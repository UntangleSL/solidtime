<?php

declare(strict_types=1);

namespace App\Microsoft365\OutOfSync;

use App\Microsoft365\Graph\EventLookupStatus;
use App\Microsoft365\Graph\GraphCalendarClient;
use App\Microsoft365\Graph\MicrosoftTokenService;
use App\Microsoft365\Graph\RetryAfter;
use App\Microsoft365\Models\MicrosoftAccount;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Log;

/**
 * Direct lookups (GET /me/events/{id}) of linked occurrences that a window did not return, shared by
 * the interactive sync and the daily job (Phase 6). Absence from a window is never proof on its own:
 * only a lookup answer turns it into an observation (D-07, RESEARCH anti-pattern "absent means removed").
 *
 * - Sequential, at most $max requests, and none started after $deadline.
 * - Present, Cancelled and Removed become observations; observedAt is the time of each answer.
 * - Throttled persists graph_backoff_until on the account (Phase 3 D-12) and stops.
 * - Reconnect marks the account for reconnect and stops.
 * - Unknown (an outage, a timeout, a 404 without ErrorItemNotFound) stops without an observation: an
 *   outage never spends the rest of the budget, and nothing is concluded.
 * - Logs one line with counts and the stop reason only: no Graph id, time or subject.
 *
 * Stateless (Octane).
 */
final class OutOfSyncLookups
{
    public function __construct(
        private readonly GraphCalendarClient $client,
        private readonly MicrosoftTokenService $tokens,
    ) {}

    /**
     * @param  list<string>  $graphIds  in the order they should be looked up
     * @return array{observations: array<string, Observation>, stopped: 'throttled'|'reconnect'|'unknown'|'budget'|'deadline'|null, looked_up: int}
     */
    public function lookUp(MicrosoftAccount $account, array $graphIds, int $max, ?CarbonImmutable $deadline): array
    {
        /** @var array<string, Observation> $observations */
        $observations = [];
        $stopped = null;
        $lookedUp = 0;

        $ids = array_values(array_unique($graphIds));
        if ($ids === []) {
            return ['observations' => [], 'stopped' => null, 'looked_up' => 0];
        }

        $token = fn (?string $rejected): string => $this->tokens->accessToken($account, $rejected);

        foreach ($ids as $graphId) {
            if ($lookedUp >= $max) {
                $stopped = 'budget';
                break;
            }
            if ($deadline !== null && ! CarbonImmutable::now('UTC')->lessThan($deadline)) {
                $stopped = 'deadline';
                break;
            }

            $lookup = $this->client->event($token, $graphId);
            $lookedUp++;
            $answeredAt = CarbonImmutable::now('UTC');

            if ($lookup->status === EventLookupStatus::Throttled) {
                $seconds = $lookup->retryAfter ?? RetryAfter::DEFAULT_SECONDS;
                // Persisted, so every later request of this user waits without a Graph call (Phase 3 D-12)
                MicrosoftAccount::query()
                    ->whereKey($account->getKey())
                    ->update(['graph_backoff_until' => $answeredAt->addSeconds($seconds)->format('Y-m-d H:i:s')]);
                $stopped = 'throttled';
                break;
            }
            if ($lookup->status === EventLookupStatus::Reconnect) {
                $this->tokens->markReconnectRequired($account);
                $stopped = 'reconnect';
                break;
            }
            if ($lookup->status === EventLookupStatus::Unknown) {
                $stopped = 'unknown';
                break;
            }

            $observations[$graphId] = Observation::fromLookup($lookup, $answeredAt);
        }

        Log::info('Outlook out-of-sync lookups', [
            'requested' => count($ids),
            'looked_up' => $lookedUp,
            'observations' => count($observations),
            'stopped' => $stopped,
        ]);

        return ['observations' => $observations, 'stopped' => $stopped, 'looked_up' => $lookedUp];
    }
}
