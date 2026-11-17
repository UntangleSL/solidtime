<?php

declare(strict_types=1);

namespace App\Appearance\Models;

use App\Models\Concerns\HasUuids;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A user's own appearance choices (theme and accent preset), kept in a side table so core's users
 * table stays untouched. Cosmetic only, so it is not audited.
 *
 * @property string $id
 * @property string $user_id
 * @property string|null $theme
 * @property string|null $accent
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read User $user
 */
class UserAppearanceSetting extends Model
{
    use HasUuids;

    /**
     * @var string
     */
    protected $table = 'user_appearance_settings';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'user_id',
        'theme',
        'accent',
    ];

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
