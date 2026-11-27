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
use Carbon\CarbonImmutable;
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
 * (D-04), so the summary shows the current period straight away.
 *
 * Editing existing terms (D-03, D-04, UI-D9), in one transaction with the contract row locked:
 * - Nothing has started yet: the schedule, dates and terms are replaced and the not-started periods
 *   are created again from them.
 * - A period has started: the schedule and the start date are locked (and so is the end date of a
 *   one-off, which is its only period). The end date may move, but not before the start of the latest
 *   started period; upcoming periods that would start after it are removed. apply_to is required:
 *   current_and_following updates the current period (its monthly plan rescaled to the new hours) and
 *   every upcoming one, next_period only the upcoming ones. Closed periods are never written.
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

        $today = now()->setTimezone($this->consumption->timezone())->toImmutable()->startOfDay();

        /** @var ProjectContract|null $existing */
        $existing = ProjectContract::query()
            ->where('organization_id', '=', $organization->getKey())
            ->where('project_id', '=', $model->getKey())
            ->first();
        if ($existing !== null) {
            DB::transaction(function () use ($existing, $request, $today): void {
                /** @var ProjectContract $contract */
                $contract = ProjectContract::query()
                    ->whereKey($existing->getKey())
                    ->lockForUpdate()
                    ->firstOrFail();
                if ($contract->starts_on->format('Y-m-d') > $today->format('Y-m-d')) {
                    $this->replaceNotStarted($contract, $request, $today);
                } else {
                    $this->editStarted($contract, $request, $today);
                }
            });

            return response()->noContent();
        }

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
     * No period has started: the new terms replace the old ones entirely, schedule and dates included,
     * and the periods are created again from them.
     */
    private function replaceNotStarted(ProjectContract $contract, ContractTermsRequest $request, CarbonImmutable $today): void
    {
        // Every period of a contract that has not started is upcoming; their months cascade
        ContractPeriod::query()
            ->where('contract_id', '=', $contract->getKey())
            ->where('starts_on', '>', $today->format('Y-m-d'))
            ->delete();

        $contract->service = $request->service();
        $contract->schedule = $request->schedule();
        $contract->starts_on = $request->startsOn();
        $contract->ends_on = $request->endsOn();
        $contract->budget_seconds = $request->budgetSeconds();
        $contract->amount_cents = $request->amountCents();
        $contract->save();

        $this->materializer->ensureThrough($contract, $today);
        $this->applyFirstPeriodValues($contract, $request);
    }

    /**
     * A period has started: closed periods keep their result (D-03); the new terms reach the current
     * period and the upcoming ones, or the upcoming ones only (UI-D9).
     */
    private function editStarted(ProjectContract $contract, ContractTermsRequest $request, CarbonImmutable $today): void
    {
        $todayDate = $today->format('Y-m-d');
        $endsOn = $request->endsOn();

        /** @var ContractPeriod|null $latestStarted */
        $latestStarted = ContractPeriod::query()
            ->where('contract_id', '=', $contract->getKey())
            ->where('starts_on', '<=', $todayDate)
            ->orderByDesc('starts_on')
            ->first();
        $current = $latestStarted !== null && $latestStarted->ends_on->format('Y-m-d') >= $todayDate
            ? $latestStarted
            : null;

        $errors = [];
        $locked = self::label('profitability.validation.schedule_locked');
        if ($request->schedule() !== $contract->schedule) {
            $errors['schedule'] = [$locked];
        }
        if ($request->startsOn()->format('Y-m-d') !== $contract->starts_on->format('Y-m-d')) {
            $errors['starts_on'] = [$locked];
        }
        if (! $contract->schedule->isRenewing() && $endsOn?->format('Y-m-d') !== $contract->ends_on?->format('Y-m-d')) {
            // A one-off has a single period running to its end date
            $errors['ends_on'] = [$locked];
        } elseif ($endsOn !== null && $latestStarted !== null
            && $endsOn->format('Y-m-d') < $latestStarted->starts_on->format('Y-m-d')) {
            $errors['ends_on'] = [self::label('profitability.validation.ends_before_current_period')];
        }
        $applyTo = $request->applyTo();
        if ($applyTo === null) {
            $errors['apply_to'] = [self::label('validation.required', ['attribute' => 'apply to'])];
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        $contract->service = $request->service();
        $contract->ends_on = $endsOn;
        $contract->budget_seconds = $request->budgetSeconds();
        $contract->amount_cents = $request->amountCents();
        $contract->save();

        if ($endsOn !== null) {
            // Upcoming periods that would now start after the end date (their months cascade)
            ContractPeriod::query()
                ->where('contract_id', '=', $contract->getKey())
                ->where('starts_on', '>', $todayDate)
                ->where('starts_on', '>', $endsOn->format('Y-m-d'))
                ->delete();
        }

        // A later end date can make room for periods again; new ones take the new terms
        $this->materializer->ensureThrough($contract, $today);

        $upcoming = ContractPeriod::query()
            ->where('contract_id', '=', $contract->getKey())
            ->where('starts_on', '>', $todayDate)
            ->orderBy('starts_on')
            ->get();
        foreach ($upcoming as $period) {
            $this->applyTemplate($contract, $period, false);
        }

        // UI-D9: the current period changes too, or only the periods from the next one on
        $includeCurrent = match ($applyTo) {
            'current_and_following' => true,
            'next_period' => false,
            default => false,
        };
        if ($includeCurrent && $current !== null) {
            $this->applyTemplate($contract, $current, true);
        }
    }

    /**
     * Gives one current or upcoming period the contract's terms, prorated when the period is a stub
     * (D-15). When its hours change, the current period's plan keeps its shape, rescaled to the new
     * total; an upcoming period gets a fresh even plan.
     */
    private function applyTemplate(ProjectContract $contract, ContractPeriod $period, bool $isCurrent): void
    {
        $isStub = $contract->schedule->isRenewing() && $period->starts_on->day !== 1;
        $budgetSeconds = $isStub
            ? $this->calendar->prorateSeconds($contract->budget_seconds, $contract->schedule, $period->starts_on)
            : $contract->budget_seconds;
        $amountCents = $isStub
            ? $this->calendar->prorateCents($contract->amount_cents, $contract->schedule, $period->starts_on)
            : $contract->amount_cents;

        $budgetChanged = $period->budget_seconds !== $budgetSeconds;
        $period->budget_seconds = $budgetSeconds;
        $period->amount_cents = $amountCents;
        $period->save();
        if (! $budgetChanged) {
            return;
        }

        $months = $period->months()->get();
        $planned = $isCurrent
            ? $this->distributor->rescale(
                array_values($months->map(static fn (ContractPeriodMonth $month): int => $month->planned_seconds)->all()),
                $budgetSeconds,
            )
            : $this->distributor->evenSplit($budgetSeconds, $months->count());
        foreach ($months->values() as $index => $month) {
            $month->planned_seconds = $planned[$index];
            $month->save();
        }
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

    /**
     * @param  array<string, string>  $replace
     */
    private static function label(string $key, array $replace = []): string
    {
        $value = __($key, $replace);

        return is_string($value) ? $value : $key;
    }
}
