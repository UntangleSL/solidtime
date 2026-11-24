<?php

declare(strict_types=1);

namespace Tests\Unit\Microsoft365;

use App\Microsoft365\Models\OutlookMeetingLink;
use App\Microsoft365\OutOfSync\Decision;
use App\Microsoft365\OutOfSync\DecisionAction;
use App\Microsoft365\OutOfSync\LinkedSightings;
use App\Microsoft365\OutOfSync\LinkState;
use App\Microsoft365\OutOfSync\Observation;
use App\Microsoft365\OutOfSync\ObservationKind;
use App\Microsoft365\OutOfSync\OutOfSyncRules;
use App\Models\TimeEntry;
use Carbon\CarbonImmutable;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use ReflectionClass;
use ReflectionNamedType;
use ReflectionParameter;
use ReflectionProperty;
use Tests\TestCase;

/**
 * The Phase 6 owner rules, proven without a database: links and entries are built in memory and never
 * saved, and "now" is always passed in.
 */
#[CoversClass(OutOfSyncRules::class)]
#[CoversClass(LinkedSightings::class)]
#[CoversClass(Decision::class)]
#[CoversClass(LinkState::class)]
#[CoversClass(Observation::class)]
class OutOfSyncRulesTest extends TestCase
{
    private const string NOW = '2026-12-01 08:00:00';

    /** Recorded slot of a not-started meeting */
    private const array SNAP = ['2026-12-03 10:00:00', '2026-12-03 11:00:00'];

    /** The slot Outlook moved it to */
    private const array MOVED = ['2026-12-03 12:00:00', '2026-12-03 13:00:00'];

    /** Recorded slot of a started meeting */
    private const array PAST = ['2026-11-30 10:00:00', '2026-11-30 11:00:00'];

    /** An entry edited by hand (start moved by 15 minutes) */
    private const array EDITED = ['2026-12-03 10:15:00', '2026-12-03 11:00:00'];

    /** The day of SNAP as an all-day block */
    private const array ALL_DAY = ['2026-12-03 00:00:00', '2026-12-04 00:00:00'];

    private function now(): CarbonImmutable
    {
        return CarbonImmutable::parse(self::NOW, 'UTC');
    }

    private function utc(string $value): CarbonImmutable
    {
        return CarbonImmutable::parse($value, 'UTC');
    }

