<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Microsoft365\Graph\GraphAccessGuard;
use App\Microsoft365\Graph\OutlookMeetingSyncService;
use App\Microsoft365\Graph\SyncOutcome;
use App\Microsoft365\Graph\SyncStatus;
use App\Microsoft365\Http\Controllers\MeetingConversionController;
use App\Microsoft365\Http\Controllers\MicrosoftAccountController;
use App\Microsoft365\Http\Controllers\MicrosoftAuthController;
use App\Microsoft365\Http\Controllers\OutlookMeetingController;
use App\Microsoft365\Http\Controllers\OutlookSeriesController;
use App\Microsoft365\Http\Controllers\OutOfSyncController;
use App\Microsoft365\Http\Middleware\EnsureMicrosoftIsEnabled;
use App\Microsoft365\Http\Middleware\EnsureNotImpersonating;
use App\Microsoft365\Http\Middleware\ShareMicrosoftInertiaData;
use App\Microsoft365\Http\Requests\MeetingConversionRequest;
use App\Microsoft365\Http\Requests\MeetingRangeRequest;
use App\Microsoft365\Http\Resources\OutlookMeetingResource;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookMeetingLink;
use App\Microsoft365\Models\OutlookSeriesSetting;
use App\Microsoft365\Models\OutlookSyncWindow;
use App\Models\Member;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use STS\FilamentImpersonate\ImpersonateManager;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

/**
 * SEC-04 (D-07, D-08): while an admin impersonates a user, every Microsoft 365 entry point of the fork
 * is inert. No Graph or token request leaves, no OAuth gateway runs, no Microsoft identity is linked and
 * no row of the fork tables or of time_entries changes.
 */
