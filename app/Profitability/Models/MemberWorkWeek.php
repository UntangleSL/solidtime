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
 * The working week and chargeability target of one member from a local date on (D-13, CHRG-01). One
 * dated row carries both values; it applies until the next row of the same member, so past months keep
 * the week and target that applied then.
 *
 * organization_id is set by code from the route organization, never from request input.
 *
 * Deliberately not audited and not in Filament: it is HR data that only Owner and Admin may read (D-12).
 *
 * @property string $id
 * @property string $organization_id
 * @property string $member_id
 * @property CarbonImmutable $effective_from
 * @property int $weekly_seconds
 * @property int $chargeability_target_percent
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Member $member
 */
class MemberWorkWeek extends Model
{
    use HasUuids;

    /**
     * @var string
     */
    protected $table = 'member_work_weeks';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'member_id',
        'effective_from',
        'weekly_seconds',
        'chargeability_target_percent',
    ];

    /**
     * The attributes that should be cast.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'effective_from' => 'immutable_date',
        'weekly_seconds' => 'integer',
        'chargeability_target_percent' => 'integer',
    ];

    /**
     * @return BelongsTo<Member, $this>
     */
    public function member(): BelongsTo
    {
        return $this->belongsTo(Member::class, 'member_id');
    }
}
