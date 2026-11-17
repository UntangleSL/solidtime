<?php

declare(strict_types=1);

namespace App\Microsoft365\Http\Controllers;

use App\Microsoft365\Graph\GraphAccessGuard;
use App\Microsoft365\Graph\OutlookMeetingSyncService;
use App\Microsoft365\Http\Requests\MeetingRangeRequest;
use App\Microsoft365\Http\Resources\OutlookMeetingResource;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookSyncWindow;
use App\Microsoft365\Suggestions\MeetingHints;
use App\Microsoft365\Suggestions\SeriesAssignmentResolver;
use App\Models\Member;
use App\Models\Organization;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\DB;

/**
 * The calendar's two Outlook endpoints. Both answer only for the session user: there is no user id
 * input and every query is scoped by the authenticated user (CAL-03, D-16). While an admin impersonates
 * the user nothing is served (D-22): an empty list, no sync, and a 404 for dismiss and restore.
 * A meeting converted into a time entry is not listed while that entry exists (Phase 4 D-04); the read
 * carries the ids of the user's entries created from meetings instead (linked_time_entry_ids).
 * Each meeting of the read also carries its hints (Phase 5 D-02): an occurrence of a series the user
 * already converted comes pre-assigned to the project of the latest conversion. The read never converts
 * anything (D-03). Occurrences of a series the user chose to ignore are left out like dismissed ones and
 * come back only with include_dismissed (D-10).
 */
class OutlookMeetingController extends Controller
{
    public function __construct(private readonly GraphAccessGuard $access) {}

    /**
     * Cache read: never calls Graph, so the calendar can always render what it has (SYNC-01).
     * The range is half-open [start, end): a meeting touching only a boundary is not part of it.
     */
    public function index(MeetingRangeRequest $request, SeriesAssignmentResolver $resolver): AnonymousResourceCollection
    {
        $user = $this->sessionUser($request->user());
        $start = $request->rangeStart();
        $end = $request->rangeEnd();

        // Impersonation, no link, or a disconnected link: nothing to show and nothing is queried. A
        // reconnect-state account still serves its last known meetings (UI-SPEC).
        $account = MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->first();
        if ($this->access->blocked() || $account === null || $account->calendarAccessState() === 'not_connected') {
            return OutlookMeetingResource::collection(collect())->additional([
                'sync' => ['last_synced_at' => null, 'retry_after' => null],
                'linked_time_entry_ids' => [],
            ]);
        }

        $meetings = OutlookMeeting::query()
            ->where('user_id', '=', $user->getKey())
            ->where('starts_at', '<', $end->format('Y-m-d H:i:s'))
            ->where('ends_at', '>', $start->format('Y-m-d H:i:s'))
            // Dismissed meetings only come back when asked for (include_dismissed); gone ones never do
            ->when(! $request->includeDismissed(), fn (Builder $query): Builder => $query->whereNull('dismissed_at'))
            ->whereNull('gone_at')
            // Occurrences of a series the user ignored leave the calendar (Phase 5 D-10); like dismissed
            // ones they only come back when asked for (include_dismissed)
            ->when(! $request->includeDismissed(), fn (Builder $query): Builder => $query->whereNotExists(function (QueryBuilder $settings): void {
                $settings->selectRaw('1')
                    ->from('outlook_series_settings')
                    ->whereColumn('outlook_series_settings.user_id', 'outlook_meetings.user_id')
                    ->whereColumn('outlook_series_settings.series_master_id', 'outlook_meetings.series_master_id')
                    ->whereNotNull('outlook_series_settings.ignored_at');
            }))
            // Converted meetings leave the suggestions while their entry exists and still belongs to the
            // user (Phase 4 D-04). An entry deleted anywhere drops its link (cascade); an entry moved to
            // another user no longer hides the meeting.
            ->whereNotExists(function (QueryBuilder $query): void {
                $query->selectRaw('1')
                    ->from('outlook_meeting_links')
                    ->join('time_entries', 'time_entries.id', '=', 'outlook_meeting_links.time_entry_id')
                    ->whereColumn('outlook_meeting_links.user_id', 'outlook_meetings.user_id')
                    ->whereColumn('outlook_meeting_links.graph_id', 'outlook_meetings.graph_id')
                    ->whereColumn('time_entries.user_id', 'outlook_meeting_links.user_id');
            })
            ->orderBy('starts_at')
            ->orderBy('ends_at')
            ->orderBy('graph_id')
            ->get();

        $window = OutlookSyncWindow::query()
            ->where('user_id', '=', $user->getKey())
            ->where('window_start', '=', $start->format('Y-m-d H:i:s'))
            ->where('window_end', '=', $end->format('Y-m-d H:i:s'))
            ->first();

        // Ignored series are only part of the read with include_dismissed (above): their occurrences come
        // back marked series_ignored, faded like dismissed ones (D-10). One query, whatever the size.
        $ignoredSeries = $request->includeDismissed() ? $this->ignoredSeries($user) : [];

        // Series pre-assignment, resolved once for every visible series of the read (T-05-05). Only the
        // current organization counts, the same one the convert URL targets (RESEARCH Pitfall 5); without
        // one there is nothing to pre-assign. Dismissed occurrences and occurrences of an ignored series
        // never carry an assignment (D-03, D-10).
        $organization = $this->currentOrganization($user);
        $assignments = $organization === null ? [] : $resolver->forMeetings(
            $user,
            $organization,
            $meetings->filter(fn (OutlookMeeting $meeting): bool => $meeting->series_master_id !== null
                && $meeting->dismissed_at === null
                && ! isset($ignoredSeries[$meeting->series_master_id])),
        );

        $resources = $meetings->map(fn (OutlookMeeting $meeting): OutlookMeetingResource => new OutlookMeetingResource(
            $meeting,
            new MeetingHints(
                assignment: $assignments[$meeting->id] ?? null,
                seriesIgnored: $meeting->series_master_id !== null && isset($ignoredSeries[$meeting->series_master_id]),
            ),
        ));

        return OutlookMeetingResource::collection($resources)->additional([
            'sync' => [
                'last_synced_at' => $window?->synced_at->utc()->format('Y-m-d\TH:i:s\Z'),
                // Seconds Graph is still backed off for (D-12): a reload keeps the Sync control waiting
                'retry_after' => $account->backoffRemainingSeconds(),
            ],
            'linked_time_entry_ids' => $this->linkedTimeEntryIds($user, $start, $end),
        ]);
    }

