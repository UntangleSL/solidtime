<?php

declare(strict_types=1);

namespace App\Microsoft365\OutOfSync;

use App\Microsoft365\Models\OutlookMeetingLink;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;

/**
 * The links that the out-of-sync checks cover, shared by the interactive sync, the calendar read and
 * the daily job so they never disagree (D-10, D-11):
 * the user's own links that are active (not released, D-03; not detached by "Keep as is"), have a
 * recorded snapshot whose start is in the future or within OutOfSyncRules::WINDOW_DAYS days, and whose
 * entry still exists and still belongs to the user (a stale link is never checked, Phase 4).
 *
 * Callers add their own order, limit or window predicates on the returned builder. Stateless (Octane).
 */
final class OutOfSyncScope
{
    /**
     * @return Builder<OutlookMeetingLink>
     */
    public function activeLinks(User $user, CarbonImmutable $now): Builder
    {
        $windowStart = $now->utc()->subDays(OutOfSyncRules::WINDOW_DAYS)->format('Y-m-d H:i:s');

        $links = OutlookMeetingLink::query();
        // Qualified on the base query so a caller may join time_entries without ambiguous columns
        $links->getQuery()
            ->where('outlook_meeting_links.user_id', '=', $user->getKey())
            ->whereNull('outlook_meeting_links.released_at')
            ->whereNull('outlook_meeting_links.detached_at')
            ->whereNotNull('outlook_meeting_links.meeting_starts_at')
            ->whereNotNull('outlook_meeting_links.meeting_ends_at')
            ->where('outlook_meeting_links.meeting_starts_at', '>=', $windowStart)
            ->whereExists(function (QueryBuilder $query): void {
                $query->selectRaw('1')
                    ->from('time_entries')
                    ->whereColumn('time_entries.id', 'outlook_meeting_links.time_entry_id')
                    ->whereColumn('time_entries.user_id', 'outlook_meeting_links.user_id');
            });

        return $links;
    }

    /**
     * Graph ids of the user's active links in scope, as a set for O(1) membership checks.
     *
     * @return array<string, true>
     */
    public function activeGraphIds(User $user, CarbonImmutable $now): array
    {
        $ids = [];
        foreach ($this->activeLinks($user, $now)->pluck('graph_id') as $graphId) {
            $ids[(string) $graphId] = true;
        }

        return $ids;
    }
}
