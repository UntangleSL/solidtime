<?php

declare(strict_types=1);

namespace App\Profitability\Http\Controllers;

use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Profitability\Access\AccessScope;
use App\Profitability\Access\ProfitabilityAccess;
use App\Profitability\Models\ContractPeriod;
use App\Profitability\Models\ProjectContract;
use App\Profitability\Periods\PeriodCalendar;
use App\Profitability\Periods\PeriodMaterializer;
use App\Profitability\Reporting\ConsumptionQuery;
use App\Profitability\Reporting\ProjectBalanceService;
use App\Profitability\TimeEntries\LegacyNonBillableQuery;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Collection;

/**
 * The by-project view of the Profitability page (D-14): one row per project in the caller's scope with
 * its period, hours, projection, status and edit flags, and money only on the rows the caller has money
 * for (D-11). Rows come from ProjectBalanceService::projectRow, the same figures as the project summary.
 *
 * Scope (D-11, D-16): Owner/Admin get every billable project and every project with contract terms; an
 * account manager the projects of their clients; a project manager the projects they manage; a mixed
 * scope the union. Anyone without access gets the same plain 404 as an unknown organization.
 *
 * ?contract= filter (UI-SPEC toolbar), unknown values fall back to active:
 * - active (default): not archived, and the contract has a current period;
 * - without: billable, not archived, no contract terms, and the caller may set terms on it;
 * - ended: contract terms whose project is archived, or whose end date passed with no current or upcoming
 *   period left;
 * - all: every project in scope.
 *
 * meta: total_rows, money_rows (rows carrying money keys) and, for Owner/Admin only, the legacy
 * non-billable work seconds of the organization behind the data-quality notice (D-05).
 *
 * Each contract is materialized before it is read, and each row runs its own balance queries; at
 * Untangle's scale (tens of projects) that is acceptable, and the read throttle bounds the cost.
 */
class ProjectsViewController extends Controller
{
    public const string FILTER_ACTIVE = 'active';

    public const string FILTER_WITHOUT = 'without';

    public const string FILTER_ENDED = 'ended';

    public const string FILTER_ALL = 'all';

    public function __construct(
        private readonly ProfitabilityAccess $access,
        private readonly ConsumptionQuery $consumption,
        private readonly PeriodMaterializer $materializer,
        private readonly ProjectBalanceService $balance,
        private readonly LegacyNonBillableQuery $legacy,
    ) {}

    public function index(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        assert($user instanceof User);
        $scope = $this->access->forUser($organization, $user);
        if (! $scope->hasAnyAccess()) {
            throw (new ModelNotFoundException)->setModel(Organization::class);
        }

        $now = now()->toImmutable();
        $today = $now->setTimezone($this->consumption->timezone())->startOfDay();
        $filter = $this->filter($request->query('contract'));

        $projects = $this->projectsInScope($organization, $scope);
        /** @var Collection<string, ProjectContract> $contracts */
        $contracts = ProjectContract::query()
            ->where('organization_id', '=', $organization->getKey())
            ->whereIn('project_id', $projects->map(fn (Project $project): string => $project->getKey())->values()->all())
            ->get()
            ->keyBy('project_id');
        foreach ($contracts as $contract) {
            $this->materializer->ensureThrough($contract, $today);
        }
        /** @var Collection<string, Collection<int, ContractPeriod>> $periods */
        $periods = ContractPeriod::query()
            ->whereIn('contract_id', $contracts->map(fn (ProjectContract $contract): string => $contract->getKey())->values()->all())
            ->orderByDesc('starts_on')
            ->get()
            ->groupBy('contract_id');

        $rows = [];
        foreach ($projects as $project) {
            $contract = $contracts->get($project->getKey());
            /** @var Collection<int, ContractPeriod> $contractPeriods */
            $contractPeriods = $contract === null ? collect() : ($periods->get($contract->getKey()) ?? collect());
            if (! $this->matches($filter, $project, $contract, $contractPeriods, $scope, $today)) {
                continue;
            }
            $rows[] = $this->balance->projectRow($project, $contract, $scope, $today, $now, $contractPeriods);
        }

        $meta = [
            'total_rows' => count($rows),
            'money_rows' => count(array_filter($rows, fn (array $row): bool => array_key_exists('amount_cents', $row))),
        ];
        if ($scope->isFull()) {
            $meta['nonbillable_legacy_seconds'] = $this->legacy->secondsFor($organization->getKey(), null, $now);
        }

        return new JsonResponse([
            'data' => $rows,
            'meta' => $meta,
        ]);
    }

    private function filter(mixed $value): string
    {
        $allowed = [self::FILTER_ACTIVE, self::FILTER_WITHOUT, self::FILTER_ENDED, self::FILTER_ALL];

        return is_string($value) && in_array($value, $allowed, true) ? $value : self::FILTER_ACTIVE;
    }

    /**
     * Projects of the organization that may carry contract terms (billable, or already under contract),
     * restricted to the caller's scope and sorted by name.
     *
     * @return Collection<int, Project>
     */
    private function projectsInScope(Organization $organization, AccessScope $scope): Collection
    {
        $contractProjectIds = ProjectContract::query()
            ->where('organization_id', '=', $organization->getKey())
            ->pluck('project_id')
            ->all();

        $query = Project::query()
            ->whereBelongsTo($organization, 'organization')
            ->with('client')
            ->where(function (Builder $query) use ($contractProjectIds): void {
                $query->where('is_billable', '=', true)
                    ->orWhereIn('id', $contractProjectIds);
            });
        if (! $scope->isFull()) {
            $query->where(function (Builder $query) use ($scope): void {
                $query->whereIn('id', $scope->managedProjectIds())
                    ->orWhereIn('client_id', $scope->accountClientIds());
            });
        }

        return $query->get()
            ->filter(fn (Project $project): bool => $scope->canViewProject($project))
            ->sort(function (Project $a, Project $b): int {
                $byName = strnatcasecmp($a->name, $b->name);

                return $byName !== 0 ? $byName : strcmp($a->getKey(), $b->getKey());
            })
            ->values();
    }

    /**
     * @param  Collection<int, ContractPeriod>  $periods
     */
    private function matches(string $filter, Project $project, ?ProjectContract $contract, Collection $periods, AccessScope $scope, CarbonImmutable $today): bool
    {
        $archived = $project->archived_at !== null;
        if ($filter === self::FILTER_ALL) {
            return true;
        }
        if ($filter === self::FILTER_WITHOUT) {
            return $contract === null && $project->is_billable && ! $archived && $scope->canEditTerms($project);
        }
        if ($contract === null) {
            return false;
        }

        $hasCurrent = $periods->contains(fn (ContractPeriod $period): bool => $period->stateOn($today) === PeriodCalendar::STATE_CURRENT);
        if ($filter === self::FILTER_ACTIVE) {
            return ! $archived && $hasCurrent;
        }

        $hasUpcoming = $periods->contains(fn (ContractPeriod $period): bool => $period->stateOn($today) === PeriodCalendar::STATE_UPCOMING);
        $endPassed = $contract->ends_on !== null && $contract->ends_on->format('Y-m-d') < $today->format('Y-m-d');

        return $archived || ($endPassed && ! $hasCurrent && ! $hasUpcoming);
    }
}
