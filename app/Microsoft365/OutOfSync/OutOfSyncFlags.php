<?php

declare(strict_types=1);

namespace App\Microsoft365\OutOfSync;

use App\Microsoft365\Models\OutlookMeeting;
use App\Models\Organization;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\DB;

/**
 * What the calendar read serves about out-of-sync entries (Phase 6), each part in one query whatever
 * the number of rows, so the read cost stays constant (T-06-22):
 *
 * - items(): the flagged entries of the whole check window, whatever week is open (D-09, D-10, D-11).
 * - autoAdjusted(): the entries of the requested range moved silently with their meeting in the last
 *   few days (out_of_sync.auto_adjusted_days, default 7), for the origin icon's note (UI-SPEC 5).
 * - movedFrom(): for meetings shown again after their link was released (a started meeting Outlook
 *   moved, D-03), the entry the meeting was logged on.
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
     * The user's entries in the organization that overlap the half-open range [start, end) (an entry
     * without an end counts from its start) and were adjusted automatically within the last
     * out_of_sync.auto_adjusted_days days, ordered by entry start. "to" is the slot the entry was moved
     * to, which the adjust recorded as the link's snapshot.
     *
     * @return list<array{time_entry_id: string, at: string|null, from_start: string|null, from_end: string|null, to_start: string|null, to_end: string|null}>
     */
    public function autoAdjusted(User $user, Organization $organization, CarbonImmutable $start, CarbonImmutable $end, CarbonImmutable $now): array
    {
        $days = config('microsoft365.out_of_sync.auto_adjusted_days', 7);
        $since = $now->utc()->subDays(is_numeric($days) ? (int) $days : 7)->format('Y-m-d H:i:s');
        $rangeStart = $start->utc()->format('Y-m-d H:i:s');

        $rows = DB::table('outlook_meeting_links')
            ->join('time_entries', 'time_entries.id', '=', 'outlook_meeting_links.time_entry_id')
            ->where('outlook_meeting_links.user_id', '=', $user->getKey())
            ->where('outlook_meeting_links.auto_adjusted_at', '>=', $since)
            ->whereNotNull('outlook_meeting_links.auto_adjusted_from_starts_at')
            ->whereNotNull('outlook_meeting_links.auto_adjusted_from_ends_at')
            ->whereNotNull('outlook_meeting_links.meeting_starts_at')
            ->whereNotNull('outlook_meeting_links.meeting_ends_at')
            ->where('time_entries.user_id', '=', $user->getKey())
            ->where('time_entries.organization_id', '=', $organization->getKey())
            ->where('time_entries.start', '<', $end->utc()->format('Y-m-d H:i:s'))
            ->where(function (QueryBuilder $query) use ($rangeStart): void {
                $query->where('time_entries.end', '>', $rangeStart)
                    ->orWhere(function (QueryBuilder $running) use ($rangeStart): void {
                        $running->whereNull('time_entries.end')
                            ->where('time_entries.start', '>=', $rangeStart);
                    });
            })
            ->orderBy('time_entries.start')
            ->orderBy('time_entries.id')
            ->get([
                'outlook_meeting_links.time_entry_id',
                'outlook_meeting_links.auto_adjusted_at',
                'outlook_meeting_links.auto_adjusted_from_starts_at',
                'outlook_meeting_links.auto_adjusted_from_ends_at',
                'outlook_meeting_links.meeting_starts_at',
                'outlook_meeting_links.meeting_ends_at',
            ]);

        $adjusted = [];
        foreach ($rows as $row) {
            $adjusted[] = [
                'time_entry_id' => (string) $row->time_entry_id,
                'at' => self::utc($row->auto_adjusted_at),
                'from_start' => self::utc($row->auto_adjusted_from_starts_at),
                'from_end' => self::utc($row->auto_adjusted_from_ends_at),
                'to_start' => self::utc($row->meeting_starts_at),
                'to_end' => self::utc($row->meeting_ends_at),
            ];
        }

        return $adjusted;
    }

    /**
     * For each given meeting, the entry of the latest released link of its occurrence whose entry is
     * still the user's, lives in the organization and has an end (D-03), keyed by meeting id. Meetings
     * without one are left out. One query for all meetings.
     *
     * @param  iterable<OutlookMeeting>  $meetings
     * @return array<string, array{time_entry_id: string, entry_start: string, entry_end: string}>
     */
    public function movedFrom(User $user, Organization $organization, iterable $meetings): array
    {
        $meetingIds = [];
        foreach ($meetings as $meeting) {
            $meetingIds[$meeting->graph_id] = $meeting->id;
        }
        if ($meetingIds === []) {
            return [];
        }

        $rows = DB::table('outlook_meeting_links')
            ->join('time_entries', 'time_entries.id', '=', 'outlook_meeting_links.time_entry_id')
            // The latest released link per occurrence, among those that qualify
            ->selectRaw('DISTINCT ON (outlook_meeting_links.graph_id) outlook_meeting_links.graph_id')
            ->addSelect([
                'outlook_meeting_links.time_entry_id',
                'time_entries.start as entry_start',
                'time_entries.end as entry_end',
            ])
            ->where('outlook_meeting_links.user_id', '=', $user->getKey())
            ->whereNotNull('outlook_meeting_links.released_at')
            ->whereIn('outlook_meeting_links.graph_id', array_map('strval', array_keys($meetingIds)))
            ->where('time_entries.user_id', '=', $user->getKey())
            ->where('time_entries.organization_id', '=', $organization->getKey())
            ->whereNotNull('time_entries.end')
            ->orderBy('outlook_meeting_links.graph_id')
            ->orderByDesc('outlook_meeting_links.released_at')
            ->orderByDesc('outlook_meeting_links.id')
            ->get();

        $movedFrom = [];
        foreach ($rows as $row) {
            $meetingId = $meetingIds[(string) $row->graph_id] ?? null;
            $entryStart = self::utc($row->entry_start);
            $entryEnd = self::utc($row->entry_end);
            if ($meetingId === null || $entryStart === null || $entryEnd === null) {
                continue;
            }
            $movedFrom[$meetingId] = [
                'time_entry_id' => (string) $row->time_entry_id,
                'entry_start' => $entryStart,
                'entry_end' => $entryEnd,
            ];
        }

        return $movedFrom;
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
