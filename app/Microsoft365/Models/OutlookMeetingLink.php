<?php

declare(strict_types=1);

namespace App\Microsoft365\Models;

use App\Models\Concerns\HasUuids;
use App\Models\TimeEntry;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Links one Outlook meeting occurrence of a user (user_id + immutable Graph id) to the time entry
 * created from it (Phase 4 D-05, D-06). Keyed by the occurrence, not by an outlook_meetings row, so
 * it survives Disconnect and re-syncs.
 *
 * It also carries the series of the occurrence (Phase 5 D-02, D-17): the series history lives on the
 * links, so a recurring meeting stays pre-assigned after Disconnect and re-syncs.
 *
 * It also carries the out-of-sync state of the occurrence (Phase 6): a flag waiting for the user's
 * choice with the new Outlook slot (D-04, D-05, D-18), the release of a started meeting moved to a new
 * slot (D-03), the detach of a kept cancelled or removed flag, the last automatic adjust (D-04), and the
 * snapshot meeting_starts_at / meeting_ends_at that every check compares against (D-01, D-16).
 *
 * Deliberately not audited and not in Filament: it holds ids, times and keyed hashes only, never the
 * subject or an address (D-13).
 *
 * @property string $id
 * @property string $user_id
 * @property string $graph_id
 * @property string $time_entry_id
 * @property Carbon|null $meeting_starts_at
 * @property Carbon|null $meeting_ends_at
 * @property string|null $series_master_id
 * @property array<string, mixed>|null $signals
 * @property string|null $prefill_source
 * @property bool|null $prefill_kept
 * @property string|null $flag_reason
 * @property Carbon|null $flagged_at
 * @property Carbon|null $outlook_starts_at
 * @property Carbon|null $outlook_ends_at
 * @property bool $outlook_all_day
 * @property Carbon|null $released_at
 * @property Carbon|null $detached_at
 * @property Carbon|null $last_checked_at
 * @property Carbon|null $auto_adjusted_at
 * @property Carbon|null $auto_adjusted_from_starts_at
 * @property Carbon|null $auto_adjusted_from_ends_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read TimeEntry|null $timeEntry
 */
class OutlookMeetingLink extends Model
{
    use HasUuids;

    /**
     * @var string
     */
    protected $table = 'outlook_meeting_links';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'user_id',
        'graph_id',
        'time_entry_id',
        'meeting_starts_at',
        'meeting_ends_at',
        'series_master_id',
        'signals',
        'prefill_source',
        'prefill_kept',
        'flag_reason',
        'flagged_at',
        'outlook_starts_at',
        'outlook_ends_at',
        'outlook_all_day',
        'released_at',
        'detached_at',
        'last_checked_at',
        'auto_adjusted_at',
        'auto_adjusted_from_starts_at',
        'auto_adjusted_from_ends_at',
    ];

    /**
     * Mirrors the column default, so an unsaved link reads "not all-day" too.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'outlook_all_day' => false,
    ];

    /**
     * The attributes that should be cast.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'meeting_starts_at' => 'datetime',
        'meeting_ends_at' => 'datetime',
        'signals' => 'array',
        'prefill_kept' => 'boolean',
        'flagged_at' => 'datetime',
        'outlook_starts_at' => 'datetime',
        'outlook_ends_at' => 'datetime',
        'outlook_all_day' => 'boolean',
        'released_at' => 'datetime',
        'detached_at' => 'datetime',
        'last_checked_at' => 'datetime',
        'auto_adjusted_at' => 'datetime',
        'auto_adjusted_from_starts_at' => 'datetime',
        'auto_adjusted_from_ends_at' => 'datetime',
    ];

    /**
     * @return BelongsTo<TimeEntry, $this>
     */
    public function timeEntry(): BelongsTo
    {
        return $this->belongsTo(TimeEntry::class, 'time_entry_id');
    }
}
