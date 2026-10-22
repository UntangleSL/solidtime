<?php

declare(strict_types=1);

namespace App\Microsoft365\Models;

use App\Models\Concerns\HasUuids;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Link between a solidtime user and a Microsoft identity (tenant id + object id), plus the tokens.
 *
 * Deliberately excluded from auditing: an audit row would capture the token attributes.
 *
 * @property string $id
 * @property string $user_id
 * @property string $tenant_id
 * @property string $microsoft_oid
 * @property string|null $microsoft_email
 * @property string|null $access_token
 * @property string|null $refresh_token
 * @property Carbon|null $access_token_expires_at
 * @property array<int, string>|null $scopes
 * @property Carbon|null $disconnected_at
 * @property Carbon|null $last_login_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read User $user
 */
class MicrosoftAccount extends Model
{
    use HasUuids;

    /**
     * @var string
     */
    protected $table = 'microsoft_accounts';

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var list<string>
     */
    protected $hidden = [
        'access_token',
        'refresh_token',
    ];

    /**
     * The attributes that should be cast.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'access_token' => 'encrypted',
        'refresh_token' => 'encrypted',
        'access_token_expires_at' => 'datetime',
        'scopes' => 'array',
        'disconnected_at' => 'datetime',
        'last_login_at' => 'datetime',
    ];

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
