<?php

declare(strict_types=1);

namespace App\Profitability\Reporting;

use App\Models\Project;
use App\Profitability\Access\AccessScope;
use App\Profitability\Models\ContractPeriod;
use App\Profitability\Models\ContractPeriodMonth;
use App\Profitability\Models\ProjectContract;
use App\Profitability\Periods\PeriodBounds;
use App\Profitability\Periods\PeriodCalendar;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;

/**
 * The balance of one contract period, shared by the project summary and the Profitability views so both
 * always show the same figures (BUDG-04, BUDG-05, BUDG-06).
 *
 * Hours part (every scope that may view the project): the period, hours sold and consumed, the
 * projection to the period close (still_to_consume_seconds, remaining_plan_seconds, run_rate_seconds and
 * status, see Projection, D-02) and the months with their planned and consumed hours.
 *
 * Money part (D-07, D-09, D-11, D-19), merged only when AccessScope::hasMoneyFor() allows it (Owner,
 * Admin, account managers of the client). Without money the cost is not even queried and no money key
 * exists in the array: money is hidden by absence, never by a null value.
 * - amount_cents: the money sold for the period (integer cents in the organization currency, D-09).
 * - revenue_to_date_cents: the amount spread evenly over the months of the period, remainder cents to the
 *   last month (D-19), for the months started up to and including the current one; the whole amount once
 *   the period is closed, nothing before it starts.
 * - cost_cents: cost to date from the dated hourly cost of each person (D-08, ConsumptionQuery).
 * - margin_cents: revenue to date minus cost to date; the period margin (amount minus cost) is the
 *   headline figure once the period is closed.
 * - projected_cost_cents / projected_margin_cents: the cost at close if the plan is followed, at the
 *   average cost of the priced hours so far, and the amount minus it; null while nothing is priced.
 * - unpriced_cost_seconds: hours of people without an hourly cost on the entry date, which the cost
 *   leaves out (shown as "Incomplete", never as free time).
 */
class ProjectBalanceService
{
    public function __construct(
        private readonly ConsumptionQuery $consumption,
        private readonly PeriodCalendar $calendar,
        private readonly Projection $projection,
    ) {}

    /**
     * The period block of the project summary: hours, projection and months for every scope that may
     * view the project, plus the money part for scopes with money.
     *
     * @return array<string, mixed>
     */
    public function periodBalance(
        Project $project,
        ProjectContract $contract,
        ContractPeriod $period,
        AccessScope $scope,
        CarbonImmutable $today,
        CarbonImmutable $now,
    ): array {
        $withMoney = $scope->hasMoneyFor($project);
        $totals = $this->consumption->periodTotals(
            $contract->organization_id,
            $project->getKey(),
            $period->starts_on,
            $period->ends_on,
            $now,
            $withMoney,
        );
        $state = $period->stateOn($today);
        $months = $this->months($contract->organization_id, $project, $period, $now);
        $projection = $this->projection->forPeriod(
            $period->budget_seconds,
            $months,
            $period->starts_on,
            $period->ends_on,
            $today,
            $this->atRiskThreshold(),
            $this->runRateMinWeekdays(),
            $totals['cost_cents'],
            $totals['priced_seconds'],
        );

        $balance = [
            'id' => $period->getKey(),
            'starts_on' => $period->starts_on->format('Y-m-d'),
            'ends_on' => $period->ends_on->format('Y-m-d'),
            'state' => $state,
            'budget_seconds' => $period->budget_seconds,
            'consumed_seconds' => $totals['seconds'],
            'still_to_consume_seconds' => $projection->stillToConsumeSeconds,
            'remaining_plan_seconds' => $projection->remainingPlanSeconds,
            'run_rate_seconds' => $projection->runRateSeconds,
            'status' => $projection->status,
            'months' => $months,
        ];

        if (! $withMoney) {
            return $balance;
        }

        return $balance + $this->money($period, $state, $months, $today, $totals, $projection);
    }

