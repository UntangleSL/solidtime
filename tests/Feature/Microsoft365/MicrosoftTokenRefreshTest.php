<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Microsoft365\Auth\MicrosoftIdentity;
use App\Microsoft365\Auth\MicrosoftIdentityGuard;
use App\Microsoft365\Auth\MicrosoftIdentityResolver;
use App\Microsoft365\Graph\GraphCalendarClient;
use App\Microsoft365\Graph\GraphException;
use App\Microsoft365\Graph\MicrosoftTokenService;
use App\Microsoft365\Graph\OutlookMeetingEligibility;
use App\Microsoft365\Graph\OutlookMeetingSyncService;
use App\Microsoft365\Graph\SyncOutcome;
use App\Microsoft365\Graph\SyncStatus;
use App\Microsoft365\Http\Controllers\MicrosoftAccountController;
use App\Microsoft365\Http\Controllers\MicrosoftAuthController;
use App\Microsoft365\Http\Controllers\OutlookMeetingController;
use App\Microsoft365\Http\Middleware\EnsureMicrosoftIsEnabled;
use App\Microsoft365\Http\Requests\MeetingRangeRequest;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookSyncWindow;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;
use TiMacDonald\Log\LogEntry;

#[CoversClass(MicrosoftTokenService::class)]
#[UsesClass(OutlookMeetingSyncService::class)]
#[UsesClass(GraphCalendarClient::class)]
#[UsesClass(OutlookMeetingEligibility::class)]
#[UsesClass(OutlookMeetingController::class)]
#[UsesClass(MeetingRangeRequest::class)]
#[UsesClass(SyncOutcome::class)]
#[UsesClass(SyncStatus::class)]
#[UsesClass(GraphException::class)]
#[UsesClass(MicrosoftAccount::class)]
#[UsesClass(OutlookMeeting::class)]
#[UsesClass(OutlookSyncWindow::class)]
#[UsesClass(EnsureMicrosoftIsEnabled::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
#[UsesClass(MicrosoftAccountController::class)]
#[UsesClass(MicrosoftAuthController::class)]
#[UsesClass(MicrosoftIdentityResolver::class)]
#[UsesClass(MicrosoftIdentityGuard::class)]
#[UsesClass(MicrosoftIdentity::class)]
class MicrosoftTokenRefreshTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

    private const string TOKEN_URL_PART = 'login.microsoftonline.com';

    /**
     * @return array<string, mixed>
     */
    private function refreshSuccess(): array
    {
        return ['access_token' => 'at-new-5b2e', 'expires_in' => 3600, 'refresh_token' => 'rt-new-8c4a'];
    }

    private function createUser(): User
    {
        return User::factory()->withPersonalOrganization()->create();
    }

    private function postSync(User $user): TestResponse
    {
        $this->actingAs($user);

        return $this->postJson(route('microsoft.meetings.sync', [], false), $this->fixtureWindow());
    }

    /**
     * @return list<Request>
     */
    private function recordedTokenRequests(): array
    {
        $requests = [];
        foreach (Http::recorded() as [$request]) {
            if (str_contains($request->url(), self::TOKEN_URL_PART)) {
                $requests[] = $request;
            }
        }

        return $requests;
    }

    /**
     * @return list<Request>
     */
    private function recordedGraphRequests(): array
    {
        $requests = [];
        foreach (Http::recorded() as [$request]) {
            if (str_contains($request->url(), 'graph.microsoft.com')) {
                $requests[] = $request;
            }
        }

        return $requests;
    }

    private function rawColumn(MicrosoftAccount $account, string $column): ?string
    {
        $value = DB::table('microsoft_accounts')->where('id', '=', $account->getKey())->value($column);

        return is_string($value) ? $value : null;
    }

    public function test_expired_access_token_is_refreshed_once_and_sync_succeeds(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user, expired: true);
        $this->fakeTokenEndpoint($this->refreshSuccess(), graph: $this->graphSequence([]));

        // Act
        $response = $this->postSync($user);

        // Assert
        $response->assertOk()->assertJsonPath('status', 'ok');
        $tokenRequests = $this->recordedTokenRequests();
        $this->assertCount(1, $tokenRequests);
        $this->assertSame(
            'https://login.microsoftonline.com/'.self::MICROSOFT_TEST_TENANT_ID.'/oauth2/v2.0/token',
            $tokenRequests[0]->url()
        );
        $this->assertSame([
            'client_id' => self::MICROSOFT_TEST_CLIENT_ID,
            'client_secret' => 'fake-secret',
            'grant_type' => 'refresh_token',
            'refresh_token' => 'rt-marker-9d1e',
            'scope' => 'Calendars.Read offline_access',
        ], $tokenRequests[0]->data());
        $graphRequests = $this->recordedGraphRequests();
        $this->assertCount(22, $graphRequests);
        foreach ($graphRequests as $graphRequest) {
            $this->assertSame('Bearer at-new-5b2e', $graphRequest->header('Authorization')[0] ?? null);
        }
        $this->assertSame(12, OutlookMeeting::query()->where('user_id', '=', $user->getKey())->count());
    }

    public function test_refresh_rotates_tokens_encrypted_in_one_save(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->connectedAccount($user, expired: true);
        $this->fakeTokenEndpoint($this->refreshSuccess(), graph: $this->graphSequence([]));

        // Act
        $this->postSync($user)->assertOk();

        // Assert
        $fresh = MicrosoftAccount::query()->findOrFail($account->getKey());
        $this->assertSame('at-new-5b2e', $fresh->access_token);
        $this->assertSame('rt-new-8c4a', $fresh->refresh_token);
        $this->assertNotNull($fresh->access_token_expires_at);
        $this->assertEqualsWithDelta(Carbon::now()->addSeconds(3600)->getTimestamp(), $fresh->access_token_expires_at->getTimestamp(), 30);
        $this->assertSame(['openid', 'profile', 'email', 'offline_access', 'User.Read', 'Calendars.Read'], $fresh->scopes);
        $rawAccess = $this->rawColumn($account, 'access_token');
        $rawRefresh = $this->rawColumn($account, 'refresh_token');
        $this->assertNotNull($rawAccess);
        $this->assertNotNull($rawRefresh);
        $this->assertNotSame('at-new-5b2e', $rawAccess);
        $this->assertNotSame('rt-new-8c4a', $rawRefresh);
        $this->assertStringNotContainsString('at-new-5b2e', $rawAccess);
        $this->assertStringNotContainsString('rt-new-8c4a', $rawRefresh);
    }

    public function test_refresh_without_new_refresh_token_keeps_the_old_one(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->connectedAccount($user, expired: true);
        $this->fakeTokenEndpoint(['access_token' => 'at-new-5b2e', 'expires_in' => 3600], graph: $this->graphSequence([]));

        // Act
        $this->postSync($user)->assertOk();

        // Assert
        $fresh = MicrosoftAccount::query()->findOrFail($account->getKey());
        $this->assertSame('at-new-5b2e', $fresh->access_token);
        $this->assertSame('rt-marker-9d1e', $fresh->refresh_token);
    }

    public function test_token_far_from_expiry_is_used_without_refresh(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->fakeTokenEndpoint($this->refreshSuccess(), graph: $this->graphSequence([]));

        // Act
        $response = $this->postSync($user);

        // Assert
        $response->assertOk()->assertJsonPath('status', 'ok');
        $this->assertCount(0, $this->recordedTokenRequests());
        foreach ($this->recordedGraphRequests() as $graphRequest) {
            $this->assertSame('Bearer at-marker-7f3c', $graphRequest->header('Authorization')[0] ?? null);
        }
    }

    public function test_token_within_skew_is_refreshed(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->connectedAccount($user);
        $account->access_token_expires_at = Carbon::now()->addSeconds(60);
        $account->save();
        $this->fakeTokenEndpoint($this->refreshSuccess(), graph: $this->graphSequence([]));

        // Act
        $response = $this->postSync($user);

        // Assert
        $response->assertOk()->assertJsonPath('status', 'ok');
        $this->assertCount(1, $this->recordedTokenRequests());
    }

    /**
     * @return array<string, array{string}>
     */
    public static function terminalErrors(): array
    {
        return [
            'invalid_grant' => ['invalid_grant'],
            'interaction_required' => ['interaction_required'],
            'consent_required' => ['consent_required'],
        ];
    }

    /**
     * @return array<string, array{string, int}>
     */
    public static function operatorErrors(): array
    {
        return [
            'invalid_client' => ['invalid_client', 401],
            'unauthorized_client' => ['unauthorized_client', 400],
            'invalid_request' => ['invalid_request', 400],
            'invalid_scope' => ['invalid_scope', 400],
            'unsupported_grant_type' => ['unsupported_grant_type', 400],
            'invalid_resource' => ['invalid_resource', 400],
        ];
    }

    /**
     * @return array<string, array{int}>
     */
    public static function rejectedGraphStatuses(): array
    {
        return ['401' => [401], '403' => [403]];
    }

    /**
     * @return array<string, array{array<int, string>|null}>
     */
    public static function scopesThatDoNotBlock(): array
    {
        return [
            'empty' => [[]],
            'missing' => [null],
            'case-insensitive' => [['openid', 'calendars.read']],
        ];
    }

    private function assertTokensKept(MicrosoftAccount $account): void
    {
        $fresh = MicrosoftAccount::query()->findOrFail($account->getKey());
        $this->assertSame('at-marker-7f3c', $fresh->access_token);
        $this->assertSame('rt-marker-9d1e', $fresh->refresh_token);
        $this->assertNotNull($fresh->access_token_expires_at);
        $this->assertNull($fresh->reconnect_required_at);
    }

    #[DataProvider('terminalErrors')]
    public function test_terminal_errors_require_reconnect_and_clear_tokens(string $error): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->connectedAccount($user, expired: true);
        $this->fakeTokenEndpoint([
            'error' => $error,
            'error_description' => 'AADSTS70008: The refresh token has expired. Trace ID: 0000',
        ], 400);

        // Act
        $first = $this->postSync($user);
        $second = $this->postSync($user);

        // Assert
        $first->assertOk()->assertJsonPath('status', 'reconnect');
        $second->assertOk()->assertJsonPath('status', 'reconnect');
        $fresh = MicrosoftAccount::query()->findOrFail($account->getKey());
        $this->assertNotNull($fresh->reconnect_required_at);
        $this->assertNull($fresh->access_token);
        $this->assertNull($fresh->refresh_token);
        $this->assertNull($fresh->access_token_expires_at);
        $this->assertSame('reconnect', $fresh->calendarAccessState());
        // One token request in total: the second sync answers from the stored marker without any HTTP request
        Http::assertSentCount(1);
    }

    #[DataProvider('operatorErrors')]
    public function test_operator_errors_keep_tokens_and_answer_unavailable(string $error, int $status): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->connectedAccount($user, expired: true);
        $this->fakeTokenEndpoint([
            'error' => $error,
            'error_description' => 'AADSTS7000215: Invalid client secret provided. Trace ID: 0000',
        ], $status);

        // Act
        $response = $this->postSync($user);

        // Assert
        $response->assertOk()->assertJsonPath('status', 'unavailable');
        $this->assertTokensKept($account);
        $this->assertCount(1, $this->recordedTokenRequests());
        $this->assertCount(0, $this->recordedGraphRequests());
    }

    public function test_transient_errors_answer_unavailable(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->connectedAccount($user, expired: true);
        Http::fake([
            'https://login.microsoftonline.com/*/oauth2/v2.0/token' => Http::sequence()
                ->push(['error' => 'temporarily_unavailable'], 503)
                ->push(['error' => 'server_error'], 500)
                ->push('<html>bad gateway</html>', 502)
                ->pushFailedConnection(),
        ]);

        // Act
        $statuses = [];
        for ($attempt = 0; $attempt < 4; $attempt++) {
            $statuses[] = $this->postSync($user)->assertOk()->json('status');
        }

        // Assert
        $this->assertSame(['unavailable', 'unavailable', 'unavailable', 'unavailable'], $statuses);
        $this->assertTokensKept($account);
        $this->assertCount(4, $this->recordedTokenRequests());
    }

    public function test_unconfigured_integration_sends_no_token_request(): void
    {
        // Arrange
        $this->configureMicrosoft365(overrides: ['client_secret' => '']);
        $user = $this->createUser();
        $account = $this->connectedAccount($user, expired: true);
        $this->fakeTokenEndpoint($this->refreshSuccess());

        // Act
        $outcome = app(OutlookMeetingSyncService::class)->sync(
            $user,
            CarbonImmutable::parse($this->fixtureWindow()['start']),
            CarbonImmutable::parse($this->fixtureWindow()['end'])
        );

        // Assert
        $this->assertSame(SyncStatus::Unavailable, $outcome->status);
        Http::assertNothingSent();
        $this->assertTokensKept($account);
    }

    public function test_graph_401_refreshes_once_and_retries_the_page(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->fakeTokenEndpoint(
            $this->refreshSuccess(),
            graph: $this->graphSequence([Http::response(['error' => ['code' => 'InvalidAuthenticationToken']], 401)])
        );

        // Act
        $response = $this->postSync($user);

        // Assert
        $response->assertOk()->assertJsonPath('status', 'ok');
        $this->assertCount(1, $this->recordedTokenRequests());
        $graphRequests = $this->recordedGraphRequests();
        $this->assertCount(23, $graphRequests);
        $this->assertSame('Bearer at-marker-7f3c', $graphRequests[0]->header('Authorization')[0] ?? null);
        $this->assertSame('Bearer at-new-5b2e', $graphRequests[1]->header('Authorization')[0] ?? null);
        $this->assertSame($graphRequests[0]->url(), $graphRequests[1]->url());
        $this->assertSame(12, OutlookMeeting::query()->where('user_id', '=', $user->getKey())->count());
    }

    #[DataProvider('rejectedGraphStatuses')]
    public function test_second_graph_rejection_requires_reconnect(int $status): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->connectedAccount($user);
        $this->fakeTokenEndpoint(
            $this->refreshSuccess(),
            graph: $this->graphSequence([
                Http::response(['error' => ['code' => 'denied']], $status),
                Http::response(['error' => ['code' => 'denied']], $status),
            ])
        );

        // Act
        $response = $this->postSync($user);

        // Assert
        $response->assertOk()->assertJsonPath('status', 'reconnect');
        $this->assertCount(1, $this->recordedTokenRequests());
        $this->assertCount(2, $this->recordedGraphRequests());
        $fresh = MicrosoftAccount::query()->findOrFail($account->getKey());
        $this->assertNotNull($fresh->reconnect_required_at);
        $this->assertNull($fresh->access_token);
        $this->assertNull($fresh->refresh_token);
        $this->assertSame(0, OutlookMeeting::query()->count());
    }

    public function test_missing_calendars_read_scope_requires_reconnect_without_http(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->connectedAccount($user);
        $account->scopes = ['openid', 'User.Read'];
        $account->save();
        $this->fakeTokenEndpoint($this->refreshSuccess());

        // Act
        $response = $this->postSync($user);

        // Assert
        $response->assertOk()->assertJsonPath('status', 'reconnect');
        Http::assertNothingSent();
    }

    /**
     * @param  array<int, string>|null  $scopes
     */
    #[DataProvider('scopesThatDoNotBlock')]
    public function test_unknown_or_complete_scopes_do_not_block(?array $scopes): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->connectedAccount($user);
        $account->scopes = $scopes;
        $account->save();
        $this->fakeTokenEndpoint($this->refreshSuccess(), graph: $this->graphSequence([]));

        // Act
        $response = $this->postSync($user);

        // Assert
        $response->assertOk()->assertJsonPath('status', 'ok');
        $this->assertSame('connected', MicrosoftAccount::query()->findOrFail($account->getKey())->calendarAccessState());
    }

    public function test_post_lock_check_reuses_a_concurrently_refreshed_token(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $created = $this->connectedAccount($user, expired: true);
        $stale = MicrosoftAccount::query()->findOrFail($created->getKey());
        $winner = MicrosoftAccount::query()->findOrFail($created->getKey());
        $winner->access_token = 'at-won-1111';
        $winner->access_token_expires_at = Carbon::now()->addHour();
        $winner->save();
        $this->assertNotSame('at-won-1111', $stale->access_token);
        $this->fakeTokenEndpoint($this->refreshSuccess());

        // Act
        $token = app(MicrosoftTokenService::class)->accessToken($stale);

        // Assert
        $this->assertSame('at-won-1111', $token);
        $this->assertSame('at-won-1111', $stale->access_token);
        Http::assertNothingSent();
    }

    public function test_connect_and_sign_in_clear_the_reconnect_marker(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->connectedAccount($user);
        $mark = function () use ($account): void {
            $row = MicrosoftAccount::query()->findOrFail($account->getKey());
            $row->reconnect_required_at = Carbon::now();
            $row->access_token = null;
            $row->refresh_token = null;
            $row->access_token_expires_at = null;
            $row->save();
        };
        $callbackUrl = route('microsoft.callback', ['code' => 'fake-code', 'state' => 'fake-state'], false);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());

        // Act: connect
        $mark();
        $this->actingAs($user);
        $this->get(route('microsoft.redirect', ['intent' => 'connect'], false))->assertRedirect();
        $this->get($callbackUrl)->assertRedirect(route('profile.show', [], false));

        // Assert: connect
        $afterConnect = MicrosoftAccount::query()->findOrFail($account->getKey());
        $this->assertNull($afterConnect->reconnect_required_at);
        $this->assertSame('rt-marker-9d1e', $afterConnect->refresh_token);
        $this->assertSame('connected', $afterConnect->calendarAccessState());

        // Act: plain sign-in
        $mark();
        Auth::guard('web')->logout();
        $this->flushSession();
        $this->get($callbackUrl)->assertRedirect();
        $this->assertAuthenticatedAs($user);

        // Assert: plain sign-in
        $afterSignIn = MicrosoftAccount::query()->findOrFail($account->getKey());
        $this->assertNull($afterSignIn->reconnect_required_at);
        $this->assertSame('connected', $afterSignIn->calendarAccessState());
    }

    public function test_disconnect_clears_graph_state(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->connectedAccount($user);
        $account->reconnect_required_at = Carbon::now()->subMinute();
        $account->graph_backoff_until = Carbon::now()->addMinutes(5);
        $account->save();
        $this->actingAs($user);

        // Act
        $this->delete(route('microsoft.account.destroy', [], false))->assertRedirect(route('profile.show', [], false));

        // Assert
        $fresh = MicrosoftAccount::query()->findOrFail($account->getKey());
        $this->assertNull($fresh->reconnect_required_at);
        $this->assertNull($fresh->graph_backoff_until);
        $this->assertNotNull($fresh->disconnected_at);
        $this->assertSame('not_connected', $fresh->calendarAccessState());
    }

    public function test_refresh_logs_carry_no_secrets(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $users = [$this->createUser(), $this->createUser(), $this->createUser()];
        foreach ($users as $index => $user) {
            $account = $this->connectedAccount($user, expired: true);
            // connectedAccount uses one identity: give each extra account its own object id
            $account->microsoft_oid = sprintf('00000000-0000-4000-8000-0000000002%02d', $index);
            $account->save();
        }
        Http::fake([
            'https://login.microsoftonline.com/*/oauth2/v2.0/token' => Http::sequence()
                ->push(['error' => 'invalid_grant', 'error_description' => 'AADSTS70008: desc-marker-aa11 Trace ID: t'], 400)
                ->push(['error' => 'invalid_client', 'error_description' => 'AADSTS7000215: desc-marker-bb22 Trace ID: t'], 401)
                ->push(['error' => 'server_error', 'error_description' => 'desc-marker-cc33'], 500),
        ]);

        // Act
        foreach ($users as $user) {
            $this->postSync($user)->assertOk();
        }

        // Assert
        $failures = Log::allLogs()
            ->filter(fn (LogEntry $log): bool => $log->message === 'Microsoft token refresh failed')
            ->values();
        $this->assertCount(3, $failures);
        $this->assertSame(['reason' => 'terminal', 'provider_code' => 'AADSTS70008'], $failures[0]->context);
        $this->assertSame(['reason' => 'client_error', 'provider_code' => 'AADSTS7000215'], $failures[1]->context);
        $this->assertSame(['reason' => 'transient', 'provider_code' => null], $failures[2]->context);
        $everything = json_encode(Log::allLogs()->map(fn (LogEntry $log): array => $log->toArray())->all());
        $this->assertIsString($everything);
        foreach (['at-marker-7f3c', 'rt-marker-9d1e', 'fake-secret', 'desc-marker-aa11', 'desc-marker-bb22', 'desc-marker-cc33'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $everything);
        }
    }

    public function test_graph_requests_are_read_only(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user, expired: true);
        $this->fakeTokenEndpoint(
            $this->refreshSuccess(),
            graph: $this->graphSequence([Http::response(['error' => ['code' => 'InvalidAuthenticationToken']], 401)])
        );

        // Act
        $this->postSync($user)->assertOk()->assertJsonPath('status', 'ok');

        // Assert
        $graphRequests = $this->recordedGraphRequests();
        $this->assertNotEmpty($graphRequests);
        foreach ($graphRequests as $graphRequest) {
            $this->assertSame('GET', $graphRequest->method());
        }
        $tokenRequests = $this->recordedTokenRequests();
        $this->assertCount(2, $tokenRequests);
        foreach ($tokenRequests as $tokenRequest) {
            $this->assertSame('Calendars.Read offline_access', $tokenRequest->data()['scope'] ?? null);
        }
    }
}
