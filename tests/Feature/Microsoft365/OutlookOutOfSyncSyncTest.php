<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Exceptions\Api\ApiException;
use App\Http\Controllers\Api\V1\TimeEntryController;
use App\Http\Middleware\CheckOrganizationBlocked;
use App\Http\Requests\V1\TimeEntry\TimeEntryStoreRequest;
use App\Http\Requests\V1\TimeEntry\TimeEntryUpdateRequest;
use App\Jobs\RecalculateSpentTimeForProject;
use App\Microsoft365\Graph\GraphAccessGuard;
use App\Microsoft365\Graph\GraphCalendarClient;
use App\Microsoft365\Graph\MicrosoftTokenService;
use App\Microsoft365\Graph\OutlookMeetingEligibility;
use App\Microsoft365\Graph\OutlookMeetingSyncService;
use App\Microsoft365\Graph\SyncOutcome;
use App\Microsoft365\Graph\SyncStatus;
use App\Microsoft365\Http\Controllers\MeetingConversionController;
use App\Microsoft365\Http\Controllers\OutlookMeetingController;
use App\Microsoft365\Http\Middleware\EnsureMicrosoftIsEnabled;
use App\Microsoft365\Http\Requests\MeetingConversionRequest;
use App\Microsoft365\Http\Requests\MeetingRangeRequest;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookMeetingLink;
use App\Microsoft365\Models\OutlookSyncWindow;
use App\Microsoft365\OutOfSync\ApplyResult;
use App\Microsoft365\OutOfSync\Decision;
use App\Microsoft365\OutOfSync\DecisionAction;
use App\Microsoft365\OutOfSync\LinkedSightings;
use App\Microsoft365\OutOfSync\LinkState;
use App\Microsoft365\OutOfSync\Observation;
use App\Microsoft365\OutOfSync\ObservationKind;
use App\Microsoft365\OutOfSync\OutOfSyncApplier;
use App\Microsoft365\OutOfSync\OutOfSyncRules;
use App\Microsoft365\OutOfSync\OutOfSyncScope;
use App\Microsoft365\Suggestions\Assignment;
use App\Microsoft365\Suggestions\BookableProjects;
use App\Microsoft365\Suggestions\MeetingSignalInput;
use App\Microsoft365\Suggestions\MeetingSignals;
use App\Microsoft365\Suggestions\SeriesAssignmentResolver;
use App\Microsoft365\Suggestions\SubjectTokenizer;
use App\Microsoft365\TimeEntries\CoreTimeEntryCreator;
use App\Microsoft365\TimeEntries\CoreTimeEntryUpdater;
use App\Models\Member;
use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

/**
 * The out-of-sync check of the interactive sync, end to end (Phase 6 tracer): an Outlook change seen by
 * the next calendar sync reaches the linked entry through the rules, the applier and core's own update
 * path. Also proves the link migration of 06-01 (active-only uniqueness, null-only backfill) in Postgres.
 */
