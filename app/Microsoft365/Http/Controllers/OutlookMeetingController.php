<?php

declare(strict_types=1);

namespace App\Microsoft365\Http\Controllers;

use App\Microsoft365\Graph\OutlookMeetingSyncService;
use App\Microsoft365\Http\Requests\MeetingRangeRequest;
use App\Microsoft365\Http\Resources\OutlookMeetingResource;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookSyncWindow;
use App\Models\User;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Controller;

/**
 * The calendar's two Outlook endpoints. Both answer only for the session user: there is no user id
 * input and every query is scoped by the authenticated user (CAL-03, D-16).
 */
class OutlookMeetingController extends Controller
{
    /**
     * Cache read: never calls Graph, so the calendar can always render what it has (SYNC-01).
     * The range is half-open [start, end): a meeting touching only a boundary is not part of it.
     */
    public function index(MeetingRangeRequest $request): AnonymousResourceCollection
    {
        $user = $this->sessionUser($request->user());
        $start = $request->rangeStart();
        $end = $request->rangeEnd();

        $meetings = OutlookMeeting::query()
            ->where('user_id', '=', $user->getKey())
            ->where('starts_at', '<', $end->format('Y-m-d H:i:s'))
            ->where('ends_at', '>', $start->format('Y-m-d H:i:s'))
            // Dismissed meetings only come back when asked for (include_dismissed); gone ones never do
            ->when(! $request->includeDismissed(), fn (Builder $query): Builder => $query->whereNull('dismissed_at'))
            ->whereNull('gone_at')
            ->orderBy('starts_at')
            ->orderBy('ends_at')
            ->orderBy('graph_id')
            ->get();

        $window = OutlookSyncWindow::query()
            ->where('user_id', '=', $user->getKey())
            ->where('window_start', '=', $start->format('Y-m-d H:i:s'))
            ->where('window_end', '=', $end->format('Y-m-d H:i:s'))
            ->first();

        // Seconds Graph is still backed off for (D-12): a reload keeps the Sync control waiting
        $account = MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->first();

        return OutlookMeetingResource::collection($meetings)->additional([
            'sync' => [
                'last_synced_at' => $window?->synced_at->utc()->format('Y-m-d\TH:i:s\Z'),
                'retry_after' => $account?->backoffRemainingSeconds(),
            ],
        ]);
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
        return OutlookMeeting::query()
            ->where('user_id', '=', $this->sessionUser($user)->getKey())
            ->whereKey($id)
            ->whereNull('gone_at')
            ->firstOrFail();
    }

    private function sessionUser(?Authenticatable $user): User
    {
        assert($user instanceof User);

        return $user;
    }
}
