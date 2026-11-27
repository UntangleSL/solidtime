<?php

declare(strict_types=1);

namespace Tests\Unit\Profitability;

use App\Profitability\Reporting\ReportRange;
use Carbon\CarbonImmutable;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Calendar-aligned reporting ranges (UI-SPEC "Range" select), proven without a database or a clock.
 */
#[CoversClass(ReportRange::class)]
class ReportRangeTest extends TestCase
{
    /**
     * @return array<string, array{0: string, 1: string, 2: string, 3: string, 4: string, 5: string, 6: bool}>
     */
    public static function ranges(): array
    {
        // key, today, expected key, from, to, capped to, contains today
        return [
            'this month' => ['this_month', '2026-11-18', 'this_month', '2026-11-01', '2026-11-30', '2026-11-18', true],
            'last month' => ['last_month', '2026-11-18', 'last_month', '2026-10-01', '2026-10-31', '2026-10-31', false],
            'this quarter' => ['this_quarter', '2026-11-18', 'this_quarter', '2026-10-01', '2026-12-31', '2026-11-18', true],
            'last quarter' => ['last_quarter', '2026-11-18', 'last_quarter', '2026-07-01', '2026-09-30', '2026-09-30', false],
            'year to date' => ['year_to_date', '2026-11-18', 'year_to_date', '2026-01-01', '2026-11-30', '2026-11-18', true],
            'last 12 months' => ['last_12_months', '2026-11-18', 'last_12_months', '2025-12-01', '2026-11-30', '2026-11-18', true],
            'unknown key falls back' => ['bogus', '2026-11-18', 'this_month', '2026-11-01', '2026-11-30', '2026-11-18', true],
            'empty key falls back' => ['', '2026-11-18', 'this_month', '2026-11-01', '2026-11-30', '2026-11-18', true],
            'last month across the year' => ['last_month', '2026-01-15', 'last_month', '2025-12-01', '2025-12-31', '2025-12-31', false],
            'last quarter across the year' => ['last_quarter', '2026-02-10', 'last_quarter', '2025-10-01', '2025-12-31', '2025-12-31', false],
            'last month from the 31st' => ['last_month', '2026-03-31', 'last_month', '2026-02-01', '2026-02-28', '2026-02-28', false],
            'this month on its last day' => ['this_month', '2026-11-30', 'this_month', '2026-11-01', '2026-11-30', '2026-11-30', true],
            'this quarter on its first day' => ['this_quarter', '2026-07-01', 'this_quarter', '2026-07-01', '2026-09-30', '2026-07-01', true],
        ];
    }

    #[DataProvider('ranges')]
    public function test_range_from_key(string $key, string $today, string $expectedKey, string $from, string $to, string $cappedTo, bool $containsToday): void
    {
        // Act
        $range = ReportRange::fromKey($key, CarbonImmutable::parse($today, 'Europe/Madrid'));

        // Assert
        $this->assertSame([
            'key' => $expectedKey,
            'from' => $from,
            'to' => $to,
            'capped_to' => $cappedTo,
            'contains_today' => $containsToday,
        ], $range->toArray());
    }

    public function test_months_lists_the_first_day_of_every_month(): void
    {
        // Act
        $range = ReportRange::fromKey('last_12_months', CarbonImmutable::parse('2026-11-18', 'Europe/Madrid'));
        $months = array_map(fn (CarbonImmutable $month): string => $month->format('Y-m-d'), $range->months());

        // Assert
        $this->assertCount(12, $months);
        $this->assertSame('2025-12-01', $months[0]);
        $this->assertSame('2026-11-01', $months[11]);
        $this->assertSame(['2026-10-01', '2026-11-01', '2026-12-01'], array_map(
            fn (CarbonImmutable $month): string => $month->format('Y-m-d'),
            ReportRange::fromKey('this_quarter', CarbonImmutable::parse('2026-11-18', 'Europe/Madrid'))->months(),
        ));
    }

    public function test_time_of_day_of_today_is_ignored(): void
    {
        // Act
        $range = ReportRange::fromKey('this_month', CarbonImmutable::parse('2026-11-18 23:59:00', 'Europe/Madrid'));

        // Assert
        $this->assertSame('2026-11-18', $range->cappedTo->format('Y-m-d'));
        $this->assertSame('00:00:00', $range->cappedTo->format('H:i:s'));
        $this->assertSame('Europe/Madrid', $range->from->getTimezone()->getName());
    }
}
