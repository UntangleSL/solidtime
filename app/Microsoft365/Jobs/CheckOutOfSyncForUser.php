<?php

declare(strict_types=1);

namespace App\Microsoft365\Jobs;

use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\OutOfSync\ApplyResult;
use App\Microsoft365\OutOfSync\OutOfSyncApplier;
use App\Microsoft365\OutOfSync\OutOfSyncLookups;
use App\Microsoft365\OutOfSync\OutOfSyncScope;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * The daily out-of-sync check of one user (D-11), queued by m365:check-out-of-sync. It looks up each of
 * the user's active links in the window (OutOfSyncScope: recorded start in the future or within the last
 * 60 days, not released or detached, entry alive and still the user's), least recently checked first and
 * at most microsoft365.out_of_sync.lookups_per_job of them, and applies the answers with the same rules
 * and applier as the interactive sync. So the counter stays right for weeks the user never opens.
 *
 * - No request and no session are needed: MicrosoftTokenService refreshes the token under a row lock on
 *   its own, and GraphAccessGuard answers "not impersonating" without a started session (RESEARCH A1).
 * - Auth: core's update path runs as the link's user. CoreTimeEntryUpdater sets that user on the web
 *   guard for each call and forgets it in `finally`, because the queue worker does not reset auth guards
 *   between jobs; this class never signs anybody in.
 * - Phase 3 rules: a user without a valid connection is skipped; an active back-off releases the job
 *   until it is over, without a Graph call; OutOfSyncLookups stops at a throttled answer (and persists the
 *   back-off), at a reconnect (and marks the account) and at an unknown answer. The job never retries a
 *   lookup itself.
 * - Logs one line with counts and the stop reason only: no Graph id, time, subject or user data.
 *
 * Holds only the user id (Octane and queue serialization safe).
 */
final class CheckOutOfSyncForUser implements ShouldQueue
{
    use Queueable;

    /**
     * Seconds the lookups of one run may take; the rest is left for applying them within $timeout.
     */
    private const int LOOKUP_SECONDS = 100;

    public int $tries = 3;

    public int $timeout = 120;

    public function __construct(public readonly string $userId) {}

    public function handle(OutOfSyncScope $scope, OutOfSyncLookups $lookups, OutOfSyncApplier $applier): void
    {
        $user = User::query()->find($this->userId);
        $account = $user === null
            ? null
            : MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->first();
        if ($user === null || $account === null || $account->calendarAccessState() !== 'connected') {
            $this->log(0, new ApplyResult, 'not_connected');

            return;
        }

        $backoff = $account->backoffRemainingSeconds();
        if ($backoff !== null) {
            $this->release($backoff);
            $this->log(0, new ApplyResult, 'backoff');

            return;
        }

        $now = CarbonImmutable::now('UTC');
        /** @var list<string> $graphIds */
        $graphIds = $scope->activeLinks($user, $now)
            ->orderByRaw('outlook_meeting_links.last_checked_at asc nulls first')
            ->orderBy('outlook_meeting_links.meeting_starts_at')
            ->orderBy('outlook_meeting_links.id')
            ->limit($this->lookupsPerJob())
            ->pluck('graph_id')
            ->map(fn (mixed $graphId): string => (string) $graphId)
            ->values()
            ->all();

        $found = $lookups->lookUp($account, $graphIds, $this->lookupsPerJob(), $now->addSeconds(self::LOOKUP_SECONDS));
        $result = $applier->apply($user, $found['observations'], CarbonImmutable::now('UTC'));

        $this->log($found['looked_up'], $result, $found['stopped']);
    }

    private function log(int $checked, ApplyResult $result, ?string $stopped): void
    {
        Log::info('Outlook out-of-sync check', [
            'checked' => $checked,
            'adjusted' => $result->adjusted,
            'flagged' => $result->flagged,
            'released' => $result->released,
            'cleared' => $result->cleared,
            'stopped' => $stopped,
        ]);
    }

    private function lookupsPerJob(): int
    {
        $value = config('microsoft365.out_of_sync.lookups_per_job', 300);

        return is_int($value) && $value > 0 ? $value : 300;
    }
}
