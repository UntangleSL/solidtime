<?php

declare(strict_types=1);

namespace App\Profitability\Periods;

/**
 * Splits a period's hours over its months (D-02), pure: no database, no clock.
 *
 * Invariant of every result: the months sum exactly to the budget. Months get whole steps (half an hour
 * by default); any sub-step remainder of the budget goes to the last month.
 *
 * - evenSplit: the same number of steps per month; the extra steps go to the earlier months (the owner
 *   front-loads plans).
 * - rescale: keeps the proportions of an existing plan for a new budget by largest remainder; ties go
 *   to the earlier month. An all-zero plan falls back to the even split.
 */
final class PlanDistributor
{
    public const int DEFAULT_STEP = 1800;

    /**
     * @return list<int>
     */
    public function evenSplit(int $budgetSeconds, int $months, int $step = self::DEFAULT_STEP): array
    {
        if ($months <= 0) {
            return [];
        }
        $step = max(1, $step);
        $steps = intdiv($budgetSeconds, $step);
        $remainder = $budgetSeconds - $steps * $step;
        $base = intdiv($steps, $months);
        $extra = $steps - $base * $months;

        $planned = [];
        for ($i = 0; $i < $months; $i++) {
            $planned[] = ($base + ($i < $extra ? 1 : 0)) * $step + ($i === $months - 1 ? $remainder : 0);
        }

        return $planned;
    }

    /**
     * @param  list<int>  $planned
     * @return list<int>
     */
    public function rescale(array $planned, int $newBudget, int $step = self::DEFAULT_STEP): array
    {
        $months = count($planned);
        if ($months === 0) {
            return [];
        }
        $weights = array_map(static fn (int $value): int => max(0, $value), $planned);
        $total = array_sum($weights);
        if ($total === 0 || $newBudget < 0) {
            return $this->evenSplit($newBudget, $months, $step);
        }
        $step = max(1, $step);
        $steps = intdiv($newBudget, $step);
        $remainder = $newBudget - $steps * $step;

        $quotas = [];
        $fractions = [];
        foreach ($weights as $i => $weight) {
            $quotas[$i] = intdiv($steps * $weight, $total);
            $fractions[$i] = ($steps * $weight) % $total;
        }

        // Largest remainder first; equal remainders go to the earlier month
        $order = array_keys($fractions);
        usort($order, static fn (int $a, int $b): int => $fractions[$b] <=> $fractions[$a] ?: $a <=> $b);
        $left = $steps - array_sum($quotas);
        foreach ($order as $i) {
            if ($left <= 0) {
                break;
            }
            $quotas[$i]++;
            $left--;
        }

        $result = [];
        foreach ($quotas as $i => $quota) {
            $result[] = $quota * $step + ($i === $months - 1 ? $remainder : 0);
        }

        return $result;
    }

    /**
     * Planned minus budget: positive when the months plan more than the period's hours, negative when
     * they plan less, 0 when the plan is balanced.
     *
     * @param  list<int>  $planned
     */
    public function delta(array $planned, int $budget): int
    {
        return array_sum($planned) - $budget;
    }
}
