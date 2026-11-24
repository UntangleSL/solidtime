<?php

declare(strict_types=1);

namespace App\Microsoft365\OutOfSync;

use App\Microsoft365\Models\OutlookMeetingLink;
use App\Models\TimeEntry;
use Carbon\CarbonImmutable;
use DateTimeInterface;

/**
 * What the rules need to know about a link and its entry, as UTC 'Y-m-d H:i:s' strings so every
 * comparison is an exact string compare at second precision (the columns are dateTime, and core
 * rounding is never stored).
 *
 * - snapshotStart / snapshotEnd: the meeting time recorded at conversion, the reference (D-01, D-16).
 * - entryStart / entryEnd: the entry's own times (null end = still running).
 * - flagReason / flagStart / flagEnd / flagAllDay: the current flag, if any (D-04, D-05, D-18).
 */
final readonly class LinkState
{
    public function __construct(
        public string $snapshotStart,
        public string $snapshotEnd,
        public string $entryStart,
        public ?string $entryEnd,
        public ?string $flagReason,
        public ?string $flagStart,
        public ?string $flagEnd,
        public bool $flagAllDay,
    ) {}

    /**
     * A link without a snapshot is never in OutOfSyncScope; should one reach the rules anyway, the
     * entry's times stand in for it, as in the migration backfill.
     */
    public static function fromModels(OutlookMeetingLink $link, TimeEntry $entry): self
    {
        $entryStart = self::format($entry->start) ?? '';
        $entryEnd = self::format($entry->end);

        return new self(
            snapshotStart: self::format($link->meeting_starts_at) ?? $entryStart,
            snapshotEnd: self::format($link->meeting_ends_at) ?? $entryEnd ?? $entryStart,
            entryStart: $entryStart,
            entryEnd: $entryEnd,
            flagReason: $link->flag_reason,
            flagStart: self::format($link->outlook_starts_at),
            flagEnd: self::format($link->outlook_ends_at),
            flagAllDay: $link->outlook_all_day === true,
        );
    }

    private static function format(?DateTimeInterface $value): ?string
    {
        return $value === null ? null : CarbonImmutable::instance($value)->utc()->format('Y-m-d H:i:s');
    }
}
