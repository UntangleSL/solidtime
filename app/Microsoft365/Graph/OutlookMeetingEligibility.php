<?php

declare(strict_types=1);

namespace App\Microsoft365\Graph;

/**
 * Decides which Graph events may be stored (SYNC-03). Pure and fail closed: a flag that did not
 * come back never widens what is imported. The filter runs before any row is built, so the subject
 * of a private, confidential or personal event never reaches the database.
 */
final class OutlookMeetingEligibility
{
    /**
     * @param  array<string, mixed>  $event
     */
    public function isEligible(array $event): bool
    {
        if (($event['isCancelled'] ?? true) !== false) {
            return false;
        }
        if (($event['isAllDay'] ?? true) !== false) {
            return false;
        }
        // private, confidential and personal are all excluded
        if (($event['sensitivity'] ?? null) !== 'normal') {
            return false;
        }
        // Defensive only: Graph removes declined meetings from calendarView (DECISIONS-graph.md)
        $responseStatus = $event['responseStatus'] ?? null;
        if (is_array($responseStatus) && ($responseStatus['response'] ?? null) === 'declined') {
            return false;
        }

        return is_string($event['id'] ?? null);
    }
}
