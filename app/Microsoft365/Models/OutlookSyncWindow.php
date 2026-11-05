<?php

declare(strict_types=1);

namespace App\Microsoft365\Models;

use App\Models\Concerns\HasUuids;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Records when the Outlook meetings of one user were last fetched completely for a window.
 *
 * @property string $id
 * @property string $user_id
 * @property Carbon $window_start
 * @property Carbon $window_end
 * @property Carbon $synced_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read User $user
 */
class OutlookSyncWindow extends Model
{
    use HasUuids;

    /**
     * @var string
     */
    protected $table = 'outlook_sync_windows';

    /**
     * The attributes that should be cast.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'window_start' => 'datetime',
        'window_end' => 'datetime',
        'synced_at' => 'datetime',
    ];

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
