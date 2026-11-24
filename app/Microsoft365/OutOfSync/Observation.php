<?php

declare(strict_types=1);

namespace App\Microsoft365\OutOfSync;

use Carbon\CarbonImmutable;

/**
 * One sighting of a linked occurrence in Outlook. It carries the kind, the times and the all-day bit
 * only: no subject, no attendees, no Graph id (Phase 3 D-15). Changes to anything but the time or the
 * cancellation can therefore never reach a decision (D-06 by construction).
 *
 * Times are UTC 'Y-m-d H:i:s' strings, set only for Present.
 */
final readonly class Observation
{
    public function __construct(
        public ObservationKind $kind,
        public ?string $start,
        public ?string $end,
        public bool $allDay,
        public CarbonImmutable $observedAt,
    ) {}

    public static function present(string $start, string $end, bool $allDay, CarbonImmutable $at): self
    {
        return new self(ObservationKind::Present, $start, $end, $allDay, $at);
    }

    public static function cancelled(CarbonImmutable $at): self
    {
        return new self(ObservationKind::Cancelled, null, null, false, $at);
    }

    public static function removed(CarbonImmutable $at): self
    {
        return new self(ObservationKind::Removed, null, null, false, $at);
    }

    public static function unknown(CarbonImmutable $at): self
    {
        return new self(ObservationKind::Unknown, null, null, false, $at);
    }
}
