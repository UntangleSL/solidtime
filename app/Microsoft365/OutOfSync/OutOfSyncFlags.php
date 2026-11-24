<?php

declare(strict_types=1);

namespace App\Microsoft365\OutOfSync;

use App\Models\Organization;
use App\Models\User;
use Carbon\CarbonImmutable;

/**
 * What the calendar read serves about out-of-sync entries (Phase 6), each part in one query whatever
 * the number of rows, so the read cost stays constant (T-06-22):
 *
 * - items(): the flagged entries of the whole check window, whatever week is open (D-09, D-10, D-11).
 *
 * Every row is the session user's own: the link and its entry belong to the user, and the entry lives
 * in the user's current organization (T-06-19). Only times, the user's own entry ids and the entry's
 * own description leave the server; never a subject, a Graph id or a series id (T-06-21).
 *
 * Stateless (Octane).
 */
final class OutOfSyncFlags
{
    /**
     * At most this many flagged entries are served in one read.
     */
    public const int MAX_ITEMS = 200;

    private const string FORMAT = 'Y-m-d\TH:i:s\Z';

    public function __construct(private readonly OutOfSyncScope $scope) {}

    /**
     * The flagged active links of the user whose entry lives in the organization and whose recorded
     * start is in the future or within the check window, ordered by entry start (then entry id),
     * at most MAX_ITEMS.
     *
     * @return list<array{time_entry_id: string, kind: string, meeting_start: string|null, meeting_end: string|null, new_start: string|null, new_end: string|null, all_day: bool, entry_start: string|null, entry_end: string|null, description: string}>
     */
    public function items(User $user, Organization $organization, CarbonImmutable $now): array
    {
        $links = $this->scope->activeLinks($user, $now);
        $rows = $links->getQuery()
            ->join('time_entries', 'time_entries.id', '=', 'outlook_meeting_links.time_entry_id')
            ->whereNotNull('outlook_meeting_links.flag_reason')
            ->where('time_entries.user_id', '=', $user->getKey())
            ->where('time_entries.organization_id', '=', $organization->getKey())
            ->orderBy('time_entries.start')
            ->orderBy('time_entries.id')
            ->limit(self::MAX_ITEMS)
            ->get([
                'outlook_meeting_links.time_entry_id',
                'outlook_meeting_links.flag_reason',
                'outlook_meeting_links.meeting_starts_at',
                'outlook_meeting_links.meeting_ends_at',
                'outlook_meeting_links.outlook_starts_at',
                'outlook_meeting_links.outlook_ends_at',
                'outlook_meeting_links.outlook_all_day',
                'time_entries.start as entry_start',
                'time_entries.end as entry_end',
                'time_entries.description',
            ]);

        $items = [];
        foreach ($rows as $row) {
            $kind = (string) $row->flag_reason;
            // Only a moved flag has a new slot; cancelled and removed never carry one
            $moved = $kind === 'moved';
            $items[] = [
                'time_entry_id' => (string) $row->time_entry_id,
                'kind' => $kind,
                'meeting_start' => self::utc($row->meeting_starts_at),
                'meeting_end' => self::utc($row->meeting_ends_at),
                'new_start' => $moved ? self::utc($row->outlook_starts_at) : null,
                'new_end' => $moved ? self::utc($row->outlook_ends_at) : null,
                'all_day' => (bool) $row->outlook_all_day,
                'entry_start' => self::utc($row->entry_start),
                'entry_end' => self::utc($row->entry_end),
                'description' => (string) ($row->description ?? ''),
            ];
        }

        return $items;
    }

    /**
     * A stored UTC 'Y-m-d H:i:s' value as the API's 'Y-m-d\TH:i:s\Z', or null.
     */
    private static function utc(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return CarbonImmutable::parse((string) $value, 'UTC')->utc()->format(self::FORMAT);
    }
}
