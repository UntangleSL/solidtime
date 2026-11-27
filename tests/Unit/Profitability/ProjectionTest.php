<?php

declare(strict_types=1);

namespace Tests\Unit\Profitability;

use App\Profitability\Reporting\Projection;
use App\Profitability\Reporting\ProjectionResult;
use Carbon\CarbonImmutable;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Projection of a contract period to its close (BUDG-04, D-02), proven without a database or a clock.
 *
 * Fixture: a quarterly period October to December 2026 that sold 120 h, planned 60/40/20 h; today is
 * Wednesday 18 November 2026, 35 of the period's 66 weekdays elapsed.
 */
#[CoversClass(Projection::class)]
#[CoversClass(ProjectionResult::class)]
class ProjectionTest extends TestCase
{
    private const int HOUR = 3600;

    /**
     * @return list<array{month: string, planned_seconds: int, consumed_seconds: int}>
     */
    private static function quarter(int $octoberHours, int $novemberHours, int $decemberHours = 0): array
    {
        return [
            ['month' => '2026-10-01', 'planned_seconds' => 60 * self::HOUR, 'consumed_seconds' => $octoberHours * self::HOUR],
            ['month' => '2026-11-01', 'planned_seconds' => 40 * self::HOUR, 'consumed_seconds' => $novemberHours * self::HOUR],
            ['month' => '2026-12-01', 'planned_seconds' => 20 * self::HOUR, 'consumed_seconds' => $decemberHours * self::HOUR],
        ];
    }

    /**
     * @param  list<array{month: string, planned_seconds: int, consumed_seconds: int}>  $months
     */
    private function project(
        array $months,
        string $today = '2026-11-18',
        ?int $costCents = null,
        ?int $pricedSeconds = null,
        int $budget = 120 * self::HOUR,
        string $start = '2026-10-01',
        string $end = '2026-12-31',
    ): ProjectionResult {
        return (new Projection)->forPeriod(
            $budget,
            $months,
            CarbonImmutable::parse($start, 'UTC'),
            CarbonImmutable::parse($end, 'UTC'),
            CarbonImmutable::parse($today, 'Europe/Madrid'),
            1.10,
            5,
            $costCents,
            $pricedSeconds,
        );
    }

    public function test_current_period_following_the_plan_is_on_track(): void
    {
        // Act
        $result = $this->project(self::quarter(50, 5));

        // Assert
        $this->assertSame(65 * self::HOUR, $result->stillToConsumeSeconds);
        // 55 h consumed + (40 - 5) h left of November + 20 h of December
        $this->assertSame(110 * self::HOUR, $result->remainingPlanSeconds);
        // 55 h x 66 / 35 weekdays = 103.7 h, rounded to whole seconds once
        $this->assertSame((int) round(55 * self::HOUR * 66 / 35), $result->runRateSeconds);
        $this->assertSame(373371, $result->runRateSeconds);
        $this->assertSame(Projection::STATUS_ON_TRACK, $result->status);
        $this->assertNull($result->projectedCostCents);
    }

    /**
     * @return array<string, array{0: int, 1: int, 2: int, 3: string}>
     */
    public static function statuses(): array
    {
        // October hours, November hours, expected remaining-plan hours, status
        return [
            'on plan exactly 100 %' => [60, 40, 120, Projection::STATUS_ON_TRACK],
            'remaining plan 108 % is at risk' => [60, 50, 130, Projection::STATUS_AT_RISK],
            'remaining plan exactly 110 % is at risk' => [60, 52, 132, Projection::STATUS_AT_RISK],
            'remaining plan 125 % is over' => [70, 60, 150, Projection::STATUS_OVER],
        ];
    }

    #[DataProvider('statuses')]
    public function test_status_comes_from_the_remaining_plan_projection(int $october, int $november, int $expectedHours, string $status): void
    {
        // Act
        $result = $this->project(self::quarter($october, $november));

        // Assert
        $this->assertSame($expectedHours * self::HOUR, $result->remainingPlanSeconds);
        $this->assertSame($status, $result->status);
    }

    public function test_front_loaded_plan_is_not_flagged_by_the_run_rate(): void
    {
        // Arrange: on plan, but the run rate over the front-loaded months points far above the hours sold
        $result = $this->project(self::quarter(60, 30));

        // Assert
        $this->assertNotNull($result->runRateSeconds);
        $this->assertGreaterThan(120 * self::HOUR, $result->runRateSeconds);
        $this->assertSame(Projection::STATUS_ON_TRACK, $result->status);
    }