    /**
     * The series the session user ignores, as a set keyed by Graph series id.
     *
     * @return array<string, true>
     */
    private function ignoredSeries(User $user): array
    {
        $ignored = [];
        foreach (DB::table('outlook_series_settings')
            ->where('user_id', '=', $user->getKey())
            ->whereNotNull('ignored_at')
            ->pluck('series_master_id') as $series) {
            $ignored[(string) $series] = true;
        }

        return $ignored;
    }

    /**
     * Ids of the session user's own time entries that were created from a meeting and overlap the
     * half-open range [start, end) by their own start and end (an entry without an end counts from its
     * start). The meeting's time plays no part: an entry dragged to another week carries its Outlook icon
     * there (Phase 4 D-04). An entry now owned by someone else is not the user's and is left out.
     *
     * @return list<string>
     */
    private function linkedTimeEntryIds(User $user, CarbonImmutable $start, CarbonImmutable $end): array
    {
        $rangeStart = $start->format('Y-m-d H:i:s');

        $ids = DB::table('outlook_meeting_links')
            ->join('time_entries', 'time_entries.id', '=', 'outlook_meeting_links.time_entry_id')
            ->where('outlook_meeting_links.user_id', '=', $user->getKey())
            ->where('time_entries.user_id', '=', $user->getKey())
            ->where('time_entries.start', '<', $end->format('Y-m-d H:i:s'))
            ->where(function (QueryBuilder $query) use ($rangeStart): void {
                $query->where('time_entries.end', '>', $rangeStart)
                    ->orWhere(function (QueryBuilder $running) use ($rangeStart): void {
                        $running->whereNull('time_entries.end')
                            ->where('time_entries.start', '>=', $rangeStart);
                    });
            })
            ->orderBy('time_entries.start')
            ->orderBy('time_entries.id')
            ->pluck('time_entries.id')
            ->map(fn (mixed $id): string => (string) $id)
            ->all();

        return array_values($ids);
    }

    /**
     * Runs a sync for the session user. Every outcome, failures included, is an HTTP 200 with a status:
     * the calendar keeps working from the cache whatever Graph does.
     */
    public function sync(MeetingRangeRequest $request, OutlookMeetingSyncService $service): JsonResponse
    {
        $outcome = $service->sync(
            $this->sessionUser($request->user()),
            $request->rangeStart(),
            $request->rangeEnd(),
            $request->force(),
        );

        return response()->json($outcome->toArray());
    }

    /**
     * Hides one occurrence from the calendar. Idempotent: a second call keeps the first dismissed_at.
     * Nothing is deleted and no time entry is touched; restoring is the inverse call.
     */
    public function dismiss(Request $request, string $meeting): OutlookMeetingResource
    {
        $row = $this->ownMeeting($request->user(), $meeting);
        if ($row->dismissed_at === null) {
            $row->dismissed_at = now();
            $row->save();
        }

        return new OutlookMeetingResource($row);
    }

    /**
     * Brings a dismissed occurrence back. Idempotent: restoring a visible meeting is a no-op 200.
     */
    public function restore(Request $request, string $meeting): OutlookMeetingResource
    {
        $row = $this->ownMeeting($request->user(), $meeting);
        if ($row->dismissed_at !== null) {
            $row->dismissed_at = null;
            $row->save();
        }

        return new OutlookMeetingResource($row);
    }

    /**
     * The meeting of the session user with this id. The route value is a plain string (no implicit
     * model binding): another user's id, an unknown id and a gone meeting are all the same 404.
     */
    private function ownMeeting(?Authenticatable $user, string $id): OutlookMeeting
    {
        // Impersonation answers like a foreign id: no oracle for what exists
        if ($this->access->blocked()) {
            throw (new ModelNotFoundException)->setModel(OutlookMeeting::class, [$id]);
        }

        return OutlookMeeting::query()
            ->where('user_id', '=', $this->sessionUser($user)->getKey())
            ->whereKey($id)
            ->whereNull('gone_at')
            ->firstOrFail();
    }

    /**
     * The session user's current organization (current_team_id), or null when there is none or the user
     * is no longer a member of it.
     */
    private function currentOrganization(User $user): ?Organization
    {
        if ($user->current_team_id === null) {
            return null;
        }

        $organization = Organization::query()->find($user->current_team_id);
        if ($organization === null) {
            return null;
        }

        $isMember = Member::query()
            ->where('organization_id', '=', $organization->getKey())
            ->where('user_id', '=', $user->getKey())
            ->exists();

        return $isMember ? $organization : null;
    }

    private function sessionUser(?Authenticatable $user): User
    {
        assert($user instanceof User);

        return $user;
    }
}
