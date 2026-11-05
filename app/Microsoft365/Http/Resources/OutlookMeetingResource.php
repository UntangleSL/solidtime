<?php

declare(strict_types=1);

namespace App\Microsoft365\Http\Resources;

use App\Microsoft365\Models\OutlookMeeting;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Explicit allow-list of what the calendar may see of a cached meeting. Never the model's toArray():
 * the user id, Graph ids and show_as stay on the server.
 *
 * @property OutlookMeeting $resource
 */
class OutlookMeetingResource extends JsonResource
{
    private const string FORMAT = 'Y-m-d\TH:i:s\Z';

    public static $wrap = 'data';

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
        ];
    }
}
