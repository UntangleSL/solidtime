<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Microsoft365\Console\CheckOutOfSyncCommand;
use App\Microsoft365\Http\Middleware\EnsureMicrosoftIsEnabled;
use App\Microsoft365\Http\Middleware\ShareMicrosoftInertiaData;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookMeetingLink;
use App\Microsoft365\Models\OutlookSeriesSetting;
use App\Microsoft365\Models\OutlookSyncWindow;
use App\Models\Member;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Console\Scheduling\Event;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Symfony\Component\HttpFoundation\Response;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

/**
 * OPS-02, the off switch in one place: with any of client id, secret or tenant id unset, no fork route
 * answers (404 for guests and signed-in users), the shared microsoft prop is only {enabled: false}, the
 * daily out-of-sync check never passes its filter and queues nothing, no Graph call is made, and nothing
 * is deleted: configuring the integration again serves the same meetings and the same account.
 */
#[CoversClass(EnsureMicrosoftIsEnabled::class)]
#[UsesClass(ShareMicrosoftInertiaData::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
#[UsesClass(CheckOutOfSyncCommand::class)]
class MicrosoftOffSwitchTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

    // The seeded week (Monday to Monday, UTC) and its meetings
    private const string WEEK_START = '2026-10-19T00:00:00Z';

    private const string WEEK_END = '2026-10-26T00:00:00Z';

    private const string ROUTE_UUID = '00000000-0000-4000-8000-0000000007f1';

    private const array FORK_TABLES = [
        'microsoft_accounts',
        'outlook_meetings',
        'outlook_sync_windows',
        'outlook_series_settings',
        'outlook_meeting_links',
    ];

    private function unconfigure(): void
    {
        $this->configureMicrosoft365(null, ['client_secret' => null]);
    }

    /**
     * One user with a row in every fork table: a connected account, a cached meeting inside the seeded
     * week, the week's sync window, a series setting, and a converted meeting whose time entry is linked.
     *
     * @return object{user: User, member: Member, organization: Organization, meeting: OutlookMeeting, entry: TimeEntry}
     */
    private function seedUser(): object
    {
        $data = $this->createUserWithRole(Role::Employee);
        $user = $data->user;
        $this->connectedAccount($user);
        $meeting = $this->meeting($user, 'off-switch-visible', '2026-10-20 09:00:00', '2026-10-20 10:00:00');
        $this->meeting($user, 'off-switch-converted', '2026-10-21 09:00:00', '2026-10-21 10:00:00');
        OutlookSyncWindow::query()->create([
            'user_id' => $user->getKey(),
            'window_start' => '2026-10-19 00:00:00',
            'window_end' => '2026-10-26 00:00:00',
            'synced_at' => '2026-10-19 12:00:00',
        ]);
        OutlookSeriesSetting::query()->create([
            'user_id' => $user->getKey(),
            'series_master_id' => 'off-switch-series',
            'ignored_at' => '2026-10-19 08:00:00',
        ]);
        $entry = TimeEntry::factory()->forMember($data->member)->create([
            'start' => '2026-10-21 09:00:00',
            'end' => '2026-10-21 10:00:00',
            'description' => 'Entry off-switch-converted',
        ]);
        OutlookMeetingLink::query()->create([
            'user_id' => $user->getKey(),
            'graph_id' => 'off-switch-converted',
            'time_entry_id' => $entry->getKey(),
            'meeting_starts_at' => '2026-10-21 09:00:00',
            'meeting_ends_at' => '2026-10-21 10:00:00',
        ]);

        return (object) [
            'user' => $user,
            'member' => $data->member,
            'organization' => $data->organization,
            'meeting' => $meeting,
            'entry' => $entry,
        ];
    }

    private function meeting(User $user, string $graphId, string $start, string $end): OutlookMeeting
    {
        return OutlookMeeting::query()->create([
            'user_id' => $user->getKey(),
            'graph_id' => $graphId,
            'event_type' => 'singleInstance',
            'subject' => 'Subject '.$graphId,
            'starts_at' => $start,
            'ends_at' => $end,
            'organizer_name' => 'Org Name',
            'is_organizer' => false,
            'is_online_meeting' => true,
            'web_link' => 'https://outlook.office.com/owa/?itemid='.$graphId,
            'last_seen_at' => '2026-10-19 00:00:00',
        ]);
    }

    /**
     * Row counts of the user in every fork table, plus the user's time entries.
     *
     * @return array<string, int>
     */
    private function rowCounts(User $user): array
    {
        $counts = [];
        foreach (self::FORK_TABLES as $table) {
            $counts[$table] = DB::table($table)->where('user_id', '=', $user->getKey())->count();
        }
        $counts['time_entries'] = TimeEntry::query()->where('user_id', '=', $user->getKey())->count();

        return $counts;
    }

    /**
     * @return list<RoutingRoute>
     */
    private function forkRoutes(): array
    {
        return array_values(array_filter(
            Route::getRoutes()->getRoutes(),
            fn (RoutingRoute $route): bool => str_starts_with((string) $route->getName(), 'microsoft.'),
        ));
    }

    /**
     * The scheduled events of the m365:check-out-of-sync command, from a freshly built Schedule (same
     * approach as OutlookOutOfSyncScheduleTest: a provider may have resolved it before the config was set).
     *
     * @return list<Event>
     */
    private function dailyChecks(): array
    {
        $this->app->forgetInstance(Schedule::class);
        $events = array_filter(
            app(Schedule::class)->events(),
            fn (Event $event): bool => is_string($event->command) && str_ends_with($event->command, 'm365:check-out-of-sync'),
        );

        return array_values($events);
    }

    /**
     * @return TestResponse<Response>
     */
    private function readSeededWeek(): TestResponse
    {
        return $this->getJson(route('microsoft.meetings.index', ['start' => self::WEEK_START, 'end' => self::WEEK_END], false));
    }

    public function test_every_microsoft_route_is_a_404_while_unconfigured(): void
    {
        // Arrange
        $this->unconfigure();
        $seeded = $this->seedUser();
        Http::fake();
        $routes = $this->forkRoutes();
        // redirect, callback, account.destroy and the eleven microsoft.meetings.* routes
        $this->assertCount(14, $routes);

        // The seeded user's own ids, so a 404 can only come from the switch (an unknown organization
        // would already be a 404 through route model binding); any other parameter gets a fixed uuid
        $ids = [
            'organization' => $seeded->organization->getKey(),
            'meeting' => $seeded->meeting->getKey(),
            'entry' => $seeded->entry->getKey(),
        ];

        // Act + Assert: every route with its first method, first as a guest, then as the seeded user
        foreach (['guest', 'signed-in user'] as $caller) {
            if ($caller === 'signed-in user') {
                $this->actingAs($seeded->user);
            }
            foreach ($routes as $route) {
                $name = (string) $route->getName();
                $parameters = [];
                foreach ($route->parameterNames() as $parameter) {
                    $parameters[$parameter] = $ids[$parameter] ?? self::ROUTE_UUID;
                }
                $method = $route->methods()[0];

                $response = $this->json($method, route($name, $parameters, false));

                $this->assertSame(404, $response->getStatusCode(), $name.' ('.$method.') answered '.$response->getStatusCode().' to a '.$caller);
            }
        }
        Http::assertNothingSent();

        // Control: configured again, the same signed-in read reaches the controller (422: no range given)
        $this->configureMicrosoft365();
        $this->getJson(route('microsoft.meetings.index', [], false))->assertStatus(422);
    }

    public function test_pages_share_only_enabled_false_while_unconfigured(): void
    {
        // Arrange
        $this->unconfigure();
        $seeded = $this->seedUser();

        // Act
        $login = $this->get('/login');
        $this->actingAs($seeded->user);
        $calendar = $this->get(route('calendar', [], false));
        $profile = $this->get(route('profile.show', [], false));

        // Assert: exactly {enabled: false}, no login URL, labels, calendar block or account payload
        foreach ([$login, $calendar, $profile] as $response) {
            $response->assertStatus(200);
            $response->assertInertia(fn (AssertableInertia $inertia) => $inertia
                ->where('microsoft', ['enabled' => false])
                ->etc());
        }
    }

    public function test_daily_check_is_filtered_and_queues_nothing_while_unconfigured(): void
    {
        // Arrange: a connected user with a linked entry in the database
        $this->unconfigure();
        $this->seedUser();
        Queue::fake();
        Http::fake();

        // Act
        $events = $this->dailyChecks();
        $exitCode = $this->withoutMockingConsoleOutput()->artisan('m365:check-out-of-sync');
        $output = Artisan::output();

        // Assert: the 05:30 event stays registered but its filter keeps it from running
        $this->assertCount(1, $events);
        $this->assertFalse($events[0]->filtersPass($this->app));
        // Run by hand, the command does nothing and says so
        $this->assertSame(0, $exitCode);
        $this->assertSame('configured: no', trim($output));
        $this->assertStringNotContainsString('dispatched', $output);
        Queue::assertNothingPushed();
        Http::assertNothingSent();
    }

    public function test_switching_off_keeps_the_data_and_switching_on_restores_it(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $seeded = $this->seedUser();
        $seededCounts = $this->rowCounts($seeded->user);
        $this->assertSame([
            'microsoft_accounts' => 1,
            'outlook_meetings' => 2,
            'outlook_sync_windows' => 1,
            'outlook_series_settings' => 1,
            'outlook_meeting_links' => 1,
            'time_entries' => 1,
        ], $seededCounts);
        Http::fake();
        $this->actingAs($seeded->user);

        // Act: switch off, use the app, switch on again
        $this->unconfigure();
        $offRead = $this->readSeededWeek();
        $offProfile = $this->get(route('profile.show', [], false));
        $offCounts = $this->rowCounts($seeded->user);
        $this->configureMicrosoft365();
        $onRead = $this->readSeededWeek();
        $onProfile = $this->get(route('profile.show', [], false));

        // Assert: while off nothing answers and nothing is deleted
        $offRead->assertNotFound();
        $offProfile->assertStatus(200);
        $offProfile->assertInertia(fn (AssertableInertia $page) => $page
            ->where('microsoft', ['enabled' => false])
            ->etc());
        $this->assertSame($seededCounts, $offCounts);
        // Back on: the same cached meeting, the same linked entry and the same account
        $onRead->assertOk();
        $this->assertSame([$seeded->meeting->id], array_column($onRead->json('data'), 'id'));
        $this->assertSame([$seeded->entry->getKey()], $onRead->json('linked_time_entry_ids'));
        $this->assertNotNull($onRead->json('sync.last_synced_at'));
        $onProfile->assertStatus(200);
        $onProfile->assertInertia(fn (AssertableInertia $page) => $page
            ->where('microsoft.enabled', true)
            ->where('microsoft.account.linked', true)
            ->where('microsoft.account.email', 'ada@example.test')
            ->etc());
        $this->assertSame($seededCounts, $this->rowCounts($seeded->user));
        Http::assertNothingSent();
    }
}
