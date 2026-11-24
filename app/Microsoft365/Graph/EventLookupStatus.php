<?php

declare(strict_types=1);

namespace App\Microsoft365\Graph;

/**
 * Answer of a direct lookup of one linked Outlook occurrence (GET /me/events/{id}).
 *
 * Only Present, Cancelled and Removed are evidence the out-of-sync rules may act on. Unknown, Throttled
 * and Reconnect never flag an entry (D-07): a Graph error is not proof that a meeting changed.
 */
enum EventLookupStatus: string
{
    // The occurrence exists and is not cancelled; start/end carry its current UTC times (it may have moved)
    case Present = 'present';

    // The occurrence still exists but the organizer cancelled it
    case Cancelled = 'cancelled';

    // Graph answered 404 with error code ErrorItemNotFound: deleted, or declined and removed from the calendar
    case Removed = 'removed';

    // Any other answer (outage, other 404, malformed body, non-UTC time): nothing can be concluded
    case Unknown = 'unknown';

    // Graph or the token endpoint asked to back off; retryAfter carries the clamped seconds
    case Throttled = 'throttled';

    // The token was rejected after one forced refresh, or the refresh token is no longer valid
    case Reconnect = 'reconnect';
}