    public function test_over_consumed_period_has_negative_still_to_consume(): void
    {
        // Act
        $result = $this->project(self::quarter(70, 60));

        // Assert
        $this->assertSame(-10 * self::HOUR, $result->stillToConsumeSeconds);
    }

    public function test_run_rate_needs_five_elapsed_weekdays(): void
    {
        // Arrange: a November period; 2 to 5 November are four weekdays, 2 to 6 November five
        $months = [['month' => '2026-11-01', 'planned_seconds' => 40 * self::HOUR, 'consumed_seconds' => 8 * self::HOUR]];

        // Act
        $four = $this->project($months, '2026-11-05', budget: 40 * self::HOUR, start: '2026-11-01', end: '2026-11-30');
        $five = $this->project($months, '2026-11-06', budget: 40 * self::HOUR, start: '2026-11-01', end: '2026-11-30');

        // Assert
        $this->assertNull($four->runRateSeconds);
        // 8 h x 21 weekdays / 5 weekdays
        $this->assertSame((int) round(8 * self::HOUR * 21 / 5), $five->runRateSeconds);
    }

    public function test_run_rate_is_null_with_nothing_consumed(): void
    {
        // Act
        $result = $this->project(self::quarter(0, 0));

        // Assert
        $this->assertNull($result->runRateSeconds);
        $this->assertSame(Projection::STATUS_ON_TRACK, $result->status);
        // October is past: its unconsumed plan is gone, only November and December are still ahead
        $this->assertSame(60 * self::HOUR, $result->remainingPlanSeconds);
    }

    public function test_before_the_period_starts(): void
    {
        // Act
        $result = $this->project(self::quarter(0, 0), '2026-09-20');

        // Assert
        $this->assertSame(120 * self::HOUR, $result->stillToConsumeSeconds);
        $this->assertSame(120 * self::HOUR, $result->remainingPlanSeconds);
        $this->assertNull($result->runRateSeconds);
        $this->assertSame(Projection::STATUS_NOT_STARTED, $result->status);
    }

    public function test_after_the_period_ends(): void
    {
        // Act
        $result = $this->project(self::quarter(50, 30, 25), '2027-01-04');

        // Assert
        $this->assertSame(105 * self::HOUR, $result->remainingPlanSeconds);
        $this->assertSame(105 * self::HOUR, $result->runRateSeconds);
        $this->assertSame(15 * self::HOUR, $result->stillToConsumeSeconds);
        $this->assertSame(Projection::STATUS_CLOSED, $result->status);
    }

    public function test_last_day_of_the_period_is_still_current(): void
    {
        // Act
        $result = $this->project(self::quarter(60, 40, 10), '2026-12-31');

        // Assert
        $this->assertSame(Projection::STATUS_ON_TRACK, $result->status);
        $this->assertSame(120 * self::HOUR, $result->remainingPlanSeconds);
    }

    public function test_projected_cost_extends_the_average_cost_to_the_remaining_plan(): void
    {
        // Arrange: 55 h consumed, all priced, 165000 cents of cost (3000 cents/h on average)
        $result = $this->project(self::quarter(50, 5), costCents: 165000, pricedSeconds: 55 * self::HOUR);

        // Assert: 165000 + (110 h - 55 h) x 3000
        $this->assertSame(330000, $result->projectedCostCents);
    }

    public function test_projected_cost_averages_over_priced_seconds_only(): void
    {
        // Arrange: 55 h consumed, 11 h of them priced at 3000 cents/h
        $result = $this->project(self::quarter(50, 5), costCents: 33000, pricedSeconds: 11 * self::HOUR);

        // Assert: 33000 + 55 h x 3000
        $this->assertSame(198000, $result->projectedCostCents);
    }

    public function test_projected_cost_is_null_without_priced_seconds(): void
    {
        // Act
        $unpriced = $this->project(self::quarter(50, 5), costCents: 0, pricedSeconds: 0);
        $withoutMoney = $this->project(self::quarter(50, 5));

        // Assert
        $this->assertNull($unpriced->projectedCostCents);
        $this->assertNull($withoutMoney->projectedCostCents);
    }

    public function test_closed_period_projects_the_cost_to_date(): void
    {
        // Act
        $result = $this->project(self::quarter(50, 30, 25), '2027-01-04', costCents: 315000, pricedSeconds: 105 * self::HOUR);

        // Assert
        $this->assertSame(315000, $result->projectedCostCents);
    }

    public function test_zero_budget_with_planned_time_is_over(): void
    {
        // Act
        $result = $this->project(self::quarter(1, 0), budget: 0);

        // Assert
        $this->assertSame(Projection::STATUS_OVER, $result->status);
    }
}
