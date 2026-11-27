// Client mirror of the server's plan rules (app/Profitability/Periods/PlanDistributor.php, D-02):
// the monthly plan of a period must add up exactly to its hours. The client gate is a convenience;
// the server rejects any other sum with a 422 (T-08-42).

/** Half an hour: plans are split in whole steps. */
export const PLAN_STEP_SECONDS = 1800;

/**
 * The same number of steps per month; the extra steps go to the earlier months (the owner front-loads
 * plans) and any sub-step remainder of the budget goes to the last month. Always sums to the budget.
 */
export function evenSplit(
    budgetSeconds: number,
    months: number,
    step: number = PLAN_STEP_SECONDS
): number[] {
    if (months <= 0) return [];
    const unit = Math.max(1, step);
    const steps = Math.floor(budgetSeconds / unit);
    const remainder = budgetSeconds - steps * unit;
    const base = Math.floor(steps / months);
    const extra = steps - base * months;

    const planned: number[] = [];
    for (let i = 0; i < months; i++) {
        planned.push((base + (i < extra ? 1 : 0)) * unit + (i === months - 1 ? remainder : 0));
    }
    return planned;
}

export type SumKind = 'equal' | 'under' | 'over';

export interface SumState {
    kind: SumKind;
    /** Total planned seconds. */
    planned: number;
    /** Seconds left to distribute (under) or above the hours sold (over); 0 when equal. */
    seconds: number;
}

/** Where the plan stands against the hours sold (the sticky footer of the plan editor). */
export function sumState(planned: readonly number[], budgetSeconds: number): SumState {
    const total = planned.reduce((sum, value) => sum + value, 0);
    const delta = total - budgetSeconds;
    if (delta === 0) return { kind: 'equal', planned: total, seconds: 0 };
    return delta < 0
        ? { kind: 'under', planned: total, seconds: -delta }
        : { kind: 'over', planned: total, seconds: delta };
}