#[CoversClass(OutOfSyncApplier::class)]
#[CoversClass(CoreTimeEntryUpdater::class)]
#[CoversClass(ApplyResult::class)]
#[UsesClass(OutlookMeetingSyncService::class)]
#[UsesClass(OutOfSyncRules::class)]
#[UsesClass(OutOfSyncScope::class)]
#[UsesClass(LinkedSightings::class)]
#[UsesClass(Observation::class)]
#[UsesClass(ObservationKind::class)]
#[UsesClass(LinkState::class)]
#[UsesClass(Decision::class)]
#[UsesClass(DecisionAction::class)]
#[UsesClass(OutlookMeetingLink::class)]
#[UsesClass(OutlookMeeting::class)]
#[UsesClass(OutlookSyncWindow::class)]
#[UsesClass(MicrosoftAccount::class)]
#[UsesClass(GraphCalendarClient::class)]
#[UsesClass(OutlookMeetingEligibility::class)]
#[UsesClass(MicrosoftTokenService::class)]
#[UsesClass(GraphAccessGuard::class)]
#[UsesClass(SyncOutcome::class)]
#[UsesClass(SyncStatus::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
#[UsesClass(EnsureMicrosoftIsEnabled::class)]
#[UsesClass(OutlookMeetingController::class)]
#[UsesClass(MeetingRangeRequest::class)]
#[UsesClass(MeetingConversionController::class)]
#[UsesClass(MeetingConversionRequest::class)]
#[UsesClass(CoreTimeEntryCreator::class)]
#[UsesClass(TimeEntryController::class)]
#[UsesClass(TimeEntryStoreRequest::class)]
#[UsesClass(TimeEntryUpdateRequest::class)]
#[UsesClass(CheckOrganizationBlocked::class)]
#[UsesClass(ApiException::class)]
#[UsesClass(SeriesAssignmentResolver::class)]
#[UsesClass(BookableProjects::class)]
#[UsesClass(Assignment::class)]
#[UsesClass(MeetingSignalInput::class)]
#[UsesClass(MeetingSignals::class)]
#[UsesClass(SubjectTokenizer::class)]
class OutlookOutOfSyncSyncTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

    private const string GRAPH_URL = 'https://graph.microsoft.com/v1.0/me/calendarView*';

    private const string NEXT_LINK = 'https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=next';

    /**
     * An employee of a fresh organization, signed in on the web guard with a connected account. The clock
     * stands on Tuesday 2026-12-01 08:00 UTC, before every meeting of the synced week.
     *
     * @return object{user: User, organization: Organization, member: Member, owner: User, ownerMember: Member}
     */
    private function employee(string $now = '2026-12-01 08:00:00'): object
    {
        $this->travelTo(CarbonImmutable::parse($now, 'UTC'));
        $this->configureMicrosoft365();
        $data = $this->createUserWithRole(Role::Employee);
        $data->user->save();
        $this->connectedAccount($data->user);
        $this->actingAs($data->user);

        return $data;
    }

    /**
     * A time entry of the user and the link of a converted occurrence. The link records the meeting's
     * own slot (start, end); the entry has the same times unless the user edited them (entryStart,
     * entryEnd). Times are UTC 'Y-m-d H:i:s'.
     */
    private function linkedEntry(User $user, string $graphId, string $start, string $end, ?string $entryStart = null, ?string $entryEnd = null): TimeEntry
    {
        $member = Member::query()->where('user_id', '=', $user->getKey())->firstOrFail();
        $entry = TimeEntry::factory()->forMember($member)->create([
            'start' => Carbon::parse($entryStart ?? $start, 'UTC'),
            'end' => Carbon::parse($entryEnd ?? $end, 'UTC'),
            'description' => 'Linked '.$graphId,
            'billable' => false,
        ]);
        OutlookMeetingLink::query()->create([
            'user_id' => $user->getKey(),
            'graph_id' => $graphId,
            'time_entry_id' => $entry->getKey(),
            'meeting_starts_at' => $start,
            'meeting_ends_at' => $end,
        ]);

        return $entry;
    }

    /**
     * A Graph calendarView event in the shape the sync asks for ($select), with UTC times
     * ('Y-m-d\TH:i:s').
     *
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function graphEvent(string $id, string $start, string $end, array $overrides = []): array
    {
        return array_merge([
            'id' => $id,
            'iCalUId' => 'ical-'.$id,
            'subject' => 'Subject '.$id,
            'start' => ['dateTime' => $start.'.0000000', 'timeZone' => 'UTC'],
            'end' => ['dateTime' => $end.'.0000000', 'timeZone' => 'UTC'],
            'isAllDay' => false,
            'isCancelled' => false,
            'isOrganizer' => false,
            'responseStatus' => ['response' => 'accepted', 'time' => '0001-01-01T00:00:00Z'],
            'type' => 'singleInstance',
            'seriesMasterId' => null,
            'originalStart' => null,
            'organizer' => ['emailAddress' => ['name' => 'Org Name', 'address' => 'org@example.test']],
            'showAs' => 'busy',
            'sensitivity' => 'normal',
            'webLink' => 'https://outlook.example.test/'.$id,
            'isOnlineMeeting' => false,
        ], $overrides);
    }

    /**
     * Fakes calendarView for the synced week. Complete: one page without a next link. Not complete: the
     * events come on page 1 with a next link, and the page cap of 1 cuts the traversal there (D-07).
     *
     * @param  list<array<string, mixed>>  $events
     */
    private function fakeWindow(array $events, bool $complete): void
    {
        if ($complete) {
            Config::set('microsoft365.graph.max_pages', 30);
            Http::fake([self::GRAPH_URL => Http::response(['value' => $events])]);

            return;
        }

        Config::set('microsoft365.graph.max_pages', 1);
        Http::fake([self::GRAPH_URL => Http::sequence()
            ->push(['value' => $events, '@odata.nextLink' => self::NEXT_LINK])
            ->push(['value' => []]),
        ]);
    }

    private function syncWeek(): TestResponse
    {
        return $this->postJson(route('microsoft.meetings.sync', [], false), [
            'start' => '2026-11-30T00:00:00Z',
            'end' => '2026-12-07T00:00:00Z',
            'force' => true,
        ]);
    }

    private function linkOf(User $user, string $graphId): OutlookMeetingLink
    {
        return OutlookMeetingLink::query()
            ->where('user_id', '=', $user->getKey())
            ->where('graph_id', '=', $graphId)
            ->sole();
    }

    private function utc(?\DateTimeInterface $value): ?string
    {
        return $value === null ? null : CarbonImmutable::instance($value)->utc()->format('Y-m-d H:i:s');
    }

    public function test_moved_meeting_that_has_not_started_moves_its_unedited_entry(): void
    {
        // Arrange: a meeting on Thursday 10:00-11:00, converted through the real endpoint
        $data = $this->employee();
        $project = Project::factory()->forOrganization($data->organization)->isPublic()->create();
        $meeting = OutlookMeeting::query()->create([
            'user_id' => $data->user->getKey(),
            'graph_id' => 'evt-1',
            'event_type' => 'singleInstance',
            'subject' => 'Weekly sync',
            'starts_at' => '2026-12-03 10:00:00',
            'ends_at' => '2026-12-03 11:00:00',
            'organizer_name' => 'Org Name',
            'is_organizer' => false,
            'is_online_meeting' => true,
            'web_link' => 'https://outlook.office.com/owa/?itemid=evt-1',
            'last_seen_at' => '2026-11-30 08:00:00',
        ]);
        $this->postJson(route('microsoft.meetings.convert', ['organization' => $data->organization->getKey()], false), [
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ])->assertOk()->assertJsonPath('results.0.status', 'created');
        $entry = TimeEntry::query()->where('user_id', '=', $data->user->getKey())->sole();
        $this->assertSame('2026-12-03 10:00:00', $this->utc($entry->start));
        $this->assertSame('2026-12-03 10:00:00', $this->utc($this->linkOf($data->user, 'evt-1')->meeting_starts_at));
        // Only the recalculation of the sync's own update is recorded from here on
        Queue::fake([RecalculateSpentTimeForProject::class]);
        // Outlook moved the meeting to 12:00-13:00 the same day
        $this->fakeWindow([$this->graphEvent('evt-1', '2026-12-03T12:00:00', '2026-12-03T13:00:00')], complete: true);

        // Act
        $response = $this->syncWeek();

        // Assert: the entry followed through core's update path, nothing else of it changed
        $response->assertOk()->assertJsonPath('status', 'ok')->assertJsonPath('truncated', false);
        $entry->refresh();
        $this->assertSame('2026-12-03 12:00:00', $this->utc($entry->start));
        $this->assertSame('2026-12-03 13:00:00', $this->utc($entry->end));
        $this->assertSame('Weekly sync', $entry->description);
        $this->assertSame($project->getKey(), $entry->project_id);
        $this->assertFalse($entry->billable);
        Queue::assertPushed(RecalculateSpentTimeForProject::class);
        // The link's snapshot is the new slot, no flag, and the adjust is recorded with the old times
        $link = $this->linkOf($data->user, 'evt-1');
        $this->assertSame('2026-12-03 12:00:00', $this->utc($link->meeting_starts_at));
        $this->assertSame('2026-12-03 13:00:00', $this->utc($link->meeting_ends_at));
        $this->assertNull($link->flag_reason);
        $this->assertNull($link->flagged_at);
        $this->assertNotNull($link->auto_adjusted_at);
        $this->assertSame('2026-12-03 10:00:00', $this->utc($link->auto_adjusted_from_starts_at));
        $this->assertSame('2026-12-03 11:00:00', $this->utc($link->auto_adjusted_from_ends_at));
        $this->assertNotNull($link->last_checked_at);
        $this->assertNull($link->released_at);
        $this->assertSame(1, TimeEntry::query()->count());
    }

    public function test_unlinked_entries_are_not_touched_by_the_out_of_sync_check(): void
    {
        // Arrange: a linked entry and an unlinked one, both at the old slot
        $data = $this->employee();
        $linked = $this->linkedEntry($data->user, 'evt-1', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        $unlinked = TimeEntry::factory()->forMember($data->member)->create([
            'start' => Carbon::parse('2026-12-03 10:00:00', 'UTC'),
            'end' => Carbon::parse('2026-12-03 11:00:00', 'UTC'),
        ]);
        $this->fakeWindow([$this->graphEvent('evt-1', '2026-12-03T12:00:00', '2026-12-03T13:00:00')], complete: true);

        // Act
        $this->syncWeek()->assertOk();

        // Assert
        $unlinked->refresh();
        $this->assertSame('2026-12-03 10:00:00', $this->utc($unlinked->start));
        $this->assertSame('2026-12-03 11:00:00', $this->utc($unlinked->end));
        $this->assertSame('2026-12-03 12:00:00', $this->utc($linked->refresh()->start));
        $this->assertSame(2, TimeEntry::query()->count());
    }

    public function test_partial_traversal_applies_nothing(): void
    {
        // Arrange: the moved event arrives on page 1 of a traversal the page cap cuts short
        $data = $this->employee();
        $entry = $this->linkedEntry($data->user, 'evt-1', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        $this->fakeWindow([$this->graphEvent('evt-1', '2026-12-03T12:00:00', '2026-12-03T13:00:00')], complete: false);

        // Act
        $response = $this->syncWeek();

        // Assert: a partial sync never acts (D-07)
        $response->assertOk()->assertJsonPath('status', 'ok')->assertJsonPath('truncated', true);
        Http::assertSentCount(1);
        $entry->refresh();
        $this->assertSame('2026-12-03 10:00:00', $this->utc($entry->start));
        $this->assertSame('2026-12-03 11:00:00', $this->utc($entry->end));
        $link = $this->linkOf($data->user, 'evt-1');
        $this->assertSame('2026-12-03 10:00:00', $this->utc($link->meeting_starts_at));
        $this->assertNull($link->flag_reason);
        $this->assertNull($link->auto_adjusted_at);
        $this->assertNull($link->last_checked_at);
    }

    public function test_moved_meeting_whose_entry_was_edited_is_flagged_not_adjusted(): void
    {
        // Arrange: the user shortened the entry to 10:00-10:30 by hand
        $data = $this->employee();
        $entry = $this->linkedEntry($data->user, 'evt-1', '2026-12-03 10:00:00', '2026-12-03 11:00:00', '2026-12-03 10:00:00', '2026-12-03 10:30:00');
        $this->fakeWindow([$this->graphEvent('evt-1', '2026-12-03T12:00:00', '2026-12-03T13:00:00')], complete: true);

        // Act
        $this->syncWeek()->assertOk();

        // Assert: the edit is kept and the move waits for the user's choice (D-04)
        $entry->refresh();
        $this->assertSame('2026-12-03 10:00:00', $this->utc($entry->start));
        $this->assertSame('2026-12-03 10:30:00', $this->utc($entry->end));
        $link = $this->linkOf($data->user, 'evt-1');
        $this->assertSame(Decision::REASON_MOVED, $link->flag_reason);
        $this->assertNotNull($link->flagged_at);
        $this->assertSame('2026-12-03 12:00:00', $this->utc($link->outlook_starts_at));
        $this->assertSame('2026-12-03 13:00:00', $this->utc($link->outlook_ends_at));
        $this->assertSame('2026-12-03 10:00:00', $this->utc($link->meeting_starts_at));
        $this->assertNull($link->auto_adjusted_at);
    }

    public function test_started_meeting_moved_keeps_its_entry_and_releases_the_link(): void
    {
        // Arrange: the clock stands after the recorded start (10:00), the meeting moves to 14:00
        $data = $this->employee('2026-12-03 10:30:00');
        $entry = $this->linkedEntry($data->user, 'evt-1', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        $this->fakeWindow([$this->graphEvent('evt-1', '2026-12-03T14:00:00', '2026-12-03T15:00:00')], complete: true);

        // Act
        $this->syncWeek()->assertOk();

        // Assert: a started meeting's entry is never changed (D-02, D-03)
        $entry->refresh();
        $this->assertSame('2026-12-03 10:00:00', $this->utc($entry->start));
        $this->assertSame('2026-12-03 11:00:00', $this->utc($entry->end));
        $link = $this->linkOf($data->user, 'evt-1');
        $this->assertNotNull($link->released_at);
        $this->assertNull($link->flag_reason);
        $this->assertNull($link->auto_adjusted_at);
    }
}
