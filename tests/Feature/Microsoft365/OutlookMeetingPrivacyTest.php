<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Microsoft365\Graph\GraphAccessGuard;
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
use App\Microsoft365\Http\Middleware\ShareMicrosoftInertiaData;
use App\Microsoft365\Http\Requests\MeetingRangeRequest;
use App\Microsoft365\Http\Resources\OutlookMeetingResource;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookSyncWindow;
use App\Models\Member;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use Laravel\Passport\Passport;
use OwenIt\Auditing\Contracts\Auditable;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use STS\FilamentImpersonate\ImpersonateManager;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;
use TiMacDonald\Log\LogEntry;

/**
 * CAL-03 / D-16 (meetings are visible only to their owner), D-21 (Disconnect purges) and D-22 (an
 * impersonating admin sees nothing and never causes a Graph call), plus the leak matrix over logs,
 * audits, admin screens and time entries.
 */
#[CoversClass(GraphAccessGuard::class)]
#[UsesClass(MicrosoftTokenService::class)]
#[UsesClass(OutlookMeetingSyncService::class)]
#[UsesClass(OutlookMeetingController::class)]
#[UsesClass(MicrosoftAccountController::class)]
#[UsesClass(MicrosoftAuthController::class)]
#[UsesClass(ShareMicrosoftInertiaData::class)]
#[UsesClass(GraphCalendarClient::class)]
#[UsesClass(OutlookMeetingEligibility::class)]
#[UsesClass(MeetingRangeRequest::class)]
#[UsesClass(OutlookMeetingResource::class)]
#[UsesClass(SyncOutcome::class)]
#[UsesClass(SyncStatus::class)]
#[UsesClass(GraphException::class)]
#[UsesClass(MicrosoftAccount::class)]
#[UsesClass(OutlookMeeting::class)]
#[UsesClass(OutlookSyncWindow::class)]
#[UsesClass(EnsureMicrosoftIsEnabled::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
class OutlookMeetingPrivacyTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

    private const string GRAPH_URL = 'https://graph.microsoft.com/v1.0/me/calendarView*';

    private const string TOKEN_URL = 'https://login.microsoftonline.com/*/oauth2/v2.0/token';

    private function createUser(): User
    {
        return User::factory()->withPersonalOrganization()->create();
    }

    /**
     * Same distinct-per-index Microsoft object id scheme for every test that links several users.
     */
    private function objectId(int $index): string
    {
        return sprintf('00000000-0000-4000-8000-0000000002%02d', $index);
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function meeting(User $user, string $graphId, array $overrides = []): OutlookMeeting
    {
        return OutlookMeeting::query()->create(array_merge([
            'user_id' => $user->getKey(),
            'graph_id' => $graphId,
            'event_type' => 'singleInstance',
            'subject' => 'Subject '.$graphId,
            'starts_at' => '2026-10-20 09:00:00',
            'ends_at' => '2026-10-20 10:00:00',
            'organizer_name' => 'Org Name',
            'is_organizer' => false,
            'is_online_meeting' => true,
            'web_link' => 'https://outlook.office.com/owa/?itemid='.$graphId,
            'last_seen_at' => '2026-10-19 00:00:00',
        ], $overrides));
    }

    private function syncWindow(User $user, string $start, string $end): OutlookSyncWindow
    {
        return OutlookSyncWindow::query()->create([
            'user_id' => $user->getKey(),
            'window_start' => $start,
            'window_end' => $end,
            'synced_at' => '2026-10-19 12:00:00',
        ]);
    }

    private function getMeetings(): TestResponse
    {
        return $this->getJson(route('microsoft.meetings.index', $this->fixtureWindow(), false));
    }

    private function postSync(): TestResponse
    {
        return $this->postJson(route('microsoft.meetings.sync', [], false), $this->fixtureWindow());
    }

    private function dismiss(string $id): TestResponse
    {
        return $this->postJson(route('microsoft.meetings.dismiss', ['meeting' => $id], false));
    }

    private function restore(string $id): TestResponse
    {
        return $this->deleteJson(route('microsoft.meetings.restore', ['meeting' => $id], false));
    }

    /**
     * @return list<string>
     */
    private function subjects(TestResponse $response): array
    {
        return array_map(
            fn (array $item): string => (string) $item['subject'],
            $response->json('data'),
        );
    }

    /**
     * The Graph id of the first event of round A whose subject starts with the given text.
     */
    private function roundAEventId(string $subjectPrefix): string
    {
        foreach ($this->graphPages('A') as $page) {
            foreach ($page['value'] as $event) {
                if (str_starts_with((string) $event['subject'], $subjectPrefix)) {
                    return (string) $event['id'];
                }
            }
        }
        $this->fail('No round A event with subject '.$subjectPrefix);
    }

    private function startImpersonation(): void
    {
        // The session key of stechstudio/filament-impersonate: the id of the admin who impersonates
        session()->put(ImpersonateManager::SESSION_KEY, 1);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function timeEntrySnapshot(): array
    {
        return TimeEntry::query()
            ->orderBy('id')
            ->get(['id', 'start', 'end', 'description', 'project_id', 'user_id', 'member_id', 'organization_id'])
            ->map(fn (TimeEntry $entry): array => $entry->getAttributes())
            ->all();
    }

    /**
     * @return array<string, mixed>
     */
    private function accountRow(MicrosoftAccount $account): array
    {
        return (array) DB::table('microsoft_accounts')->where('id', '=', $account->getKey())->first();
    }

    public function test_impersonation_hides_meetings_and_blocks_graph(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $visible = $this->meeting($user, 'visible');
        $dismissed = $this->meeting($user, 'dismissed', ['dismissed_at' => '2026-10-19 08:00:00', 'starts_at' => '2026-10-21 09:00:00', 'ends_at' => '2026-10-21 10:00:00']);
        $this->syncWindow($user, '2026-10-19 00:00:00', '2026-11-16 00:00:00');
        Http::fake();
        $this->actingAs($user);
        $control = $this->getMeetings();

        // Act
        $this->startImpersonation();
        $read = $this->getMeetings();
        $sync = $this->postSync();
        $dismissAttempt = $this->dismiss($visible->id);
        $restoreAttempt = $this->restore($dismissed->id);

        // Assert
        $control->assertOk();
        $control->assertJsonCount(1, 'data');
        $this->assertNotNull($control->json('sync.last_synced_at'));
        $read->assertOk();
        $read->assertExactJson(['data' => [], 'sync' => ['last_synced_at' => null, 'retry_after' => null]]);
        $sync->assertOk();
        $sync->assertJsonPath('status', 'not_connected');
        $dismissAttempt->assertNotFound();
        $restoreAttempt->assertNotFound();
        $this->assertNull($visible->refresh()->dismissed_at);
        $this->assertNotNull($dismissed->refresh()->dismissed_at);
        $this->assertSame(1, OutlookSyncWindow::query()->count());
        Http::assertNothingSent();
    }

    public function test_token_service_refuses_while_impersonating(): void
    {
        // Arrange: an expired token, so that without the guard a refresh would be sent
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->connectedAccount($user, expired: true);
        $this->fakeTokenEndpoint(['access_token' => 'at-new', 'expires_in' => 3600, 'refresh_token' => 'rt-new']);
        $before = $this->accountRow($account);
        $this->startImpersonation();

        // Act
        $status = null;
        try {
            app(MicrosoftTokenService::class)->accessToken($account);
        } catch (GraphException $exception) {
            $status = $exception->status;
        }

        // Assert
        $this->assertSame(SyncStatus::NotConnected, $status);
        $this->assertSame($before, $this->accountRow($account));
        Http::assertNothingSent();
    }

    public function test_sync_service_answers_not_connected_without_any_request_while_impersonating(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->fakeGraphCalendar('A');
        $this->startImpersonation();
        $window = $this->fixtureWindow();

        // Act
        $outcome = app(OutlookMeetingSyncService::class)->sync(
            $user,
            CarbonImmutable::parse($window['start']),
            CarbonImmutable::parse($window['end']),
            true,
        );

        // Assert
        $this->assertSame(SyncStatus::NotConnected, $outcome->status);
        $this->assertSame(0, OutlookMeeting::query()->count());
        $this->assertSame(0, OutlookSyncWindow::query()->count());
        Http::assertNothingSent();
    }

    public function test_calendar_prop_is_omitted_while_impersonating(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->actingAs($user);

        // Act
        $normal = $this->get(route('calendar', [], false));
        $this->startImpersonation();
        $impersonated = $this->get(route('calendar', [], false));

        // Assert
        $normal->assertOk();
        $normal->assertInertia(fn ($page) => $page
            ->where('microsoft.enabled', true)
            ->where('microsoft.calendar.state', 'connected')
            ->etc());
        $impersonated->assertOk();
        $impersonated->assertInertia(fn ($page) => $page
            ->where('microsoft.enabled', true)
            ->missing('microsoft.calendar')
            ->etc());
    }

    public function test_disconnect_purges_meetings_windows_and_dismissals(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->connectedAccount($user);
        $this->meeting($user, 'one');
        $this->meeting($user, 'two', ['starts_at' => '2026-10-21 09:00:00', 'ends_at' => '2026-10-21 10:00:00']);
        $this->meeting($user, 'three', ['dismissed_at' => '2026-10-19 08:00:00', 'starts_at' => '2026-10-22 09:00:00', 'ends_at' => '2026-10-22 10:00:00']);
        $this->syncWindow($user, '2026-10-19 00:00:00', '2026-10-26 00:00:00');
        $this->syncWindow($user, '2026-10-26 00:00:00', '2026-11-02 00:00:00');
        $other = $this->createUser();
        $this->connectedAccount($other, objectId: $this->objectId(1));
        $this->meeting($other, 'other-one', ['dismissed_at' => '2026-10-19 08:00:00']);
        $this->syncWindow($other, '2026-10-19 00:00:00', '2026-10-26 00:00:00');
        $member = Member::query()->where('user_id', '=', $user->getKey())->firstOrFail();
        TimeEntry::factory()->forMember($member)->count(3)->create();
        $timeEntries = $this->timeEntrySnapshot();
        $this->actingAs($user);

        // Act
        $response = $this->delete(route('microsoft.account.destroy', [], false));

        // Assert
        $response->assertRedirect(route('profile.show', [], false));
        $this->assertSame(0, OutlookMeeting::query()->where('user_id', '=', $user->getKey())->count());
        $this->assertSame(0, OutlookSyncWindow::query()->where('user_id', '=', $user->getKey())->count());
        $this->assertSame(1, OutlookMeeting::query()->where('user_id', '=', $other->getKey())->count());
        $this->assertNotNull(OutlookMeeting::query()->where('user_id', '=', $other->getKey())->firstOrFail()->dismissed_at);
        $this->assertSame(1, OutlookSyncWindow::query()->where('user_id', '=', $other->getKey())->count());
        $fresh = MicrosoftAccount::query()->findOrFail($account->getKey());
        $this->assertNull($fresh->access_token);
        $this->assertNull($fresh->refresh_token);
        $this->assertNotNull($fresh->disconnected_at);
        $this->assertSame($timeEntries, $this->timeEntrySnapshot());
    }

    public function test_disconnect_without_a_link_row_still_purges_leftovers(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->meeting($user, 'leftover');
        $this->syncWindow($user, '2026-10-19 00:00:00', '2026-10-26 00:00:00');
        $this->actingAs($user);

        // Act
        $response = $this->delete(route('microsoft.account.destroy', [], false));

        // Assert
        $response->assertRedirect(route('profile.show', [], false));
        $this->assertSame(0, OutlookMeeting::query()->count());
        $this->assertSame(0, OutlookSyncWindow::query()->count());
        $this->assertSame(0, MicrosoftAccount::query()->count());
    }

    public function test_reconnect_after_disconnect_refetches_without_old_dismissals(): void
    {
        // Arrange: a dismissed meeting that Outlook will return again after the reconnect
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->meeting($user, $this->roundAEventId('[M365-TEST S1]'), ['dismissed_at' => '2026-10-19 08:00:00']);
        $this->actingAs($user);
        $this->delete(route('microsoft.account.destroy', [], false))->assertRedirect(route('profile.show', [], false));
        $this->assertSame(0, OutlookMeeting::query()->count());
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->fakeGraphCalendar('A');

        // Act
        $this->get(route('microsoft.redirect', ['intent' => 'connect'], false))->assertRedirect();
        $this->get(route('microsoft.callback', ['code' => 'fake-code', 'state' => 'fake-state'], false))->assertRedirect();
        $sync = $this->postSync();
        $read = $this->getMeetings();

        // Assert
        $sync->assertOk();
        $sync->assertJsonPath('status', 'ok');
        $read->assertJsonCount(12, 'data');
        $this->assertSame(12, OutlookMeeting::query()->where('user_id', '=', $user->getKey())->count());
        $this->assertSame(0, OutlookMeeting::query()->whereNotNull('dismissed_at')->count());
        $this->assertNotContains(true, array_column($read->json('data'), 'dismissed'));
    }

    public function test_read_is_empty_without_a_usable_link(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $noLink = $this->createUser();
        $this->meeting($noLink, 'no-link');
        $disconnected = $this->createUser();
        $disconnectedAccount = $this->connectedAccount($disconnected, objectId: $this->objectId(1));
        $disconnectedAccount->access_token = null;
        $disconnectedAccount->refresh_token = null;
        $disconnectedAccount->access_token_expires_at = null;
        $disconnectedAccount->disconnected_at = Carbon::now();
        $disconnectedAccount->save();
        $this->meeting($disconnected, 'leftover');
        $reconnect = $this->createUser();
        $reconnectAccount = $this->connectedAccount($reconnect, objectId: $this->objectId(2));
        $reconnectAccount->reconnect_required_at = Carbon::now();
        $reconnectAccount->save();
        $this->meeting($reconnect, 'last-known');

        // Act
        $this->actingAs($noLink);
        $noLinkRead = $this->getMeetings();
        $this->actingAs($disconnected);
        $disconnectedRead = $this->getMeetings();
        $this->actingAs($reconnect);
        $reconnectRead = $this->getMeetings();

        // Assert
        $noLinkRead->assertOk();
        $noLinkRead->assertExactJson(['data' => [], 'sync' => ['last_synced_at' => null, 'retry_after' => null]]);
        $disconnectedRead->assertOk();
        $disconnectedRead->assertExactJson(['data' => [], 'sync' => ['last_synced_at' => null, 'retry_after' => null]]);
        $reconnectRead->assertOk();
        $this->assertSame(['Subject last-known'], $this->subjects($reconnectRead));
    }

    public function test_each_role_sees_only_its_own_meetings(): void
    {
        // Arrange: one organization with an owner, an admin, a manager and an employee
        $this->configureMicrosoft365();
        $context = $this->createUserWithRole(Role::Owner);
        $users = ['owner' => $context->user];
        foreach ([Role::Admin, Role::Manager, Role::Employee] as $role) {
            $user = User::factory()->create();
            Member::factory()->forUser($user)->forOrganization($context->organization)->role($role)->create();
            $users[$role->value] = $user;
        }
        $ids = [];
        $index = 0;
        foreach ($users as $name => $user) {
            $this->connectedAccount($user, objectId: $this->objectId($index++));
            $ids[$name] = $this->meeting($user, 'own-'.$name)->id;
        }

        foreach ($users as $name => $user) {
            // Act: user_id and member_id parameters for somebody else must change nothing
            $this->actingAs($user);
            $response = $this->getJson(route('microsoft.meetings.index', $this->fixtureWindow() + [
                'user_id' => $context->owner->getKey(),
                'member_id' => $context->ownerMember->getKey(),
            ], false));

            // Assert
            $response->assertOk();
            $this->assertSame(['Subject own-'.$name], $this->subjects($response), $name);
            foreach ($ids as $otherName => $otherId) {
                if ($otherName === $name) {
                    continue;
                }
                $this->dismiss($otherId)->assertNotFound();
                $this->restore($otherId)->assertNotFound();
            }
        }
        $this->assertSame(4, OutlookMeeting::query()->count());
        $this->assertSame(0, OutlookMeeting::query()->whereNotNull('dismissed_at')->count());
    }

    public function test_phase_3_paths_never_touch_time_entries(): void
    {
        // Arrange: a round A traversal followed by a failing one
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $member = Member::query()->where('user_id', '=', $user->getKey())->firstOrFail();
        TimeEntry::factory()->forMember($member)->count(3)->create();
        $before = $this->timeEntrySnapshot();
        Config::set('microsoft365.graph.max_pages', 30);
        $sequence = Http::sequence();
        foreach ($this->graphPages('A') as $page) {
            $sequence->push($page);
        }
        $sequence->push(['error' => ['code' => 'boom']], 500);
        Http::fake([self::GRAPH_URL => $sequence]);
        $this->actingAs($user);

        // Act
        $this->postSync()->assertJsonPath('status', 'ok');
        $id = (string) $this->getMeetings()->json('data.0.id');
        $this->dismiss($id)->assertOk();
        $this->restore($id)->assertOk();
        $this->travel(2)->minutes();
        $this->postSync()->assertJsonPath('status', 'unavailable');
        $this->delete(route('microsoft.account.destroy', [], false))->assertRedirect(route('profile.show', [], false));

        // Assert
        $this->assertSame(3, TimeEntry::query()->count());
        $this->assertSame($before, $this->timeEntrySnapshot());
    }

    public function test_reports_and_time_entry_listing_are_identical_before_and_after_a_meetings_sync(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $data = $this->createUserWithPermission(['time-entries:view:own']);
        $project = Project::factory()->forOrganization($data->organization)->create();
        foreach (['2026-10-20 08:00:00', '2026-10-21 09:00:00', '2026-10-22 10:00:00'] as $start) {
            TimeEntry::factory()
                ->forOrganization($data->organization)
                ->forMember($data->member)
                ->forProject($project)
                ->startWithDuration(Carbon::parse($start, 'UTC'), 1800)
                ->create();
        }
        $this->connectedAccount($data->user);
        $this->fakeGraphCalendar('A');
        $aggregateUrl = route('api.v1.time-entries.aggregate', [
            $data->organization->getKey(),
            'member_id' => $data->member->getKey(),
            'group' => 'project',
        ]);
        $listUrl = route('api.v1.time-entries.index', [
            $data->organization->getKey(),
            'member_id' => $data->member->getKey(),
        ]);
        Passport::actingAs($data->user);
        $aggregateBefore = $this->getJson($aggregateUrl)->assertOk()->json();
        $listBefore = $this->getJson($listUrl)->assertOk()->json();

        // Act
        $this->actingAs($data->user);
        $this->postSync()->assertJsonPath('status', 'ok');
        Passport::actingAs($data->user);
        $aggregateAfter = $this->getJson($aggregateUrl)->assertOk()->json();
        $listAfter = $this->getJson($listUrl)->assertOk()->json();

        // Assert
        $this->assertSame(12, OutlookMeeting::query()->count());
        $this->assertSame(3, $listBefore['meta']['total'] ?? count($listBefore['data']));
        $this->assertSame($aggregateBefore, $aggregateAfter);
        $this->assertSame($listBefore, $listAfter);
    }

    public function test_no_sensitive_values_in_logs(): void
    {
        // Arrange: one Http::fake scripts every scenario, in the order the users act below
        $this->configureMicrosoft365();
        $secret = (string) config('microsoft365.client_secret');
        Config::set('microsoft365.graph.max_pages', 30);
        $graph = Http::sequence()
            ->push(['error' => ['code' => 'TooManyRequests']], 429, ['Retry-After' => '5'])
            ->push(['error' => ['code' => 'boom']], 500);
        foreach ($this->graphPages('A') as $page) {
            $graph->push($page);
        }
        Http::fake([
            self::TOKEN_URL => Http::response([
                'error' => 'invalid_client',
                'error_description' => 'AADSTS7000215: desc-marker-aa11 invalid client secret',
            ], 401),
            self::GRAPH_URL => $graph,
        ]);
        $expired = $this->createUser();
        $this->connectedAccount($expired, expired: true, objectId: $this->objectId(1));
        $throttled = $this->createUser();
        $this->connectedAccount($throttled, objectId: $this->objectId(2));
        $unavailable = $this->createUser();
        $this->connectedAccount($unavailable, objectId: $this->objectId(3));
        $working = $this->createUser();
        $this->connectedAccount($working, objectId: $this->objectId(4));

        // Act
        $this->actingAs($expired);
        $refreshFailed = $this->postSync();
        $this->actingAs($throttled);
        $throttledSync = $this->postSync();
        $this->actingAs($unavailable);
        $unavailableSync = $this->postSync();
        $this->actingAs($working);
        $okSync = $this->postSync();
        $id = (string) $this->getMeetings()->json('data.0.id');
        $this->dismiss($id)->assertOk();
        $this->restore($id)->assertOk();
        $this->delete(route('microsoft.account.destroy', [], false))->assertRedirect(route('profile.show', [], false));

        // Assert
        $refreshFailed->assertJsonPath('status', 'unavailable');
        $throttledSync->assertJsonPath('status', 'throttled');
        $unavailableSync->assertJsonPath('status', 'unavailable');
        $okSync->assertJsonPath('status', 'ok');
        $this->assertNotEmpty(Log::allLogs());
        $everything = json_encode(Log::allLogs()->map(fn (LogEntry $log): array => $log->toArray())->all());
        $this->assertIsString($everything);
        $this->assertNotSame('', $secret);
        foreach (['at-marker-7f3c', 'rt-marker-9d1e', $secret, 'desc-marker-aa11', '[M365-TEST', 'Test User', '@odata', 'outlook.example.test'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $everything, $forbidden);
        }
    }

    public function test_models_are_not_audited_and_not_in_filament(): void
    {
        // Arrange
        $filamentFiles = File::allFiles(app_path('Filament'));

        // Assert
        $this->assertNotContains(Auditable::class, class_implements(OutlookMeeting::class) ?: []);
        $this->assertNotContains(Auditable::class, class_implements(OutlookSyncWindow::class) ?: []);
        $this->assertNotEmpty($filamentFiles);
        foreach ($filamentFiles as $file) {
            $contents = $file->getContents();
            foreach (['OutlookMeeting', 'OutlookSyncWindow', 'outlook_meetings', 'outlook_sync_windows'] as $needle) {
                $this->assertStringNotContainsString($needle, $contents, $file->getPathname());
            }
        }
    }

    public function test_no_meetings_route_takes_a_user_parameter(): void
    {
        // Arrange
        $routes = array_filter(
            Route::getRoutes()->getRoutes(),
            fn (\Illuminate\Routing\Route $route): bool => str_starts_with((string) $route->getName(), 'microsoft.meetings.'),
        );

        // Assert
        $this->assertCount(4, $routes);
        foreach ($routes as $route) {
            $this->assertEmpty(array_diff($route->parameterNames(), ['meeting']), (string) $route->getName());
            $this->assertStringNotContainsString('user', $route->uri());
            $this->assertStringNotContainsString('member', $route->uri());
        }
    }
}
