<?php

declare(strict_types=1);

namespace App\Profitability\Http\Controllers;

use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Profitability\Access\ProfitabilityAccess;
use App\Profitability\Models\ContractPeriod;
use App\Profitability\Models\ProjectContract;
use App\Profitability\Periods\PeriodMaterializer;
use App\Profitability\Reporting\ConsumptionQuery;
use App\Profitability\Reporting\ProjectBalanceService;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * The profitability summary of one project for the project page (BUDG-03, D-14): its contract terms,
 * every period of the contract newest first with its state (current, upcoming, closed), and the balance
 * of one period: hours sold and consumed, its months planned and consumed (BUDG-04, D-03), and for scopes
 * with money the amount, cost and margin (BUDG-05, BUDG-06). Reading materializes the periods the
 * contract needs up to today and the next one (BUDG-02, D-04).
 *
 * ?period=<uuid> selects a period of this project's contract; any other value (another contract's
 * period, an unknown or malformed id) is a 404. Without it the period shown is the current one, else
 * the latest one that has started, else the first upcoming one.
 *
 * The scope is resolved before any data is read. A project of another organization, an unknown id, a
 * project outside the caller's scope and a non-billable project without contract terms are all the same
 * plain 404: no oracle for what exists (D-11, D-16).
 *
 * The period block is built by ProjectBalanceService, which merges the money keys only for scopes with
 * money (Owner, Admin, account managers of the client); a project manager gets no money key at all.
 */
class ProjectSummaryController extends Controller
{
    public function __construct(
        private readonly ProfitabilityAccess $access,
        private readonly ConsumptionQuery $consumption,
        private readonly PeriodMaterializer $materializer,
        private readonly ProjectBalanceService $balance,
    ) {}

    public function show(Request $request, Organization $organization, string $project): JsonResponse
    {
        $user = $request->user();
        assert($user instanceof User);

        $scope = $this->access->forUser($organization, $user);
        if (! $scope->hasAnyAccess()) {
            throw (new ModelNotFoundException)->setModel(Project::class, [$project]);
        }

        /** @var Project $model */
        $model = Project::query()
            ->whereBelongsTo($organization, 'organization')
            ->whereKey($project)
            ->firstOrFail();
        if (! $scope->canViewProject($model)) {
            throw (new ModelNotFoundException)->setModel(Project::class, [$project]);
        }

        /** @var ProjectContract|null $contract */
        $contract = ProjectContract::query()
            ->where('organization_id', '=', $organization->getKey())
            ->where('project_id', '=', $model->getKey())
            ->first();
        if ($contract === null && ! $model->is_billable) {
            throw (new ModelNotFoundException)->setModel(Project::class, [$project]);
        }

        $now = now()->toImmutable();
        $localToday = $now->setTimezone($this->consumption->timezone())->startOfDay();
        if ($contract !== null) {
            $this->materializer->ensureThrough($contract, $localToday);
        }

        $requested = $request->query('period');
        if ($requested !== null && (! is_string($requested) || ! Str::isUuid($requested) || $contract === null)) {
            throw (new ModelNotFoundException)->setModel(ContractPeriod::class, [is_string($requested) ? $requested : '']);
        }

        /** @var Collection<int, ContractPeriod> $periods */
        $periods = $contract === null ? collect() : ContractPeriod::query()
            ->where('contract_id', '=', $contract->getKey())
            ->orderByDesc('starts_on')
            ->get();

        $period = is_string($requested)
            ? $periods->first(fn (ContractPeriod $candidate): bool => $candidate->getKey() === $requested)
            : $this->balance->defaultPeriod($periods, $localToday);
        if (is_string($requested) && $period === null) {
            throw (new ModelNotFoundException)->setModel(ContractPeriod::class, [$requested]);
        }

        return new JsonResponse([
            'data' => [
                'project_id' => $model->getKey(),
                'can_edit_terms' => $scope->canEditTerms($model),
                'can_edit_plan' => $scope->canEditPlan($model),
                'contract' => $contract === null ? null : [
                    'service' => $contract->service,
                    'schedule' => $contract->schedule->value,
                    'starts_on' => $contract->starts_on->format('Y-m-d'),
                    'ends_on' => $contract->ends_on?->format('Y-m-d'),
                    'archived' => $model->archived_at !== null,
                ],
                'periods' => $periods
                    ->map(fn (ContractPeriod $item): array => [
                        'id' => $item->getKey(),
                        'starts_on' => $item->starts_on->format('Y-m-d'),
                        'ends_on' => $item->ends_on->format('Y-m-d'),
                        'state' => $item->stateOn($localToday),
                    ])
                    ->values()
                    ->all(),
                'period' => $period === null || $contract === null
                    ? null
                    : $this->balance->periodBalance($model, $contract, $period, $scope, $localToday, $now),
            ],
        ]);
    }
}
