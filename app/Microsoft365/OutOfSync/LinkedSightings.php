<?php

declare(strict_types=1);

namespace App\Microsoft365\OutOfSync;

use App\Microsoft365\Graph\OutlookMeetingSyncService;
use Carbon\CarbonImmutable;

/**
 * Turns raw Graph calendarView events into observations of linked occurrences. Reads only the id, the
 * start and end, isCancelled and isAllDay: never the subject, attendees or body (Phase 3 D-15, D-06).
 * Pure and stateless (Octane): the caller passes the moment of observation.
 */
final class LinkedSightings
{
    /**
     * - isCancelled true -> Cancelled (whatever the times say).
     * - start or end missing, or not in UTC -> Unknown (a contract violation never acts, D-07).
     * - otherwise Present with the UTC times, all-day when isAllDay is true (D-18).
     *
     * @param  array<mixed>  $event
     */
    public function observe(array $event, CarbonImmutable $observedAt): Observation
    {
        if (($event['isCancelled'] ?? null) === true) {
            return Observation::cancelled($observedAt);
        }

        $start = is_array($event['start'] ?? null) ? OutlookMeetingSyncService::parseGraphUtc($event['start']) : null;
        $end = is_array($event['end'] ?? null) ? OutlookMeetingSyncService::parseGraphUtc($event['end']) : null;
        if ($start === null || $end === null) {
            return Observation::unknown($observedAt);
        }

        return Observation::present(
            $start->format('Y-m-d H:i:s'),
            $end->format('Y-m-d H:i:s'),
            ($event['isAllDay'] ?? null) === true,
            $observedAt,
        );
    }

    /**
     * Observations of the tracked occurrences found among the events, keyed by Graph id. Events of
     * untracked ids are ignored; a tracked id absent from the events gets no entry (whether its absence
     * means "removed" is the caller's call, D-07).
     *
     * @param  iterable<mixed>  $events
     * @param  array<string, mixed>  $tracked  Graph ids as keys (OutOfSyncScope::activeGraphIds)
     * @return array<string, Observation>
     */
    public function collect(iterable $events, array $tracked, CarbonImmutable $observedAt): array
    {
        $observations = [];
        foreach ($events as $event) {
            if (! is_array($event)) {
                continue;
            }
            $id = $event['id'] ?? null;
            if (! is_string($id) || ! array_key_exists($id, $tracked)) {
                continue;
            }
            $observations[$id] = $this->observe($event, $observedAt);
        }

        return $observations;
    }
}
