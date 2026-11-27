<?php

declare(strict_types=1);

namespace App\Profitability\Models;

use App\Models\Concerns\HasUuids;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * The planned hours of one month of a contract period (D-02). The months of a period always sum to the
 * period's budget_seconds; the default plan is an even split.
 *
 * organization_id is set by code from the period, never from request input.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $period_id
 * @property CarbonImmutable $month
 * @property int $planned_seconds
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read ContractPeriod $period
 */
class ContractPeriodMonth extends Model
{
    use HasUuids;

    /**
     * @var string
     */
    protected $table = 'contract_period_months';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'period_id',
        'month',
        'planned_seconds',
    ];

    /**
     * The attributes that should be cast.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'month' => 'immutable_date',
        'planned_seconds' => 'integer',
    ];

    /**
     * @return BelongsTo<ContractPeriod, $this>
     */
    public function period(): BelongsTo
    {
        return $this->belongsTo(ContractPeriod::class, 'period_id');
    }
}
