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
}
