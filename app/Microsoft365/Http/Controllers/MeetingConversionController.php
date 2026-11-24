<?php

declare(strict_types=1);

namespace App\Microsoft365\Http\Controllers;

use App\Exceptions\Api\ApiException;
use App\Microsoft365\Graph\GraphAccessGuard;
use App\Microsoft365\Http\Requests\MeetingConversionRequest;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookMeetingLink;
use App\Microsoft365\Suggestions\MeetingSignalInput;
use App\Microsoft365\Suggestions\MeetingSignals;
use App\Microsoft365\Suggestions\SeriesAssignmentResolver;
use App\Microsoft365\TimeEntries\CoreTimeEntryCreator;
use App\Models\Member;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\UniqueConstraintViolationException;
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
 * - Repeats are safe (D-06, D-16): an occurrence with an active link to an entry of the user answers
 *   'existing' with that entry and creates nothing; a link whose entry now belongs to someone else is
 *   stale and is replaced; a unique-index race rolls the meeting back and answers with the winner's
 *   entry. A released link (Phase 6 D-03) is not active: the moved meeting converts again.
 * - The owner (member) and the subject are always read on the server; while an admin impersonates the
 *   user nothing is converted (D-13, Phase 5 D-14).
 * - Confirm mode (Phase 5 RULE-02, D-03, D-04): the body names meetings only and each meeting takes its
 *   series' current assignment (project, task, tags, billable), with its own times and subject. The
 *   assignment is resolved inside the meeting's transaction, after the row lock and the existing-link
 *   check, so a series changed, forgotten or no longer bookable since the read answers with the newest
 *   state (RESEARCH Pitfall 7); a meeting without one fails with 'no_assignment'. The entry still goes
 *   through core's create action, so every manual-entry rule applies to the server-chosen fields.
 * - Learning data (Phase 5 RULE-03, D-09, D-17): every new link stores the converted meeting's signals as
 *   keyed hashes only (see MeetingSignals): no address, domain or subject word is readable on the
 *   link, and none of it is ever logged.
 * - Hit rate (D-16): every new link records how the form was prefilled (prefill_source) and whether the
 *   user kept that project (prefill_kept); confirm mode is 'series' and kept by definition.
 */
class MeetingConversionController extends Controller
{
    public function __construct(
        private readonly GraphAccessGuard $access,
        private readonly SeriesAssignmentResolver $resolver,
        private readonly MeetingSignalInput $signalInput,
    ) {}

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

        // Once per request: the user's own addresses, the internal domains and the hash key (D-09)
        $identity = $this->signalInput->identity($user);
        $secret = (string) config('app.key');

