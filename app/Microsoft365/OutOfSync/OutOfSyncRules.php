<?php

declare(strict_types=1);

namespace App\Microsoft365\OutOfSync;

use Carbon\CarbonImmutable;

/**
 * Every owner rule of Phase 6 in one pure function: no database, no clock (the caller passes the
 * moment of detection), no subject. The applier only moves the data the decision names.
 *
 * Times compare as UTC 'Y-m-d H:i:s' strings. Order of evaluation:
 *
 * 1. Recorded start older than WINDOW_DAYS before now -> Nothing (D-10).
 * 2. Unknown -> Nothing: errors, throttling and partial syncs never act (D-07).
 * 3. Present, not all-day, at the recorded slot -> ClearFlag when flagged (D-17), else Nothing.
 *    The entry's own times play no part here: editing an entry never flags it (D-07).
 * 4. Started (recorded start at or before now, D-01):
 *    a. already flagged -> Nothing: a flag set before the start stays until the user acts (D-02
 *       forbids new flags only);
 *    b. Present, not all-day, entry already at the seen slot -> Resync;
 *    c. Present, not all-day, elsewhere -> Release, whether or not the entry was edited (D-03);
 *    d. cancelled, removed or all-day -> Nothing (D-02).
 * 5. Not started:
 *    a. Cancelled -> Flag cancelled (D-05), Nothing when already flagged cancelled;
 *    b. Removed -> Flag removed (D-05), Nothing when already flagged removed;
 *    c. Present all-day -> Flag moved with allDay, never AutoAdjust (D-18), Nothing when identical;
 *    d. Present, entry at the recorded slot -> AutoAdjust (D-04, D-12);
 *    e. Present, entry already at the seen slot -> Resync;
 *    f. Present otherwise -> Flag moved (D-04), Nothing when identical to the current flag.
 *
 * A link re-baselined by "Keep as is" carries the accepted slot as its snapshot (D-16), so the same
 * move lands in rule 3 and never flags again.
 */
final class OutOfSyncRules
{
    /**
     * Only meetings whose recorded start is in the future or within this many days are checked (D-10).
     */
    public const int WINDOW_DAYS = 60;

    private const string FORMAT = 'Y-m-d H:i:s';

    public function decide(LinkState $link, Observation $seen, CarbonImmutable $now): Decision
    {
        $nowUtc = $now->utc();
        $windowStart = $nowUtc->subDays(self::WINDOW_DAYS)->format(self::FORMAT);
        if ($link->snapshotStart < $windowStart) {
            return Decision::nothing();
        }

        if ($seen->kind === ObservationKind::Unknown) {
            return Decision::nothing();
        }

        // A Present sighting always carries both times (LinkedSightings turns a missing time into Unknown)
        $start = $seen->kind === ObservationKind::Present ? $seen->start : null;
        $end = $seen->kind === ObservationKind::Present ? $seen->end : null;
        $flagged = $link->flagReason !== null;

        if ($start !== null && $end !== null && ! $seen->allDay
            && $start === $link->snapshotStart && $end === $link->snapshotEnd) {
            return $flagged ? Decision::clearFlag() : Decision::nothing();
        }

        $started = $link->snapshotStart <= $nowUtc->format(self::FORMAT);
        if ($started) {
            if ($flagged || $start === null || $end === null || $seen->allDay) {
                return Decision::nothing();
            }

            return $this->entryAt($link, $start, $end) ? Decision::resync($start, $end) : Decision::release();
        }

        if ($seen->kind === ObservationKind::Cancelled) {
            return $link->flagReason === Decision::REASON_CANCELLED ? Decision::nothing() : Decision::flagCancelled();
        }
        if ($seen->kind === ObservationKind::Removed) {
            return $link->flagReason === Decision::REASON_REMOVED ? Decision::nothing() : Decision::flagRemoved();
        }
        if ($start === null || $end === null) {
            return Decision::nothing();
        }

        if ($seen->allDay) {
            return $this->sameMovedFlag($link, $start, $end, true)
                ? Decision::nothing()
                : Decision::flagMoved($start, $end, true);
        }
        if ($this->entryAt($link, $link->snapshotStart, $link->snapshotEnd)) {
            return Decision::autoAdjust($start, $end);
        }
        if ($this->entryAt($link, $start, $end)) {
            return Decision::resync($start, $end);
        }

        return $this->sameMovedFlag($link, $start, $end, false)
            ? Decision::nothing()
            : Decision::flagMoved($start, $end);
    }

    private function entryAt(LinkState $link, string $start, string $end): bool
    {
        return $link->entryStart === $start && $link->entryEnd === $end;
    }

    private function sameMovedFlag(LinkState $link, string $start, string $end, bool $allDay): bool
    {
        return $link->flagReason === Decision::REASON_MOVED
            && $link->flagStart === $start
            && $link->flagEnd === $end
            && $link->flagAllDay === $allDay;
    }
}
