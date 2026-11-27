<?php

declare(strict_types=1);

namespace App\Profitability\Reporting;

/**
 * Where a contract period is heading (D-02), as computed by Projection::forPeriod().
 *
 * - stillToConsumeSeconds: hours sold minus consumed (negative once over the hours sold).
 * - remainingPlanSeconds: consumed plus what the plan still has; this decides the status.
 * - runRateSeconds: linear pace over the elapsed weekdays, information only; null until enough data.
 * - status: one of the Projection::STATUS_* values.
 * - projectedCostCents: cost at close, null without priced time or without money.
 */
final readonly class ProjectionResult
{
    public function __construct(
        public int $stillToConsumeSeconds,
        public int $remainingPlanSeconds,
        public ?int $runRateSeconds,
        public string $status,
        public ?int $projectedCostCents,
    ) {}
}
