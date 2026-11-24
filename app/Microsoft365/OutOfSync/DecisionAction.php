<?php

declare(strict_types=1);

namespace App\Microsoft365\OutOfSync;

/**
 * What to do with a link after one observation (Phase 6). The rules decide; the applier only moves data.
 *
 * - Nothing: leave link and entry as they are.
 * - ClearFlag: Outlook is back at the recorded slot, the flag goes away (D-17).
 * - Release: a started meeting moved to a new slot; the link no longer hides the meeting (D-03).
 * - AutoAdjust: a not-started meeting moved and the entry was not edited; the entry and the snapshot
 *   take the new times (D-04, D-12).
 * - Resync: the entry is already at the new slot (the user fixed it by hand); the snapshot takes the
 *   new times and any flag goes away.
 * - Flag: the entry waits for the user's choice ('moved', 'cancelled' or 'removed', D-04, D-05, D-18).
 */
enum DecisionAction: string
{
    case Nothing = 'nothing';
    case ClearFlag = 'clear_flag';
    case Release = 'release';
    case AutoAdjust = 'auto_adjust';
    case Resync = 'resync';
    case Flag = 'flag';
}
