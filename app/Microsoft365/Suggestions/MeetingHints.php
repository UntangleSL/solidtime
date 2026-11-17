<?php

declare(strict_types=1);

namespace App\Microsoft365\Suggestions;

/**
 * What the read adds to one meeting beyond its own data (Phase 5): the series pre-assignment, whether
 * the user told the series to stop pre-assigning, and the learned project suggestions (already
 * serialized, scores never included). The default is "nothing to add".
 */
final readonly class MeetingHints
{
    /**
     * @param  list<array<string, mixed>>  $suggestions
     */
    public function __construct(
        public ?Assignment $assignment = null,
        public bool $seriesIgnored = false,
        public array $suggestions = [],
    ) {}

    public static function none(): self
    {
        return new self;
    }
}
