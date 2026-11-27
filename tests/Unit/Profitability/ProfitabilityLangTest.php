<?php

declare(strict_types=1);

namespace Tests\Unit\Profitability;

use Illuminate\Support\Arr;
use Tests\TestCase;

/**
 * The profitability copy (D-14, D-17): English shown, Spanish prepared with the same keys, money copy
 * separable by scope, and the single label inventory every Vue surface of Phase 8 reads from.
 */
class ProfitabilityLangTest extends TestCase
{
    /**
     * Key paths the later plans rely on (08-02 inventory). `*` style groups are listed leaf by leaf.
     */
    private const array ANCHORS = [
        'nav',
        'page.title',
        'tabs.projects', 'tabs.clients', 'tabs.people', 'tabs.settings',
        'common.hours_over', 'common.hours_left', 'common.hours_unused', 'common.on_plan',
        'common.not_available', 'common.former_member', 'common.try_again', 'common.load_error',
        'common.save_error', 'common.discard_changes', 'common.show_all', 'common.no_client',
        'common.total', 'common.this_month_suffix', 'common.figures_up_to_today',
        'period_state.current', 'period_state.upcoming', 'period_state.closed',
        'schedule.one_off', 'schedule.monthly', 'schedule.quarterly', 'schedule.annual',
        'status.on_track', 'status.at_risk', 'status.over', 'status.not_started', 'status.closed',
        'status.below_target', 'status.incomplete',
        'status_tooltip.on_track', 'status_tooltip.at_risk', 'status_tooltip.over',
        'kpi.hours_sold', 'kpi.consumed', 'kpi.still_to_consume', 'kpi.over_by', 'kpi.projected_at_close',
        'kpi.projects_at_risk', 'kpi.hours_consumed', 'kpi.result',
        'summary.title', 'summary.since', 'summary.until', 'summary.renewal_paused',
        'summary.projection_caption', 'summary.run_rate_unavailable', 'summary.meter_caption',
        'summary.meter_valuetext', 'summary.meter_sold_tick', 'summary.period_select', 'summary.month',
        'summary.planned', 'summary.difference', 'summary.chart_aria', 'summary.chart_planned',
        'summary.chart_consumed', 'summary.chart_tooltip', 'summary.plan_months', 'summary.edit_terms',
        'summary.set_terms', 'summary.empty_title', 'summary.empty_body_editor', 'summary.empty_body_pm',
        'projects.filter_label', 'projects.filter.active', 'projects.filter.without_terms',
        'projects.filter.ended', 'projects.filter.all', 'projects.columns.project', 'projects.actions_aria',
        'projects.open_project', 'projects.empty_editor_title', 'projects.empty_editor_body',
        'projects.empty_pm_title', 'projects.empty_pm_body', 'projects.empty_filter',
        'projects.only_billable_helper',
        'ranges.label', 'ranges.this_month', 'ranges.last_month', 'ranges.this_quarter',
        'ranges.last_quarter', 'ranges.year_to_date', 'ranges.last_12_months',
        'clients.columns.client', 'clients.project_count', 'clients.expand_aria', 'clients.collapse_aria',
        'clients.empty_title', 'clients.empty_body',
        'contract_editor.title_set', 'contract_editor.title_edit', 'contract_editor.project',
        'contract_editor.service', 'contract_editor.service_placeholder', 'contract_editor.schedule',
        'contract_editor.start_date', 'contract_editor.end_date', 'contract_editor.end_date_helper',
        'contract_editor.hours_per.one_off', 'contract_editor.hours_per.monthly',
        'contract_editor.hours_per.quarterly', 'contract_editor.hours_per.annual',
        'contract_editor.first_period_legend', 'contract_editor.first_period_helper',
        'contract_editor.first_period_hours', 'contract_editor.apply_to_legend',
        'contract_editor.apply_to_current', 'contract_editor.apply_to_next',
        'contract_editor.rescale_notice', 'contract_editor.save',
        'plan_editor.title', 'plan_editor.subtitle', 'plan_editor.split_evenly', 'plan_editor.save',
        'plan_editor.sum_equal', 'plan_editor.sum_under', 'plan_editor.sum_over',
        'plan_editor.save_disabled_reason',
        'validation.one_off_needs_end', 'validation.end_before_start', 'validation.plan_sum',
        'validation.duplicate_date', 'validation.project_not_billable', 'validation.period_closed',
        'validation.schedule_locked', 'validation.ends_before_current_period',
        'toasts.terms_saved', 'toasts.plan_saved',
        'money.kpi.amount_sold', 'money.kpi.cost_to_date', 'money.kpi.margin_to_date',
        'money.kpi.projected_margin', 'money.kpi.final_margin', 'money.kpi.margin_pct', 'money.kpi.cost',
        'money.kpi.margin', 'money.columns.amount', 'money.columns.cost', 'money.columns.margin',
        'money.columns.margin_pct', 'money.incomplete', 'money.incomplete_tooltip', 'money.incomplete_aria',
        'money.totals_caption', 'money.margin_chart_title', 'money.margin_chart_tooltip',
        'money.other_clients', 'money.incomplete_chart_tooltip',
        'money.editor.amount_per.one_off', 'money.editor.amount_per.monthly',
        'money.editor.amount_per.quarterly', 'money.editor.amount_per.annual',
        'money.editor.first_period_amount',
        'admin.legacy_nonbillable',
        'admin.people.kpi.target', 'admin.people.no_working_week', 'admin.people.set_in_settings',
        'admin.people.empty_title', 'admin.people.chart_tooltip',
        'admin.settings.edit_aria', 'admin.settings.not_set', 'admin.settings.mark_absence',
        'admin.settings.remove_account_manager_aria', 'admin.settings.remove_project_manager_aria',
        'admin.settings.unmark_absence_aria', 'admin.settings.delete_cost.body',
        'admin.settings.delete_cost.body_no_previous', 'admin.settings.delete_work_week.body',
        'admin.settings.dialog.delete_cost_aria', 'admin.settings.dialog.delete_work_week_aria',
        'admin.settings.dialog.close',
        'admin.toasts.cost_added', 'admin.toasts.work_week_added', 'admin.toasts.manager_added',
        'admin.toasts.manager_removed', 'admin.toasts.absence_updated',
    ];

