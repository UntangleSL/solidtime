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
use App\Microsoft365\Http\Controllers\MicrosoftAccountController;
use App\Microsoft365\Http\Controllers\OutlookMeetingController;
use App\Microsoft365\Http\Requests\MeetingRangeRequest;
use App\Microsoft365\Http\Resources\OutlookMeetingResource;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookSyncWindow;
use App\Microsoft365\Suggestions\MeetingSignalInput;
use App\Models\Member;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;
use TiMacDonald\Log\LogEntry;

#[CoversClass(OutlookMeetingSyncService::class)]
#[CoversClass(MeetingSignalInput::class)]
#[UsesClass(GraphCalendarClient::class)]
#[UsesClass(OutlookMeetingEligibility::class)]
#[UsesClass(SyncOutcome::class)]
#[UsesClass(SyncStatus::class)]
#[UsesClass(MicrosoftAccount::class)]
#[UsesClass(OutlookMeeting::class)]
#[UsesClass(OutlookSyncWindow::class)]
#[UsesClass(MicrosoftTokenService::class)]
#[UsesClass(GraphException::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(MicrosoftAccountController::class)]
#[UsesClass(OutlookMeetingController::class)]
#[UsesClass(MeetingRangeRequest::class)]
#[UsesClass(OutlookMeetingResource::class)]
class OutlookMeetingSyncTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

    private const string GRAPH_URL = 'https://graph.microsoft.com/v1.0/me/calendarView*';

    private function createUser(): User
    {
        return User::factory()->withPersonalOrganization()->create();
    }

    private function fixtureStart(): CarbonImmutable
    {
        return CarbonImmutable::parse($this->fixtureWindow()['start']);
    }

    private function fixtureEnd(): CarbonImmutable
    {
        return CarbonImmutable::parse($this->fixtureWindow()['end']);
    }

    private function syncFixtureWindow(User $user): SyncOutcome
    {
        return app(OutlookMeetingSyncService::class)->sync($user, $this->fixtureStart(), $this->fixtureEnd());
    }

    public function test_sync_replays_round_a_and_stores_only_eligible_meetings(): void
    {
        // Arrange
        $user = $this->createUser();
        $this->connectedAccount($user);
        $pages = $this->fakeGraphCalendar('A');

        // Act
        $outcome = $this->syncFixtureWindow($user);

        // Assert
        $this->assertSame(SyncStatus::Ok, $outcome->status);
        $this->assertFalse($outcome->truncated);
        $this->assertCount(22, $pages);
        Http::assertSentCount(22);
        $this->assertSame(12, OutlookMeeting::query()->where('user_id', '=', $user->getKey())->count());
        $this->assertSame(0, OutlookMeeting::query()->where('subject', 'like', '%S6]%')->count());
        $this->assertSame(0, OutlookMeeting::query()->where('subject', 'like', '%S7]%')->count());
        $this->assertSame(1, OutlookMeeting::query()->where('subject', 'like', '%S8]%')->count());
    }

    public function test_every_graph_request_carries_the_combined_prefer_header_and_bearer(): void
    {
        // Arrange
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->fakeGraphCalendar('A');

        // Act
        $this->syncFixtureWindow($user);

        // Assert
        $recorded = Http::recorded();
        $this->assertCount(22, $recorded);
        foreach ($recorded as [$request]) {
            /** @var Request $request */
            $this->assertSame('GET', $request->method());
            $this->assertSame(['outlook.timezone="UTC", IdType="ImmutableId"'], $request->header('Prefer'));
            $this->assertSame(['Bearer at-marker-7f3c'], $request->header('Authorization'));
        }
        $firstUrl = $recorded[0][0]->url();
        $this->assertSame(
            'https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=2026-10-19T00%3A00%3A00Z'
            .'&endDateTime=2026-11-16T00%3A00%3A00Z'
            .'&$select=id,iCalUId,subject,start,end,isAllDay,isCancelled,isOrganizer,responseStatus,type,seriesMasterId,originalStart,organizer,showAs,sensitivity,webLink,isOnlineMeeting,attendees'
            .'&$orderby=start/dateTime&$top=100',
            $firstUrl
        );
    }

    public function test_sync_stores_attendees_and_the_organizer_address(): void
    {
        // Arrange
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->fakeExperimentSelect(function (array $event): array {
            if (str_contains((string) ($event['subject'] ?? ''), 'S1b]')) {
                // Graph does not normalise case: the stored addresses are trimmed and lower-cased
                $event['organizer']['emailAddress']['address'] = ' Person-A@Example.TEST ';
                $event['attendees'][1]['emailAddress']['address'] = 'Person-B@Example.test';
            }

            return $event;
        });

        // Act
        $outcome = $this->syncFixtureWindow($user);

        // Assert
        $this->assertSame(SyncStatus::Ok, $outcome->status);
        $this->assertSame(12, OutlookMeeting::query()->where('user_id', '=', $user->getKey())->count());
        $meeting = OutlookMeeting::query()
            ->where('user_id', '=', $user->getKey())
            ->where('subject', 'like', '%S1b]%')
            ->firstOrFail();
        $this->assertSame('person-a@example.test', $meeting->organizer_address);
        $this->assertSame(2, $meeting->attendee_count);
        $attendees = $meeting->attendees;
        $this->assertIsArray($attendees);
        $this->assertCount(2, $attendees);
        // jsonb keeps the list order but not the key order of an object
        $this->assertEquals(['address' => 'person-a@example.test', 'name' => 'Test User A', 'type' => 'required'], $attendees[0]);
        $this->assertEquals(['address' => 'person-b@example.test', 'name' => 'Test User B', 'type' => 'required'], $attendees[1]);
        foreach ($attendees as $attendee) {
            $this->assertIsArray($attendee);
            $this->assertArrayNotHasKey('status', $attendee);
        }
    }

    public function test_ineligible_sighting_scrubs_attendee_data(): void
    {
        // Arrange
        $user = $this->createUser();
        $this->connectedAccount($user);
        $event = $this->experimentEvent('S1b]');
        $cancelled = $event;
        $cancelled['isCancelled'] = true;
        Http::fake([self::GRAPH_URL => Http::sequence()
            ->push(['value' => [$event]])
            ->push(['value' => [$cancelled]])]);
        $this->assertSame(SyncStatus::Ok, $this->syncFixtureWindow($user)->status);
        $stored = OutlookMeeting::query()->where('graph_id', '=', $event['id'])->firstOrFail();
        $this->assertNotNull($stored->organizer_address);
        $this->assertNotNull($stored->attendees);
        $this->assertNotNull($stored->attendee_count);
        $this->travel(61)->seconds();

        // Act
        $outcome = $this->syncFixtureWindow($user);

        // Assert
        $this->assertSame(SyncStatus::Ok, $outcome->status);
        $scrubbed = OutlookMeeting::query()->where('graph_id', '=', $event['id'])->firstOrFail();
        $this->assertNotNull($scrubbed->gone_at);
        $this->assertNull($scrubbed->subject);
        $this->assertNull($scrubbed->organizer_name);
        $this->assertNull($scrubbed->web_link);
        $this->assertNull($scrubbed->organizer_address);
        $this->assertNull($scrubbed->attendees);
        $this->assertNull($scrubbed->attendee_count);
    }

    public function test_attendees_are_capped_and_rooms_skipped(): void
    {
        // Arrange
        $user = $this->createUser();
        $this->connectedAccount($user);
        $event = $this->experimentEvent('S1b]');
        $attendees = [$this->graphAttendee('room-1@example.test', 'resource')];
        for ($index = 1; $index <= 60; $index++) {
            $attendees[] = $this->graphAttendee(sprintf('person-%02d@example.test', $index), 'required');
            if ($index === 30) {
                $attendees[] = $this->graphAttendee('projector@example.test', 'resource');
            }
        }
        $event['attendees'] = $attendees;
        Http::fake([self::GRAPH_URL => Http::response(['value' => [$event]])]);

        // Act
        $outcome = $this->syncFixtureWindow($user);

        // Assert
        $this->assertSame(SyncStatus::Ok, $outcome->status);
        $meeting = OutlookMeeting::query()->where('graph_id', '=', $event['id'])->firstOrFail();
        $this->assertSame(60, $meeting->attendee_count);
        $this->assertIsArray($meeting->attendees);
        $this->assertCount(OutlookMeetingSyncService::MAX_ATTENDEES, $meeting->attendees);
        $addresses = array_column($meeting->attendees, 'address');
        $this->assertSame('person-01@example.test', $addresses[0]);
        $this->assertSame('person-50@example.test', $addresses[49]);
        $this->assertNotContains('room-1@example.test', $addresses);
        $this->assertNotContains('projector@example.test', $addresses);
        $this->assertNotContains('resource', array_column($meeting->attendees, 'type'));
    }

    public function test_disconnect_deletes_attendee_data(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->fakeExperimentSelect();
        $this->assertSame(SyncStatus::Ok, $this->syncFixtureWindow($user)->status);
        $this->assertGreaterThan(0, OutlookMeeting::query()
            ->where('user_id', '=', $user->getKey())
            ->whereNotNull('attendees')
            ->whereNotNull('organizer_address')
            ->count());
        $this->actingAs($user);

        // Act
        $response = $this->delete(route('microsoft.account.destroy', [], false));

        // Assert
        $response->assertRedirect(route('profile.show', [], false));
        $this->assertSame(0, OutlookMeeting::query()->where('user_id', '=', $user->getKey())->count());
        $this->assertSame(0, OutlookMeeting::query()->whereNotNull('attendees')->count());
    }

    public function test_read_never_serves_attendee_data(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->fakeExperimentSelect();
        $this->assertSame(SyncStatus::Ok, $this->syncFixtureWindow($user)->status);
        $this->actingAs($user);

        // Act
        $response = $this->getJson(route('microsoft.meetings.index', $this->fixtureWindow(), false));

        // Assert
        $response->assertOk();
        $this->assertNotEmpty($response->json('data'));
        $body = (string) $response->getContent();
        $this->assertStringNotContainsString('"attendees"', $body);
        $this->assertStringNotContainsString('"organizer_address"', $body);
        $this->assertStringNotContainsString('"attendee_count"', $body);
        $this->assertStringNotContainsString('@example.test', $body);
    }

    public function test_signal_input_of_a_cached_meeting(): void
    {
        // Arrange
        Config::set('microsoft365.allowed_domains', 'untanglegrowth.com,untangle.es');
        $user = User::factory()->withPersonalOrganization()->create(['email' => 'Me@Untangle.es']);
        $account = $this->connectedAccount($user);
        $account->microsoft_email = 'me@untangle.es';
        $account->save();
        $this->fakeExperimentSelect();
        $this->assertSame(SyncStatus::Ok, $this->syncFixtureWindow($user)->status);
        $meeting = OutlookMeeting::query()
            ->where('user_id', '=', $user->getKey())
            ->where('subject', 'like', '%S1b]%')
            ->firstOrFail();
        $input = app(MeetingSignalInput::class);

        // Act
        $features = $input->fromMeeting($meeting);
        $identity = $input->identity($user);

        // Assert
        $this->assertSame(
            ['organizer_address', 'organizer_name', 'is_organizer', 'attendees', 'attendee_count', 'subject'],
            array_keys($features)
        );
        $this->assertSame('person-a@example.test', $features['organizer_address']);
        $this->assertSame($meeting->organizer_name, $features['organizer_name']);
        $this->assertTrue($features['is_organizer']);
        $this->assertSame([
            ['address' => 'person-a@example.test', 'name' => 'Test User A', 'type' => 'required'],
            ['address' => 'person-b@example.test', 'name' => 'Test User B', 'type' => 'required'],
        ], $features['attendees']);
        $this->assertSame(2, $features['attendee_count']);
        $this->assertSame($meeting->subject, $features['subject']);
        $this->assertSame(['own' => ['me@untangle.es'], 'internal' => ['untanglegrowth.com', 'untangle.es']], $identity);
    }

    public function test_s2_occurrences_are_stored_in_utc(): void
    {
        // Arrange
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->fakeGraphCalendar('A');

        // Act
        $this->syncFixtureWindow($user);

        // Assert
        $starts = OutlookMeeting::query()
            ->where('subject', 'like', '%S2]%')
            ->orderBy('starts_at')
            ->get()
            ->map(fn (OutlookMeeting $meeting): string => $meeting->starts_at->format('Y-m-d H:i:s'))
            ->values()
            ->all();
        $this->assertCount(4, $starts);
        $this->assertSame('2026-10-20 08:00:00', $starts[0]);
        $this->assertSame('2026-10-27 09:00:00', $starts[1]);
    }

    public function test_sync_does_not_change_time_entries(): void
    {
        // Arrange
        $user = $this->createUser();
        $this->connectedAccount($user);
        $member = Member::query()->where('user_id', '=', $user->getKey())->firstOrFail();
        TimeEntry::factory()->forMember($member)->count(3)->create();
        $before = $this->timeEntrySnapshot();
        $this->fakeGraphCalendar('A');

        // Act
        $this->syncFixtureWindow($user);

        // Assert
        $this->assertCount(3, $before);
        $this->assertSame($before, $this->timeEntrySnapshot());
    }

    public function test_sync_without_connected_account_returns_not_connected_without_graph(): void
    {
        // Arrange
        Http::fake();
        $withoutAccount = $this->createUser();
        $disconnected = $this->createUser();
        $account = $this->connectedAccount($disconnected);
        $account->access_token = null;
        $account->refresh_token = null;
        $account->access_token_expires_at = null;
        $account->disconnected_at = now();
        $account->save();

        // Act
        $first = $this->syncFixtureWindow($withoutAccount);
        $second = $this->syncFixtureWindow($disconnected);

        // Assert
        $this->assertSame(SyncStatus::NotConnected, $first->status);
        $this->assertSame(SyncStatus::NotConnected, $second->status);
        Http::assertNothingSent();
        $this->assertSame(0, OutlookMeeting::query()->count());
        $this->assertSame(0, OutlookSyncWindow::query()->count());
    }

    public function test_expired_token_with_unconfigured_integration_answers_unavailable_without_http(): void
    {
        // Arrange
        Http::fake();
        $this->configureMicrosoft365(overrides: ['client_secret' => '']);
        $user = $this->createUser();
        $this->connectedAccount($user, expired: true);

        // Act
        $outcome = $this->syncFixtureWindow($user);

        // Assert
        $this->assertSame(SyncStatus::Unavailable, $outcome->status);
        Http::assertNothingSent();
        $this->assertSame(0, OutlookSyncWindow::query()->count());
    }

    public function test_successful_traversal_records_the_sync_window(): void
    {
        // Arrange
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->fakeGraphCalendar('A');

        // Act
        $outcome = $this->syncFixtureWindow($user);

        // Assert
        $this->assertSame(SyncStatus::Ok, $outcome->status);
        $windows = OutlookSyncWindow::query()->where('user_id', '=', $user->getKey())->get();
        $this->assertCount(1, $windows);
        $window = $windows->firstOrFail();
        $this->assertSame('2026-10-19 00:00:00', $window->window_start->format('Y-m-d H:i:s'));
        $this->assertSame('2026-11-16 00:00:00', $window->window_end->format('Y-m-d H:i:s'));
        $this->assertNotNull($outcome->lastSyncedAt);
        $this->assertSame(
            $outcome->lastSyncedAt->format('Y-m-d H:i:s'),
            $window->synced_at->format('Y-m-d H:i:s')
        );
    }

    public function test_failed_traversal_records_no_sync_window(): void
    {
        // Arrange
        $user = $this->createUser();
        $this->connectedAccount($user);
        Http::fake([
            'https://graph.microsoft.com/v1.0/me/calendarView*' => Http::response(['error' => ['code' => 'boom']], 500),
        ]);

        // Act
        $outcome = $this->syncFixtureWindow($user);

        // Assert
        $this->assertSame(SyncStatus::Unavailable, $outcome->status);
        $this->assertNull($outcome->lastSyncedAt);
        $this->assertSame(0, OutlookSyncWindow::query()->count());
        $this->assertSame(0, OutlookMeeting::query()->count());
    }

    public function test_non_utc_events_are_skipped_and_counted(): void
    {
        // Arrange
        $user = $this->createUser();
        $this->connectedAccount($user);
        $event = $this->graphPages('A')[1]['value'][0];
        $this->assertIsArray($event);
        $foreign = $event;
        $foreign['id'] = 'FAKE-non-utc-event';
        $foreign['subject'] = '[M365-TEST SECRET] zone';
        $foreign['start']['timeZone'] = 'W. Europe Standard Time';
        $foreign['end']['timeZone'] = 'W. Europe Standard Time';
        Http::fake([
            'https://graph.microsoft.com/v1.0/me/calendarView*' => Http::response(['value' => [$event, $foreign]]),
        ]);

        // Act
        $outcome = $this->syncFixtureWindow($user);

        // Assert
        $this->assertSame(SyncStatus::Ok, $outcome->status);
        $this->assertSame(1, OutlookMeeting::query()->count());
        $this->assertSame(0, OutlookMeeting::query()->where('graph_id', '=', 'FAKE-non-utc-event')->count());
        $skipped = Log::allLogs()
            ->filter(fn (LogEntry $log): bool => $log->message === 'Outlook meetings skipped')
            ->values();
        $this->assertCount(1, $skipped);
        $this->assertSame(['reason' => 'non_utc', 'count' => 1], $skipped->firstOrFail()->context);
        $everything = json_encode(Log::allLogs()->map(fn (LogEntry $log): array => $log->toArray())->all());
        $this->assertIsString($everything);
        $this->assertStringNotContainsString('SECRET', $everything);
        $this->assertStringNotContainsString('FAKE-non-utc-event', $everything);
    }

    /**
     * Fakes calendarView with the recorded round A experiment-select pages, the pass that carries
     * attendees, each event passed through $mutate when given.
     *
     * @param  (Closure(array<string, mixed>): array<string, mixed>)|null  $mutate
     */
    private function fakeExperimentSelect(?Closure $mutate = null): void
    {
        Config::set('microsoft365.graph.max_pages', 30);
        $sequence = Http::sequence();
        foreach ($this->graphPages('A', 'experiment-select') as $page) {
            if ($mutate !== null && is_array($page['value'] ?? null)) {
                $page['value'] = array_map($mutate, $page['value']);
            }
            $sequence->push($page);
        }
        Http::fake([self::GRAPH_URL => $sequence]);
    }

    /**
     * A recorded round A experiment-select event, found by its test tag, e.g. "S1b]".
     *
     * @return array<string, mixed>
     */
    private function experimentEvent(string $tag): array
    {
        foreach ($this->graphPages('A', 'experiment-select') as $page) {
            foreach ($page['value'] ?? [] as $event) {
                if (is_array($event) && str_contains((string) ($event['subject'] ?? ''), $tag)) {
                    return $event;
                }
            }
        }

        $this->fail('No experiment-select event tagged '.$tag);
    }

    /**
     * @return array<string, mixed>
     */
    private function graphAttendee(string $address, string $type): array
    {
        return [
            'type' => $type,
            'status' => ['response' => 'none', 'time' => '0001-01-01T00:00:00Z'],
            'emailAddress' => ['name' => 'Name of '.$address, 'address' => $address],
        ];
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
}
