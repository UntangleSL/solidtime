<?php

declare(strict_types=1);

namespace App\Profitability\Http\Controllers;

use App\Enums\Role;
use App\Models\Member;
use App\Models\Organization;
use App\Models\User;
use App\Profitability\Access\ProfitabilityAccess;
use App\Profitability\Http\Requests\CostRateRequest;
use App\Profitability\Http\Requests\WorkWeekRequest;
use App\Profitability\Models\MemberCostRate;
use App\Profitability\Models\MemberWorkWeek;
use App\Profitability\Reporting\ConsumptionQuery;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Routing\Controller;
use Illuminate\Validation\ValidationException;

/**
 * The per-person inputs of margins and chargeability, for the Settings view (D-08, D-12, D-13, BUDG-05,
 * CHRG-01): the dated hourly cost and the dated working week with its chargeability target of every
 * member of the organization, placeholders included (their past hours still need a cost, A8).
 *
 * Owner and Admin only: the gate is isFull() alone, so account managers, project managers, core managers
 * and employees never reach hourly costs. Every other caller, a foreign member and a foreign row are the
 * same plain 404 (no oracle for what exists, D-16).
 *
 * Cost values are never logged and the models are not audited: the response is built from explicit
 * arrays and nothing else leaves this controller.
 */
class PeopleSettingsController extends Controller
{
    public function __construct(
        private readonly ProfitabilityAccess $access,
        private readonly ConsumptionQuery $consumption,
    ) {}

    /**
     * Every member of the organization sorted by name, with the values effective today and the full
     * histories newest first.
     */
    public function index(Request $request, Organization $organization): JsonResponse
    {
        $this->authorizeFull($request, $organization);

        $today = $this->today();

        /** @var Collection<int, Member> $members */
        $members = Member::query()
            ->whereBelongsTo($organization, 'organization')
            ->with('user')
            ->get();

        /** @var array<string, list<MemberCostRate>> $costRates */
        $costRates = [];
        MemberCostRate::query()
            ->where('organization_id', '=', $organization->getKey())
            ->orderByDesc('effective_from')
            ->get()
            ->each(function (MemberCostRate $rate) use (&$costRates): void {
                $costRates[$rate->member_id][] = $rate;
            });

        /** @var array<string, list<MemberWorkWeek>> $workWeeks */
        $workWeeks = [];
        MemberWorkWeek::query()
            ->where('organization_id', '=', $organization->getKey())
            ->orderByDesc('effective_from')
            ->get()
            ->each(function (MemberWorkWeek $week) use (&$workWeeks): void {
                $workWeeks[$week->member_id][] = $week;
            });

        $rows = [];
        foreach ($members as $member) {
            $memberRates = $costRates[$member->getKey()] ?? [];
            $memberWeeks = $workWeeks[$member->getKey()] ?? [];
            $currentRate = $this->currentRow($memberRates, $today);
            $currentWeek = $this->currentRow($memberWeeks, $today);

            $rows[] = [
                'member_id' => $member->getKey(),
                'name' => $member->user->name,
                'role' => $member->role,
                'is_placeholder' => $member->role === Role::Placeholder->value,
                'hourly_cost_cents' => $currentRate?->hourly_cost_cents,
                'weekly_seconds' => $currentWeek?->weekly_seconds,
                'target_percent' => $currentWeek?->chargeability_target_percent,
                'since' => $this->since($currentRate, $currentWeek),
                'cost_rates' => array_map(fn (MemberCostRate $rate): array => $this->costRateData($rate), $memberRates),
                'work_weeks' => array_map(fn (MemberWorkWeek $week): array => $this->workWeekData($week), $memberWeeks),
            ];
        }

        usort($rows, fn (array $a, array $b): int => [mb_strtolower($a['name']), $a['member_id']] <=> [mb_strtolower($b['name']), $b['member_id']]);

        return new JsonResponse(['data' => $rows]);
    }

    /**
     * A new hourly cost of the member from a date on. A second row on the same date is a 422.
     */
    public function storeCostRate(CostRateRequest $request, Organization $organization, string $memberId): JsonResponse
    {
        $this->authorizeFull($request, $organization);
        $model = $this->findMember($organization, $memberId);

        $effectiveFrom = $request->effectiveFrom();
        $exists = MemberCostRate::query()
            ->where('member_id', '=', $model->getKey())
            ->where('effective_from', '=', $effectiveFrom)
            ->exists();
        if ($exists) {
            throw $this->duplicateDate();
        }

        try {
            $rate = (new MemberCostRate)->forceFill([
                'organization_id' => $organization->getKey(),
                'member_id' => $model->getKey(),
                'effective_from' => $effectiveFrom,
                'hourly_cost_cents' => $request->hourlyCostCents(),
            ]);
            $rate->save();
        } catch (UniqueConstraintViolationException) {
            // A concurrent request stored the same date between the check and the insert
            throw $this->duplicateDate();
        }

        return new JsonResponse(['data' => $this->costRateData($rate->refresh())], 201);
    }

