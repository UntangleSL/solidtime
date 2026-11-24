<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Exceptions\Api\ApiException;
use App\Exceptions\Api\OrganizationHasNoSubscriptionButMultipleMembersException;
use App\Exceptions\Api\OverlappingTimeEntryApiException;
use App\Http\Controllers\Api\V1\TimeEntryController;
use App\Http\Requests\V1\TimeEntry\TimeEntryUpdateRequest;
use App\Microsoft365\Http\Requests\MeetingConversionRequest;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookMeetingLink;
use App\Microsoft365\OutOfSync\ApplyResult;
use App\Microsoft365\OutOfSync\Decision;
use App\Microsoft365\OutOfSync\DecisionAction;
use App\Microsoft365\OutOfSync\LinkState;
use App\Microsoft365\OutOfSync\Observation;
use App\Microsoft365\OutOfSync\ObservationKind;
use App\Microsoft365\OutOfSync\OutOfSyncApplier;
use App\Microsoft365\OutOfSync\OutOfSyncRules;
use App\Microsoft365\OutOfSync\OutOfSyncScope;
use App\Microsoft365\TimeEntries\CoreTimeEntryUpdater;
use App\Models\Member;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Service\BillingContract;
use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Auth;
use Mockery\MockInterface;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

/**
 * The failure paths of the applier (Phase 6 OSYNC-02 "never changed unless safe"; D-03, D-04, D-05, D-07,
 * D-10, D-12): observations applied out of order, core refusing an auto adjust, the cached meeting row of
 * a released link, and every guard that must leave an entry alone. Observations are built with the
 * Observation named constructors, so no Graph fake is needed; nobody is signed in, as in the daily job.
 */
