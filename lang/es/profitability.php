<?php

declare(strict_types=1);

// Spanish copy, prepared for a later locale switch. The app locale stays 'en' (D-17).
// Same keys and placeholders as lang/en/profitability.php (ProfitabilityLangTest).
return [
    'nav' => 'Rentabilidad',

    'page' => [
        'title' => 'Rentabilidad',
    ],

    'tabs' => [
        'projects' => 'Proyectos',
        'clients' => 'Clientes',
        'people' => 'Personas',
        'settings' => 'Ajustes',
    ],

    'common' => [
        'hours_over' => ':n h de más',
        'hours_left' => 'Quedan :n h',
        'hours_unused' => ':n h sin usar',
        'on_plan' => 'Según el plan',
        'not_available' => 'No disponible',
        'former_member' => 'Antiguo miembro',
        'try_again' => 'Reintentar',
        'load_error' => 'No se pudieron cargar los datos de rentabilidad. Revisa tu conexión e inténtalo de nuevo.',
        'save_error' => 'No se pudieron guardar los cambios. No se ha modificado nada. Inténtalo de nuevo.',
        'discard_changes' => 'Descartar cambios',
        'show_all' => 'Ver todos',
        'no_client' => 'Sin cliente',
        'total' => 'Total',
        'this_month_suffix' => '(este mes)',
        'figures_up_to_today' => ':range. Datos hasta hoy, :date.',
    ],

    'kpi' => [
        'hours_sold' => 'Horas vendidas',
        'consumed' => 'Consumidas',
        'still_to_consume' => 'Pendientes de consumir',
        'over_by' => 'Exceso',
        'projected_at_close' => 'Previsión al cierre',
        'projects_at_risk' => 'Proyectos en riesgo',
        'hours_consumed' => 'Horas consumidas',
        'result' => 'Resultado',
    ],

    'summary' => [
        'title' => 'Contrato',
        'since' => 'Desde el :date',
        'until' => 'Hasta el :date',
        'renewal_paused' => 'Renovación en pausa (proyecto archivado)',
        'projection_caption' => 'Siguiendo el plan. Al ritmo actual: :h.',
        'run_rate_unavailable' => 'Al ritmo actual: aún no hay datos suficientes (hacen falta 5 días laborables).',
        'meter_caption' => ':consumed de :sold consumidas (:pct)',
        'meter_valuetext' => ':consumed de :sold consumidas, previsión :projected, :status',
        'meter_sold_tick' => 'Vendidas :h',
        'period_select' => 'Periodo',
        'period_option' => ':period · :state',
        'month' => 'Mes',
        'planned' => 'Planificadas',
        'consumed' => 'Consumidas',
        'difference' => 'Diferencia',
        'chart_aria' => 'Horas planificadas y consumidas por mes en :period. Detalle en la tabla de abajo.',
        'chart_planned' => 'Planificadas',
        'chart_consumed' => 'Consumidas',
        'chart_tooltip' => ':month · Planificadas :planned · Consumidas :consumed · :difference',
        'plan_months' => 'Planificar meses',
        'edit_terms' => 'Editar condiciones del contrato',
        'set_terms' => 'Definir condiciones del contrato',
        'empty_title' => 'Aún no hay condiciones de contrato',
        'empty_body_editor' => 'Define las horas y el importe vendidos para seguir el presupuesto de este proyecto.',
        'empty_body_pm' => 'El responsable de cuenta define las horas vendidas.',
    ],

    // Solo para quien ve importes (Owner/Admin, responsables de cuenta)
    'money' => [
        'kpi' => [
            'amount_sold' => 'Importe vendido',
        ],
    ],
];
