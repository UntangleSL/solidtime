<?php

declare(strict_types=1);

namespace App\Profitability\Models;

use App\Models\Concerns\HasUuids;
use App\Profitability\Periods\PeriodCalendar;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * One period of a project contract (D-03, D-04): the hours and money sold for a date range, both dates
 * inclusive and local to the profitability timezone. A period is the per-period override surface; a
 * started or closed period is never rewritten by a later change of the contract template.
 *
 * organization_id is set by code from the contract, never from request input.
 *
 * Deliberately not audited and not in Filament: it holds contract money that only Owner, Admin and the
 * account managers of the client may read.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $contract_id
 * @property CarbonImmutable $starts_on
 * @property CarbonImmutable $ends_on
 * @property int $amount_cents
 * @property int $budget_seconds
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read ProjectContract $contract
 * @property-read Collection<int, ContractPeriodMonth> $months
 */
class ContractPeriod extends Model
{
    use HasUuids;

    /**
     * @var string
     */
    protected $table = 'contract_periods';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'contract_id',
        'starts_on',
        'ends_on',
        'amount_cents',
        'budget_seconds',
    ];

    /**
     * The attributes that should be cast.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'starts_on' => 'immutable_date',
        'ends_on' => 'immutable_date',
        'amount_cents' => 'integer',
        'budget_seconds' => 'integer',
    ];

    /**
     * @return BelongsTo<ProjectContract, $this>
     */
    public function contract(): BelongsTo
    {
        return $this->belongsTo(ProjectContract::class, 'contract_id');
    }

    /**
     * The planned hours of each month of the period, in month order (D-02).
     *
     * @return HasMany<ContractPeriodMonth, $this>
     */
    public function months(): HasMany
    {
        return $this->hasMany(ContractPeriodMonth::class, 'period_id')->orderBy('month');
    }

    /**
     * current while $today (a local date in the profitability timezone) is inside the period, upcoming
     * before it, closed after it (D-03). One of the PeriodCalendar::STATE_* values.
     */
    public function stateOn(CarbonImmutable $today): string
    {
        return (new PeriodCalendar)->stateOn($this->starts_on, $this->ends_on, $today);
    }
}
