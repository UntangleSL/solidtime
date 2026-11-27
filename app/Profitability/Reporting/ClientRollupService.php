<?php

declare(strict_types=1);

namespace App\Profitability\Reporting;

use App\Models\Organization;
use App\Models\Project;
use App\Profitability\Access\AccessScope;
use App\Profitability\Models\ContractPeriod;
use App\Profitability\Models\ContractPeriodMonth;
use App\Profitability\Models\ProjectContract;
use App\Profitability\Periods\PeriodBounds;
use App\Profitability\Periods\PeriodCalendar;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * The by-client view of the Profitability page (BUDG-06, D-07, D-11): per client, the hours and money
 * sold, the hours consumed, the cost and the margin of its contract projects over a calendar-aligned
 * range, with each project as a nested row.
 *
 * Scope: Owner/Admin get every contract project, client-less ones in a "No client" bucket (client_id
 * null) listed last; an account manager the contract projects of their clients only. Every listed project
 * is one the caller has money for. Only client and project aggregates leave this class, never a cost per
 * person or per entry.
 *
 * Figures of a project in the range:
 * - hours_sold_seconds: the planned hours (D-02) of the range months, from the plan rows of the periods
 *   overlapping the range.
 * - amount_cents: the straight-line monthly share (D-19) of each overlapping period's amount for the
 *   period months inside the range: floor(amount / months) per month, the remainder cents on the period's
 *   last month (the same rule as the project summary's revenue to date).
 * - consumed_seconds, cost_cents, unpriced_cost_seconds: all work time of the project from the range start
 *   up to today (ReportRange::cappedTo), valued at the hourly cost in force on each entry's date (D-08);
 *   hours without a cost are reported, never valued at 0 (ConsumptionQuery::byProjectMonth).
 * - margin_cents = amount - cost; margin_percent = margin / amount x 100 (unrounded), null when the amount
 *   is 0.
 * - status: the status of the period the project is shown with in the Projects view (ProjectBalanceService).
 *
 * A project is listed when one of its periods overlaps the range or it has time in it; a client when it
 * has at least one listed project. Clients carry the sums, project_count and the worst project status.
 */
class ClientRollupService
{
    /** How bad a project status is, for the worst status of a client (higher is worse). */
    private const array STATUS_SEVERITY = [
        Projection::STATUS_CLOSED => 1,
        Projection::STATUS_NOT_STARTED => 2,
        Projection::STATUS_ON_TRACK => 3,
        Projection::STATUS_AT_RISK => 4,
        Projection::STATUS_OVER => 5,
    ];

    public function __construct(
        private readonly ConsumptionQuery $consumption,
        private readonly PeriodCalendar $calendar,
        private readonly ProjectBalanceService $balance,
    ) {}

    /**
     * The contracts of the projects whose client figures the caller may read, with project and client
     * loaded: every contract for Owner/Admin, the contracts of their clients' projects for an account
     * manager, none otherwise.
     *
     * @return Collection<int, ProjectContract>
     */
    public function contractsInScope(Organization $organization, AccessScope $scope): Collection
    {
        if (! $scope->isFull() && $scope->accountClientIds() === []) {
            return collect();
        }

        $query = ProjectContract::query()
            ->where('organization_id', '=', $organization->getKey())
            ->with('project.client');
        if (! $scope->isFull()) {
            $query->whereHas('project', function (Builder $query) use ($scope): void {
                $query->whereIn('client_id', $scope->accountClientIds());
            });
        }

        return $query->get()
            ->filter(fn (ProjectContract $contract): bool => $contract->project->organization_id === $organization->getKey()
                && $scope->hasMoneyFor($contract->project))
            ->values();
    }

    /**
     * @return array{
     *     clients: list<array<string, mixed>>,
     *     totals: array{hours_sold_seconds: int, consumed_seconds: int, amount_cents: int, cost_cents: int, margin_cents: int, margin_percent: float|null, unpriced_cost_seconds: int}
     * }
     */
    public function forRange(Organization $organization, AccessScope $scope, ReportRange $range, CarbonImmutable $now): array
    {
        $today = $now->setTimezone($this->consumption->timezone())->startOfDay();
        $contracts = $this->contractsInScope($organization, $scope);

        /** @var Collection<string, Collection<int, ContractPeriod>> $periods */
        $periods = ContractPeriod::query()
            ->whereIn('contract_id', $contracts->map(fn (ProjectContract $contract): string => $contract->getKey())->values()->all())
            ->orderByDesc('starts_on')
            ->get()
            ->groupBy('contract_id');

        $from = $range->from->format('Y-m-d');
        $to = $range->to->format('Y-m-d');
        $rangeMonths = array_map(fn (CarbonImmutable $month): string => $month->format('Y-m-d'), $range->months());

        $overlapping = [];
        foreach ($periods as $contractPeriods) {
            foreach ($contractPeriods as $period) {
                if ($period->starts_on->format('Y-m-d') <= $to && $period->ends_on->format('Y-m-d') >= $from) {
                    $overlapping[$period->getKey()] = $period;
                }
            }
        }
        $planned = $this->plannedSeconds(array_keys($overlapping), $from, $to);
        $consumed = $this->consumption->byProjectMonth(
            $organization->getKey(),
            array_values($contracts->map(fn (ProjectContract $contract): string => $contract->project_id)->unique()->all()),
            $range->from,
            $range->cappedTo,
            $now,
        );

        /** @var array<string, array{client_id: string|null, name: string|null, projects: list<array<string, mixed>>}> $clients */
        $clients = [];
        foreach ($contracts as $contract) {
            $project = $contract->project;
            /** @var Collection<int, ContractPeriod> $contractPeriods */
            $contractPeriods = $periods->get($contract->getKey()) ?? collect();
            $inRange = $contractPeriods->filter(fn (ContractPeriod $period): bool => isset($overlapping[$period->getKey()]));
            $usage = $consumed[$project->getKey()] ?? [];
            if ($inRange->isEmpty() && $usage === []) {
                continue;
            }

            $row = $this->projectRow($project, $contract, $contractPeriods, $inRange, $rangeMonths, $planned, $usage, $scope, $today, $now);
            $key = $project->client_id ?? '';
            $clients[$key] ??= [
                'client_id' => $project->client_id,
                'name' => $project->client?->name,
                'projects' => [],
            ];
            $clients[$key]['projects'][] = $row;
        }

        $rows = array_map(fn (array $client): array => $this->clientRow($client), array_values($clients));
        usort($rows, function (array $a, array $b): int {
            // The "No client" bucket is always last
            if (($a['client_id'] === null) !== ($b['client_id'] === null)) {
                return $a['client_id'] === null ? 1 : -1;
            }

            return $this->compareNames($a['name'], $a['client_id'], $b['name'], $b['client_id']);
        });

        return [
            'clients' => $rows,
            'totals' => $this->sums($rows),
        ];
    }

    /**
     * @param  Collection<int, ContractPeriod>  $contractPeriods  every period of the contract, newest first
     * @param  Collection<int, ContractPeriod>  $inRange  the periods overlapping the range
     * @param  list<string>  $rangeMonths
     * @param  array<string, int>  $planned  planned seconds of the range months per period id
     * @param  array<string, array{seconds: int, cost_cents: int, unpriced_seconds: int}>  $usage  per month
     * @return array<string, mixed>
     */
    private function projectRow(
        Project $project,
        ProjectContract $contract,
        Collection $contractPeriods,
        Collection $inRange,
        array $rangeMonths,
        array $planned,
        array $usage,
        AccessScope $scope,
        CarbonImmutable $today,
        CarbonImmutable $now,
    ): array {
        $hoursSold = 0;
        $amount = 0;
        foreach ($inRange as $period) {
            $hoursSold += $planned[$period->getKey()] ?? 0;
            $amount += $this->amountInRange($period, $rangeMonths);
        }
        $consumedSeconds = 0;
        $cost = 0;
        $unpriced = 0;
        foreach ($usage as $month) {
            $consumedSeconds += $month['seconds'];
            $cost += $month['cost_cents'];
            $unpriced += $month['unpriced_seconds'];
        }

        $status = null;
        $shown = $this->balance->defaultPeriod($contractPeriods, $today);
        if ($shown !== null) {
            $value = $this->balance->periodBalance($project, $contract, $shown, $scope, $today, $now)['status'] ?? null;
            $status = is_string($value) ? $value : null;
        }

        return [
            'project_id' => $project->getKey(),
            'name' => $project->name,
            'color' => $project->color,
            'client_id' => $project->client_id,
            'archived' => $project->archived_at !== null,
            'hours_sold_seconds' => $hoursSold,
            'consumed_seconds' => $consumedSeconds,
            'amount_cents' => $amount,
            'cost_cents' => $cost,
            'margin_cents' => $amount - $cost,
            'margin_percent' => $this->marginPercent($amount, $amount - $cost),
            'unpriced_cost_seconds' => $unpriced,
            'status' => $status,
        ];
    }

    /**
     * @param  array{client_id: string|null, name: string|null, projects: list<array<string, mixed>>}  $client
     * @return array<string, mixed>
     */
    private function clientRow(array $client): array
    {
        $projects = $client['projects'];
        usort($projects, fn (array $a, array $b): int => $this->compareNames($a['name'], $a['project_id'], $b['name'], $b['project_id']));

        $worst = null;
        foreach ($projects as $project) {
            $status = $project['status'];
            if (is_string($status) && ($worst === null || (self::STATUS_SEVERITY[$status] ?? 0) > (self::STATUS_SEVERITY[$worst] ?? 0))) {
                $worst = $status;
            }
        }
        $sums = $this->sums($projects);

        return [
            'client_id' => $client['client_id'],
            'name' => $client['name'],
            'project_count' => count($projects),
            'hours_sold_seconds' => $sums['hours_sold_seconds'],
            'consumed_seconds' => $sums['consumed_seconds'],
            'amount_cents' => $sums['amount_cents'],
            'cost_cents' => $sums['cost_cents'],
            'margin_cents' => $sums['margin_cents'],
            'margin_percent' => $sums['margin_percent'],
            'unpriced_cost_seconds' => $sums['unpriced_cost_seconds'],
            'status' => $worst,
            'projects' => $projects,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return array{hours_sold_seconds: int, consumed_seconds: int, amount_cents: int, cost_cents: int, margin_cents: int, margin_percent: float|null, unpriced_cost_seconds: int}
     */
    private function sums(array $rows): array
    {
        $sums = [
            'hours_sold_seconds' => 0,
            'consumed_seconds' => 0,
            'amount_cents' => 0,
            'cost_cents' => 0,
            'unpriced_cost_seconds' => 0,
        ];
        foreach ($rows as $row) {
            foreach (array_keys($sums) as $key) {
                $value = $row[$key] ?? 0;
                $sums[$key] += is_int($value) ? $value : 0;
            }
        }
        $margin = $sums['amount_cents'] - $sums['cost_cents'];

        return [
            'hours_sold_seconds' => $sums['hours_sold_seconds'],
            'consumed_seconds' => $sums['consumed_seconds'],
            'amount_cents' => $sums['amount_cents'],
            'cost_cents' => $sums['cost_cents'],
            'margin_cents' => $margin,
            'margin_percent' => $this->marginPercent($sums['amount_cents'], $margin),
            'unpriced_cost_seconds' => $sums['unpriced_cost_seconds'],
        ];
    }

    /**
     * The straight-line share (D-19) of the period amount for the period months inside the range: each
     * month but the last earns floor(amount / months), the last one the remainder, so the months of a
     * period always add up to its amount.
     *
     * @param  list<string>  $rangeMonths  first days (Y-m-d) of the range months
     */
    private function amountInRange(ContractPeriod $period, array $rangeMonths): int
    {
        $months = $this->calendar->months(new PeriodBounds($period->starts_on, $period->ends_on, false));
        $count = count($months);
        if ($count === 0) {
            return 0;
        }

        $share = intdiv($period->amount_cents, $count);
        $amount = 0;
        foreach ($months as $index => $month) {
            if (! in_array($month->format('Y-m-d'), $rangeMonths, true)) {
                continue;
            }
            $amount += $index === $count - 1 ? $period->amount_cents - $share * ($count - 1) : $share;
        }

        return $amount;
    }

    /**
     * Planned seconds of the months between $from and $to (both Y-m-d, inclusive) per period id.
     *
     * @param  list<string>  $periodIds
     * @return array<string, int>
     */
    private function plannedSeconds(array $periodIds, string $from, string $to): array
    {
        if ($periodIds === []) {
            return [];
        }

        $planned = [];
        $rows = ContractPeriodMonth::query()
            ->whereIn('period_id', $periodIds)
            ->where('month', '>=', $from)
            ->where('month', '<=', $to)
            ->get();
        foreach ($rows as $row) {
            $planned[$row->period_id] = ($planned[$row->period_id] ?? 0) + $row->planned_seconds;
        }

        return $planned;
    }

    private function marginPercent(int $amount, int $margin): ?float
    {
        return $amount === 0 ? null : (float) $margin / $amount * 100;
    }

    private function compareNames(mixed $nameA, mixed $idA, mixed $nameB, mixed $idB): int
    {
        $byName = strnatcasecmp(is_string($nameA) ? $nameA : '', is_string($nameB) ? $nameB : '');

        return $byName !== 0 ? $byName : strcmp(is_string($idA) ? $idA : '', is_string($idB) ? $idB : '');
    }
}