    private function linkState(string $snapshotStart, string $snapshotEnd, string $entryStart, ?string $entryEnd): LinkState
    {
        $link = new OutlookMeetingLink;
        $link->meeting_starts_at = $this->utc($snapshotStart);
        $link->meeting_ends_at = $this->utc($snapshotEnd);

        $entry = new TimeEntry;
        $entry->start = $this->utc($entryStart);
        $entry->end = $entryEnd === null ? null : $this->utc($entryEnd);

        return LinkState::fromModels($link, $entry);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function graphEvent(array $overrides = []): array
    {
        return array_replace([
            'id' => 'AAMkAD-tracked',
            'start' => ['dateTime' => '2026-12-03T12:00:00.0000000', 'timeZone' => 'UTC'],
            'end' => ['dateTime' => '2026-12-03T13:00:00.0000000', 'timeZone' => 'UTC'],
            'isAllDay' => false,
            'isCancelled' => false,
        ], $overrides);
    }

    public function test_d04_a_moved_unedited_not_started_link_decides_auto_adjust(): void
    {
        $link = $this->linkState('2026-12-03 10:00:00', '2026-12-03 11:00:00', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        $seen = Observation::present('2026-12-03 12:00:00', '2026-12-03 13:00:00', false, $this->now());

        $decision = (new OutOfSyncRules)->decide($link, $seen, $this->now());

        $this->assertSame(DecisionAction::AutoAdjust, $decision->action);
        $this->assertSame('2026-12-03 12:00:00', $decision->start);
        $this->assertSame('2026-12-03 13:00:00', $decision->end);
        $this->assertNull($decision->reason);
    }

    public function test_d04_d07_a_moved_edited_not_started_link_is_flagged_moved(): void
    {
        $link = $this->linkState('2026-12-03 10:00:00', '2026-12-03 11:00:00', '2026-12-03 10:15:00', '2026-12-03 11:00:00');
        $seen = Observation::present('2026-12-03 12:00:00', '2026-12-03 13:00:00', false, $this->now());

        $decision = (new OutOfSyncRules)->decide($link, $seen, $this->now());

        $this->assertSame(DecisionAction::Flag, $decision->action);
        $this->assertSame(Decision::REASON_MOVED, $decision->reason);
        $this->assertSame('2026-12-03 12:00:00', $decision->start);
        $this->assertSame('2026-12-03 13:00:00', $decision->end);
        $this->assertFalse($decision->allDay);
    }

    public function test_link_state_reads_snapshot_entry_and_flag_as_utc_strings(): void
    {
        $link = new OutlookMeetingLink;
        $link->meeting_starts_at = $this->utc('2026-12-03 10:00:00');
        $link->meeting_ends_at = $this->utc('2026-12-03 11:00:00');
        $link->flag_reason = Decision::REASON_MOVED;
        $link->outlook_starts_at = $this->utc('2026-12-03 12:00:00');
        $link->outlook_ends_at = $this->utc('2026-12-04 00:00:00');
        $link->outlook_all_day = true;
        $entry = new TimeEntry;
        $entry->start = $this->utc('2026-12-03 10:00:00');
        $entry->end = null;

        $state = LinkState::fromModels($link, $entry);

        $this->assertSame('2026-12-03 10:00:00', $state->snapshotStart);
        $this->assertSame('2026-12-03 11:00:00', $state->snapshotEnd);
        $this->assertSame('2026-12-03 10:00:00', $state->entryStart);
        $this->assertNull($state->entryEnd);
        $this->assertSame(Decision::REASON_MOVED, $state->flagReason);
        $this->assertSame('2026-12-03 12:00:00', $state->flagStart);
        $this->assertSame('2026-12-04 00:00:00', $state->flagEnd);
        $this->assertTrue($state->flagAllDay);
    }

    public function test_an_unsaved_link_is_not_flagged_and_not_all_day(): void
    {
        $state = $this->linkState('2026-12-03 10:00:00', '2026-12-03 11:00:00', '2026-12-03 10:00:00', '2026-12-03 11:00:00');

        $this->assertNull($state->flagReason);
        $this->assertNull($state->flagStart);
        $this->assertNull($state->flagEnd);
        $this->assertFalse($state->flagAllDay);
    }

    public function test_sightings_cancelled_event_is_cancelled(): void
    {
        $seen = (new LinkedSightings)->observe($this->graphEvent(['isCancelled' => true]), $this->now());

        $this->assertSame(ObservationKind::Cancelled, $seen->kind);
        $this->assertNull($seen->start);
        $this->assertNull($seen->end);
    }

    public function test_sightings_all_day_event_is_present_all_day(): void
    {
        $seen = (new LinkedSightings)->observe($this->graphEvent([
            'isAllDay' => true,
            'start' => ['dateTime' => '2026-12-03T00:00:00.0000000', 'timeZone' => 'UTC'],
            'end' => ['dateTime' => '2026-12-04T00:00:00.0000000', 'timeZone' => 'UTC'],
        ]), $this->now());

        $this->assertSame(ObservationKind::Present, $seen->kind);
        $this->assertTrue($seen->allDay);
        $this->assertSame('2026-12-03 00:00:00', $seen->start);
        $this->assertSame('2026-12-04 00:00:00', $seen->end);
    }

    public function test_sightings_non_utc_event_is_unknown(): void
    {
        $seen = (new LinkedSightings)->observe($this->graphEvent([
            'start' => ['dateTime' => '2026-12-03T04:00:00.0000000', 'timeZone' => 'Pacific Standard Time'],
        ]), $this->now());

        $this->assertSame(ObservationKind::Unknown, $seen->kind);
    }

    public function test_sightings_collect_keeps_only_tracked_ids(): void
    {
        $events = [
            $this->graphEvent(['id' => 'AAMkAD-tracked']),
            $this->graphEvent(['id' => 'AAMkAD-other']),
            $this->graphEvent(['id' => 'AAMkAD-cancelled', 'isCancelled' => true]),
        ];

        $observations = (new LinkedSightings)->collect(
            $events,
            ['AAMkAD-tracked' => true, 'AAMkAD-cancelled' => true, 'AAMkAD-absent' => true],
            $this->now(),
        );

        $this->assertSame(['AAMkAD-tracked', 'AAMkAD-cancelled'], array_keys($observations));
        $this->assertSame(ObservationKind::Present, $observations['AAMkAD-tracked']->kind);
        $this->assertSame('2026-12-03 12:00:00', $observations['AAMkAD-tracked']->start);
        $this->assertSame(ObservationKind::Cancelled, $observations['AAMkAD-cancelled']->kind);
    }

    /**
     * One row per owner rule: the link (snapshot, entry, flag), what Outlook showed, now, the decision.
     *
     * Row: [snapshot, entry, flag, observation, now, action, reason, start, end, allDay]
     * - snapshot / entry: [start, end] (entry end null = running)
     * - flag: null or [reason, start, end, allDay]
     * - observation: ['present', start, end, allDay] | ['cancelled'] | ['removed'] | ['unknown']
     *
     * @return array<string, array<int, mixed>>
     */
    public static function rulesProvider(): array
    {
        $now = self::NOW;
        $snap = self::SNAP;
        $moved = self::MOVED;
        $past = self::PAST;
        $edited = self::EDITED;
        $allDay = self::ALL_DAY;
        $later = ['2026-12-03 14:00:00', '2026-12-03 15:00:00'];
        $endMoved = ['2026-12-03 10:00:00', '2026-12-03 11:30:00'];
        $startMoved = ['2026-12-03 10:30:00', '2026-12-03 11:00:00'];
        $atNow = ['2026-12-01 08:00:00', '2026-12-01 09:00:00'];
        $inASecond = ['2026-12-01 08:00:01', '2026-12-01 09:00:00'];
        $inProgress = ['2026-12-01 07:30:00', '2026-12-01 08:30:00'];
        $pastEdited = ['2026-11-30 10:15:00', '2026-11-30 11:00:00'];
        $windowEdge = ['2026-10-02 08:00:00', '2026-10-02 09:00:00'];
        $beforeWindow = ['2026-10-02 07:59:59', '2026-10-02 09:00:00'];
        $old = ['2026-10-01 10:00:00', '2026-10-01 11:00:00'];
        $farFuture = ['2027-06-01 10:00:00', '2027-06-01 11:00:00'];
        $farFutureMoved = ['2027-06-02 10:00:00', '2027-06-02 11:00:00'];

        $present = fn (array $slot, bool $isAllDay = false): array => ['present', $slot[0], $slot[1], $isAllDay];
        $flagMoved = fn (array $slot, bool $isAllDay = false): array => ['moved', $slot[0], $slot[1], $isAllDay];
        $flagCancelled = ['cancelled', null, null, false];
        $flagRemoved = ['removed', null, null, false];

        $nothing = [DecisionAction::Nothing, null, null, null, false];
        $clear = [DecisionAction::ClearFlag, null, null, null, false];
        $release = [DecisionAction::Release, null, null, null, false];
        $auto = fn (array $slot): array => [DecisionAction::AutoAdjust, null, $slot[0], $slot[1], false];
        $resync = fn (array $slot): array => [DecisionAction::Resync, null, $slot[0], $slot[1], false];
        $flag = fn (array $slot, bool $isAllDay = false): array => [DecisionAction::Flag, 'moved', $slot[0], $slot[1], $isAllDay];
        $flagC = [DecisionAction::Flag, 'cancelled', null, null, false];
        $flagR = [DecisionAction::Flag, 'removed', null, null, false];

        $rows = [
            // D-07: an unclear answer never acts
            'D-07 unknown, not started, unflagged -> nothing' => [$snap, $snap, null, ['unknown'], $nothing],
            'D-07 unknown, not started, flagged moved -> nothing' => [$snap, $edited, $flagMoved($moved), ['unknown'], $nothing],
            'D-07 unknown, started, unflagged -> nothing' => [$past, $past, null, ['unknown'], $nothing],
            'D-07 unknown, started, flagged cancelled -> nothing' => [$past, $past, $flagCancelled, ['unknown'], $nothing],

            // D-07 / D-17: Outlook at the recorded slot
            'D-07 present at the snapshot, unflagged -> nothing' => [$snap, $snap, null, $present($snap), $nothing],
            'D-07 entry edited by hand, Outlook unchanged -> nothing' => [$snap, $edited, null, $present($snap), $nothing],
            'D-17 present at the snapshot, flagged moved -> clear flag' => [$snap, $edited, $flagMoved($moved), $present($snap), $clear],
            'D-17 present at the snapshot, flagged cancelled -> clear flag' => [$snap, $snap, $flagCancelled, $present($snap), $clear],
            'D-17 present at the snapshot, flagged removed -> clear flag' => [$snap, $snap, $flagRemoved, $present($snap), $clear],
            'D-17 started, back at the snapshot, flagged -> clear flag' => [$past, $past, $flagMoved($moved), $present($past), $clear],
            'D-17 flagged moved all-day, back at the snapshot -> clear flag' => [$snap, $snap, $flagMoved($allDay, true), $present($snap), $clear],

            // D-04: not-started meeting moved
            'D-04 not started, unedited, start and end moved -> auto adjust' => [$snap, $snap, null, $present($moved), $auto($moved)],
            'D-04 not started, unedited, end moved -> auto adjust' => [$snap, $snap, null, $present($endMoved), $auto($endMoved)],
            'D-04 not started, unedited, start moved (duration only) -> auto adjust' => [$snap, $snap, null, $present($startMoved), $auto($startMoved)],
            'D-04 not started, edited, moved -> flag moved' => [$snap, $edited, null, $present($moved), $flag($moved)],
            'D-04 not started, edited, end moved -> flag moved' => [$snap, $edited, null, $present($endMoved), $flag($endMoved)],
            'D-04 not started, entry already at the new slot -> resync' => [$snap, $moved, null, $present($moved), $resync($moved)],
            'D-04 flagged moved, user aligned the entry by hand -> resync' => [$snap, $moved, $flagMoved($moved), $present($moved), $resync($moved)],
            'D-04 already flagged moved with the same times -> nothing' => [$snap, $edited, $flagMoved($moved), $present($moved), $nothing],
            'D-04 flagged moved with older times -> flag moved with the newer times' => [$snap, $edited, $flagMoved($later), $present($moved), $flag($moved)],
            'D-04 running entry (no end), moved -> flag moved' => [$snap, [$snap[0], null], null, $present($moved), $flag($moved)],

            // D-05: not-started meeting cancelled or removed
            'D-05 not started, cancelled -> flag cancelled' => [$snap, $snap, null, ['cancelled'], $flagC],
            'D-05 not started, removed -> flag removed' => [$snap, $snap, null, ['removed'], $flagR],
            'D-05 edited entry, cancelled -> flag cancelled' => [$snap, $edited, null, ['cancelled'], $flagC],
            'D-05 already flagged cancelled, cancelled again -> nothing' => [$snap, $snap, $flagCancelled, ['cancelled'], $nothing],
            'D-05 already flagged removed, removed again -> nothing' => [$snap, $snap, $flagRemoved, ['removed'], $nothing],
            'D-05 flagged removed, then cancelled -> flag cancelled' => [$snap, $snap, $flagRemoved, ['cancelled'], $flagC],
            'D-05 flagged moved, then removed -> flag removed' => [$snap, $edited, $flagMoved($moved), ['removed'], $flagR],
            'D-17 flagged cancelled, reappears elsewhere, entry at the snapshot -> auto adjust' => [$snap, $snap, $flagCancelled, $present($moved), $auto($moved)],
            'D-17 flagged cancelled, reappears elsewhere, entry edited -> flag moved' => [$snap, $edited, $flagCancelled, $present($moved), $flag($moved)],

            // D-18: a not-started meeting that became all-day
            'D-18 not started, unedited, all-day -> flag moved all-day, never auto adjust' => [$snap, $snap, null, $present($allDay, true), $flag($allDay, true)],
            'D-18 not started, edited, all-day -> flag moved all-day' => [$snap, $edited, null, $present($allDay, true), $flag($allDay, true)],
            'D-18 entry already at the all-day slot -> flag, never resync' => [$snap, $allDay, null, $present($allDay, true), $flag($allDay, true)],
            'D-18 already flagged all-day with the same times -> nothing' => [$snap, $snap, $flagMoved($allDay, true), $present($allDay, true), $nothing],
            'D-18 flagged timed at the same times, now all-day -> flag moved all-day' => [$snap, $edited, $flagMoved($allDay), $present($allDay, true), $flag($allDay, true)],
            'D-18 flagged all-day, timed again elsewhere, entry at the snapshot -> auto adjust' => [$snap, $snap, $flagMoved($allDay, true), $present($moved), $auto($moved)],

            // D-01: started = recorded start at or before now
            'D-01 snapshot start equal to now counts as started -> release' => [$atNow, $atNow, null, $present($moved), $release],
            'D-01 snapshot start one second after now is not started -> auto adjust' => [$inASecond, $inASecond, null, $present($moved), $auto($moved)],
            'D-01 meeting in progress, moved -> release' => [$inProgress, $inProgress, null, $present($moved), $release],

            // D-03 / D-02: started meeting
            'D-03 started, unedited, moved -> release' => [$past, $past, null, $present($moved), $release],
            'D-03 started, edited, moved -> release' => [$past, $pastEdited, null, $present($moved), $release],
            'D-03 started, entry already at the new slot -> resync' => [$past, $moved, null, $present($moved), $resync($moved)],
            'D-02 started, cancelled -> nothing' => [$past, $past, null, ['cancelled'], $nothing],
            'D-02 started, removed -> nothing' => [$past, $past, null, ['removed'], $nothing],
            'D-02 started, all-day -> nothing' => [$past, $past, null, $present(['2026-11-30 00:00:00', '2026-12-01 00:00:00'], true), $nothing],
            'D-02 flagged before the start, Outlook still at the flag slot -> nothing' => [$past, $pastEdited, $flagMoved($moved), $present($moved), $nothing],
            'D-02 flagged before the start, moved again after it -> nothing' => [$past, $past, $flagMoved($moved), $present($later), $nothing],
            'D-02 flagged cancelled before the start, removed now -> nothing' => [$past, $past, $flagCancelled, ['removed'], $nothing],

            // D-10: the window of the checks
            'D-10 snapshot start exactly now minus 60 days is in scope -> release' => [$windowEdge, $windowEdge, null, $present($moved), $release],
            'D-10 snapshot start one second earlier is out of scope -> nothing' => [$beforeWindow, $beforeWindow, null, $present($moved), $nothing],
            'D-10 out of scope, flagged, back at the snapshot -> nothing' => [$old, $old, $flagMoved($moved), $present($old), $nothing],
            'D-10 out of scope, cancelled -> nothing' => [$old, $old, null, ['cancelled'], $nothing],
            'D-10 far future meeting is in scope -> auto adjust' => [$farFuture, $farFuture, null, $present($farFutureMoved), $auto($farFutureMoved)],

            // D-16: "Keep as is" on a moved flag re-baselines the snapshot to the new slot
            'D-16 re-baselined by Keep, same new slot -> nothing' => [$moved, $snap, null, $present($moved), $nothing],
            'D-16 re-baselined by Keep, later different slot -> flag moved' => [$moved, $snap, null, $present($later), $flag($later)],
        ];

        $cases = [];
        foreach ($rows as $label => [$snapshot, $entry, $flagState, $observation, $expected]) {
            $cases[$label] = [$snapshot, $entry, $flagState, $observation, $now, ...$expected];
        }

        return $cases;
    }

    /**
     * @param  array{0: string, 1: string}  $snapshot
     * @param  array{0: string, 1: string|null}  $entry
     * @param  array{0: string, 1: string|null, 2: string|null, 3: bool}|null  $flag
     * @param  array<int, string|bool>  $observation
     */
    #[DataProvider('rulesProvider')]
    public function test_rules_matrix(
        array $snapshot,
        array $entry,
        ?array $flag,
        array $observation,
        string $now,
        DecisionAction $action,
        ?string $reason,
        ?string $start,
        ?string $end,
        bool $allDay,
    ): void {
        $at = $this->utc($now);
        $link = new LinkState(
            snapshotStart: $snapshot[0],
            snapshotEnd: $snapshot[1],
            entryStart: $entry[0],
            entryEnd: $entry[1],
            flagReason: $flag[0] ?? null,
            flagStart: $flag[1] ?? null,
            flagEnd: $flag[2] ?? null,
            flagAllDay: $flag[3] ?? false,
        );
        $seen = match ($observation[0]) {
            'present' => Observation::present((string) $observation[1], (string) $observation[2], $observation[3] === true, $at),
            'cancelled' => Observation::cancelled($at),
            'removed' => Observation::removed($at),
            default => Observation::unknown($at),
        };

        $decision = (new OutOfSyncRules)->decide($link, $seen, $at);

        $this->assertSame($action, $decision->action);
        $this->assertSame($reason, $decision->reason);
        $this->assertSame($start, $decision->start);
        $this->assertSame($end, $decision->end);
        $this->assertSame($allDay, $decision->allDay);
    }

    public function test_d01_now_in_another_time_zone_is_compared_in_utc(): void
    {
        // 09:00 in Madrid is 08:00 UTC: exactly the recorded start, so the meeting has started (D-01)
        $link = new LinkState('2026-12-01 08:00:00', '2026-12-01 09:00:00', '2026-12-01 08:00:00', '2026-12-01 09:00:00', null, null, null, false);
        $now = CarbonImmutable::parse('2026-12-01 09:00:00', 'Europe/Madrid');
        $seen = Observation::present(self::MOVED[0], self::MOVED[1], false, $now);

        $this->assertSame(DecisionAction::Release, (new OutOfSyncRules)->decide($link, $seen, $now)->action);
    }

    public function test_d10_window_is_sixty_days(): void
    {
        $this->assertSame(60, OutOfSyncRules::WINDOW_DAYS);
    }

    public function test_d06_an_observation_carries_only_kind_times_all_day_and_time_of_observation(): void
    {
        $class = new ReflectionClass(Observation::class);
        $constructor = $class->getConstructor();
        $this->assertNotNull($constructor);

        $parameters = array_map(fn (ReflectionParameter $parameter): string => $parameter->getName(), $constructor->getParameters());
        $this->assertSame(['kind', 'start', 'end', 'allDay', 'observedAt'], $parameters);

        $properties = array_map(fn (ReflectionProperty $property): string => $property->getName(), $class->getProperties());
        $this->assertSame(['kind', 'start', 'end', 'allDay', 'observedAt'], $properties);

        $type = $constructor->getParameters()[0]->getType();
        $this->assertInstanceOf(ReflectionNamedType::class, $type);
        $this->assertSame(ObservationKind::class, $type->getName());
    }

    public function test_d06_subject_and_attendee_changes_are_invisible_to_a_sighting(): void
    {
        $sightings = new LinkedSightings;
        $before = $sightings->observe($this->graphEvent(['subject' => 'Weekly sync']), $this->now());
        $after = $sightings->observe($this->graphEvent([
            'subject' => 'Renamed',
            'attendees' => [['emailAddress' => ['address' => 'someone@example.test']]],
            'location' => ['displayName' => 'Room 2'],
            'bodyPreview' => 'New agenda',
        ]), $this->now());

        $this->assertEquals($before, $after);
        $link = new LinkState(self::MOVED[0], self::MOVED[1], self::MOVED[0], self::MOVED[1], null, null, null, false);
        $this->assertSame(DecisionAction::Nothing, (new OutOfSyncRules)->decide($link, $after, $this->now())->action);
    }

    /**
     * @return array<string, array{0: array<string, mixed>, 1: ObservationKind, 2: string|null, 3: string|null, 4: bool}>
     */
    public static function sightingsProvider(): array
    {
        $utc = fn (string $dateTime): array => ['dateTime' => $dateTime, 'timeZone' => 'UTC'];
        $pacific = fn (string $dateTime): array => ['dateTime' => $dateTime, 'timeZone' => 'Pacific Standard Time'];

        return [
            'D-07 missing start -> unknown' => [['start' => null], ObservationKind::Unknown, null, null, false],
            'D-07 missing end -> unknown' => [['end' => null], ObservationKind::Unknown, null, null, false],
            'D-07 end not in UTC -> unknown' => [['end' => $pacific('2026-12-03T05:00:00.0000000')], ObservationKind::Unknown, null, null, false],
            'D-07 malformed time -> unknown' => [['start' => $utc('tomorrow')], ObservationKind::Unknown, null, null, false],
            'D-05 cancelled wins over a non-UTC time' => [['isCancelled' => true, 'start' => $pacific('2026-12-03T04:00:00')], ObservationKind::Cancelled, null, null, false],
            'D-04 fractional seconds are dropped' => [['start' => $utc('2026-12-03T12:00:00.1234567')], ObservationKind::Present, '2026-12-03 12:00:00', '2026-12-03 13:00:00', false],
            'D-18 isAllDay missing -> timed' => [['isAllDay' => null], ObservationKind::Present, '2026-12-03 12:00:00', '2026-12-03 13:00:00', false],
            'D-05 isCancelled not strictly true -> present' => [['isCancelled' => 'true'], ObservationKind::Present, '2026-12-03 12:00:00', '2026-12-03 13:00:00', false],
        ];
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    #[DataProvider('sightingsProvider')]
    public function test_sightings_matrix(array $overrides, ObservationKind $kind, ?string $start, ?string $end, bool $allDay): void
    {
        $seen = (new LinkedSightings)->observe($this->graphEvent($overrides), $this->now());

        $this->assertSame($kind, $seen->kind);
        $this->assertSame($start, $seen->start);
        $this->assertSame($end, $seen->end);
        $this->assertSame($allDay, $seen->allDay);
        $this->assertSame(self::NOW, $seen->observedAt->format('Y-m-d H:i:s'));
    }

    public function test_sightings_collect_skips_malformed_events(): void
    {
        $observations = (new LinkedSightings)->collect(
            ['not an event', ['id' => 42], $this->graphEvent(['id' => null]), $this->graphEvent()],
            ['AAMkAD-tracked' => true, '42' => true],
            $this->now(),
        );

        $this->assertSame(['AAMkAD-tracked'], array_keys($observations));
    }
}
