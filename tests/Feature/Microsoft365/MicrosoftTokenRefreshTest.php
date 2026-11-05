<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Microsoft365\Graph\GraphCalendarClient;
use App\Microsoft365\Graph\GraphException;
use App\Microsoft365\Graph\MicrosoftTokenService;
use App\Microsoft365\Graph\OutlookMeetingEligibility;
use App\Microsoft365\Graph\OutlookMeetingSyncService;
use App\Microsoft365\Graph\SyncOutcome;
use App\Microsoft365\Graph\SyncStatus;
use App\Microsoft365\Http\Controllers\OutlookMeetingController;
use App\Microsoft365\Http\Middleware\EnsureMicrosoftIsEnabled;
use App\Microsoft365\Http\Requests\MeetingRangeRequest;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookSyncWindow;
use App\Models\User;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

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
}
