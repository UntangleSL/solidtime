<?php

declare(strict_types=1);

namespace App\Profitability\Models;

use App\Models\Concerns\HasUuids;
use App\Models\Member;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * The hourly cost of one member from a local date on (D-08, BUDG-05). A row applies from its
 * effective_from until the next row of the same member, so past months keep the cost that applied then.
 * It is a separate value from the member's sale rate in core (sale rate and cost differ).
 *
 * organization_id is set by code from the route organization, never from request input.
 *
 * Deliberately not audited, not in Filament and never logged: the cost is sensitive HR data that only
 * Owner and Admin may read (D-12).
 *
 * @property string $id
 * @property string $organization_id
 * @property string $member_id
 * @property CarbonImmutable $effective_from
 * @property int $hourly_cost_cents
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Member $member
 */
class MemberCostRate extends Model
{
    use HasUuids;

    /**
     * @var string
     */
    protected $table = 'member_cost_rates';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'member_id',
        'effective_from',
        'hourly_cost_cents',
    ];

    /**
     * The attributes that should be cast.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'effective_from' => 'immutable_date',
        'hourly_cost_cents' => 'integer',
    ];

    /**
     * @return BelongsTo<Member, $this>
     */
    public function member(): BelongsTo
    {
        return $this->belongsTo(Member::class, 'member_id');
    }
}
