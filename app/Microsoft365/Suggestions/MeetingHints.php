<?php

declare(strict_types=1);

namespace App\Microsoft365\Suggestions;

/**
 * What the read adds to one meeting beyond its own data (Phase 5): the series pre-assignment, whether
 * the user told the series to stop pre-assigning, and the learned project suggestions (already
 * serialized, scores never included). The default is "nothing to add".
 *
 * Phase 6 (D-03) adds movedFrom: for a started meeting that Outlook moved after it was logged, the
 * user's own entry it was logged on (times of the entry, never of the meeting), so the calendar can
 * offer "Move my entry here".
 */
final readonly class MeetingHints
{
    /**
     * @param  list<array<string, mixed>>  $suggestions
     * @param  array{time_entry_id: string, entry_start: string, entry_end: string}|null  $movedFrom
     */
    public function __construct(
        public ?Assignment $assignment = null,
        public bool $seriesIgnored = false,
        public array $suggestions = [],
        public ?array $movedFrom = null,
    ) {}

    public static function none(): self
    {
        return new self;
    }
}
