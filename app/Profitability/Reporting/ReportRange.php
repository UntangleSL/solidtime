<?php

declare(strict_types=1);

namespace App\Profitability\Reporting;

use Carbon\CarbonImmutable;

/**
 * A calendar-aligned reporting range of the profitability views (UI-SPEC "Range" select): This month,
 * Last month, This quarter, Last quarter, Year to date and Last 12 months. Months and quarters are
 * calendar months and quarters of the profitability timezone; "today" is passed in as a local date, so
 * this class is pure and never reads the clock.
 *
 * The key comes from the query string: only the whitelisted keys map to dates, anything else falls back
 * to This month (the dates are then bound as parameters, never interpolated).
 *
 * `from` and `to` are inclusive local dates (`to` is a month end). When the range contains today every
 * figure is capped at today (`cappedTo`), the honest number for a range still running (UI-D3).
 */
final class ReportRange
{
    public const string THIS_MONTH = 'this_month';

    public const string LAST_MONTH = 'last_month';

    public const string THIS_QUARTER = 'this_quarter';

    public const string LAST_QUARTER = 'last_quarter';

    public const string YEAR_TO_DATE = 'year_to_date';

    public const string LAST_12_MONTHS = 'last_12_months';

    public const array KEYS = [
        self::THIS_MONTH,
        self::LAST_MONTH,
        self::THIS_QUARTER,
        self::LAST_QUARTER,
        self::YEAR_TO_DATE,
        self::LAST_12_MONTHS,
    ];

    private function __construct(
        public readonly string $key,
        public readonly CarbonImmutable $from,
        public readonly CarbonImmutable $to,
        public readonly CarbonImmutable $cappedTo,
        public readonly bool $containsToday,
    ) {}

    /**
     * @param  CarbonImmutable  $today  the local date of today in the profitability timezone
     */
    public static function fromKey(string $key, CarbonImmutable $today): self
    {
        $today = $today->startOfDay();
        $month = $today->startOfMonth();
        $quarter = $month->subMonthsNoOverflow(($month->month - 1) % 3);

        [$key, $from, $lastMonth] = match ($key) {
            self::LAST_MONTH => [$key, $month->subMonthNoOverflow(), $month->subMonthNoOverflow()],
            self::THIS_QUARTER => [$key, $quarter, $quarter->addMonthsNoOverflow(2)],
            self::LAST_QUARTER => [$key, $quarter->subMonthsNoOverflow(3), $quarter->subMonthNoOverflow()],
            self::YEAR_TO_DATE => [$key, $month->startOfYear(), $month],
            self::LAST_12_MONTHS => [$key, $month->subMonthsNoOverflow(11), $month],
            default => [self::THIS_MONTH, $month, $month],
        };

        $to = $lastMonth->endOfMonth()->startOfDay();
        $containsToday = $from->lessThanOrEqualTo($today) && $today->lessThanOrEqualTo($to);

        return new self(
            $key,
            $from,
            $to,
            $to->greaterThan($today) ? $today : $to,
            $containsToday,
        );
    }

    /**
     * The first day of every month of the range, oldest first.
     *
     * @return list<CarbonImmutable>
     */
    public function months(): array
    {
        $months = [];
        for ($month = $this->from->startOfMonth(); $month->lessThanOrEqualTo($this->to); $month = $month->addMonthNoOverflow()) {
            $months[] = $month;
        }

        return $months;
    }

    /**
     * @return array{key: string, from: string, to: string, capped_to: string, contains_today: bool}
     */
    public function toArray(): array
    {
        return [
            'key' => $this->key,
            'from' => $this->from->format('Y-m-d'),
            'to' => $this->to->format('Y-m-d'),
            'capped_to' => $this->cappedTo->format('Y-m-d'),
            'contains_today' => $this->containsToday,
        ];
    }
}
