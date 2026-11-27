<?php

declare(strict_types=1);

namespace App\Profitability\Http\Controllers;

use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Profitability\Access\ProfitabilityAccess;
use App\Profitability\Http\Requests\PlanRequest;
use App\Profitability\Models\ContractPeriod;
use App\Profitability\Models\ContractPeriodMonth;
use App\Profitability\Models\ProjectContract;
use App\Profitability\Periods\PeriodCalendar;
use App\Profitability\Periods\PlanDistributor;
use App\Profitability\Reporting\ConsumptionQuery;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Writes the monthly plan of one contract period (BUDG-04, D-02, D-03, D-12).
 *
 * Who may write: the project managers of the project, Owner and Admin (canEditPlan). Anyone else (an
 * account manager who is not also project manager included), a project of another organization, a
 * period of another contract and an unknown id get the same plain 404, checked before the body is
 * validated (T-08-25, T-08-26). The period is looked up only among the periods of the route project's
 * contract, never by id alone.
 *
 * Months may be uneven (the owner front-loads plans), but they must be exactly the period's months and
 * add up exactly to the period's hours: otherwise 422 on `months`, with the hours missing or in excess.
 * A closed period keeps its result (D-03): its plan is never changed (422). Current and upcoming periods
 * may be planned.
 *
 * The write runs in one transaction holding the contract row locked, like the terms editor and the
 * materializer, so a concurrent change of the period's hours can never leave a plan that does not sum.
 */
class PlanController extends Controller
{
    public function __construct(
        private readonly ProfitabilityAccess $access,
        private readonly ConsumptionQuery $consumption,
        private readonly PlanDistributor $distributor,
    ) {}

    public function update(Request $request, Organization $organization, string $project, string $period): Response
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
        if (! $scope->canEditPlan($model)) {
            throw (new ModelNotFoundException)->setModel(Project::class, [$project]);
        }

        /** @var ProjectContract|null $contract */
        $contract = ProjectContract::query()
            ->where('organization_id', '=', $organization->getKey())
            ->where('project_id', '=', $model->getKey())
            ->first();
        if ($contract === null) {
            throw (new ModelNotFoundException)->setModel(ContractPeriod::class, [$period]);
        }
        $periodExists = ContractPeriod::query()
            ->where('contract_id', '=', $contract->getKey())
            ->whereKey($period)
            ->exists();
        if (! $periodExists) {
            throw (new ModelNotFoundException)->setModel(ContractPeriod::class, [$period]);
        }

        // Only now, inside the caller's scope, does the body count (no 422 oracle for outsiders)
        $planned = app(PlanRequest::class)->plannedByMonth();

        $today = now()->setTimezone($this->consumption->timezone())->toImmutable()->startOfDay();

        DB::transaction(function () use ($contract, $period, $planned, $today): void {
            ProjectContract::query()->whereKey($contract->getKey())->lockForUpdate()->first();

            /** @var ContractPeriod $locked */
            $locked = ContractPeriod::query()
                ->where('contract_id', '=', $contract->getKey())
                ->whereKey($period)
                ->firstOrFail();

            if ($locked->stateOn($today) === PeriodCalendar::STATE_CLOSED) {
                throw ValidationException::withMessages([
                    'months' => [self::label('profitability.validation.period_closed')],
                ]);
            }

            $months = ContractPeriodMonth::query()
                ->where('period_id', '=', $locked->getKey())
                ->orderBy('month')
                ->get();
            $stored = array_values($months->map(static fn (ContractPeriodMonth $month): string => $month->month->format('Y-m-d'))->all());
            $sent = array_keys($planned);
            sort($sent);
            if ($stored !== $sent) {
                throw ValidationException::withMessages([
                    'months' => [self::label('validation.in', ['attribute' => 'months'])],
                ]);
            }

            $delta = $this->distributor->delta(array_values($planned), $locked->budget_seconds);
            if ($delta !== 0) {
                throw ValidationException::withMessages([
                    'months' => [self::label('profitability.validation.plan_sum', [
                        'x' => self::hours(array_sum($planned)),
                        'sold' => self::hours($locked->budget_seconds),
                        'n' => self::hoursNumber(abs($delta)),
                    ])],
                ]);
            }

            foreach ($months as $month) {
                $seconds = $planned[$month->month->format('Y-m-d')];
                if ($month->planned_seconds !== $seconds) {
                    $month->planned_seconds = $seconds;
                    $month->save();
                }
            }
        });

        return response()->noContent();
    }

    /**
     * Hours as the copy shows them: "12.5 h", "110 h".
     */
    private static function hours(int $seconds): string
    {
        return self::hoursNumber($seconds).' h';
    }

    /**
     * The bare number of hours (the `:n` placeholder, whose copy adds the "h"): up to two decimals,
     * trailing zeros dropped, so even a delta of a few minutes never reads as 0.
     */
    private static function hoursNumber(int $seconds): string
    {
        $formatted = number_format($seconds / 3600, 2, '.', '');

        return rtrim(rtrim($formatted, '0'), '.');
    }

    /**
     * @param  array<string, string>  $replace
     */
    private static function label(string $key, array $replace = []): string
    {
        $value = __($key, $replace);

        return is_string($value) ? $value : $key;
    }
}
