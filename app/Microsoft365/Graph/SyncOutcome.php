<?php

declare(strict_types=1);

namespace App\Microsoft365\Graph;

use Carbon\CarbonImmutable;

/**
 * Result of OutlookMeetingSyncService::sync(): a status plus the data the calendar needs to explain it.
 */
final readonly class SyncOutcome
{
    public function __construct(
        public SyncStatus $status,
        public ?int $retryAfter = null,
        public ?CarbonImmutable $lastSyncedAt = null,
        public bool $truncated = false,
        // Entries this sync moved to their meeting's new Outlook time (Phase 6 D-04), for the calendar's notice
        public int $autoAdjusted = 0,
    ) {}

    /**
     * @return array{status: string, retry_after: int|null, last_synced_at: string|null, truncated: bool, auto_adjusted: int}
     */
    public function toArray(): array
    {
        return [
            'status' => $this->status->value,
            'retry_after' => $this->retryAfter,
            'last_synced_at' => $this->lastSyncedAt?->utc()->format('Y-m-d\TH:i:s\Z'),
            'truncated' => $this->truncated,
            'auto_adjusted' => $this->autoAdjusted,
        ];
    }
}
