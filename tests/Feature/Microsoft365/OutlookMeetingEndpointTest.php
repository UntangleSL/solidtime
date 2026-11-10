<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Microsoft365\Graph\GraphCalendarClient;
use App\Microsoft365\Graph\OutlookMeetingEligibility;
use App\Microsoft365\Graph\OutlookMeetingSyncService;
use App\Microsoft365\Graph\SyncOutcome;
use App\Microsoft365\Graph\SyncStatus;
use App\Microsoft365\Http\Controllers\OutlookMeetingController;
use App\Microsoft365\Http\Middleware\EnsureMicrosoftIsEnabled;
use App\Microsoft365\Http\Requests\MeetingRangeRequest;
use App\Microsoft365\Http\Resources\OutlookMeetingResource;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookSyncWindow;
use App\Models\Member;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

#[CoversClass(OutlookMeetingController::class)]
#[UsesClass(MeetingRangeRequest::class)]
#[UsesClass(OutlookMeetingResource::class)]
#[UsesClass(OutlookMeetingSyncService::class)]
#[UsesClass(GraphCalendarClient::class)]
#[UsesClass(OutlookMeetingEligibility::class)]
#[UsesClass(SyncOutcome::class)]
#[UsesClass(SyncStatus::class)]
#[UsesClass(MicrosoftAccount::class)]
#[UsesClass(OutlookMeeting::class)]
#[UsesClass(OutlookSyncWindow::class)]
#[UsesClass(EnsureMicrosoftIsEnabled::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
class OutlookMeetingEndpointTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

    private const string WINDOW_START = '2026-10-19T00:00:00Z';

    private const string WINDOW_END = '2026-10-26T00:00:00Z';

    private function createUser(): User
    {
        return User::factory()->withPersonalOrganization()->create();
    }

    /**
     * @return array<string, string>
     */
    private function window(): array
    {
        return $this->fixtureWindow();
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function meeting(User $user, string $graphId, string $start, string $end, array $overrides = []): OutlookMeeting
    {
        return OutlookMeeting::query()->create(array_merge([
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
        ], $overrides));
    }

    /**
     * @param  array<string, string>  $range
     */
    private function getMeetings(array $range): TestResponse
    {
        return $this->getJson(route('microsoft.meetings.index', $range, false));
    }

    public function test_sync_then_read_returns_the_cached_meetings(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->fakeGraphCalendar('A');
        $this->actingAs($user);
        $window = $this->window();

        // Act
        $sync = $this->postJson(route('microsoft.meetings.sync', [], false), $window);
        Http::fake();
        $read = $this->getMeetings($window);

        // Assert
        $sync->assertOk();
        $sync->assertJsonPath('status', 'ok');
        $sync->assertJsonPath('truncated', false);
        $read->assertOk();
        $read->assertJsonCount(12, 'data');
        $starts = array_column($read->json('data'), 'start');
        $this->assertContains('2026-10-20T08:00:00Z', $starts);
        $this->assertContains('2026-10-27T09:00:00Z', $starts);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', (string) $read->json('sync.last_synced_at'));
        Http::assertNothingSent();
    }

    public function test_sync_for_a_user_without_account_answers_not_connected(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        Http::fake();
        $this->actingAs($user);

        // Act
        $response = $this->postJson(route('microsoft.meetings.sync', [], false), $this->window());

        // Assert
        $response->assertOk();
        $response->assertJsonPath('status', 'not_connected');
        Http::assertNothingSent();
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

    public function test_half_open_range(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->meeting($user, 'ends-at-start', '2026-10-18 23:00:00', '2026-10-19 00:00:00');
        $this->meeting($user, 'starts-at-end', '2026-10-26 00:00:00', '2026-10-26 01:00:00');
        $this->meeting($user, 'crosses-start', '2026-10-18 23:30:00', '2026-10-19 00:30:00');
        $this->meeting($user, 'crosses-end', '2026-10-25 23:30:00', '2026-10-26 00:30:00');
        Http::fake();
        $this->actingAs($user);

        // Act
        $response = $this->getMeetings(['start' => self::WINDOW_START, 'end' => self::WINDOW_END]);

        // Assert
        $response->assertOk();
        $this->assertSame(['Subject crosses-start', 'Subject crosses-end'], $this->subjects($response));
    }

    public function test_ordering_is_start_end_graph_id(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->meeting($user, 'c', '2026-10-20 09:00:00', '2026-10-20 10:00:00');
        $this->meeting($user, 'a', '2026-10-20 09:00:00', '2026-10-20 10:00:00');
        $this->meeting($user, 'b', '2026-10-20 09:00:00', '2026-10-20 09:30:00');
        $this->meeting($user, 'z', '2026-10-20 08:00:00', '2026-10-20 12:00:00');
        $this->actingAs($user);
        $range = ['start' => self::WINDOW_START, 'end' => self::WINDOW_END];

        // Act
        $first = $this->getMeetings($range);
        $second = $this->getMeetings($range);

        // Assert
        $expected = ['Subject z', 'Subject b', 'Subject a', 'Subject c'];
        $this->assertSame($expected, $this->subjects($first));
        $this->assertSame($expected, $this->subjects($second));
    }

    public function test_back_to_back_meetings_are_two_items(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->meeting($user, 'first', '2026-10-20 09:00:00', '2026-10-20 10:00:00');
        $this->meeting($user, 'second', '2026-10-20 10:00:00', '2026-10-20 11:00:00');
        $this->actingAs($user);

        // Act
        $response = $this->getMeetings(['start' => self::WINDOW_START, 'end' => self::WINDOW_END]);

        // Assert
        $response->assertOk();
        $response->assertJsonCount(2, 'data');
        $this->assertSame(['Subject first', 'Subject second'], $this->subjects($response));
    }

    public function test_overlapping_time_entry_and_past_meetings_are_returned(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $member = Member::query()->where('user_id', '=', $user->getKey())->firstOrFail();
        TimeEntry::factory()->forMember($member)->create([
            'start' => '2026-09-15 09:00:00',
            'end' => '2026-09-15 10:00:00',
        ]);
        $this->meeting($user, 'past', '2026-09-15 09:00:00', '2026-09-15 10:00:00');
        $this->actingAs($user);

        // Act
        $response = $this->getMeetings(['start' => '2026-09-01T00:00:00Z', 'end' => '2026-09-30T00:00:00Z']);

        // Assert
        $response->assertOk();
        $response->assertJsonCount(1, 'data');
        $response->assertJsonPath('data.0.subject', 'Subject past');
        $response->assertJsonPath('data.0.start', '2026-09-15T09:00:00Z');
        $this->assertSame(1, TimeEntry::query()->count());
    }

    public function test_empty_range_returns_empty_list_without_graph(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        Http::fake();
        $this->actingAs($user);

        // Act
        $response = $this->getMeetings(['start' => self::WINDOW_START, 'end' => self::WINDOW_END]);

        // Assert
        $response->assertOk();
        $response->assertExactJson(['data' => [], 'sync' => ['last_synced_at' => null, 'retry_after' => null]]);
        Http::assertNothingSent();
    }

    public function test_only_the_session_users_rows_are_returned(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $context = $this->createUserWithRole(Role::Employee);
        $employee = $context->user;
        $owner = $context->owner;
        $manager = User::factory()->create();
        Member::factory()->forUser($manager)->forOrganization($context->organization)->role(Role::Manager)->create();
        $other = $this->createUser();
        $users = ['employee' => $employee, 'manager' => $manager, 'owner' => $owner, 'other' => $other];
        $index = 0;
        foreach ($users as $name => $user) {
            $this->connectedAccount($user, objectId: sprintf('00000000-0000-4000-8000-0000000001%02d', $index++));
            $this->meeting($user, 'own-'.$name, '2026-10-20 09:00:00', '2026-10-20 10:00:00');
        }
        $range = ['start' => self::WINDOW_START, 'end' => self::WINDOW_END];

        foreach ($users as $name => $user) {
            // Act: a user_id query parameter for somebody else must change nothing
            $this->actingAs($user);
            $response = $this->getMeetings($range + ['user_id' => $other->getKey()]);

            // Assert
            $response->assertOk();
            $this->assertSame(['Subject own-'.$name], $this->subjects($response), $name);
        }
    }

    /**
     * @return array<string, array{0: array<string, string>}>
     */
    public static function badRangeProvider(): array
    {
        return [
            'missing start' => [['end' => '2026-10-26T00:00:00Z']],
            'missing end' => [['start' => '2026-10-19T00:00:00Z']],
            'date without time' => [['start' => '2026-10-19', 'end' => '2026-10-26']],
            'offset form' => [['start' => '2026-10-19T00:00:00+02:00', 'end' => '2026-10-26T00:00:00+02:00']],
            'end equals start' => [['start' => '2026-10-19T00:00:00Z', 'end' => '2026-10-19T00:00:00Z']],
            'end before start' => [['start' => '2026-10-26T00:00:00Z', 'end' => '2026-10-19T00:00:00Z']],
            'span of 36 days' => [['start' => '2026-10-01T00:00:00Z', 'end' => '2026-11-06T00:00:00Z']],
        ];
    }

    /**
     * @param  array<string, string>  $range
     */
    #[DataProvider('badRangeProvider')]
    public function test_validation_rejects_bad_ranges(array $range): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        Http::fake();
        $this->actingAs($user);

        // Act
        $read = $this->getMeetings($range);
        $sync = $this->postJson(route('microsoft.meetings.sync', [], false), $range);

        // Assert
        $read->assertStatus(422);
        $sync->assertStatus(422);
        Http::assertNothingSent();
    }

    public function test_a_range_of_exactly_35_days_is_accepted(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->actingAs($user);

        // Act
        $response = $this->getMeetings(['start' => '2026-10-01T00:00:00Z', 'end' => '2026-11-05T00:00:00Z']);

        // Assert
        $response->assertOk();
    }

    public function test_unauthenticated_json_gets_401_and_unconfigured_gets_404(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $range = ['start' => self::WINDOW_START, 'end' => self::WINDOW_END];

        // Act
        $guestRead = $this->getMeetings($range);
        $guestSync = $this->postJson(route('microsoft.meetings.sync', [], false), $range);
        $this->configureMicrosoft365(overrides: ['client_id' => '']);
        $this->actingAs($this->createUser());
        $offRead = $this->getMeetings($range);
        $offSync = $this->postJson(route('microsoft.meetings.sync', [], false), $range);

        // Assert
        $guestRead->assertUnauthorized();
        $guestSync->assertUnauthorized();
        $offRead->assertNotFound();
        $offSync->assertNotFound();
    }

    public function test_resource_has_exactly_the_allow_listed_keys(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->meeting($user, 'one', '2026-10-20 09:00:00', '2026-10-20 10:00:00');
        $this->actingAs($user);

        // Act
        $response = $this->getMeetings(['start' => self::WINDOW_START, 'end' => self::WINDOW_END]);

        // Assert
        $response->assertOk();
        $item = $response->json('data.0');
        $keys = array_keys($item);
        sort($keys);
        $expected = ['dismissed', 'end', 'id', 'is_online_meeting', 'is_organizer', 'organizer_name', 'start', 'subject', 'web_link'];
        $this->assertSame($expected, $keys);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $item['start']);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $item['end']);
        $this->assertFalse($item['dismissed']);
        $this->assertSame(['data', 'sync'], array_keys($response->json()));
    }

    public function test_meetings_routes_are_not_under_api_and_use_the_web_group(): void
    {
        // Arrange
        $routes = array_filter(
            Route::getRoutes()->getRoutes(),
            fn (\Illuminate\Routing\Route $route): bool => str_starts_with((string) $route->getName(), 'microsoft.meetings.'),
        );

        // Assert
        $this->assertGreaterThanOrEqual(2, count($routes));
        foreach ($routes as $route) {
            $this->assertStringStartsWith('m365/', $route->uri());
            $this->assertStringStartsNotWith('api/', $route->uri());
            $middleware = $route->gatherMiddleware();
            $this->assertContains('web', $middleware);
            $this->assertContains('auth:web', $middleware);
            $this->assertContains('verified', $middleware);
        }
    }
}
