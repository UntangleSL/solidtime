<?php

declare(strict_types=1);

namespace App\Profitability\Periods;

use Carbon\CarbonImmutable;

/**
 * The dates of one contract period, both inclusive, as local calendar dates (held as midnight UTC so
 * date arithmetic never crosses a daylight-saving change). A stub is a period that starts after the 1st
 * of a month and runs to the end of that month (D-15).
 */
final readonly class PeriodBounds
{
    public function __construct(
        public CarbonImmutable $startsOn,
        public CarbonImmutable $endsOn,
        public bool $isStub,
    ) {}
}
