<?php

declare(strict_types=1);

namespace App\Profitability\Enums;

/**
 * How a project contract runs (D-01, D-04): once between a start and an end date, or renewing
 * automatically every month, quarter or year. Renewing periods start on the 1st of a month after an
 * optional first stub period (D-15).
 */
enum ContractSchedule: string
{
    case OneOff = 'one_off';
    case Monthly = 'monthly';
    case Quarterly = 'quarterly';
    case Annual = 'annual';

    /**
     * Length of one full period in months, null for a one-off contract (its period is start..end).
     */
    public function months(): ?int
    {
        return match ($this) {
            self::OneOff => null,
            self::Monthly => 1,
            self::Quarterly => 3,
            self::Annual => 12,
        };
    }

    public function isRenewing(): bool
    {
        return $this !== self::OneOff;
    }
}
