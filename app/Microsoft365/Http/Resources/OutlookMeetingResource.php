<?php

declare(strict_types=1);

namespace App\Microsoft365\Http\Resources;

use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Suggestions\MeetingHints;
use App\Microsoft365\Suggestions\SeriesKey;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Explicit allow-list of what the calendar may see of a cached meeting. Never the model's toArray():
 * the user id, Graph ids (the series id included) and show_as stay on the server.
 *
 * Phase 5 adds the hints the read derived for the meeting (D-02, D-13): an opaque series key (a keyed
 * hash, never the Graph series id), whether the series is ignored, the series pre-assignment and the
 * learned suggestions. Attendees, addresses, Graph ids and scores never appear.
 *
 * Phase 6 adds moved_from (D-03): the user's own entry a started, since moved meeting was logged on
 * (its id and times), or null.
 *
 * @property OutlookMeeting $resource
 */
class OutlookMeetingResource extends JsonResource
{
    private const string FORMAT = 'Y-m-d\TH:i:s\Z';

    public static $wrap = 'data';

    private readonly MeetingHints $hints;

    public function __construct(OutlookMeeting $resource, ?MeetingHints $hints = null)
    {
        parent::__construct($resource);
        $this->hints = $hints ?? MeetingHints::none();
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->resource->id,
            'subject' => $this->resource->subject,
            'start' => $this->resource->starts_at->utc()->format(self::FORMAT),
            'end' => $this->resource->ends_at->utc()->format(self::FORMAT),
            'organizer_name' => $this->resource->organizer_name,
            'is_organizer' => $this->resource->is_organizer,
            'is_online_meeting' => $this->resource->is_online_meeting,
            'web_link' => $this->resource->web_link,
            'dismissed' => $this->resource->dismissed_at !== null,
            'series_key' => SeriesKey::of($this->resource->series_master_id, (string) config('app.key')),
            'series_ignored' => $this->hints->seriesIgnored,
            'assignment' => $this->hints->assignment?->toArray(),
            'suggestions' => $this->hints->suggestions,
            'moved_from' => $this->hints->movedFrom,
        ];
    }
}