    public function destroyCostRate(Request $request, Organization $organization, string $memberId, string $rate): Response
    {
        $this->authorizeFull($request, $organization);
        $model = $this->findMember($organization, $memberId);

        /** @var MemberCostRate $row */
        $row = MemberCostRate::query()
            ->where('organization_id', '=', $organization->getKey())
            ->where('member_id', '=', $model->getKey())
            ->whereKey($rate)
            ->firstOrFail();
        $row->delete();

        return response()->noContent();
    }

    /**
     * A new working week with its chargeability target from a date on. A second row on the same date is
     * a 422.
     */
    public function storeWorkWeek(WorkWeekRequest $request, Organization $organization, string $memberId): JsonResponse
    {
        $this->authorizeFull($request, $organization);
        $model = $this->findMember($organization, $memberId);

        $effectiveFrom = $request->effectiveFrom();
        $exists = MemberWorkWeek::query()
            ->where('member_id', '=', $model->getKey())
            ->where('effective_from', '=', $effectiveFrom)
            ->exists();
        if ($exists) {
            throw $this->duplicateDate();
        }

        try {
            $week = (new MemberWorkWeek)->forceFill([
                'organization_id' => $organization->getKey(),
                'member_id' => $model->getKey(),
                'effective_from' => $effectiveFrom,
                'weekly_seconds' => $request->weeklySeconds(),
                'chargeability_target_percent' => $request->targetPercent(),
            ]);
            $week->save();
        } catch (UniqueConstraintViolationException) {
            // A concurrent request stored the same date between the check and the insert
            throw $this->duplicateDate();
        }

        return new JsonResponse(['data' => $this->workWeekData($week->refresh())], 201);
    }

    public function destroyWorkWeek(Request $request, Organization $organization, string $memberId, string $week): Response
    {
        $this->authorizeFull($request, $organization);
        $model = $this->findMember($organization, $memberId);

        /** @var MemberWorkWeek $row */
        $row = MemberWorkWeek::query()
            ->where('organization_id', '=', $organization->getKey())
            ->where('member_id', '=', $model->getKey())
            ->whereKey($week)
            ->firstOrFail();
        $row->delete();

        return response()->noContent();
    }

    private function authorizeFull(Request $request, Organization $organization): void
    {
        $user = $request->user();
        assert($user instanceof User);

        if (! $this->access->forUser($organization, $user)->isFull()) {
            throw (new ModelNotFoundException)->setModel(Member::class);
        }
    }

    private function findMember(Organization $organization, string $memberId): Member
    {
        /** @var Member $model */
        $model = Member::query()
            ->whereBelongsTo($organization, 'organization')
            ->whereKey($memberId)
            ->firstOrFail();

        return $model;
    }

    /**
     * Today as a local date of the profitability timezone, the same one every period and month uses.
     */
    private function today(): string
    {
        return now()->toImmutable()->setTimezone($this->consumption->timezone())->format('Y-m-d');
    }

    /**
     * The row in force today: the greatest effective_from on or before today.
     *
     * @template TRow of MemberCostRate|MemberWorkWeek
     *
     * @param  list<TRow>  $rowsNewestFirst
     * @return TRow|null
     */
    private function currentRow(array $rowsNewestFirst, string $today): MemberCostRate|MemberWorkWeek|null
    {
        foreach ($rowsNewestFirst as $row) {
            if ($row->effective_from->format('Y-m-d') <= $today) {
                return $row;
            }
        }

        return null;
    }

    /**
     * The most recent effective date of the two values in force today, or null when neither is set.
     */
    private function since(?MemberCostRate $rate, ?MemberWorkWeek $week): ?string
    {
        $dates = array_filter([
            $rate?->effective_from->format('Y-m-d'),
            $week?->effective_from->format('Y-m-d'),
        ], fn (?string $date): bool => $date !== null);

        return $dates === [] ? null : max($dates);
    }

    /**
     * @return array{id: string, effective_from: string, hourly_cost_cents: int}
     */
    private function costRateData(MemberCostRate $rate): array
    {
        return [
            'id' => $rate->getKey(),
            'effective_from' => $rate->effective_from->format('Y-m-d'),
            'hourly_cost_cents' => $rate->hourly_cost_cents,
        ];
    }

    /**
     * @return array{id: string, effective_from: string, weekly_seconds: int, target_percent: int}
     */
    private function workWeekData(MemberWorkWeek $week): array
    {
        return [
            'id' => $week->getKey(),
            'effective_from' => $week->effective_from->format('Y-m-d'),
            'weekly_seconds' => $week->weekly_seconds,
            'target_percent' => $week->chargeability_target_percent,
        ];
    }

    private function duplicateDate(): ValidationException
    {
        return ValidationException::withMessages([
            'effective_from' => [__('profitability.validation.duplicate_date')],
        ]);
    }
}
