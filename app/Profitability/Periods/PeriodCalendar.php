<?php

declare(strict_types=1);

namespace App\Profitability\Periods;

use App\Profitability\Enums\ContractSchedule;
use Carbon\CarbonImmutable;
use InvalidArgumentException;

/**
 * The period grid of a contract as pure date arithmetic: no database, no clock (the caller passes
 * "today"). Every date is a local calendar date; inputs are reduced to their Y-m-d and held as midnight
 * UTC so month arithmetic never meets a daylight-saving change. Both ends of a period are inclusive.
 *
 * Rules, in the order they apply:
 *
 * 1. One-off: a single period from the start date to the end date; there is no next one (D-01).
 * 2. Renewing from the 1st of a month: full periods of 1, 3 or 12 months (D-04).
 * 3. Renewing from any other day: a first stub period from the start date to the end of that month,
 *    its hours and amount prorated by days (hours to the nearest half hour, amount to the cent) unless
 *    the account manager sets them (D-15).
 * 4. Each period starts clean the day after the previous one ends: nothing carries over (D-03).
 * 5. After a pause the next period starts at resume_on when that is later, so the paused months are
 *    never back-filled (D-18). A resume that is not on the 1st gives a stub to the end of that month,
 *    keeping the grid on the 1st.
 * 6. No period starts after the contract's end date (D-04).
 */
final class PeriodCalendar
{
    /** Half an hour: prorated hours are rounded to this step. */
    public const int HOUR_STEP_SECONDS = 1800;

    public const string STATE_CURRENT = 'current';

    public const string STATE_UPCOMING = 'upcoming';

    public const string STATE_CLOSED = 'closed';

    public function first(ContractSchedule $schedule, CarbonImmutable $startsOn, ?CarbonImmutable $endsOn): PeriodBounds
    {
        $start = self::date($startsOn);
        $months = $schedule->months();
        if ($months === null) {
            if ($endsOn === null) {
                throw new InvalidArgumentException('A one-off contract needs an end date.');
            }

            return new PeriodBounds($start, self::date($endsOn), false);
        }

        return self::periodFrom($start, $months);
    }

    /**
     * The period after $previous, or null when the contract does not renew or the next start would be
     * after the end date.
     */
    public function next(
        ContractSchedule $schedule,
        PeriodBounds $previous,
        ?CarbonImmutable $endsOn,
        ?CarbonImmutable $resumeOn,
    ): ?PeriodBounds {
        $months = $schedule->months();
        if ($months === null) {
            return null;
        }

        $start = self::date($previous->endsOn)->addDay();
        if ($resumeOn !== null && self::date($resumeOn)->greaterThan($start)) {
            $start = self::date($resumeOn);
        }
        if ($endsOn !== null && $start->greaterThan(self::date($endsOn))) {
            return null;
        }

        return self::periodFrom($start, $months);
    }

    /**
     * The first day of every month the period touches, in order.
     *
     * @return list<CarbonImmutable>
     */
    public function months(PeriodBounds $bounds): array
    {
        $month = self::date($bounds->startsOn)->startOfMonth();
        $last = self::date($bounds->endsOn)->startOfMonth();
        $months = [];
        while ($month->lessThanOrEqualTo($last)) {
            $months[] = $month;
            $month = $month->addMonthNoOverflow();
        }

        return $months;
    }

    /**
     * Days of a stub starting on $startsOn (to the end of its month, inclusive) and the days of that month.
     *
     * @return array{days: int, of: int}
     */
    public function stubDays(CarbonImmutable $startsOn): array
    {
        $start = self::date($startsOn);
        $of = $start->daysInMonth;

        return ['days' => $of - $start->day + 1, 'of' => $of];
    }

    /**
     * The per-period hours prorated to a stub starting on $startsOn: one month's share of the period,
     * times the stub's share of its month, rounded to the nearest half hour. A one-off contract has no
     * stub and keeps the value.
     */
    public function prorateSeconds(int $perPeriod, ContractSchedule $schedule, CarbonImmutable $startsOn): int
    {
        $months = $schedule->months();
        if ($months === null) {
            return $perPeriod;
        }
        $stub = $this->stubDays($startsOn);

        return self::roundDiv($perPeriod * $stub['days'], $months * $stub['of'] * self::HOUR_STEP_SECONDS) * self::HOUR_STEP_SECONDS;
    }

    /**
     * The per-period amount prorated like the hours, rounded to the cent.
     */
    public function prorateCents(int $perPeriod, ContractSchedule $schedule, CarbonImmutable $startsOn): int
    {
        $months = $schedule->months();
        if ($months === null) {
            return $perPeriod;
        }
        $stub = $this->stubDays($startsOn);

        return self::roundDiv($perPeriod * $stub['days'], $months * $stub['of']);
    }

    /**
     * current while today is inside the period (both ends inclusive), upcoming before it, closed after.
     */
    public function stateOn(CarbonImmutable $startsOn, CarbonImmutable $endsOn, CarbonImmutable $today): string
    {
        $day = $today->format('Y-m-d');
        if ($day < $startsOn->format('Y-m-d')) {
            return self::STATE_UPCOMING;
        }
        if ($day > $endsOn->format('Y-m-d')) {
            return self::STATE_CLOSED;
        }

        return self::STATE_CURRENT;
    }

    /**
     * A period starting on $start: a stub to the end of the month when $start is not the 1st, otherwise
     * a full period of $months months.
     */
    private static function periodFrom(CarbonImmutable $start, int $months): PeriodBounds
    {
        if ($start->day !== 1) {
            return new PeriodBounds($start, $start->endOfMonth()->startOfDay(), true);
        }

        return new PeriodBounds($start, $start->addMonthsNoOverflow($months)->subDay(), false);
    }

    /**
     * The calendar date of $value as midnight UTC.
     */
    private static function date(CarbonImmutable $value): CarbonImmutable
    {
        return CarbonImmutable::createFromFormat('!Y-m-d', $value->format('Y-m-d'), 'UTC')
            ?: throw new InvalidArgumentException('Invalid date.');
    }

    /**
     * $numerator / $denominator rounded half away from zero, in integers.
     */
    private static function roundDiv(int $numerator, int $denominator): int
    {
        if ($denominator <= 0) {
            throw new InvalidArgumentException('The denominator must be positive.');
        }
        $sign = $numerator < 0 ? -1 : 1;

        return $sign * intdiv(2 * abs($numerator) + $denominator, 2 * $denominator);
    }
}
