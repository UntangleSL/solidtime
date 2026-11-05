<?php

declare(strict_types=1);

namespace App\Microsoft365\Models;

use App\Models\Concerns\HasUuids;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Cached Outlook meeting of one user (one occurrence of a meeting), read from Microsoft Graph.
 *
 * Deliberately not audited and never serialized directly: the subject is personal data.
 * Only meetings that passed OutlookMeetingEligibility are ever stored.
 *
 * @property string $id
 * @property string $user_id
 * @property string $graph_id
 * @property string|null $series_master_id
 * @property Carbon|null $original_start
 * @property string $event_type
 * @property string|null $subject
 * @property Carbon $starts_at
 * @property Carbon $ends_at
 * @property string|null $organizer_name
 * @property bool $is_organizer
 * @property bool $is_online_meeting
 * @property string|null $show_as
 * @property string|null $web_link
 * @property Carbon $last_seen_at
 * @property Carbon|null $gone_at
 * @property Carbon|null $dismissed_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read User $user
 */
class OutlookMeeting extends Model
{
    use HasUuids;

    /**
     * @var string
     */
    protected $table = 'outlook_meetings';

    /**
     * The attributes that should be cast.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'original_start' => 'datetime',
        'starts_at' => 'datetime',
        'ends_at' => 'datetime',
        'is_organizer' => 'boolean',
        'is_online_meeting' => 'boolean',
        'last_seen_at' => 'datetime',
        'gone_at' => 'datetime',
        'dismissed_at' => 'datetime',
    ];

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
