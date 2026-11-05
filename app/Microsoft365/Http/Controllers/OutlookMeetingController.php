<?php

declare(strict_types=1);

namespace App\Microsoft365\Http\Controllers;

use App\Microsoft365\Graph\OutlookMeetingSyncService;
use App\Microsoft365\Http\Requests\MeetingRangeRequest;
use App\Microsoft365\Http\Resources\OutlookMeetingResource;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookSyncWindow;
use App\Models\User;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Http\JsonResponse;
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
            ->whereNull('dismissed_at')
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

        return OutlookMeetingResource::collection($meetings)->additional([
            'sync' => [
                'last_synced_at' => $window?->synced_at->utc()->format('Y-m-d\TH:i:s\Z'),
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
        );

        return response()->json($outcome->toArray());
    }

    private function sessionUser(?Authenticatable $user): User
    {
        assert($user instanceof User);

        return $user;
    }
}
