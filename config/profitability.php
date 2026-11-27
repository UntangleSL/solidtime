<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Profitability module (Untangle fork)
|--------------------------------------------------------------------------
|
| Contract terms, hour budgets, consumption and chargeability (Phase 8).
| Plain values on purpose: the module reads no environment variable. The
| code lives in app/Profitability; this file only holds its settings.
|
*/

return [
    // Contract periods, months and "today" are local dates in this timezone (period boundaries, D-15)
    'timezone' => 'Europe/Madrid',

    // A period projected to close above sold x this ratio is "Over budget"; between sold and this
    // ratio it is "At risk" (UI-SPEC status tooltips: up to 10 % above the hours sold)
    'at_risk_threshold' => 1.10,

    // Working days (Monday to Friday) of consumption needed before the run-rate projection is shown
    'run_rate_min_weekdays' => 5,

    // Local time (in the timezone above) of the daily job that creates the next renewal periods
    'renew_daily_at' => '04:30',
];
