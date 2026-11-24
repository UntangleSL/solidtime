<?php

declare(strict_types=1);

namespace App\Microsoft365\Http\Controllers;

use App\Microsoft365\Graph\GraphAccessGuard;
use App\Microsoft365\Http\Requests\MeetingConversionRequest;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookMeetingLink;
use App\Microsoft365\TimeEntries\CoreTimeEntryUpdater;
use App\Models\Member;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * The user's answers to an out-of-sync change (Phase 6): "Keep as is" and "Adjust to Outlook" on a
 * flagged entry (OSYNC-03), and "Move my entry here" for a started meeting Outlook moved (D-03,
 * OSYNC-01). Keep and Adjust name one of the session user's own flagged time entries by id, Move names
 * one of the user's own meetings and the organization; no user, member or target time is ever read
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
     * "Adjust to Outlook": the entry moves to the Outlook slot stored on the flag, through core's own
     * update path (CoreTimeEntryUpdater), so permissions, the organization's overlap rule, validation and
     * the spent-time recalculation all apply as for a manual edit (D-04, D-12). Only the start and end
     * change. The target always comes from the server-side flag, never from the request (T-06-27).
     *
     * Only a timed moved flag can be adjusted: cancelled, removed and all-day flags are a 404 (D-18).
     * When core refuses (422 validation, 403 permission, its ApiException such as an overlap or a blocked
     * organization) its own answer goes back unchanged and the transaction rolls back, so the flag stays.
     * On success the new slot becomes the reference and the flag is cleared.
     */
    public function adjust(Request $request, string $entry, CoreTimeEntryUpdater $updater): JsonResponse
    {
        $user = $this->sessionUser($request);
        $this->ensureAccess($user, $entry);

        /** @var array{start: string, end: string} $slot */
        $slot = DB::transaction(function () use ($user, $entry, $updater): array {
            $link = $this->ownFlaggedLink($user, $entry);
            if (! $this->isTimedMove($link) || $link->outlook_starts_at === null || $link->outlook_ends_at === null) {
                throw (new ModelNotFoundException)->setModel(OutlookMeetingLink::class, [$entry]);
            }
            $timeEntry = $this->ownEntry($user, $link->time_entry_id);
            $start = $link->outlook_starts_at->copy()->utc();
            $end = $link->outlook_ends_at->copy()->utc();

            $updater->updateTimes(
                $user,
                $timeEntry,
                $start->format(MeetingConversionRequest::FORMAT),
                $end->format(MeetingConversionRequest::FORMAT),
            );

            $link->meeting_starts_at = $start;
            $link->meeting_ends_at = $end;
            $this->clearFlag($link);
            $link->last_checked_at = Carbon::now();
            $link->save();

            return [
                'start' => $start->format(MeetingConversionRequest::FORMAT),
                'end' => $end->format(MeetingConversionRequest::FORMAT),
            ];
        });

        return response()->json([
            'time_entry_id' => $entry,
            'status' => 'adjusted',
            'start' => $slot['start'],
            'end' => $slot['end'],
        ]);
    }

    /**
     * "Move my entry here" (D-03): a started meeting Outlook moved to a new slot released its link, so the
     * meeting shows again at the new slot. Instead of a second entry, the entry logged on the old slot
     * moves to the meeting's current slot through core's update path, and its link becomes active again
     * with the new slot as the reference.
     *
     * - The meeting is one of the session user's own, non-gone meetings, locked for the whole call: the
     *   same row lock as "Create time entry", so the two never both win (T-06-30).
     * - An active link already exists (a second entry was created, or a concurrent request won) ->
     *   'existing' with that link's entry, nothing changes. An active link whose entry now belongs to
     *   someone else is stale and is dropped, as the conversion does.
     * - Otherwise the latest released link of the occurrence whose entry is live, has an end, belongs to
     *   the user and lives in {organization} (T-06-29). None -> 404.
     * - The target is the cached meeting's own slot; the body is never read (T-06-27).
     * - Core refusals answer core's error and roll everything back; a unique-index race answers with the
     *   winner's entry.
     *
     * @throws AuthorizationException the session user is not a member of the organization
     */
    public function moveEntry(Organization $organization, Request $request, string $meeting, CoreTimeEntryUpdater $updater): JsonResponse
    {
        $user = $this->sessionUser($request);
        $this->ensureAccess($user, $meeting);

        $isMember = Member::query()
            ->whereBelongsTo($organization, 'organization')
            ->whereBelongsTo($user, 'user')
            ->exists();
        if (! $isMember) {
            throw new AuthorizationException;
        }

        try {
            $result = DB::transaction(fn (): array => $this->moveOne($organization, $user, $meeting, $updater));
        } catch (UniqueConstraintViolationException) {
            // A concurrent conversion activated a link for the occurrence first; this call left nothing
            $result = $this->afterConflict($user, $meeting);
        }

        return response()->json($result);
    }

    /**
     * @return array{meeting_id: string, status: 'moved'|'existing', time_entry_id: string}
     */
    private function moveOne(Organization $organization, User $user, string $meetingId, CoreTimeEntryUpdater $updater): array
    {
        $meeting = OutlookMeeting::query()
            ->where('user_id', '=', $user->getKey())
            ->whereKey($meetingId)
            ->whereNull('gone_at')
            ->lockForUpdate()
            ->firstOrFail();

        $active = $this->activeLink($user, $meeting->graph_id);
        if ($active !== null) {
            if ($active->timeEntry !== null && $active->timeEntry->user_id === $user->getKey()) {
                return $this->moveResult($meetingId, 'existing', $active->time_entry_id);
            }
            $active->delete();
        }

        $link = OutlookMeetingLink::query()
            ->where('user_id', '=', $user->getKey())
            ->where('graph_id', '=', $meeting->graph_id)
            ->whereNotNull('released_at')
            ->whereHas('timeEntry', fn (Builder $query): Builder => $query
                ->where('user_id', '=', $user->getKey())
                ->where('organization_id', '=', $organization->getKey())
                ->whereNotNull('end'))
            ->orderByDesc('released_at')
            ->orderByDesc('id')
            ->lockForUpdate()
            ->first();
        if ($link === null) {
            throw (new ModelNotFoundException)->setModel(OutlookMeeting::class, [$meetingId]);
        }
        $entry = $this->ownEntry($user, $link->time_entry_id);

        $start = $meeting->starts_at->copy()->utc();
        $end = $meeting->ends_at->copy()->utc();
        $updater->updateTimes(
            $user,
            $entry,
            $start->format(MeetingConversionRequest::FORMAT),
            $end->format(MeetingConversionRequest::FORMAT),
        );

        $link->released_at = null;
        $link->detached_at = null;
        $link->meeting_starts_at = $start;
        $link->meeting_ends_at = $end;
        $this->clearFlag($link);
        $link->last_checked_at = Carbon::now();
        $link->save();

        // Like a conversion, acting on a dismissed meeting brings it back from the dismissed state
        if ($meeting->dismissed_at !== null) {
            $meeting->dismissed_at = null;
            $meeting->save();
        }

        return $this->moveResult($meetingId, 'moved', $link->time_entry_id);
    }

    /**
     * After a unique-index violation: the winner's entry when it belongs to the user, else a 409.
     *
     * @return array{meeting_id: string, status: 'moved'|'existing', time_entry_id: string}
     */
    private function afterConflict(User $user, string $meetingId): array
    {
        $graphId = OutlookMeeting::query()
            ->where('user_id', '=', $user->getKey())
            ->whereKey($meetingId)
            ->value('graph_id');
        $active = is_string($graphId) ? $this->activeLink($user, $graphId) : null;
        if ($active === null || $active->timeEntry === null || $active->timeEntry->user_id !== $user->getKey()) {
            abort(409);
        }

        return $this->moveResult($meetingId, 'existing', $active->time_entry_id);
    }

    private function activeLink(User $user, string $graphId): ?OutlookMeetingLink
    {
        return OutlookMeetingLink::query()
            ->with('timeEntry')
            ->where('user_id', '=', $user->getKey())
            ->where('graph_id', '=', $graphId)
            ->whereNull('released_at')
            ->first();
    }

    /**
     * @param  'moved'|'existing'  $status
     * @return array{meeting_id: string, status: 'moved'|'existing', time_entry_id: string}
     */
    private function moveResult(string $meetingId, string $status, string $timeEntryId): array
    {
        return ['meeting_id' => $meetingId, 'status' => $status, 'time_entry_id' => $timeEntryId];
    }

    /**
     * The time entry with this id, locked, while it still belongs to the user; else a 404.
     */
    private function ownEntry(User $user, string $id): TimeEntry
    {
        return TimeEntry::query()
            ->whereKey($id)
            ->where('user_id', '=', $user->getKey())
            ->lockForUpdate()
            ->firstOrFail();
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
