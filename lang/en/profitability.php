<?php

declare(strict_types=1);

// Copy of the profitability module (Phase 8, UI-SPEC Copywriting Contract). The app locale stays 'en'
// (D-17); lang/es/profitability.php mirrors every key (ProfitabilityLangTest).
// Placeholders are filled by the client: `:n` is a bare number of hours (the copy adds the "h");
// `:h`, `:x`, `:sold`, `:consumed`, `:planned`, `:projected`, `:billable`, `:available` are formatted
// hours ("12.5 h"); `:pct` and `:target` a formatted percent; `:date` and `:period` formatted dates.
// Any key whose name mentions amount, cost, margin, revenue or cents lives under `money` (scopes with
// money) or `admin` (Owner/Admin): the shared prop drops those groups for every other scope.
return [
    'nav' => 'Profitability',

    'page' => [
        'title' => 'Profitability',
    ],

    'tabs' => [
        'projects' => 'Projects',
        'clients' => 'Clients',
        'people' => 'People',
        'settings' => 'Settings',
    ],

    'common' => [
        'hours_over' => ':n h over',
        'hours_left' => ':n h left',
        'hours_unused' => ':n h unused',
        'on_plan' => 'On plan',
        'not_available' => 'Not available',
        'former_member' => 'Former member',
        'try_again' => 'Try again',
        'load_error' => 'Couldn\'t load profitability figures. Check your connection and try again.',
        'save_error' => 'Couldn\'t save your changes. Nothing was changed. Try again.',
        'discard_changes' => 'Discard changes',
        'show_all' => 'Show all',
        'no_client' => 'No client',
        'total' => 'Total',
        'this_month_suffix' => '(this month)',
        'figures_up_to_today' => ':range. Figures up to today, :date.',
    ],

    'kpi' => [
        'hours_sold' => 'Hours sold',
        'consumed' => 'Consumed',
        'still_to_consume' => 'Still to consume',
        'over_by' => 'Over by',
        'projected_at_close' => 'Projected at close',
        'projects_at_risk' => 'Projects at risk',
        'hours_consumed' => 'Hours consumed',
        'result' => 'Result',
    ],

    'summary' => [
        'title' => 'Contract',
        'since' => 'Since :date',
        'until' => 'Until :date',
        'renewal_paused' => 'Renewal paused (project archived)',
        'projection_caption' => 'Following the plan. At the current pace: :h.',
        'run_rate_unavailable' => 'At the current pace: not enough data yet (5 working days needed).',
        'meter_caption' => ':consumed of :sold consumed (:pct)',
        'meter_valuetext' => ':consumed of :sold consumed, projected :projected, :status',
        'meter_sold_tick' => 'Sold :h',
        'period_select' => 'Period',
        'period_option' => ':period · :state',
        'month' => 'Month',
        'planned' => 'Planned',
        'consumed' => 'Consumed',
        'difference' => 'Difference',
        'chart_aria' => 'Planned and consumed hours per month for :period. Details in the table below.',
        'chart_planned' => 'Planned',
        'chart_consumed' => 'Consumed',
        'chart_tooltip' => ':month · Planned :planned · Consumed :consumed · :difference',
        'plan_months' => 'Plan months',
        'edit_terms' => 'Edit contract terms',
        'set_terms' => 'Set contract terms',
        'empty_title' => 'No contract terms yet',
        'empty_body_editor' => 'Set the hours and amount sold to follow this project\'s budget.',
        'empty_body_pm' => 'The account manager sets the hours sold.',
    ],

    // Scopes with money only (Owner/Admin, account managers)
    'money' => [
        'kpi' => [
            'amount_sold' => 'Amount sold',
        ],
    ],
];
