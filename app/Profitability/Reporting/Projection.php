<?php

declare(strict_types=1);

namespace App\Profitability\Reporting;

use Carbon\CarbonImmutable;
use InvalidArgumentException;

/**
 * Projection of a contract period to its close (BUDG-04, D-02: "how much must still be consumed and
 * where the period is heading"). Pure: no database and no clock; "today" is passed in as a local date of
 * the profitability timezone. Every date is reduced to its calendar date, and weekdays are Monday to
 * Friday.
 *
 * Let B = hours sold, C = consumed so far (sum of the months), p_m / c_m = planned / consumed of month m,
 * W(a, b) = weekdays from a to b, both inclusive.
 * - still to consume = B - C (negative = over the hours sold).
 * - remaining plan = C + sum over the current and later months of max(p_m - c_m, 0): "if the team
 *   follows the plan from now on". Past months contribute their actual consumption only.
 * - run rate = C / W(start, today) x W(start, end), rounded once; null before $minWeekdays elapsed
 *   weekdays or with nothing consumed.
 * - status, from the remaining-plan projection only: on_track up to B, at_risk up to B x threshold,
 *   over above it. A linear run rate over a front-loaded plan (D-02, the owner's usual plan) would flag
 *   every on-plan period as over, so the run rate is shown as information, never as the status.
 * - before the period starts: remaining plan = the whole plan, run rate null, status not_started.
 *   After it ends: both projections equal C, status closed.
 * - projected cost (scopes with money) = cost + (remaining plan - C) x cost / priced seconds, rounded
 *   once; null when nothing is priced. The projected margin is the amount minus this.
 */
final class Projection
{
    public const string STATUS_ON_TRACK = 'on_track';

    public const string STATUS_AT_RISK = 'at_risk';

    public const string STATUS_OVER = 'over';

    public const string STATUS_NOT_STARTED = 'not_started';

    public const string STATUS_CLOSED = 'closed';

    /**
     * @param  list<array{month: string, planned_seconds: int, consumed_seconds: int}>  $months  months of the period (month = Y-m-01)
     */
    public function forPeriod(
        int $budget,
        array $months,
        CarbonImmutable $start,
        CarbonImmutable $end,
        CarbonImmutable $today,
        float $atRiskThreshold,
        int $minWeekdays,
        ?int $costCents,
        ?int $pricedSeconds,
    ): ProjectionResult {
        $startDate = self::date($start);
        $endDate = self::date($end);
        $day = self::date($today);

        $consumed = 0;
        $planned = 0;
        foreach ($months as $month) {
            $consumed += $month['consumed_seconds'];
            $planned += $month['planned_seconds'];
        }
        $still = $budget - $consumed;

        if ($day->lessThan($startDate)) {
            return new ProjectionResult($still, $planned, null, self::STATUS_NOT_STARTED, $this->projectedCost($planned, $consumed, $costCents, $pricedSeconds));
        }
        if ($day->greaterThan($endDate)) {
            return new ProjectionResult($still, $consumed, $consumed, self::STATUS_CLOSED, $this->projectedCost($consumed, $consumed, $costCents, $pricedSeconds));
        }

        $currentMonth = $day->format('Y-m-01');
        $remaining = $consumed;
        foreach ($months as $month) {
            if ($month['month'] >= $currentMonth) {
                $remaining += max($month['planned_seconds'] - $month['consumed_seconds'], 0);
            }
        }

        $elapsed = self::weekdays($startDate, $day);
        $runRate = null;
        if ($elapsed >= $minWeekdays && $elapsed > 0 && $consumed > 0) {
            $runRate = (int) round($consumed * self::weekdays($startDate, $endDate) / $elapsed);
        }

        return new ProjectionResult(
            $still,
            $remaining,
            $runRate,
            $this->status($remaining, $budget, $atRiskThreshold),
            $this->projectedCost($remaining, $consumed, $costCents, $pricedSeconds),
        );
    }

    private function status(int $projected, int $budget, float $atRiskThreshold): string
    {
        if ($projected <= $budget) {
            return self::STATUS_ON_TRACK;
        }
        if ($projected <= (int) round($budget * $atRiskThreshold)) {
            return self::STATUS_AT_RISK;
        }

        return self::STATUS_OVER;
    }

    private function projectedCost(int $projected, int $consumed, ?int $costCents, ?int $pricedSeconds): ?int
    {
        if ($costCents === null || $pricedSeconds === null || $pricedSeconds <= 0) {
            return null;
        }

        return (int) round($costCents + ($projected - $consumed) * $costCents / $pricedSeconds);
    }

    /**
     * Weekdays (Monday to Friday) from $from to $to, both inclusive; 0 when $to is before $from.
     */
    private static function weekdays(CarbonImmutable $from, CarbonImmutable $to): int
    {
        $count = 0;
        for ($day = $from; $day->lessThanOrEqualTo($to); $day = $day->addDay()) {
            if (! $day->isWeekend()) {
                $count++;
            }
        }

        return $count;
    }

    /**
     * The calendar date of $value as midnight UTC, so DST never shifts a day.
     */
    private static function date(CarbonImmutable $value): CarbonImmutable
    {
        return CarbonImmutable::createFromFormat('!Y-m-d', $value->format('Y-m-d'), 'UTC')
            ?: throw new InvalidArgumentException('Invalid date.');
    }
}
