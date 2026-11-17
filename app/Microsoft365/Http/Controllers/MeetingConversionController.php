<?php

declare(strict_types=1);

namespace App\Microsoft365\Http\Controllers;

use App\Exceptions\Api\ApiException;
use App\Microsoft365\Graph\GraphAccessGuard;
use App\Microsoft365\Http\Requests\MeetingConversionRequest;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookMeetingLink;
use App\Microsoft365\TimeEntries\CoreTimeEntryCreator;
use App\Models\Member;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Turns the session user's Outlook meetings into time entries (Phase 4, ASGN-01/02/03). Batch-shaped:
 * a single meeting is a batch of one, and every meeting gets its own result in request order.
 *
 * - Entries are created by core's own create action through CoreTimeEntryCreator, so every manual-entry
 *   rule applies (D-10); the fork never builds a time entry itself.
 * - Each meeting is one transaction: the entry and its outlook_meeting_links row are written together,
 *   with the meeting row locked, so an occurrence is linked at most once (D-06).
 * - Converting a dismissed meeting brings it back from the dismissed state (D-11).
 * - The owner (member) and the subject are always read on the server; while an admin impersonates the
 *   user nothing is converted (D-13).
 */
class MeetingConversionController extends Controller
{
    public function __construct(private readonly GraphAccessGuard $access) {}

    /**
     * @throws AuthorizationException the session user is not a member of the organization
     */
    public function store(Organization $organization, MeetingConversionRequest $request, CoreTimeEntryCreator $creator): JsonResponse
    {
        // Impersonation answers like an unknown meeting: no oracle and no work (D-13)
        if ($this->access->blocked()) {
            throw (new ModelNotFoundException)->setModel(OutlookMeeting::class);
        }

        $user = $request->user();
        assert($user instanceof User);
        $member = Member::query()
            ->whereBelongsTo($organization, 'organization')
            ->whereBelongsTo($user, 'user')
            ->first();
        if ($member === null) {
            throw new AuthorizationException;
        }

        $results = [];
        foreach ($request->meetingIds() as $meetingId) {
            // The catch sits outside the transaction: a failure rolls back that meeting's entry and link
            // only, and is reported for that meeting instead of failing the request (D-08). Nothing about
            // the meeting or the body is logged (Phase 3 D-15).
            try {
                $results[] = DB::transaction(fn (): array => $this->convertOne($request, $organization, $member, $user, $creator, $meetingId));
            } catch (ValidationException $exception) {
                $first = collect($exception->errors())->flatten()->first();
                $results[] = $this->failed($meetingId, 'validation', is_string($first) ? $first : $exception->getMessage());
            } catch (AuthorizationException) {
                $results[] = $this->failed($meetingId, 'forbidden', $this->text('microsoft365.calendar.error_forbidden_project'));
            } catch (ApiException $exception) {
                $results[] = $this->failed($meetingId, $exception->getKey(), $exception->getTranslatedMessage());
            }
        }

        return response()->json(['results' => $results]);
    }

    /**
     * @return array{meeting_id: string, status: string, time_entry_id: string|null, error: array{key: string, message: string}|null}
     */
    private function convertOne(
        MeetingConversionRequest $request,
        Organization $organization,
        Member $member,
        User $user,
        CoreTimeEntryCreator $creator,
        string $meetingId,
    ): array {
        // Own, non-gone meeting only: a foreign, unknown and gone id are the same answer (T-04-01)
        $meeting = OutlookMeeting::query()
            ->where('user_id', '=', $user->getKey())
            ->whereKey($meetingId)
            ->whereNull('gone_at')
            ->lockForUpdate()
            ->first();
        if ($meeting === null) {
            return $this->failed($meetingId, 'meeting_not_found', $this->text('microsoft365.calendar.error_meeting_gone'));
        }

        $times = $request->isSingle() ? $request->customTimes() : null;
        $description = $request->isSingle() ? $request->description() : null;

        $entry = $creator->create($request, $organization, [
            'member_id' => $member->getKey(),
            'type' => 'work',
            'project_id' => $request->projectId(),
            'task_id' => $request->taskId(),
            'tags' => $request->tags(),
            'billable' => $request->billable(),
            // The subject only ever goes into the user's own entry (D-13); core caps descriptions at 5000
            'description' => $description ?? mb_substr($meeting->subject ?? '', 0, 5000),
            // Always an end: a missing one would start a running timer
            'start' => $times['start'] ?? $meeting->starts_at->copy()->utc()->format(MeetingConversionRequest::FORMAT),
            'end' => $times['end'] ?? $meeting->ends_at->copy()->utc()->format(MeetingConversionRequest::FORMAT),
        ]);

        // The link records the meeting's own time, even when the entry was given custom times (D-03)
        OutlookMeetingLink::query()->create([
            'user_id' => $user->getKey(),
            'graph_id' => $meeting->graph_id,
            'time_entry_id' => $entry->getKey(),
            'meeting_starts_at' => $meeting->starts_at,
            'meeting_ends_at' => $meeting->ends_at,
        ]);

        if ($meeting->dismissed_at !== null) {
            $meeting->dismissed_at = null;
            $meeting->save();
        }

        return [
            'meeting_id' => $meetingId,
            'status' => 'created',
            'time_entry_id' => (string) $entry->getKey(),
            'error' => null,
        ];
    }

    private function text(string $key): string
    {
        $text = __($key);

        return is_string($text) ? $text : $key;
    }

    /**
     * @return array{meeting_id: string, status: string, time_entry_id: null, error: array{key: string, message: string}}
     */
    private function failed(string $meetingId, string $key, string $message): array
    {
        return [
            'meeting_id' => $meetingId,
            'status' => 'failed',
            'time_entry_id' => null,
            'error' => ['key' => $key, 'message' => $message],
        ];
    }
}
