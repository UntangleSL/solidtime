<?php

declare(strict_types=1);

// Copy of the profitability module (Phase 8, UI-SPEC Copywriting Contract). The app locale stays 'en'
// (D-17); lang/es/profitability.php mirrors every key (ProfitabilityLangTest).
// Placeholders are filled by the client: `:n` is a bare number of hours (the copy adds the "h");
// `:h`, `:x`, `:sold`, `:consumed`, `:planned`, `:projected`, `:billable`, `:available` are formatted
// hours ("12.5 h"); `:pct` and `:target` a formatted percent; `:date` and `:period` formatted dates.
// Any key whose name mentions amount, cost, margin, revenue or cents lives under `money` (scopes with
// money) or `admin` (Owner/Admin): the shared prop drops those groups for every other scope.
// This is the single label inventory of the phase: later plans read these keys and never edit the file.
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

    'period_state' => [
        'current' => 'Current',
        'upcoming' => 'Upcoming',
        'closed' => 'Closed',
    ],

    'schedule' => [
        'one_off' => 'One-off',
        'monthly' => 'Renews monthly',
        'quarterly' => 'Renews quarterly',
        'annual' => 'Renews annually',
    ],

    'status' => [
        'on_track' => 'On track',
        'at_risk' => 'At risk',
        'over' => 'Over budget',
        'not_started' => 'Not started',
        'closed' => 'Closed',
        'below_target' => 'Below target',
        'incomplete' => 'Incomplete',
        'no_contract' => 'No contract',
    ],

    'status_tooltip' => [
        'on_track' => 'Projected to close within the hours sold.',
        'at_risk' => 'Projected to close up to 10 % above the hours sold.',
        'over' => 'Projected to close more than 10 % above the hours sold.',
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

    'projects' => [
        'filter_label' => 'Contract',
        'filter' => [
            'active' => 'Active',
            'without_terms' => 'Without contract terms',
            'ended' => 'Ended',
            'all' => 'All',
        ],
        'columns' => [
            'project' => 'Project',
            'period' => 'Period',
            'sold' => 'Sold',
            'consumed' => 'Consumed',
            'still_to_consume' => 'Still to consume',
            'projected_at_close' => 'Projected at close',
            'status' => 'Status',
        ],
        'actions_aria' => 'Actions for :project',
        'open_project' => 'Open project',
        'empty_editor_title' => 'No contract terms yet',
        'empty_editor_body' => 'Set the hours and amount sold on a billable project to follow its budget here.',
        'empty_pm_title' => 'No contract terms on your projects yet',
        'empty_pm_body' => 'The account manager sets the hours sold. They will show here once set.',
        'empty_filter' => 'No projects match this filter.',
        'only_billable_helper' => 'Only billable projects can have contract terms.',
    ],

    'ranges' => [
        'label' => 'Range',
        'this_month' => 'This month',
        'last_month' => 'Last month',
        'this_quarter' => 'This quarter',
        'last_quarter' => 'Last quarter',
        'year_to_date' => 'Year to date',
        'last_12_months' => 'Last 12 months',
    ],

    'clients' => [
        'columns' => [
            'client' => 'Client',
            'hours_sold' => 'Hours sold',
            'hours_consumed' => 'Hours consumed',
            'status' => 'Status',
        ],
        'project_count' => ':count projects',
        'project_count_one' => ':count project',
        'expand_aria' => 'Show projects of :client',
        'collapse_aria' => 'Hide projects of :client',
        'empty_title' => 'No client figures for this range',
        'empty_body' => 'Clients appear here once their projects have contract terms and time in the selected range.',
    ],

    'contract_editor' => [
        'title_set' => 'Set contract terms',
        'title_edit' => 'Edit contract terms',
        'project' => 'Project',
        'project_placeholder' => 'Choose a project',
        'service' => 'Service',
        'service_placeholder' => 'For example: SEO retainer',
        'schedule' => 'Schedule',
        'start_date' => 'Start date',
        'end_date' => 'End date',
        'end_date_helper' => 'Leave empty to keep renewing. Archiving the project also pauses renewal.',
        'hours_per' => [
            'one_off' => 'Hours',
            'monthly' => 'Hours per month',
            'quarterly' => 'Hours per quarter',
            'annual' => 'Hours per year',
        ],
        'first_period_legend' => 'First period: :period',
        'first_period_helper' => 'Prorated to :d of :n days. You can change these.',
        'first_period_hours' => 'First period hours',
        'apply_to_legend' => 'Apply changes to',
        'apply_to_current' => 'This period (:period) and the following ones',
        'apply_to_next' => 'From the next period (:date) on',
        'rescale_notice' => 'The monthly plan of this period will be rescaled to the new total.',
        'save' => 'Save contract terms',
    ],

    'plan_editor' => [
        'title' => 'Plan months',
        'subtitle' => ':project · :period · :sold sold',
        'split_evenly' => 'Split evenly',
        'save' => 'Save plan',
        'sum_equal' => 'Planned :sold of :sold',
        'sum_under' => 'Planned :x of :sold · :n h left to distribute',
        'sum_over' => 'Planned :x of :sold · :n h above the hours sold',
        'save_disabled_reason' => 'The months must add up to the hours sold before you can save.',
    ],

    'validation' => [
        'one_off_needs_end' => 'A one-off contract needs an end date.',
        'end_before_start' => 'The end date must be after the start date.',
        'plan_sum' => 'The months add up to :x, but :sold were sold. Adjust :n h before saving.',
        'duplicate_date' => 'There is already a value from this date. Delete it first or pick another date.',
        'project_not_billable' => 'Only billable projects can have contract terms.',
        'period_closed' => 'This period is closed. Its plan can no longer be changed.',
        'schedule_locked' => 'The schedule and start date can\'t change once a period has started. Set an end date and add new terms instead.',
        'ends_before_current_period' => 'The end date can\'t be before the start of the current period.',
    ],

    'toasts' => [
        'terms_saved' => 'Contract terms saved.',
        'plan_saved' => 'Plan saved.',
    ],

    // Scopes with money only (Owner/Admin, account managers)
    'money' => [
        'kpi' => [
            'amount_sold' => 'Amount sold',
            'cost_to_date' => 'Cost to date',
            'margin_to_date' => 'Margin to date',
            'projected_margin' => 'Projected margin',
            'final_margin' => 'Final margin',
            'margin_pct' => 'Margin %',
            'cost' => 'Cost',
            'margin' => 'Margin',
        ],
        'columns' => [
            'amount' => 'Amount',
            'amount_sold' => 'Amount sold',
            'cost' => 'Cost',
            'margin' => 'Margin',
            'margin_pct' => 'Margin %',
        ],
        'incomplete' => 'Incomplete',
        'incomplete_tooltip' => ':n h without an hourly cost. Set costs in Settings.',
        'incomplete_aria' => 'Incomplete cost: :n h without an hourly cost',
        'totals_caption' => 'Money totals cover :n of :total projects (the clients you manage).',
        'margin_chart_title' => 'Margin by client',
        'margin_chart_aria' => 'Margin by client for :range. Details in the table below.',
        'margin_chart_tooltip' => ':client · Margin :margin (:pct) · Sold :amount · Cost :cost',
        'other_clients' => 'Other clients',
        'incomplete_chart_tooltip' => 'Incomplete: :n h without an hourly cost',
        'editor' => [
            'amount_per' => [
                'one_off' => 'Amount',
                'monthly' => 'Amount per month',
                'quarterly' => 'Amount per quarter',
                'annual' => 'Amount per year',
            ],
            'first_period_amount' => 'First period amount',
        ],
    ],

    // Owner/Admin only (People and Settings views, data-quality notice)
    'admin' => [
        'legacy_nonbillable' => ':h on billable projects were logged as non-billable before this rule. They count against the contract but not toward chargeability.',

        'people' => [
            'kpi' => [
                'team_chargeability' => 'Team chargeability',
                'billable_hours' => 'Billable hours',
                'available_hours' => 'Available hours',
                'absence_hours' => 'Absence hours',
                'target' => 'Target :pct',
            ],
            'chart_title' => 'Chargeability vs target',
            'chart_aria' => 'Chargeability and target per person for :range. Details in the table below.',
            'chart_legend_chargeability' => 'Chargeability',
            'chart_legend_target' => 'Target',
            'chart_tooltip' => ':name · :pct (target :target) · :billable billable of :available available',
            'columns' => [
                'person' => 'Person',
                'working_week' => 'Working week',
                'available' => 'Available',
                'absence' => 'Absence',
                'billable' => 'Billable',
                'internal' => 'Internal',
                'chargeability' => 'Chargeability',
                'target' => 'Target',
                'gap' => 'Gap',
                'status' => 'Status',
            ],
            'no_working_week' => 'No working week',
            'set_in_settings' => 'Set in Settings',
            'empty_title' => 'No working weeks set',
            'empty_body' => 'Set each person\'s working week in Settings to calculate chargeability.',
            'go_to_settings' => 'Go to Settings',
        ],

        'settings' => [
            'people_title' => 'People',
            'people_columns' => [
                'person' => 'Person',
                'role' => 'Role',
                'hourly_cost' => 'Hourly cost',
                'working_week' => 'Working week',
                'target' => 'Target',
                'since' => 'Since',
            ],
            'per_hour' => ':value / h',
            'edit_aria' => 'Edit :name',
            'not_set' => 'Not set',
            'not_set_tooltip' => 'Margins and chargeability are incomplete without this.',

            'dialog' => [
                'cost_legend' => 'Hourly cost',
                'effective_from' => 'Effective from',
                'cost_per_hour' => 'Cost per hour',
                'add_cost' => 'Add cost',
                'cost_helper' => 'Each cost applies from its date until the next one. Past months keep the cost that applied then.',
                'work_week_legend' => 'Working week and chargeability target',
                'hours_per_week' => 'Hours per week',
                'target' => 'Target',
                'add_work_week' => 'Add working week',
                'work_week_helper' => 'Available hours are the working week spread over Monday to Friday, minus time on absence projects.',
                'history_empty' => 'No values yet.',
                'close' => 'Close person settings',
                'delete_cost_aria' => 'Delete hourly cost from :date',
                'delete_work_week_aria' => 'Delete working week from :date',
            ],

            'delete_cost' => [
                'title' => 'Delete this hourly cost?',
                'body' => 'From :date, :name\'s time will use the previous cost. Margins of those months change.',
                'body_no_previous' => 'From :date, :name\'s time will show as incomplete, because there is no previous cost. Margins of those months change.',
                'keep' => 'Keep cost',
                'confirm' => 'Delete cost',
            ],

            'delete_work_week' => [
                'title' => 'Delete this working week?',
                'body' => 'From :date, :name\'s available hours and target will use the previous values. Chargeability of those months changes.',
                'keep' => 'Keep working week',
                'confirm' => 'Delete working week',
            ],

            'managers_title' => 'Project and account managers',
            'managers_filter' => 'Filter clients and projects',
            'managers_columns' => [
                'client' => 'Client',
                'project' => 'Project',
                'account_managers' => 'Account managers',
                'project_managers' => 'Project managers',
            ],
            'account_managers' => 'Account managers',
            'account_managers_helper' => 'Account managers set contract terms and see money for the client\'s projects.',
            'add_account_manager' => 'Add account manager',
            'remove_account_manager_aria' => 'Remove :name as account manager',
            'project_managers' => 'Project managers',
            'project_managers_helper' => 'Project managers plan the monthly hours and see hour balances of the project. They do not see money.',
            'add_project_manager' => 'Add project manager',
            'remove_project_manager_aria' => 'Remove :name as project manager',

            'absence_title' => 'Absence projects',
            'mark_absence' => 'Mark absence project',
            'unmark_absence_aria' => 'Unmark :project as absence',
            'absence_helper' => 'Time on these projects counts as absence: it lowers available hours instead of counting as internal time. For example Vacaciones and Festivo.',
            'absence_empty' => 'No absence projects marked. Until you mark them, holidays count as internal time and lower chargeability.',
        ],

        'toasts' => [
            'cost_added' => 'Hourly cost added.',
            'cost_deleted' => 'Hourly cost deleted.',
            'work_week_added' => 'Working week added.',
            'work_week_deleted' => 'Working week deleted.',
            'manager_added' => 'Manager added.',
            'manager_removed' => 'Manager removed.',
            'absence_updated' => 'Absence projects updated.',
        ],
    ],
];