        $results = [];
        foreach ($request->meetingIds() as $meetingId) {
            // The catch sits outside the transaction: a failure rolls back that meeting's entry and link
            // only, and is reported for that meeting instead of failing the request (D-08). Nothing about
            // the meeting or the body is logged (Phase 3 D-15).
            try {
                $results[] = DB::transaction(fn (): array => $this->convertOne($request, $organization, $member, $user, $creator, $meetingId, $identity, $secret));
            } catch (UniqueConstraintViolationException) {
                // A concurrent request linked the same occurrence first: this meeting's transaction is
                // already rolled back (no entry, no link of its own), so answer with the winner's entry
                $results[] = $this->afterConflict($user, $meetingId);
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
     * @param  array{own: list<string>, internal: list<string>}  $identity
     * @return array{meeting_id: string, status: string, time_entry_id: string|null, error: array{key: string, message: string}|null}
     */
    private function convertOne(
        MeetingConversionRequest $request,
        Organization $organization,
        Member $member,
        User $user,
        CoreTimeEntryCreator $creator,
        string $meetingId,
        array $identity,
        string $secret,
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

        // Already converted: the same entry again, nothing new (D-06, D-16). A link whose entry now belongs
        // to another user (reassigned in bulk by core) is stale: it is dropped and the meeting converts
        // again (RESEARCH Pitfall 4).
        $link = $this->linkOf($user, $meeting->graph_id);
        if ($link !== null) {
            if ($this->ownedBy($link, $user)) {
                return $this->existing($meetingId, $link->time_entry_id);
            }
            $link->delete();
        }

        if ($request->usesSeriesAssignment()) {
            // Confirm mode: the server decides every entry field from the series, never the body (T-05-15)
            $assignment = $this->resolver->forMeeting($user, $organization, $meeting);
            if ($assignment === null) {
                return $this->failed($meetingId, 'no_assignment', $this->text('microsoft365.calendar.error_no_assignment'));
            }
            $fields = [
                'project_id' => $assignment->projectId,
                'task_id' => $assignment->taskId,
                'tags' => $assignment->tags,
                'billable' => $assignment->billable,
            ];
            $times = null;
            $description = null;
        } else {
            $fields = [
                'project_id' => $request->projectId(),
                'task_id' => $request->taskId(),
                'tags' => $request->tags(),
                'billable' => $request->billable(),
            ];
            $times = $request->isSingle() ? $request->customTimes() : null;
            $description = $request->isSingle() ? $request->description() : null;
        }

        $entry = $creator->create($request, $organization, [
            'member_id' => $member->getKey(),
            'type' => 'work',
            ...$fields,
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
            // The series history lives on the link: Disconnect purges the meeting rows (Phase 5 D-17)
            'series_master_id' => $meeting->series_master_id,
            // Keyed hashes only, never a readable address, domain or word (D-09, D-17)
            'signals' => MeetingSignals::hashed(
                MeetingSignals::features($this->signalInput->fromMeeting($meeting), $identity['own'], $identity['internal']),
                $secret,
            ),
            ...$this->prefill($request),
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

    /**
     * The answer after a unique-index violation: the winner's entry when it belongs to the user, else a
     * neutral per-meeting failure. Never a 500 (ASGN-03).
     *
     * @return array{meeting_id: string, status: string, time_entry_id: string|null, error: array{key: string, message: string}|null}
     */
    private function afterConflict(User $user, string $meetingId): array
    {
        $graphId = OutlookMeeting::query()
            ->where('user_id', '=', $user->getKey())
            ->whereKey($meetingId)
            ->value('graph_id');
        $link = is_string($graphId) ? $this->linkOf($user, $graphId) : null;
        if ($link !== null && $this->ownedBy($link, $user)) {
            return $this->existing($meetingId, $link->time_entry_id);
        }

        return $this->failed($meetingId, 'conflict', $this->text('microsoft365.calendar.error_generic'));
    }

    /**
     * How the form was prefilled and whether the user kept that project (D-16). Confirm mode is a series
     * prefill kept as is; a form without a prefilled project records no "kept".
     *
     * @return array{prefill_source: string|null, prefill_kept: bool|null}
     */
    private function prefill(MeetingConversionRequest $request): array
    {
        if ($request->usesSeriesAssignment()) {
            $source = 'series';
            $kept = true;
        } else {
            $source = $request->prefillSource();
            $prefilled = $request->prefillProjectId();
            $kept = in_array($source, ['series', 'suggestion', 'last_used'], true) && $prefilled !== null
                ? $prefilled === $request->projectId()
                : null;
        }

        return ['prefill_source' => $source, 'prefill_kept' => $kept];
    }

    /**
     * The occurrence's active link. A released link (a started meeting Outlook moved, Phase 6 D-03) no
     * longer counts as "already converted": "Create time entry" on the meeting at its new slot makes a
     * second entry and a second, active link, which the partial unique index (active links only) allows.
     */
    private function linkOf(User $user, string $graphId): ?OutlookMeetingLink
    {
        return OutlookMeetingLink::query()
            ->with('timeEntry')
            ->where('user_id', '=', $user->getKey())
            ->where('graph_id', '=', $graphId)
            ->whereNull('released_at')
            ->first();
    }

    private function ownedBy(OutlookMeetingLink $link, User $user): bool
    {
        return $link->timeEntry !== null && $link->timeEntry->user_id === $user->getKey();
    }

    /**
     * @return array{meeting_id: string, status: string, time_entry_id: string, error: null}
     */
    private function existing(string $meetingId, string $timeEntryId): array
    {
        return [
            'meeting_id' => $meetingId,
            'status' => 'existing',
            'time_entry_id' => $timeEntryId,
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
