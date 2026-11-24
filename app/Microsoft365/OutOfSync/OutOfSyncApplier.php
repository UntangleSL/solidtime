<?php

declare(strict_types=1);

namespace App\Microsoft365\OutOfSync;

use App\Exceptions\Api\ApiException;
use App\Microsoft365\Models\OutlookMeetingLink;
use App\Microsoft365\TimeEntries\CoreTimeEntryUpdater;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use LogicException;

/**
 * Applies observations of linked occurrences to their links and entries (Phase 6). OutOfSyncRules
 * decides; this class only moves the data the decision names, shared by the interactive sync, the
 * direct lookups and the daily job.
 *
 * - One per-user lock (m365:osync:{user}) with a short wait: a busy lock skips the batch, and the next
 *   sync or the daily job sees the change again.
 * - One transaction per link that re-reads the active link and its entry FOR UPDATE: a user edit that
 *   arrives meanwhile waits for the row lock and then wins with its own values. A link that left the
 *   scope (released, detached, too old) or whose entry is gone or now belongs to someone else is skipped.
 * - Time entries change only through CoreTimeEntryUpdater (core's update path) and only for the
 *   AutoAdjust decision: the unedited entry of a meeting that has not started (D-04, D-12). Nothing here
 *   ever deletes an entry (D-05). When core refuses the adjust (overlap, blocked organization,
 *   permission, validation), the entry is flagged 'moved' instead (D-04 "when that is safe").
 * - Logs counts only.
 *
 * Stateless (Octane).
 */
final class OutOfSyncApplier
{
    /**
     * Seconds a call waits for a busy per-user lock before it skips the batch.
     */
    private const int LOCK_WAIT_SECONDS = 2;

    private const string FORMAT = 'Y-m-d H:i:s';

    public function __construct(
        private readonly OutOfSyncRules $rules,
        private readonly OutOfSyncScope $scope,
        private readonly CoreTimeEntryUpdater $updater,
    ) {}

    /**
     * @param  array<string, Observation>  $observations  keyed by Graph id
     */
    public function apply(User $user, array $observations, CarbonImmutable $now): ApplyResult
    {
        if ($observations === []) {
            return new ApplyResult;
        }

        $lock = Cache::lock('m365:osync:'.$user->getKey(), $this->lockSeconds());
        try {
            $lock->block(self::LOCK_WAIT_SECONDS);
        } catch (LockTimeoutException) {
            $result = new ApplyResult(skipped: count($observations));
            Log::info('Outlook out-of-sync applied', $result->toArray());

            return $result;
        }

        $counts = ['adjusted' => 0, 'flagged' => 0, 'released' => 0, 'cleared' => 0, 'resynced' => 0, 'skipped' => 0];
        try {
            foreach ($observations as $graphId => $observation) {
                $outcome = DB::transaction(fn (): ?string => $this->applyOne($user, (string) $graphId, $observation, $now));
                if ($outcome !== null) {
                    $counts[$outcome]++;
                }
            }
        } finally {
            $lock->release();
        }

        $result = new ApplyResult(...$counts);
        if ($result->total() > 0) {
            Log::info('Outlook out-of-sync applied', $result->toArray());
        }

        return $result;
    }

    /**
     * @return 'adjusted'|'flagged'|'released'|'cleared'|'resynced'|'skipped'|null the counter to raise, null for no change
     */
    private function applyOne(User $user, string $graphId, Observation $seen, CarbonImmutable $now): ?string
    {
        $link = $this->scope->activeLinks($user, $now)
            ->where('graph_id', '=', $graphId)
            ->lockForUpdate()
            ->first();
        if ($link === null) {
            return 'skipped';
        }
        $entry = TimeEntry::query()->whereKey($link->time_entry_id)->lockForUpdate()->first();
        if ($entry === null || $entry->user_id !== $user->getKey()) {
            return 'skipped';
        }

        $decision = $this->rules->decide(LinkState::fromModels($link, $entry), $seen, $now);
        $outcome = match ($decision->action) {
            DecisionAction::Nothing => null,
            DecisionAction::ClearFlag => $this->clearFlag($link, 'cleared'),
            DecisionAction::Release => $this->release($link, $now),
            DecisionAction::AutoAdjust => $this->autoAdjust($user, $link, $entry, $decision, $now),
            DecisionAction::Resync => $this->resync($link, $decision),
            DecisionAction::Flag => $this->flag($link, $decision, $now),
        };

        $link->last_checked_at = Carbon::instance($seen->observedAt);
        $link->save();

        return $outcome;
    }

