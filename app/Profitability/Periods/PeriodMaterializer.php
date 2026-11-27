<?php

declare(strict_types=1);

namespace App\Profitability\Periods;

use App\Models\Project;
use App\Profitability\Models\ContractPeriod;
use App\Profitability\Models\ContractPeriodMonth;
use App\Profitability\Models\ProjectContract;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Creates the contract periods a read needs, lazily (BUDG-02): correctness never depends on a scheduler.
 *
 * - Every missing period up to the one containing today, plus exactly one after it, so the terms of the
 *   next period can be changed before it starts (D-04).
 * - Each new period starts clean with the contract's template terms (D-03), prorated for a stub (D-15),
 *   and an even monthly plan whose months sum to its hours (D-02).
 * - Nothing is created while the project is archived; no period starts after the end date; after a
 *   pause the next period starts at resume_on (D-18).
 *
 * Insert-only: an existing period or plan month is never updated or deleted. Idempotent and safe under
 * concurrent reads: one transaction holds the contract row locked, and the unique keys
 * (contract_id, starts_on) and (period_id, month) turn any duplicate insert into a no-op.
 */
class PeriodMaterializer
{
    /** Upper bound of periods created by one call (a start decades back cannot create unbounded rows). */
    public const int MAX_NEW_PERIODS = 600;

    public function __construct(
        private readonly PeriodCalendar $calendar,
        private readonly PlanDistributor $distributor,
    ) {}

    /**
     * @param  CarbonImmutable  $today  the local date in the profitability timezone
     */
    public function ensureThrough(ProjectContract $contract, CarbonImmutable $today): void
    {
        DB::transaction(function () use ($contract, $today): void {
            /** @var ProjectContract|null $locked */
            $locked = ProjectContract::query()
                ->whereKey($contract->getKey())
                ->lockForUpdate()
                ->first();
            if ($locked === null) {
                return;
            }

            /** @var Project|null $project */
            $project = Project::query()->whereKey($locked->project_id)->first();
            if ($project === null || $project->archived_at !== null) {
                return;
            }

            $todayDate = $today->format('Y-m-d');

            /** @var ContractPeriod|null $last */
            $last = ContractPeriod::query()
                ->where('contract_id', '=', $locked->getKey())
                ->orderByDesc('starts_on')
                ->first();
            if ($last === null) {
                $bounds = $this->calendar->first($locked->schedule, $locked->starts_on, $locked->ends_on);
                $bounds = $this->insertPeriod($locked, $bounds);
            } else {
                $bounds = new PeriodBounds($last->starts_on, $last->ends_on, false);
            }

            $created = 0;
            while ($bounds->startsOn->format('Y-m-d') <= $todayDate && $created < self::MAX_NEW_PERIODS) {
                $next = $this->calendar->next($locked->schedule, $bounds, $locked->ends_on, $locked->resume_on);
                if ($next === null) {
                    break;
                }
                $bounds = $this->insertPeriod($locked, $next);
                $created++;
            }
        });
    }

    /**
     * Inserts the period with its even plan when it does not exist yet, and returns the bounds of the row
     * that is stored for that start (an existing row keeps its own end date).
     */
    private function insertPeriod(ProjectContract $contract, PeriodBounds $bounds): PeriodBounds
    {
        $budgetSeconds = $bounds->isStub
            ? $this->calendar->prorateSeconds($contract->budget_seconds, $contract->schedule, $bounds->startsOn)
            : $contract->budget_seconds;
        $amountCents = $bounds->isStub
            ? $this->calendar->prorateCents($contract->amount_cents, $contract->schedule, $bounds->startsOn)
            : $contract->amount_cents;

        $now = now();
        $periodId = Str::uuid()->toString();
        $inserted = ContractPeriod::query()->insertOrIgnore([
            'id' => $periodId,
            'organization_id' => $contract->organization_id,
            'contract_id' => $contract->getKey(),
            'starts_on' => $bounds->startsOn->format('Y-m-d'),
            'ends_on' => $bounds->endsOn->format('Y-m-d'),
            'amount_cents' => $amountCents,
            'budget_seconds' => $budgetSeconds,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        if ($inserted === 0) {
            /** @var ContractPeriod|null $existing */
            $existing = ContractPeriod::query()
                ->where('contract_id', '=', $contract->getKey())
                ->where('starts_on', '=', $bounds->startsOn->format('Y-m-d'))
                ->first();

            return $existing === null
                ? $bounds
                : new PeriodBounds($existing->starts_on, $existing->ends_on, $bounds->isStub);
        }

        $months = $this->calendar->months($bounds);
        $planned = $this->distributor->evenSplit($budgetSeconds, count($months));
        $rows = [];
        foreach ($months as $index => $month) {
            $rows[] = [
                'id' => Str::uuid()->toString(),
                'organization_id' => $contract->organization_id,
                'period_id' => $periodId,
                'month' => $month->format('Y-m-d'),
                'planned_seconds' => $planned[$index],
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }
        ContractPeriodMonth::query()->insertOrIgnore($rows);

        return $bounds;
    }
}
