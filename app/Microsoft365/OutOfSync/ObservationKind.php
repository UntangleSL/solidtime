<?php

declare(strict_types=1);

namespace App\Microsoft365\OutOfSync;

/**
 * What Outlook showed for a linked occurrence (Phase 6).
 *
 * - Present: the occurrence exists and is not cancelled, with its current times.
 * - Cancelled: Graph returned it with isCancelled true.
 * - Removed: a successful sync of a window covering the recorded slot no longer returns it, or a
 *   direct lookup answered 404 ErrorItemNotFound (D-07).
 * - Unknown: anything that is not a clear answer (Graph errors, throttling, partial syncs, a time that
 *   is not UTC). Unknown never changes anything (D-07).
 */
enum ObservationKind: string
{
    case Present = 'present';
    case Cancelled = 'cancelled';
    case Removed = 'removed';
    case Unknown = 'unknown';
}