#[CoversClass(EnsureNotImpersonating::class)]
#[UsesClass(GraphAccessGuard::class)]
#[UsesClass(MicrosoftAccountController::class)]
#[UsesClass(MicrosoftAuthController::class)]
#[UsesClass(ShareMicrosoftInertiaData::class)]
#[UsesClass(EnsureMicrosoftIsEnabled::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
#[UsesClass(MicrosoftAccount::class)]
#[UsesClass(OutlookMeeting::class)]
#[UsesClass(OutlookSyncWindow::class)]
#[UsesClass(OutlookMeetingLink::class)]
#[UsesClass(OutlookSeriesSetting::class)]
#[UsesClass(OutlookMeetingController::class)]
#[UsesClass(OutlookSeriesController::class)]
#[UsesClass(OutOfSyncController::class)]
#[UsesClass(MeetingConversionController::class)]
#[UsesClass(MeetingConversionRequest::class)]
#[UsesClass(MeetingRangeRequest::class)]
#[UsesClass(OutlookMeetingResource::class)]
#[UsesClass(OutlookMeetingSyncService::class)]
#[UsesClass(SyncOutcome::class)]
#[UsesClass(SyncStatus::class)]
class MicrosoftImpersonationMatrixTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

    /**
     * Every route served by App\Microsoft365\Http\Controllers and its outcome while an admin
     * impersonates the user: a plain 404, the empty meetings read, or a `not_connected` sync. A new fork
     * route must get a row here (test_every_fork_route_is_in_the_impersonation_matrix).
     */
    private const array MATRIX = [
        'microsoft.redirect' => '404',
        'microsoft.callback' => '404',
        'microsoft.account.destroy' => '404',
        'microsoft.meetings.index' => 'empty',
        'microsoft.meetings.sync' => 'not_connected',
        'microsoft.meetings.dismiss' => '404',
        'microsoft.meetings.restore' => '404',
        'microsoft.meetings.series.ignore' => '404',
        'microsoft.meetings.series.unignore' => '404',
        'microsoft.meetings.series.forget' => '404',
        'microsoft.meetings.convert' => '404',
        'microsoft.meetings.out-of-sync.keep' => '404',
        'microsoft.meetings.out-of-sync.adjust' => '404',
        'microsoft.meetings.move-entry' => '404',
    ];

    /** The seeded weeks of the matrix (inside the 35-day limit of MeetingRangeRequest). */
    private const array WEEK = ['start' => '2026-10-19T00:00:00Z', 'end' => '2026-11-16T00:00:00Z'];

    private const string SERIES = 'matrix-series';

    private const string OAUTH_STATE = 'matrix-state';

    /** The Microsoft object id the admin's own identity would carry: no microsoft_accounts row has it. */
    private const string ADMIN_OBJECT_ID = '00000000-0000-4000-8000-0000000007a1';

    /** Every table a Microsoft 365 route could write, plus core's time entries. All have an `id` key. */
    private const array SNAPSHOT_TABLES = [
        'microsoft_accounts',
        'outlook_meetings',
        'outlook_sync_windows',
        'outlook_meeting_links',
        'outlook_series_settings',
        'time_entries',
    ];

    private function createUser(): User
    {
        return User::factory()->withPersonalOrganization()->create();
    }

    private function startImpersonation(): void
    {
        // The session key of stechstudio/filament-impersonate: the id of the admin who impersonates
        session()->put(ImpersonateManager::SESSION_KEY, 1);
    }

    /**
     * Every row of the fork tables and of time_entries, in a stable order, as JSON per table.
     *
     * @return array<string, string>
     */
    private function forkRows(): array
    {
        $rows = [];
        foreach (self::SNAPSHOT_TABLES as $table) {
            $rows[$table] = (string) json_encode(DB::table($table)->orderBy('id')->get());
        }

        return $rows;
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

    /**
     * A time entry of the member with its link to the meeting of the same Graph id.
     *
     * @param  array<string, mixed>  $link  overrides of the link columns
     */
    private function linkedEntry(Member $member, string $graphId, string $start, string $end, array $link = []): TimeEntry
    {
        $timeEntry = TimeEntry::factory()->forMember($member)->create([
            'start' => $start,
            'end' => $end,
            'description' => 'Entry '.$graphId,
        ]);
        OutlookMeetingLink::query()->create(array_merge([
            'user_id' => $member->user_id,
            'graph_id' => $graphId,
            'time_entry_id' => $timeEntry->getKey(),
            'meeting_starts_at' => $start,
            'meeting_ends_at' => $end,
        ], $link));

        return $timeEntry;
    }

    /**
     * One request per matrix row, in the shape the route's own tests use (a valid body where the route
     * validates one, so the guard and not the validation answers).
     *
     * @param  array<string, string>  $ids
     */
    private function matrixRequest(string $name, array $ids): TestResponse
    {
        return match ($name) {
            'microsoft.redirect' => $this->get(route($name, ['intent' => 'connect'], false)),
            'microsoft.callback' => $this->get(route($name, ['code' => 'fake-code', 'state' => self::OAUTH_STATE], false)),
            'microsoft.account.destroy' => $this->delete(route($name, [], false)),
            'microsoft.meetings.index' => $this->getJson(route($name, self::WEEK, false)),
            'microsoft.meetings.sync' => $this->postJson(route($name, [], false), self::WEEK + ['force' => true]),
            'microsoft.meetings.dismiss' => $this->postJson(route($name, ['meeting' => $ids['single']], false)),
            'microsoft.meetings.restore' => $this->deleteJson(route($name, ['meeting' => $ids['dismissed']], false)),
            'microsoft.meetings.series.ignore' => $this->postJson(route($name, ['meeting' => $ids['occurrence']], false)),
            'microsoft.meetings.series.unignore',
            'microsoft.meetings.series.forget' => $this->deleteJson(route($name, ['meeting' => $ids['occurrence']], false)),
            'microsoft.meetings.convert' => $this->postJson(route($name, ['organization' => $ids['organization']], false), [
                'meeting_ids' => [$ids['single']],
                'project_id' => $ids['project'],
                'billable' => false,
            ]),
            'microsoft.meetings.out-of-sync.keep',
            'microsoft.meetings.out-of-sync.adjust' => $this->postJson(route($name, ['entry' => $ids['flagged_entry']], false)),
            'microsoft.meetings.move-entry' => $this->postJson(route($name, [
                'organization' => $ids['organization'],
                'meeting' => $ids['moved_meeting'],
            ], false)),
            default => $this->fail('No request shape for '.$name),
        };
    }

    public function test_disconnect_is_a_404_and_changes_nothing_while_impersonating(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->connectedAccount($user);
        $this->meeting($user, 'kept');
        $this->syncWindow($user, '2026-10-19 00:00:00', '2026-11-16 00:00:00');
        Http::fake();
        $this->actingAs($user, 'web');
        $this->startImpersonation();
        $before = $this->forkRows();

        // Act
        $response = $this->delete(route('microsoft.account.destroy', [], false));

        // Assert
        $response->assertNotFound();
        $this->assertSame($before, $this->forkRows());
        $this->assertNotNull($account->refresh()->refresh_token);
        Http::assertNothingSent();
    }

    public function test_connect_redirect_is_a_404_while_impersonating(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $gateway = $this->fakeMicrosoftGateway();
        Http::fake();
        $this->actingAs($user, 'web');
        $this->startImpersonation();

        // Act
        $response = $this->get(route('microsoft.redirect', ['intent' => 'connect', 'return' => 'calendar'], false));

        // Assert: refused before any session write
        $response->assertNotFound();
        $response->assertSessionMissing('microsoft.intent');
        $response->assertSessionMissing('microsoft.connect_user_id');
        $response->assertSessionMissing('microsoft.return');
        $this->assertSame(0, $gateway->authenticateCalls());
        Http::assertNothingSent();
    }

    public function test_connect_callback_is_a_404_and_links_nothing_while_impersonating(): void
    {
        // Arrange: a password user without a Microsoft link, and a Connect pending in the session as if
        // the admin had started it; the gateway would hand back the admin's own identity
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->assertNotNull($user->password);
        $gateway = $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity([
            'objectId' => self::ADMIN_OBJECT_ID,
            'graphId' => self::ADMIN_OBJECT_ID,
            'mail' => 'admin@example.test',
            'userPrincipalName' => 'admin@example.test',
        ]));
        Http::fake();
        $this->actingAs($user, 'web');
        session()->put('microsoft.intent', 'connect');
        session()->put('microsoft.connect_user_id', (string) $user->getKey());
        session()->put('microsoft.return', 'calendar');
        $this->startImpersonation();
        $before = $this->forkRows();

        // Act
        $response = $this->get(route('microsoft.callback', ['code' => 'fake-code', 'state' => 'fake-state'], false));

        // Assert
        $response->assertNotFound();
        $this->assertSame(0, $gateway->authenticateCalls());
        $this->assertSame(0, MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->count());
        $this->assertSame($before, $this->forkRows());
        $response->assertSessionMissing('microsoft.intent');
        $response->assertSessionMissing('microsoft.connect_user_id');
        $response->assertSessionMissing('microsoft.return');
        $this->assertAuthenticatedAs($user, 'web');
        Http::assertNothingSent();
    }

    public function test_profile_carries_no_microsoft_account_while_impersonating(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->actingAs($user, 'web');

        // Act
        $control = $this->get(route('profile.show', [], false));
        $this->startImpersonation();
        $impersonated = $this->get(route('profile.show', [], false));

        // Assert
        $control->assertOk();
        $control->assertInertia(fn (AssertableInertia $page) => $page
            ->where('microsoft.enabled', true)
            ->where('microsoft.account.linked', true)
            ->etc());
        $impersonated->assertOk();
        $impersonated->assertInertia(fn (AssertableInertia $page) => $page
            ->where('microsoft.enabled', true)
            ->missing('microsoft.account')
            ->etc());
    }

    public function test_every_microsoft_route_is_inert_while_impersonating(): void
    {
        // Arrange: an employee with an expired token (any token use would send a refresh) and a row for
        // every route to act on
        $this->configureMicrosoft365();
        $data = $this->createUserWithRole(Role::Employee);
        $data->user->save();
        $user = $data->user;
        $this->connectedAccount($user, expired: true);
        $project = Project::factory()->forOrganization($data->organization)->isPublic()->create();
        $single = $this->meeting($user, 'matrix-single');
        $dismissed = $this->meeting($user, 'matrix-dismissed', [
            'dismissed_at' => '2026-10-19 08:00:00',
            'starts_at' => '2026-10-21 09:00:00',
            'ends_at' => '2026-10-21 10:00:00',
        ]);
        $occurrence = $this->meeting($user, 'matrix-occurrence', [
            'event_type' => 'occurrence',
            'series_master_id' => self::SERIES,
            'original_start' => '2026-10-22 09:00:00',
            'starts_at' => '2026-10-22 09:00:00',
            'ends_at' => '2026-10-22 10:00:00',
        ]);
        OutlookSeriesSetting::query()->create([
            'user_id' => $user->getKey(),
            'series_master_id' => self::SERIES,
            'ignored_at' => '2026-10-19 08:00:00',
        ]);
        $this->syncWindow($user, '2026-10-19 00:00:00', '2026-11-16 00:00:00');
        // An entry flagged moved with an Outlook slot (keep and adjust)
        $this->meeting($user, 'matrix-flagged', ['starts_at' => '2026-10-23 12:00:00', 'ends_at' => '2026-10-23 13:00:00']);
        $flaggedEntry = $this->linkedEntry($data->member, 'matrix-flagged', '2026-10-23 10:00:00', '2026-10-23 11:00:00', [
            'flag_reason' => 'moved',
            'flagged_at' => '2026-10-23 08:00:00',
            'outlook_starts_at' => '2026-10-23 12:00:00',
            'outlook_ends_at' => '2026-10-23 13:00:00',
            'outlook_all_day' => false,
        ]);
        // A meeting Outlook moved, with the entry logged on its old slot and a released link (move-entry)
        $moved = $this->meeting($user, 'matrix-moved', ['starts_at' => '2026-10-29 15:00:00', 'ends_at' => '2026-10-29 16:00:00']);
        $this->linkedEntry($data->member, 'matrix-moved', '2026-10-26 10:00:00', '2026-10-26 11:00:00', [
            'released_at' => '2026-10-27 09:00:00',
        ]);
        $ids = [
            'organization' => (string) $data->organization->getKey(),
            'project' => (string) $project->getKey(),
            'single' => (string) $single->getKey(),
            'dismissed' => (string) $dismissed->getKey(),
            'occurrence' => (string) $occurrence->getKey(),
            'flagged_entry' => (string) $flaggedEntry->getKey(),
            'moved_meeting' => (string) $moved->getKey(),
        ];
        Http::fake();
        $gateway = $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity([
            'objectId' => self::ADMIN_OBJECT_ID,
            'graphId' => self::ADMIN_OBJECT_ID,
        ]));
        $this->actingAs($user, 'web');
        // A Connect pending in the session for the callback row: intent, user, return, OAuth state, PKCE
        session()->put('microsoft.intent', 'connect');
        session()->put('microsoft.connect_user_id', (string) $user->getKey());
        session()->put('microsoft.return', 'calendar');
        session()->put('state', self::OAUTH_STATE);
        session()->put('code_verifier', 'matrix-code-verifier');
        $this->startImpersonation();
        $before = $this->forkRows();
        foreach ($before as $table => $rows) {
            $this->assertNotSame('[]', $rows, $table.' must hold a row, otherwise the snapshot proves nothing');
        }

        // Act + Assert: one request per route
        foreach (self::MATRIX as $name => $outcome) {
            $response = $this->matrixRequest($name, $ids);
            match ($outcome) {
                '404' => $this->assertSame(404, $response->status(), $name.' must be a 404 while impersonating'),
                'empty' => $this->assertSame(
                    [200, [], []],
                    [$response->status(), $response->json('data'), $response->json('linked_time_entry_ids')],
                    $name.' must be the empty read while impersonating',
                ),
                'not_connected' => $this->assertSame(
                    [200, 'not_connected'],
                    [$response->status(), $response->json('status')],
                    $name.' must answer not_connected while impersonating',
                ),
                default => $this->fail('Unknown outcome '.$outcome.' for '.$name),
            };
        }

        // Assert: nothing changed, nothing was sent, no gateway ran, still the same session user
        $this->assertSame($before, $this->forkRows());
        Http::assertNothingSent();
        $this->assertSame(0, $gateway->authenticateCalls());
        $this->assertAuthenticatedAs($user, 'web');
    }

    public function test_every_fork_route_is_in_the_impersonation_matrix(): void
    {
        // Arrange
        $names = [];
        foreach (Route::getRoutes()->getRoutes() as $route) {
            if (str_starts_with($route->getActionName(), 'App\\Microsoft365\\Http\\Controllers\\')) {
                $names[] = (string) $route->getName();
            }
        }
        sort($names);
        $expected = array_keys(self::MATRIX);
        sort($expected);

        // Assert
        $this->assertSame($expected, $names, 'A new Microsoft 365 route needs a MATRIX row with its impersonation outcome');
        $this->assertCount(14, $names);
    }

    public function test_calendar_carries_no_outlook_block_while_impersonating(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        Http::fake();
        $this->actingAs($user, 'web');
        $this->startImpersonation();

        // Act
        $response = $this->get(route('calendar', [], false));

        // Assert
        $response->assertOk();
        $response->assertInertia(fn (AssertableInertia $page) => $page
            ->where('microsoft.enabled', true)
            ->missing('microsoft.calendar')
            ->etc());
        Http::assertNothingSent();
    }
}
