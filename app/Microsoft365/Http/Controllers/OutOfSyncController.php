<?php

declare(strict_types=1);

namespace App\Microsoft365\Http\Controllers;

use App\Microsoft365\Graph\GraphAccessGuard;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeetingLink;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * The user's answers to an out-of-sync flag (Phase 6, OSYNC-03). Each call names one of the session
 * user's own flagged time entries by id and nothing else: no user, member or target time is ever read
 * from the request (D-13, T-06-27). Deleting a flagged entry is core's own DELETE: the link cascades
 * with the entry, so no fork route is needed (D-05).
 *
 * - Lookup (T-06-26): the active (not released, not detached), flagged link of the session user with
 *   that time entry, whose entry still exists and still belongs to the user. Another user's id, an
 *   unknown id, an unflagged or settled entry, impersonation (D-14) and a disconnected or missing
 *   Microsoft account (D-19) are all the same plain 404: no oracle for what exists.
 * - Each call is one transaction with the link row locked, so two clicks or a concurrent sync never
 *   apply a choice twice.
 * - Nothing about the entry or the meeting is logged.
 */
class OutOfSyncController extends Controller
{
    private const string REASON_MOVED = 'moved';

    public function __construct(private readonly GraphAccessGuard $access) {}

    /**
     * "Keep as is": the entry stays exactly as it is and the flag goes away for good.
     *
     * - A timed moved flag makes the new Outlook time the reference (snapshot := Outlook time, D-16): the
     *   same move lands in the "at the recorded slot" rule and never flags again, while a later move is
     *   compared against it and detected as usual.
     * - A cancelled or removed flag, and an all-day moved flag, detach the link: the occurrence is never
     *   checked again. An all-day slot cannot be a reference, because the rules only accept a timed
     *   sighting as "at the recorded slot" (D-18); re-baselining it would flag the same move again.
     *
     * The entry is never read for writing and never changed.
     */
    public function keep(Request $request, string $entry): JsonResponse
    {
        $user = $this->sessionUser($request);
        $this->ensureAccess($user, $entry);

        DB::transaction(function () use ($user, $entry): void {
            $link = $this->ownFlaggedLink($user, $entry);
            $now = Carbon::now();

            if ($this->isTimedMove($link)) {
                $link->meeting_starts_at = $link->outlook_starts_at;
                $link->meeting_ends_at = $link->outlook_ends_at;
            } else {
                $link->detached_at = $now;
            }
            $this->clearFlag($link);
            $link->last_checked_at = $now;
            $link->save();
        });

        return response()->json(['time_entry_id' => $entry, 'status' => 'kept']);
    }

    /**
     * 404 while an admin impersonates the user (D-14) and while the user has no usable Microsoft account
     * (D-19): the flags are hidden then, so acting on them must be too. A reconnect-state account still
     * serves its flags and may act on them.
     */
    private function ensureAccess(User $user, string $id): void
    {
        $account = MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->first();
        if ($this->access->blocked() || $account === null || $account->calendarAccessState() === 'not_connected') {
            throw (new ModelNotFoundException)->setModel(OutlookMeetingLink::class, [$id]);
        }
    }

    /**
     * The session user's active, flagged link of this time entry, locked for the caller's transaction.
     * The entry must still exist and still belong to the user (a reassigned entry is not the user's).
     */
    private function ownFlaggedLink(User $user, string $entryId): OutlookMeetingLink
    {
        return OutlookMeetingLink::query()
            ->where('user_id', '=', $user->getKey())
            ->where('time_entry_id', '=', $entryId)
            ->whereNull('released_at')
            ->whereNull('detached_at')
            ->whereNotNull('flag_reason')
            ->whereHas('timeEntry', fn (Builder $query): Builder => $query->where('user_id', '=', $user->getKey()))
            ->lockForUpdate()
            ->firstOrFail();
    }

    /**
     * A moved flag with a timed new slot: the only flag that carries a usable reference.
     */
    private function isTimedMove(OutlookMeetingLink $link): bool
    {
        return $link->flag_reason === self::REASON_MOVED
            && ! $link->outlook_all_day
            && $link->outlook_starts_at !== null
            && $link->outlook_ends_at !== null;
    }

    private function clearFlag(OutlookMeetingLink $link): void
    {
        $link->flag_reason = null;
        $link->flagged_at = null;
        $link->outlook_starts_at = null;
        $link->outlook_ends_at = null;
        $link->outlook_all_day = false;
    }

    private function sessionUser(Request $request): User
    {
        $user = $request->user();
        assert($user instanceof User);

        return $user;
    }
}
