<?php

declare(strict_types=1);

namespace App\Profitability\Models;

use App\Models\Client;
use App\Models\Concerns\HasUuids;
use App\Models\Member;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A member assigned as account manager of one client (D-10). Grants every project of that client with
 * its money, and the right to edit the contract terms (D-11, D-12). It is an assignment row, not a
 * solidtime role: the member keeps their core role, whatever it is.
 *
 * organization_id is set by code from the route organization, never from request input. Only Owner and
 * Admin create or delete these rows (D-16).
 *
 * Deliberately not audited and not in Filament: it is part of the profitability access model.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $client_id
 * @property string $member_id
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Member $member
 * @property-read Client $client
 */
class ClientAccountManager extends Model
{
    use HasUuids;

    /**
     * @var string
     */
    protected $table = 'client_account_managers';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'client_id',
        'member_id',
    ];

    /**
     * @return BelongsTo<Member, $this>
     */
    public function member(): BelongsTo
    {
        return $this->belongsTo(Member::class, 'member_id');
    }

    /**
     * @return BelongsTo<Client, $this>
     */
    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class, 'client_id');
    }
}