#[CoversClass(OutOfSyncApplier::class)]
#[CoversClass(ApplyResult::class)]
#[UsesClass(OutOfSyncRules::class)]
#[UsesClass(OutOfSyncScope::class)]
#[UsesClass(Observation::class)]
#[UsesClass(ObservationKind::class)]
#[UsesClass(LinkState::class)]
#[UsesClass(Decision::class)]
#[UsesClass(DecisionAction::class)]
#[UsesClass(CoreTimeEntryUpdater::class)]
#[UsesClass(OutlookMeetingLink::class)]
#[UsesClass(OutlookMeeting::class)]
#[UsesClass(TimeEntryController::class)]
#[UsesClass(TimeEntryUpdateRequest::class)]
#[UsesClass(MeetingConversionRequest::class)]
#[UsesClass(ApiException::class)]
#[UsesClass(OverlappingTimeEntryApiException::class)]
#[UsesClass(OrganizationHasNoSubscriptionButMultipleMembersException::class)]
class OutOfSyncApplierTest extends TestCaseWithDatabase
{
    /**
     * An employee of a fresh organization; the clock stands on Tuesday 2026-12-01 08:00 UTC by default,
     * before every meeting of the tests. Nobody is signed in (job context).
     *
     * @return object{user: User, organization: Organization, member: Member, owner: User, ownerMember: Member}
     */
    private function employee(string $now = '2026-12-01 08:00:00'): object
    {
        $this->travelTo(CarbonImmutable::parse($now, 'UTC'));
        $data = $this->createUserWithRole(Role::Employee);
        $data->user->save();

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
     * The cached meeting row of an occurrence (one per user and Graph id).
     */
    private function cachedMeeting(User $user, string $graphId, string $start, string $end, ?string $goneAt = null): OutlookMeeting
    {
        $meeting = OutlookMeeting::query()->create([
            'user_id' => $user->getKey(),
            'graph_id' => $graphId,
            'event_type' => 'singleInstance',
            'subject' => 'Subject '.$graphId,
            'starts_at' => $start,
            'ends_at' => $end,
            'is_organizer' => false,
            'is_online_meeting' => false,
            'last_seen_at' => '2026-11-30 08:00:00',
        ]);
        if ($goneAt !== null) {
            OutlookMeeting::query()->whereKey($meeting->getKey())->update(['gone_at' => $goneAt]);
        }

        return $meeting;
    }

    /**
     * @param  array<string, Observation>  $observations
     */
    private function apply(User $user, array $observations, ?CarbonImmutable $now = null): ApplyResult
    {
        return app(OutOfSyncApplier::class)->apply($user, $observations, $now ?? CarbonImmutable::now('UTC'));
    }

    private function seenAt(string $start, string $end, ?CarbonImmutable $at = null): Observation
    {
        return Observation::present($start, $end, false, $at ?? CarbonImmutable::now('UTC'));
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

    /**
     * @return array{0: string|null, 1: string|null}
     */
    private function timesOf(TimeEntry $entry): array
    {
        $fresh = TimeEntry::query()->findOrFail($entry->getKey());

        return [$this->utc($fresh->start), $this->utc($fresh->end)];
    }

    public function test_older_observation_never_overrides_a_newer_one(): void
    {
        // Arrange: an unedited entry of a not-started meeting at slot A (10:00-11:00)
        $data = $this->employee();
        $entry = $this->linkedEntry($data->user, 'evt-1', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        $t2 = CarbonImmutable::now('UTC');
        $t1 = $t2->subMinutes(5);

        // Act: a sync sees slot B at T2, then a slow lookup made at T1 still saw slot A (Pitfall 1)
        $newer = $this->apply($data->user, ['evt-1' => $this->seenAt('2026-12-03 12:00:00', '2026-12-03 13:00:00', $t2)]);
        $older = $this->apply($data->user, ['evt-1' => $this->seenAt('2026-12-03 10:00:00', '2026-12-03 11:00:00', $t1)]);

        // Assert: the entry stays at B, the older sighting is skipped and leaves no trace
        $this->assertSame(1, $newer->adjusted);
        $this->assertSame(['adjusted' => 0, 'flagged' => 0, 'released' => 0, 'cleared' => 0, 'resynced' => 0, 'skipped' => 1], $older->toArray());
        $this->assertSame(['2026-12-03 12:00:00', '2026-12-03 13:00:00'], $this->timesOf($entry));
        $link = $this->linkOf($data->user, 'evt-1');
        $this->assertSame('2026-12-03 12:00:00', $this->utc($link->meeting_starts_at));
        $this->assertSame($t2->format('Y-m-d H:i:s'), $this->utc($link->last_checked_at));
        $this->assertNull($link->flag_reason);
    }

    public function test_observation_at_the_same_second_still_applies(): void
    {
        // Arrange: a flag set by an observation at T
        $data = $this->employee();
        $this->linkedEntry($data->user, 'evt-1', '2026-12-03 10:00:00', '2026-12-03 11:00:00', '2026-12-03 10:00:00', '2026-12-03 10:30:00');
        $at = CarbonImmutable::now('UTC');
        $this->apply($data->user, ['evt-1' => $this->seenAt('2026-12-03 12:00:00', '2026-12-03 13:00:00', $at)]);

        // Act: Outlook is back at the recorded slot, seen within the same second
        $result = $this->apply($data->user, ['evt-1' => $this->seenAt('2026-12-03 10:00:00', '2026-12-03 11:00:00', $at)]);

        // Assert: not stale, the flag is cleared (D-17)
        $this->assertSame(1, $result->cleared);
        $this->assertNull($this->linkOf($data->user, 'evt-1')->flag_reason);
    }

    public function test_overlap_turns_auto_adjust_into_a_moved_flag(): void
    {
        // Arrange: the organization forbids overlaps and a manual entry occupies the new slot
        $data = $this->employee();
        $entry = $this->linkedEntry($data->user, 'evt-1', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        TimeEntry::factory()->forMember($data->member)->create([
            'start' => Carbon::parse('2026-12-03 12:30:00', 'UTC'),
            'end' => Carbon::parse('2026-12-03 13:30:00', 'UTC'),
            'description' => '',
        ]);
        $data->organization->prevent_overlapping_time_entries = true;
        $data->organization->save();

        // Act
        $result = $this->apply($data->user, ['evt-1' => $this->seenAt('2026-12-03 12:00:00', '2026-12-03 13:00:00')]);

        // Assert: core refused, so the user decides (D-04 "when that is safe", Pitfall 6)
        $this->assertSame(0, $result->adjusted);
        $this->assertSame(1, $result->flagged);
        $this->assertSame(['2026-12-03 10:00:00', '2026-12-03 11:00:00'], $this->timesOf($entry));
        $link = $this->linkOf($data->user, 'evt-1');
        $this->assertSame(Decision::REASON_MOVED, $link->flag_reason);
        $this->assertSame('2026-12-03 12:00:00', $this->utc($link->outlook_starts_at));
        $this->assertSame('2026-12-03 13:00:00', $this->utc($link->outlook_ends_at));
        $this->assertFalse($link->outlook_all_day);
        $this->assertSame('2026-12-03 10:00:00', $this->utc($link->meeting_starts_at));
        $this->assertNull($link->auto_adjusted_at);
        $this->assertNull(Auth::guard('web')->user());
    }

    public function test_blocked_organization_turns_auto_adjust_into_a_moved_flag(): void
    {
        // Arrange: billing reports the organization as blocked
        $data = $this->employee();
        $entry = $this->linkedEntry($data->user, 'evt-1', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        $this->mock(BillingContract::class, function (MockInterface $mock): void {
            $mock->shouldReceive('isBlocked')->andReturn(true);
            $mock->shouldReceive('hasSubscription')->andReturn(false);
            $mock->shouldReceive('hasTrial')->andReturn(false);
            $mock->shouldReceive('canUseBillableRates')->andReturn(false);
        });

        // Act
        $result = $this->apply($data->user, ['evt-1' => $this->seenAt('2026-12-03 12:00:00', '2026-12-03 13:00:00')]);

        // Assert
        $this->assertSame(0, $result->adjusted);
        $this->assertSame(1, $result->flagged);
        $this->assertSame(['2026-12-03 10:00:00', '2026-12-03 11:00:00'], $this->timesOf($entry));
        $link = $this->linkOf($data->user, 'evt-1');
        $this->assertSame(Decision::REASON_MOVED, $link->flag_reason);
        $this->assertSame('2026-12-03 12:00:00', $this->utc($link->outlook_starts_at));
        $this->assertNull($link->auto_adjusted_at);
    }

    public function test_release_moves_the_cached_meeting_row(): void
    {
        // Arrange: two started meetings (10:00, now 10:30); the second one's cached row is gone
        $data = $this->employee('2026-12-03 10:30:00');
        $entry = $this->linkedEntry($data->user, 'evt-r', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        $other = $this->linkedEntry($data->user, 'evt-g', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        $cached = $this->cachedMeeting($data->user, 'evt-r', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        $gone = $this->cachedMeeting($data->user, 'evt-g', '2026-12-03 10:00:00', '2026-12-03 11:00:00', '2026-12-02 08:00:00');

        // Act: a lookup sees both at 14:00-15:00
        $result = $this->apply($data->user, [
            'evt-r' => $this->seenAt('2026-12-03 14:00:00', '2026-12-03 15:00:00'),
            'evt-g' => $this->seenAt('2026-12-03 14:00:00', '2026-12-03 15:00:00'),
        ]);

        // Assert: both links settle, the entries keep their times (D-02, D-03)
        $this->assertSame(2, $result->released);
        $this->assertNotNull($this->linkOf($data->user, 'evt-r')->released_at);
        $this->assertNotNull($this->linkOf($data->user, 'evt-g')->released_at);
        $this->assertSame(['2026-12-03 10:00:00', '2026-12-03 11:00:00'], $this->timesOf($entry));
        $this->assertSame(['2026-12-03 10:00:00', '2026-12-03 11:00:00'], $this->timesOf($other));
        // The live cached row follows the meeting: no ghost at the old slot (Pitfall 5)
        $cached->refresh();
        $this->assertSame('2026-12-03 14:00:00', $this->utc($cached->starts_at));
        $this->assertSame('2026-12-03 15:00:00', $this->utc($cached->ends_at));
        $this->assertSame('Subject evt-r', $cached->subject);
        $this->assertNull($cached->gone_at);
        // A gone row stays as it is
        $gone->refresh();
        $this->assertSame('2026-12-03 10:00:00', $this->utc($gone->starts_at));
        $this->assertSame('2026-12-03 11:00:00', $this->utc($gone->ends_at));
        $this->assertNotNull($gone->gone_at);
    }

    public function test_release_without_a_cached_row_creates_none(): void
    {
        // Arrange: a started meeting whose row is not cached (another week, never synced)
        $data = $this->employee('2026-12-03 10:30:00');
        $this->linkedEntry($data->user, 'evt-n', '2026-12-03 10:00:00', '2026-12-03 11:00:00');

        // Act
        $result = $this->apply($data->user, ['evt-n' => $this->seenAt('2026-12-03 14:00:00', '2026-12-03 15:00:00')]);

        // Assert
        $this->assertSame(1, $result->released);
        $this->assertSame(0, OutlookMeeting::query()->where('graph_id', '=', 'evt-n')->count());
    }

    public function test_auto_adjust_records_where_the_entry_came_from(): void
    {
        // Arrange
        $data = $this->employee();
        $entry = $this->linkedEntry($data->user, 'evt-1', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        $now = CarbonImmutable::now('UTC');
        $observedAt = $now->subMinute();

        // Act
        $result = $this->apply($data->user, ['evt-1' => $this->seenAt('2026-12-04 09:00:00', '2026-12-04 09:45:00', $observedAt)], $now);

        // Assert: the entry moved through core and the link remembers the old slot
        $this->assertSame(1, $result->adjusted);
        $this->assertSame(['2026-12-04 09:00:00', '2026-12-04 09:45:00'], $this->timesOf($entry));
        $link = $this->linkOf($data->user, 'evt-1');
        $this->assertSame('2026-12-03 10:00:00', $this->utc($link->auto_adjusted_from_starts_at));
        $this->assertSame('2026-12-03 11:00:00', $this->utc($link->auto_adjusted_from_ends_at));
        $this->assertSame($now->format('Y-m-d H:i:s'), $this->utc($link->auto_adjusted_at));
        $this->assertSame('2026-12-04 09:00:00', $this->utc($link->meeting_starts_at));
        $this->assertSame('2026-12-04 09:45:00', $this->utc($link->meeting_ends_at));
        $this->assertSame($observedAt->format('Y-m-d H:i:s'), $this->utc($link->last_checked_at));
        $this->assertNull($link->flag_reason);
        $this->assertNull(Auth::guard('web')->user());
    }

    public function test_flag_is_idempotent(): void
    {
        // Arrange: the user shortened the entry, so a move flags it
        $data = $this->employee();
        $entry = $this->linkedEntry($data->user, 'evt-1', '2026-12-03 10:00:00', '2026-12-03 11:00:00', '2026-12-03 10:00:00', '2026-12-03 10:30:00');
        $first = $this->apply($data->user, ['evt-1' => $this->seenAt('2026-12-03 12:00:00', '2026-12-03 13:00:00')]);
        $flaggedAt = $this->utc($this->linkOf($data->user, 'evt-1')->flagged_at);

        // Act: the same move is seen again an hour later
        $this->travel(1)->hours();
        $second = $this->apply($data->user, ['evt-1' => $this->seenAt('2026-12-03 12:00:00', '2026-12-03 13:00:00')]);

        // Assert: one flag, its first time kept, the edit kept
        $this->assertSame(1, $first->flagged);
        $this->assertSame(0, $second->flagged);
        $this->assertSame(0, $second->total());
        $link = $this->linkOf($data->user, 'evt-1');
        $this->assertSame(Decision::REASON_MOVED, $link->flag_reason);
        $this->assertSame($flaggedAt, $this->utc($link->flagged_at));
        $this->assertSame('2026-12-01 09:00:00', $this->utc($link->last_checked_at));
        $this->assertSame(['2026-12-03 10:00:00', '2026-12-03 10:30:00'], $this->timesOf($entry));
    }
}