    public function test_english_and_spanish_files_have_exactly_the_same_nested_keys(): void
    {
        // Arrange
        $english = $this->flatten('en');
        $spanish = $this->flatten('es');

        // Act
        $missingInSpanish = array_values(array_diff(array_keys($english), array_keys($spanish)));
        $missingInEnglish = array_values(array_diff(array_keys($spanish), array_keys($english)));

        // Assert
        $this->assertSame([], $missingInSpanish);
        $this->assertSame([], $missingInEnglish);
        $this->assertNotEmpty($english);
    }

    public function test_no_value_is_empty_in_either_language(): void
    {
        foreach (['en', 'es'] as $locale) {
            foreach ($this->flatten($locale) as $key => $value) {
                $this->assertIsString($value, sprintf('%s.%s must be a string', $locale, $key));
                $this->assertNotSame('', trim($value), sprintf('%s.%s must not be empty', $locale, $key));
            }
        }
    }

    public function test_english_is_the_default_copy_and_spanish_is_prepared(): void
    {
        // Arrange
        $english = $this->flatten('en');
        $spanish = $this->flatten('es');

        // Assert
        $this->assertSame('Profitability', $english['nav']);
        $this->assertSame('Rentabilidad', $spanish['nav']);
        $this->assertSame('Profitability', $english['page.title']);
        $this->assertSame('Rentabilidad', $spanish['page.title']);
        $this->assertSame('en', config('app.locale'));
        // What the shared prop resolves for the nav item in the running locale
        $this->assertSame('Profitability', __('profitability.nav'));
    }

    public function test_placeholders_match_between_languages(): void
    {
        // Arrange
        $english = $this->flatten('en');
        $spanish = $this->flatten('es');

        foreach ($english as $key => $value) {
            // Act
            preg_match_all('/:[a-z_]+/', (string) $value, $englishPlaceholders);
            preg_match_all('/:[a-z_]+/', (string) $spanish[$key], $spanishPlaceholders);

            // Assert
            $this->assertEqualsCanonicalizing($englishPlaceholders[0], $spanishPlaceholders[0], $key);
        }
    }

    public function test_money_named_keys_live_under_money_or_admin(): void
    {
        // Arrange
        $offending = [];

        // Act: the shared prop drops `money` and `admin` for scopes without them, so a money-named key
        // anywhere else would reach a project manager's page
        foreach (array_keys($this->flatten('en')) as $key) {
            $key = (string) $key;
            if (preg_match('/(amount|cost|margin|revenue|cents)/i', $key) !== 1) {
                continue;
            }
            if (! str_starts_with($key, 'money.') && ! str_starts_with($key, 'admin.')) {
                $offending[] = $key;
            }
        }

        // Assert
        $this->assertSame([], $offending);
    }

    public function test_inventory_is_complete(): void
    {
        // Arrange
        $english = $this->flatten('en');

        // Act
        $missing = array_values(array_filter(
            self::ANCHORS,
            fn (string $path): bool => ! array_key_exists($path, $english),
        ));

        // Assert
        $this->assertSame([], $missing);
        $this->assertGreaterThanOrEqual(180, count($english));
    }

    /**
     * @return array<string, mixed>
     */
    private function flatten(string $locale): array
    {
        $translations = require lang_path($locale.'/profitability.php');
        $this->assertIsArray($translations);

        return Arr::dot($translations);
    }
}
