<?php

declare(strict_types=1);

namespace App\Profitability\Http\Controllers;

use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Profitability\Access\ProfitabilityAccess;
use App\Profitability\Models\ContractPeriod;
use App\Profitability\Models\ProjectContract;
use App\Profitability\Reporting\ConsumptionQuery;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;

/**
 * The profitability summary of one project for the project page (BUDG-03, D-14): its contract terms
 * and the hours sold and consumed of the current period.
 *
 * The scope is resolved before any data is read. A project of another organization, an unknown id, a
 * project outside the caller's scope and a non-billable project without contract terms are all the same
 * plain 404: no oracle for what exists (D-11, D-16).
 *
 * Hours only: no money key is ever part of this response here; money arrives later, and only for scopes
 * that have money.
 */
class ProjectSummaryController extends Controller
{
    public function __construct(
        private readonly ProfitabilityAccess $access,
        private readonly ConsumptionQuery $consumption,
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
        $today = $now->setTimezone($this->consumption->timezone())->format('Y-m-d');

        /** @var ContractPeriod|null $period */
        $period = $contract === null ? null : ContractPeriod::query()
            ->where('contract_id', '=', $contract->getKey())
            ->where('starts_on', '<=', $today)
            ->where('ends_on', '>=', $today)
            ->orderBy('starts_on')
            ->first();

        return new JsonResponse([
            'data' => [
                'project_id' => $model->getKey(),
                'can_edit_terms' => $scope->canEditTerms($model),
                'can_edit_plan' => $scope->canEditPlan($model),
                'contract' => $contract === null ? null : [
                    'service' => $contract->service,
                    'schedule' => $contract->schedule,
                    'starts_on' => $contract->starts_on->format('Y-m-d'),
                    'ends_on' => $contract->ends_on?->format('Y-m-d'),
                    'archived' => $model->archived_at !== null,
                ],
                'period' => $period === null ? null : [
                    'id' => $period->getKey(),
                    'starts_on' => $period->starts_on->format('Y-m-d'),
                    'ends_on' => $period->ends_on->format('Y-m-d'),
                    'state' => 'current',
                    'budget_seconds' => $period->budget_seconds,
                    'consumed_seconds' => $this->consumption->totalSeconds(
                        $organization->getKey(),
                        $model->getKey(),
                        $period->starts_on,
                        $period->ends_on,
                        $now,
                    ),
                ],
            ],
        ]);
    }
}
