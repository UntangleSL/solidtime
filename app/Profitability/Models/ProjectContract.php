<?php

declare(strict_types=1);

namespace App\Profitability\Models;

use App\Models\Concerns\HasUuids;
use App\Models\Project;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * The contract terms of one billable project (D-01: the contract is the project, one per project): what
 * was sold per period in hours and money, and on which schedule it renews. The amounts are the template
 * of every period; each period carries its own copy (D-03, D-04).
 *
 * organization_id is set by code from the route organization, never from request input.
 *
 * Deliberately not audited and not in Filament: it holds contract money that only Owner, Admin and the
 * account managers of the client may read.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $project_id
 * @property string|null $service
 * @property string $schedule
 * @property CarbonImmutable $starts_on
 * @property CarbonImmutable|null $ends_on
 * @property int $amount_cents
 * @property int $budget_seconds
 * @property CarbonImmutable|null $paused_on
 * @property CarbonImmutable|null $resume_on
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Project $project
 * @property-read Collection<int, ContractPeriod> $periods
 */
class ProjectContract extends Model
{
    use HasUuids;

    /**
     * @var string
     */
    protected $table = 'project_contracts';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'project_id',
        'service',
        'schedule',
        'starts_on',
        'ends_on',
        'amount_cents',
        'budget_seconds',
        'paused_on',
        'resume_on',
    ];

    /**
     * The attributes that should be cast.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'starts_on' => 'immutable_date',
        'ends_on' => 'immutable_date',
        'paused_on' => 'immutable_date',
        'resume_on' => 'immutable_date',
        'amount_cents' => 'integer',
        'budget_seconds' => 'integer',
    ];

    /**
     * @return BelongsTo<Project, $this>
     */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class, 'project_id');
    }

    /**
     * @return HasMany<ContractPeriod, $this>
     */
    public function periods(): HasMany
    {
        return $this->hasMany(ContractPeriod::class, 'contract_id')->orderBy('starts_on');
    }
}