    /**
     * @template T of 'cleared'|'resynced'|'adjusted'
     *
     * @param  T  $counter
     * @return T
     */
    private function clearFlag(OutlookMeetingLink $link, string $counter): string
    {
        $link->flag_reason = null;
        $link->flagged_at = null;
        $link->outlook_starts_at = null;
        $link->outlook_ends_at = null;
        $link->outlook_all_day = false;

        return $counter;
    }

    /**
     * @return 'released'
     */
    private function release(OutlookMeetingLink $link, CarbonImmutable $now): string
    {
        $link->released_at = Carbon::instance($now);

        return 'released';
    }

    /**
     * @return 'resynced'
     */
    private function resync(OutlookMeetingLink $link, Decision $decision): string
    {
        $this->snapshot($link, $decision);

        return $this->clearFlag($link, 'resynced');
    }

    /**
     * The entry follows the new Outlook times through core. A refusal by core leaves the entry as it was
     * (the nested transaction rolls back any partial write) and flags the link 'moved' instead.
     *
     * @return 'adjusted'|'flagged'|'skipped'
     */
    private function autoAdjust(User $user, OutlookMeetingLink $link, TimeEntry $entry, Decision $decision, CarbonImmutable $now): string
    {
        if ($decision->start === null || $decision->end === null) {
            return 'skipped';
        }

        try {
            DB::transaction(fn (): TimeEntry => $this->updater->updateTimes(
                $user,
                $entry,
                CoreTimeEntryUpdater::format($decision->start),
                CoreTimeEntryUpdater::format($decision->end),
            ));
        } catch (ValidationException|AuthorizationException|ApiException|LogicException) {
            return $this->flag($link, Decision::flagMoved($decision->start, $decision->end), $now);
        }

        $link->auto_adjusted_from_starts_at = $link->meeting_starts_at;
        $link->auto_adjusted_from_ends_at = $link->meeting_ends_at;
        $link->auto_adjusted_at = Carbon::instance($now);
        $this->snapshot($link, $decision);

        return $this->clearFlag($link, 'adjusted');
    }

    /**
     * A flag keeps its original flagged_at while the same flag is observed again.
     *
     * @return 'flagged'
     */
    private function flag(OutlookMeetingLink $link, Decision $decision, CarbonImmutable $now): string
    {
        $start = $decision->start === null ? null : $this->at($decision->start);
        $end = $decision->end === null ? null : $this->at($decision->end);
        $same = $link->flag_reason === $decision->reason
            && $link->outlook_starts_at?->format(self::FORMAT) === $start?->format(self::FORMAT)
            && $link->outlook_ends_at?->format(self::FORMAT) === $end?->format(self::FORMAT)
            && $link->outlook_all_day === $decision->allDay;

        $link->flag_reason = $decision->reason;
        $link->outlook_starts_at = $start;
        $link->outlook_ends_at = $end;
        $link->outlook_all_day = $decision->allDay;
        if (! $same || $link->flagged_at === null) {
            $link->flagged_at = Carbon::instance($now);
        }

        return 'flagged';
    }

    private function snapshot(OutlookMeetingLink $link, Decision $decision): void
    {
        if ($decision->start === null || $decision->end === null) {
            return;
        }
        $link->meeting_starts_at = $this->at($decision->start);
        $link->meeting_ends_at = $this->at($decision->end);
    }

    private function at(string $utc): Carbon
    {
        return Carbon::parse($utc, 'UTC');
    }

    private function lockSeconds(): int
    {
        $value = config('microsoft365.out_of_sync.lock_seconds', 30);

        return is_int($value) && $value > 0 ? $value : 30;
    }
}
