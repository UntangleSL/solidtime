<?php

declare(strict_types=1);

namespace App\Microsoft365\Graph;

/**
 * Outcome of an Outlook meetings sync, also the stable value the calendar endpoint reports.
 */
enum SyncStatus: string
{
    case Ok = 'ok';
    case Reused = 'reused';
    case Coalesced = 'coalesced';
    case Throttled = 'throttled';
    case Unavailable = 'unavailable';
    case Reconnect = 'reconnect';
    case NotConnected = 'not_connected';
    case NoMailbox = 'no_mailbox';
}
