<?php

declare(strict_types=1);

namespace App\Profitability\Reporting;

use App\Enums\Role;
use App\Models\Member;
use App\Models\Organization;
use App\Profitability\Models\AbsenceProject;
use App\Profitability\Models\MemberWorkWeek;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;

/**
 * Chargeability per person over a reporting range (CHRG-02, CHRG-03, D-06, D-13):
 *
 *   available = AvailableHoursCalculator over from..cappedTo (dated working week, Monday to Friday)
 *               minus absence time, never below 0; null without a working week
 *   chargeability = billable / available (null when available is null or 0)
 *
 * The target is the one of the working-week row in force at the capped range end. Every member of the
 * organization is listed; placeholders (former members) only when they have time in the range.
 *
 * Team totals: billable and absence time of everybody listed; chargeability and the available-weighted
 * target only over people with a working week (a person without one has no denominator and would
 * otherwise inflate the team figure).
 *
 * Per-person figures are Owner/Admin data (D-16); the caller gates access before calling this service.
 */
class ChargeabilityService
{
    public function __construct(
        private readonly ChargeabilityQuery $query,
        private readonly ConsumptionQuery $consumption,
    ) {}

    /**
     * @return array{
     *     people: list<array{member_id: string, name: string, is_placeholder: bool, weekly_seconds: int|null, available_seconds: int|null, absence_seconds: int, billable_seconds: int, internal_seconds: int, chargeability: float|null, target_percent: int|null, gap_points: float|null, status: string|null}>,
     *     team: array{billable_seconds: int, available_seconds: int, absence_seconds: int, internal_seconds: int, chargeability: float|null, target_percent: float|null}
     * }
     */
    public function forRange(Organization $organization, ReportRange $range, CarbonImmutable $now): array
    {
        $today = $now->setTimezone($this->consumption->timezone())->format('Y-m-d');

        /** @var list<string> $absenceProjectIds */
        $absenceProjectIds = AbsenceProject::query()
            ->where('organization_id', '=', $organization->getKey())
            ->whereHas('project', fn (Builder $project): Builder => $project->whereBelongsTo($organization, 'organization'))
            ->orderBy('project_id')
            ->pluck('project_id')
            ->values()
            ->all();

        $time = $this->query->byMemberForRange(
            $organization->getKey(),
            $range->from,
            $range->cappedTo,
            $now,
            $absenceProjectIds,
        );

        /** @var array<string, list<array{effective_from: CarbonImmutable, weekly_seconds: int, target_percent: int}>> $workWeeks */
        $workWeeks = [];
        MemberWorkWeek::query()
            ->where('organization_id', '=', $organization->getKey())
            ->orderBy('effective_from')
            ->get()
            ->each(function (MemberWorkWeek $week) use (&$workWeeks): void {
                $workWeeks[$week->member_id][] = [
                    'effective_from' => $week->effective_from,
                    'weekly_seconds' => $week->weekly_seconds,
                    'target_percent' => $week->chargeability_target_percent,
                ];
            });

        /** @var Collection<int, Member> $members */
        $members = Member::query()
            ->whereBelongsTo($organization, 'organization')
            ->with('user')
            ->get();

        $people = [];
        foreach ($members as $member) {
            $memberId = $member->getKey();
            $memberTime = $time[$memberId] ?? ['billable_seconds' => 0, 'absence_seconds' => 0, 'internal_seconds' => 0];
            $isPlaceholder = $member->role === Role::Placeholder->value;
            $hasTime = $memberTime['billable_seconds'] + $memberTime['absence_seconds'] + $memberTime['internal_seconds'] > 0;
            if ($isPlaceholder && ! $hasTime) {
                continue;
            }

            $memberWeeks = $workWeeks[$memberId] ?? [];
            $current = $this->rowAt($memberWeeks, $today);
            $atRangeEnd = $this->rowAt($memberWeeks, $range->cappedTo->format('Y-m-d'));

            $gross = AvailableHoursCalculator::availableSeconds(
                array_map(fn (array $week): array => ['effective_from' => $week['effective_from'], 'weekly_seconds' => $week['weekly_seconds']], $memberWeeks),
                $range->from,
                $range->cappedTo,
            );
            $available = $gross === null ? null : max(0, $gross - $memberTime['absence_seconds']);
            $chargeability = $available === null || $available === 0 ? null : (float) $memberTime['billable_seconds'] / $available;
            $target = $atRangeEnd['target_percent'] ?? null;
            $gap = $chargeability === null || $target === null ? null : $chargeability * 100 - $target;

            $people[] = [
                'member_id' => $memberId,
                'name' => $member->user->name,
                'is_placeholder' => $isPlaceholder,
                'weekly_seconds' => $current['weekly_seconds'] ?? null,
                'available_seconds' => $available,
                'absence_seconds' => $memberTime['absence_seconds'],
                'billable_seconds' => $memberTime['billable_seconds'],
                'internal_seconds' => $memberTime['internal_seconds'],
                'chargeability' => $chargeability,
                'target_percent' => $target,
                'gap_points' => $gap,
                'status' => $gap === null ? null : ($gap >= 0 ? 'on_track' : 'below_target'),
            ];
        }

        usort($people, fn (array $a, array $b): int => [mb_strtolower($a['name']), $a['member_id']] <=> [mb_strtolower($b['name']), $b['member_id']]);

        return ['people' => $people, 'team' => $this->team($people)];
    }

    /**
     * @param  list<array{member_id: string, name: string, is_placeholder: bool, weekly_seconds: int|null, available_seconds: int|null, absence_seconds: int, billable_seconds: int, internal_seconds: int, chargeability: float|null, target_percent: int|null, gap_points: float|null, status: string|null}>  $people
     * @return array{billable_seconds: int, available_seconds: int, absence_seconds: int, internal_seconds: int, chargeability: float|null, target_percent: float|null}
     */
    private function team(array $people): array
    {
        $billable = 0;
        $absence = 0;
        $internal = 0;
        $available = 0;
        $chargeableBillable = 0;
        $targetWeight = 0;
        $targetSum = 0;

        foreach ($people as $person) {
            $billable += $person['billable_seconds'];
            $absence += $person['absence_seconds'];
            $internal += $person['internal_seconds'];
            if ($person['available_seconds'] === null) {
                continue;
            }
            $available += $person['available_seconds'];
            $chargeableBillable += $person['billable_seconds'];
            if ($person['target_percent'] !== null) {
                $targetWeight += $person['available_seconds'];
                $targetSum += $person['available_seconds'] * $person['target_percent'];
            }
        }

        return [
            'billable_seconds' => $billable,
            'available_seconds' => $available,
            'absence_seconds' => $absence,
            'internal_seconds' => $internal,
            'chargeability' => $available === 0 ? null : (float) $chargeableBillable / $available,
            'target_percent' => $targetWeight === 0 ? null : (float) $targetSum / $targetWeight,
        ];
    }

    /**
     * The working-week row in force on a local date: the greatest effective_from on or before it.
     *
     * @param  list<array{effective_from: CarbonImmutable, weekly_seconds: int, target_percent: int}>  $weeks  oldest first
     * @return array{effective_from: CarbonImmutable, weekly_seconds: int, target_percent: int}|null
     */
    private function rowAt(array $weeks, string $date): ?array
    {
        $found = null;
        foreach ($weeks as $week) {
            if ($week['effective_from']->format('Y-m-d') <= $date) {
                $found = $week;
            }
        }

        return $found;
    }
}
