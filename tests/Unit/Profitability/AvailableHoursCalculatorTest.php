<?php

declare(strict_types=1);

namespace Tests\Unit\Profitability;

use App\Profitability\Reporting\AvailableHoursCalculator;
use Carbon\CarbonImmutable;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Available hours from dated working weeks (D-13, A9): weekly / 5 per Monday to Friday, the row in force
 * that day, rounded once. Proven without a database.
 */
#[CoversClass(AvailableHoursCalculator::class)]
class AvailableHoursCalculatorTest extends TestCase
{
    private const int HOUR = 3600;

    /**
     * @param  list<array{0: string, 1: int}>  $rows
     * @return list<array{effective_from: CarbonImmutable, weekly_seconds: int}>
     */
    private static function weeks(array $rows): array
    {
        return array_map(fn (array $row): array => [
            'effective_from' => CarbonImmutable::parse($row[0], 'Europe/Madrid'),
            'weekly_seconds' => $row[1],
        ], $rows);
    }

    /**
     * @return array<string, array{0: list<array{0: string, 1: int}>, 1: string, 2: string, 3: int|null}>
     */
    public static function cases(): array
    {
        return [
            'full month, 21 weekdays x 8 h' => [[['2026-01-01', 40 * self::HOUR]], '2026-11-01', '2026-11-30', 604800],
            'mid-month change 40 h to 32 h' => [
                [['2026-01-01', 40 * self::HOUR], ['2026-11-16', 32 * self::HOUR]],
                '2026-11-01', '2026-11-30',
                // 10 x 8 h + 11 x 6.4 h = 150.4 h
                541440,
            ],
            'rows in any order' => [
                [['2026-11-16', 32 * self::HOUR], ['2026-01-01', 40 * self::HOUR]],
                '2026-11-01', '2026-11-30',
                541440,
            ],
            'first week mid-month: earlier days count nothing' => [
                [['2026-11-16', 40 * self::HOUR]], '2026-11-01', '2026-11-30', 88 * self::HOUR,
            ],
            'no row on or before the range end' => [[['2026-12-01', 40 * self::HOUR]], '2026-11-01', '2026-11-30', null],
            'no rows at all' => [[], '2026-11-01', '2026-11-30', null],
            'weekend only' => [[['2026-01-01', 40 * self::HOUR]], '2026-11-07', '2026-11-08', 0],
            'capped at today (Wednesday 18 Nov)' => [[['2026-01-01', 40 * self::HOUR]], '2026-11-01', '2026-11-18', 13 * 8 * self::HOUR],
            'row starting on the range end' => [[['2026-11-30', 40 * self::HOUR]], '2026-11-01', '2026-11-30', 8 * self::HOUR],
            'odd week rounded once' => [[['2026-01-01', 37 * self::HOUR + 1]], '2026-11-02', '2026-11-04', (int) round(3 * (37 * self::HOUR + 1) / 5)],
        ];
    }

    /**
     * @param  list<array{0: string, 1: int}>  $rows
     */
    #[DataProvider('cases')]
    public function test_available_seconds(array $rows, string $from, string $to, ?int $expected): void
    {
        // Act
        $seconds = AvailableHoursCalculator::availableSeconds(
            self::weeks($rows),
            CarbonImmutable::parse($from, 'Europe/Madrid'),
            CarbonImmutable::parse($to, 'Europe/Madrid'),
        );

        // Assert
        $this->assertSame($expected, $seconds);
    }

    public function test_daylight_saving_change_does_not_shift_days(): void
    {
        // Arrange: Europe/Madrid leaves summer time on Sunday 25 October 2026
        $weeks = self::weeks([['2026-01-01', 40 * self::HOUR]]);

        // Act
        $seconds = AvailableHoursCalculator::availableSeconds(
            $weeks,
            CarbonImmutable::parse('2026-10-01', 'Europe/Madrid'),
            CarbonImmutable::parse('2026-10-31', 'Europe/Madrid'),
        );

        // Assert: 22 weekdays x 8 h
        $this->assertSame(176 * self::HOUR, $seconds);
    }
}