    /**
     * The period a project is shown with: the current one, else the latest one that has started (the
     * contract ended or is paused), else the first upcoming one (the contract has not started yet).
     *
     * @param  Collection<int, ContractPeriod>  $periods  newest first
     */
    public function defaultPeriod(Collection $periods, CarbonImmutable $today): ?ContractPeriod
    {
        $started = $periods->filter(
            fn (ContractPeriod $item): bool => $item->stateOn($today) !== PeriodCalendar::STATE_UPCOMING
        );

        return $started->first(fn (ContractPeriod $item): bool => $item->stateOn($today) === PeriodCalendar::STATE_CURRENT)
            ?? $started->first()
            ?? $periods->last();
    }

    /**
     * The money part of a period (only ever called for a scope with money).
     *
     * @param  list<array{month: string, planned_seconds: int, consumed_seconds: int}>  $months
     * @param  array{seconds: int, billable_seconds: int, cost_cents: int|null, priced_seconds: int|null, unpriced_seconds: int|null}  $totals
     * @return array<string, int|null>
     */
    private function money(ContractPeriod $period, string $state, array $months, CarbonImmutable $today, array $totals, ProjectionResult $projection): array
    {
        $amount = $period->amount_cents;
        $cost = $totals['cost_cents'] ?? 0;
        $revenue = $this->revenueToDate($amount, $state, $months, $today);
        $projectedCost = $projection->projectedCostCents;

        return [
            'amount_cents' => $amount,
            'revenue_to_date_cents' => $revenue,
            'cost_cents' => $cost,
            'margin_cents' => $revenue - $cost,
            // Unknown (not hidden) while no consumed hour has a cost: the scope has money, the data has none
            'projected_cost_cents' => $projectedCost,
            'projected_margin_cents' => $projectedCost === null ? $projectedCost : $amount - $projectedCost,
            'unpriced_cost_seconds' => $totals['unpriced_seconds'] ?? 0,
        ];
    }

    private function atRiskThreshold(): float
    {
        $value = config('profitability.at_risk_threshold', 1.10);

        return is_numeric($value) ? (float) $value : 1.10;
    }

    private function runRateMinWeekdays(): int
    {
        $value = config('profitability.run_rate_min_weekdays', 5);

        return is_numeric($value) ? (int) $value : 5;
    }

    /**
     * Straight-line revenue (D-19): each month but the last earns floor(amount / months), the last one the
     * remainder, so the months always add up to the amount.
     *
     * @param  list<array{month: string, planned_seconds: int, consumed_seconds: int}>  $months
     */
    private function revenueToDate(int $amount, string $state, array $months, CarbonImmutable $today): int
    {
        if ($state === PeriodCalendar::STATE_UPCOMING) {
            return 0;
        }
        if ($state === PeriodCalendar::STATE_CLOSED) {
            return $amount;
        }
        $count = count($months);
        if ($count === 0) {
            return 0;
        }

        $todayMonth = $today->format('Y-m-01');
        $started = count(array_filter($months, fn (array $month): bool => $month['month'] <= $todayMonth));
        if ($started >= $count) {
            return $amount;
        }

        return intdiv($amount, $count) * $started;
    }

    /**
     * Every month of the period with its planned hours (0 when it has no plan row) and the hours consumed
     * in it (0 for a month without time).
     *
     * @return list<array{month: string, planned_seconds: int, consumed_seconds: int}>
     */
    private function months(string $organizationId, Project $project, ContractPeriod $period, CarbonImmutable $now): array
    {
        $planned = [];
        $rows = ContractPeriodMonth::query()
            ->where('period_id', '=', $period->getKey())
            ->get();
        foreach ($rows as $row) {
            $planned[$row->month->format('Y-m-d')] = $row->planned_seconds;
        }
        $consumed = $this->consumption->secondsByMonth(
            $organizationId,
            $project->getKey(),
            $period->starts_on,
            $period->ends_on,
            $now,
        );

        $months = [];
        foreach ($this->calendar->months(new PeriodBounds($period->starts_on, $period->ends_on, false)) as $month) {
            $key = $month->format('Y-m-d');
            $months[] = [
                'month' => $key,
                'planned_seconds' => $planned[$key] ?? 0,
                'consumed_seconds' => $consumed[$key] ?? 0,
            ];
        }

        return $months;
    }
}
