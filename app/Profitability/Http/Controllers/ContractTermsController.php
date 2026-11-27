<?php

declare(strict_types=1);

namespace App\Profitability\Http\Controllers;

use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Profitability\Access\ProfitabilityAccess;
use App\Profitability\Http\Requests\ContractTermsRequest;
use App\Profitability\Models\ContractPeriod;
use App\Profitability\Models\ContractPeriodMonth;
use App\Profitability\Models\ProjectContract;
use App\Profitability\Periods\PeriodCalendar;
use App\Profitability\Periods\PeriodMaterializer;
use App\Profitability\Periods\PlanDistributor;
use App\Profitability\Reporting\ConsumptionQuery;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Response;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Writes the contract terms of one project (BUDG-01, D-01, D-12).
 *
 * Who may write: the account managers of the project's client, Owner and Admin (canEditTerms). Anyone
 * else, a project of another organization and an unknown id get the same plain 404 before the body has
 * any effect (T-08-11). The organization and the project come from the route, never from the body
 * (T-08-15), and only fork tables are written: no column of the core projects table is ever
 * touched, its own estimate included.
 *
 * Only billable projects carry contract terms. Saving terms materializes the periods a read needs
 * (D-04), so the summary shows the current period straight away. Editing a contract that already
 * exists is not available yet and answers 422.
 */
class ContractTermsController extends Controller
{
    public function __construct(
        private readonly ProfitabilityAccess $access,
        private readonly PeriodMaterializer $materializer,
        private readonly ConsumptionQuery $consumption,
        private readonly PeriodCalendar $calendar,
        private readonly PlanDistributor $distributor,
    ) {}

    public function upsert(ContractTermsRequest $request, Organization $organization, string $project): Response
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
        if (! $scope->canEditTerms($model)) {
            throw (new ModelNotFoundException)->setModel(Project::class, [$project]);
        }

        if (! $model->is_billable) {
            throw ValidationException::withMessages([
                'project' => [self::label('profitability.validation.project_not_billable')],
            ]);
        }

        $exists = ProjectContract::query()
            ->where('organization_id', '=', $organization->getKey())
            ->where('project_id', '=', $model->getKey())
            ->exists();
        if ($exists) {
            throw self::scheduleLocked();
        }

        $today = now()->setTimezone($this->consumption->timezone())->toImmutable()->startOfDay();

        try {
            DB::transaction(function () use ($request, $organization, $model, $today): void {
                $contract = new ProjectContract;
                $contract->organization_id = $organization->getKey();
                $contract->project_id = $model->getKey();
                $contract->service = $request->service();
                $contract->schedule = $request->schedule();
                $contract->starts_on = $request->startsOn();
                $contract->ends_on = $request->endsOn();
                $contract->budget_seconds = $request->budgetSeconds();
                $contract->amount_cents = $request->amountCents();
                $contract->save();

                $this->materializer->ensureThrough($contract, $today);
                $this->applyFirstPeriodValues($contract, $request);
            });
        } catch (UniqueConstraintViolationException) {
            // A concurrent request created the terms first
            throw self::scheduleLocked();
        }

        return response()->noContent();
    }

    /**
     * The account manager's own values for a stub first period replace the proration (D-15); its months
     * are split evenly again so they keep summing to the period's hours.
     */
    private function applyFirstPeriodValues(ProjectContract $contract, ContractTermsRequest $request): void
    {
        $budgetSeconds = $request->firstPeriodBudgetSeconds();
        $amountCents = $request->firstPeriodAmountCents();
        if ($budgetSeconds === null && $amountCents === null) {
            return;
        }

        $first = $this->calendar->first($contract->schedule, $contract->starts_on, $contract->ends_on);
        if (! $first->isStub) {
            return;
        }

        /** @var ContractPeriod|null $period */
        $period = ContractPeriod::query()
            ->where('contract_id', '=', $contract->getKey())
            ->where('starts_on', '=', $first->startsOn->format('Y-m-d'))
            ->first();
        if ($period === null) {
            return;
        }

        if ($budgetSeconds !== null) {
            $period->budget_seconds = $budgetSeconds;
        }
        if ($amountCents !== null) {
            $period->amount_cents = $amountCents;
        }
        $period->save();

        $months = ContractPeriodMonth::query()
            ->where('period_id', '=', $period->getKey())
            ->orderBy('month')
            ->get();
        $planned = $this->distributor->evenSplit($period->budget_seconds, $months->count());
        foreach ($months->values() as $index => $month) {
            /** @var ContractPeriodMonth $month */
            $month->planned_seconds = $planned[$index];
            $month->save();
        }
    }

    private static function scheduleLocked(): ValidationException
    {
        return ValidationException::withMessages([
            'schedule' => [self::label('profitability.validation.schedule_locked')],
        ]);
    }

    private static function label(string $key): string
    {
        $value = __($key);

        return is_string($value) ? $value : $key;
    }
}
