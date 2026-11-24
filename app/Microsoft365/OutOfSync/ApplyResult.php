<?php

declare(strict_types=1);

namespace App\Microsoft365\OutOfSync;

/**
 * What one OutOfSyncApplier::apply() run changed, as counts only (no id, time or subject ever leaves
 * the applier, Phase 3 D-15).
 *
 * - adjusted: entries moved to the new Outlook times through core (D-04, D-12).
 * - flagged: links flagged 'moved', 'cancelled' or 'removed', including an auto adjust core refused.
 * - released: started meetings moved to a new slot (D-03).
 * - cleared: flags removed because Outlook is back at the recorded slot (D-17).
 * - resynced: snapshots updated to a slot the entry already had.
 * - skipped: observations not applied (link gone, out of scope, entry missing or foreign, lock busy).
 */
final readonly class ApplyResult
{
    public function __construct(
        public int $adjusted = 0,
        public int $flagged = 0,
        public int $released = 0,
        public int $cleared = 0,
        public int $resynced = 0,
        public int $skipped = 0,
    ) {}

    public function total(): int
    {
        return $this->adjusted + $this->flagged + $this->released + $this->cleared + $this->resynced + $this->skipped;
    }

    /**
     * @return array{adjusted: int, flagged: int, released: int, cleared: int, resynced: int, skipped: int}
     */
    public function toArray(): array
    {
        return [
            'adjusted' => $this->adjusted,
            'flagged' => $this->flagged,
            'released' => $this->released,
            'cleared' => $this->cleared,
            'resynced' => $this->resynced,
            'skipped' => $this->skipped,
        ];
    }
}
