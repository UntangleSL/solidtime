<?php

declare(strict_types=1);

namespace Tests\Unit\Profitability;

use App\Profitability\Periods\PlanDistributor;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * The monthly plan of a period (D-02), proven without a database: every split sums exactly to the
 * period's hours.
 */
#[CoversClass(PlanDistributor::class)]
class PlanDistributorTest extends TestCase
{
    /**
     * @return array<string, array{0: int, 1: int, 2: list<int>}>
     */
    public static function evenSplits(): array
    {
        return [
            'three equal quarters' => [432000, 3, [144000, 144000, 144000]],
            'extra steps go to the first months' => [144000, 3, [48600, 48600, 46800]],
            'sub-step remainder on the last month' => [78000, 2, [39600, 38400]],
            'one month takes everything' => [77400, 1, [77400]],
            'zero hours' => [0, 3, [0, 0, 0]],
            'less than a step' => [600, 2, [0, 600]],
            'a year of 100 h' => [360000, 12, [30600, 30600, 30600, 30600, 30600, 30600, 30600, 30600, 28800, 28800, 28800, 28800]],
        ];
    }

    /**
     * @param  list<int>  $expected
     */
    #[DataProvider('evenSplits')]
    public function test_even_split(int $budget, int $months, array $expected): void
    {
        $this->assertSame($expected, (new PlanDistributor)->evenSplit($budget, $months));
    }

    public function test_even_split_of_no_month_is_empty(): void
    {
        $this->assertSame([], (new PlanDistributor)->evenSplit(144000, 0));
    }

    public function test_even_split_always_sums_to_the_budget(): void
    {
        $distributor = new PlanDistributor;
        // 0 to 200 h in quarter-hour steps, over 1 to 12 months
        for ($budget = 0; $budget <= 720000; $budget += 900) {
            for ($months = 1; $months <= 12; $months++) {
                $plan = $distributor->evenSplit($budget, $months);
                $this->assertCount($months, $plan);
                $this->assertSame($budget, array_sum($plan), $budget.' over '.$months);
                // Even: no two months differ by more than one step
                $this->assertLessThanOrEqual(PlanDistributor::DEFAULT_STEP, max($plan) - min($plan));
            }
        }
    }

    public function test_rescale_keeps_the_proportions(): void
    {
        $plan = (new PlanDistributor)->rescale([200000, 100000, 60000], 180000);

        // 100 half-hour steps: 55.6, 27.8, 16.7 -> 55, 28, 17 by largest remainder
        $this->assertSame([99000, 50400, 30600], $plan);
        $this->assertSame(180000, array_sum($plan));
    }

    public function test_rescale_of_an_all_zero_plan_is_the_even_split(): void
    {
        $distributor = new PlanDistributor;

        $this->assertSame($distributor->evenSplit(144000, 3), $distributor->rescale([0, 0, 0], 144000));
    }

    public function test_rescale_of_no_month_is_empty(): void
    {
        $this->assertSame([], (new PlanDistributor)->rescale([], 144000));
    }

    public function test_rescale_puts_the_sub_step_remainder_on_the_last_month(): void
    {
        $plan = (new PlanDistributor)->rescale([36000, 36000], 72600);

        $this->assertSame([36000, 36600], $plan);
    }

    public function test_rescale_always_sums_to_the_budget(): void
    {
        $distributor = new PlanDistributor;
        $plans = [
            [200000, 100000, 60000],
            [1800, 0, 0, 0],
            [0, 0, 5400],
            [48600, 48600, 46800],
            [3600, 7200, 10800, 14400, 18000, 21600, 25200, 28800, 32400, 36000, 39600, 43200],
        ];
        foreach ($plans as $planned) {
            for ($budget = 0; $budget <= 720000; $budget += 900) {
                $plan = $distributor->rescale($planned, $budget);
                $this->assertCount(count($planned), $plan);
                $this->assertSame($budget, array_sum($plan), json_encode($planned).' to '.$budget);
            }
        }
    }

    public function test_delta_is_the_signed_difference(): void
    {
        $distributor = new PlanDistributor;

        $this->assertSame(0, $distributor->delta([48600, 48600, 46800], 144000));
        $this->assertSame(1800, $distributor->delta([50400, 48600, 46800], 144000));
        $this->assertSame(-3600, $distributor->delta([48600, 45000, 46800], 144000));
    }
}
