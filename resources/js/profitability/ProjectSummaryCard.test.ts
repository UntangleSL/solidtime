import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import axios from 'axios';
import ProjectSummaryCard from './ProjectSummaryCard.vue';
import { Select } from '@/packages/ui/src/select';

const { pageProps } = vi.hoisted(() => ({
    pageProps: {} as Record<string, unknown>,
}));

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => ({ props: pageProps }),
}));

vi.mock('@/utils/useUser', () => ({ getCurrentOrganizationId: () => 'org-1' }));

vi.mock('@/utils/useOrganizationQuery', () => ({
    useOrganizationQuery: () => ({
        organization: computed(() => ({
            number_format: 'comma-point',
            currency: 'EUR',
            currency_format: 'symbol-before',
            currency_symbol: '€',
        })),
    }),
}));

vi.mock('axios', () => ({
    default: { get: vi.fn() },
}));

const axiosGet = vi.mocked(axios.get);

const SUMMARY_URL =
    'https://app.example.test/profitability/organizations/org-1/projects/p-1/summary';

const labels = {
    common: {
        load_error: 'Couldn’t load profitability figures.',
        try_again: 'Try again',
        hours_over: ':n h over',
        hours_left: ':n h left',
        hours_unused: ':n h unused',
        on_plan: 'On plan',
        total: 'Total',
        this_month_suffix: '(this month)',
    },
    period_state: { current: 'Current', upcoming: 'Upcoming', closed: 'Closed' },
    schedule: {
        one_off: 'One-off',
        monthly: 'Renews monthly',
        quarterly: 'Renews quarterly',
        annual: 'Renews annually',
    },
    status: {
        on_track: 'On track',
        at_risk: 'At risk',
        over: 'Over budget',
        not_started: 'Not started',
        closed: 'Closed',
    },
    status_tooltip: {
        on_track: 'Projected to close within the hours sold.',
        at_risk: 'Projected to close up to 10 % above the hours sold.',
        over: 'Projected to close more than 10 % above the hours sold.',
    },
    kpi: {
        hours_sold: 'Hours sold',
        consumed: 'Consumed',
        still_to_consume: 'Still to consume',
        over_by: 'Over by',
        projected_at_close: 'Projected at close',
        result: 'Result',
    },
    summary: {
        title: 'Contract',
        since: 'Since :date',
        until: 'Until :date',
        renewal_paused: 'Renewal paused (project archived)',
        projection_caption: 'Following the plan. At the current pace: :h.',
        run_rate_unavailable: 'At the current pace: not enough data yet (5 working days needed).',
        meter_caption: ':consumed of :sold consumed (:pct)',
        meter_valuetext: ':consumed of :sold consumed, projected :projected, :status',
        meter_sold_tick: 'Sold :h',
        period_select: 'Period',
        period_option: ':period · :state',
        month: 'Month',
        planned: 'Planned',
        consumed: 'Consumed',
        difference: 'Difference',
        chart_aria: 'Planned and consumed hours per month for :period.',
        chart_planned: 'Planned',
        chart_consumed: 'Consumed',
        chart_tooltip: ':month · Planned :planned · Consumed :consumed · :difference',
        empty_title: 'No contract terms yet',
        empty_body_editor: 'Set the hours and amount sold to follow this project’s budget.',
        empty_body_pm: 'The account manager sets the hours sold.',
    },
    money: {
        kpi: {
            amount_sold: 'Amount sold',
            cost_to_date: 'Cost to date',
            margin_to_date: 'Margin to date',
            projected_margin: 'Projected margin',
            final_margin: 'Final margin',
        },
        incomplete: 'Incomplete',
        incomplete_tooltip: ':n h without an hourly cost. Set costs in Settings.',
        incomplete_aria: 'Incomplete cost: :n h without an hourly cost',
    },
};

function withSummaryUrl() {
    pageProps.profitability = {
        enabled: true,
        url: 'https://app.example.test/profitability',
        views: ['projects'],
        labels,
        organization_url: 'https://app.example.test/profitability/organizations/org-1',
        project: { summary_url: SUMMARY_URL },
    };
}

function summary(
    overrides: Record<string, unknown> = {},
    periodOverrides: Record<string, unknown> = {}
) {
    return {
        data: {
            data: {
                project_id: 'p-1',
                can_edit_terms: true,
                can_edit_plan: true,
                contract: {
                    service: 'SEO retainer',
                    schedule: 'monthly',
                    starts_on: '2026-10-01',
                    ends_on: null,
                    archived: false,
                },
                periods: [
                    {
                        id: 'period-0',
                        starts_on: '2026-10-01',
                        ends_on: '2026-10-31',
                        state: 'closed',
                    },
                    {
                        id: 'period-2',
                        starts_on: '2026-12-01',
                        ends_on: '2026-12-31',
                        state: 'upcoming',
                    },
                    {
                        id: 'period-1',
                        starts_on: '2026-11-01',
                        ends_on: '2026-11-30',
                        state: 'current',
                    },
                ],
                period: {
                    id: 'period-1',
                    starts_on: '2026-11-01',
                    ends_on: '2026-11-30',
                    state: 'current',
                    budget_seconds: 4464000,
                    consumed_seconds: 45000,
                    months: [],
                    still_to_consume_seconds: 4419000,
                    remaining_plan_seconds: 4464000,
                    run_rate_seconds: 360000,
                    status: 'on_track',
                    ...periodOverrides,
                },
                ...overrides,
            },
        },
    };
}

let wrapper: VueWrapper | null = null;

function mountCard() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = mount(ProjectSummaryCard, {
        props: { projectId: 'p-1' },
        attachTo: document.body,
        global: {
            plugins: [[VueQueryPlugin, { queryClient }]],
            // The chart needs a canvas; its option is covered by plannedVsConsumedOption.test.ts.
            stubs: { PlannedVsConsumedChart: true },
        },
    });
    return wrapper;
}

async function settle() {
    for (let i = 0; i < 3; i++) {
        await nextTick();
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await nextTick();
}

function query(testid: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
}

function text(testid: string): string {
    return query(testid)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('ProjectSummaryCard', () => {
    beforeEach(() => {
        for (const key of Object.keys(pageProps)) delete pageProps[key];
        axiosGet.mockReset();
    });

    afterEach(() => {
        wrapper?.unmount();
        wrapper = null;
        document.body.innerHTML = '';
        vi.useRealTimers();
    });

    it('renders nothing and sends no request without a summary URL', async () => {
        pageProps.profitability = { enabled: false };
        mountCard();
        await settle();
        expect(query('profitability-summary-card')).toBeNull();
        expect(wrapper?.html()).not.toContain('Contract');

        wrapper?.unmount();
        pageProps.profitability = { enabled: true, url: 'x', views: ['projects'], labels: {} };
        mountCard();
        await settle();
        expect(query('profitability-summary-card')).toBeNull();

        wrapper?.unmount();
        delete pageProps.profitability;
        mountCard();
        await settle();
        expect(query('profitability-summary-card')).toBeNull();
        expect(axiosGet).toHaveBeenCalledTimes(0);
    });

    it('renders nothing when the summary endpoint answers 404', async () => {
        withSummaryUrl();
        axiosGet.mockRejectedValue(
            Object.assign(new Error('Not Found'), { response: { status: 404 } })
        );
        mountCard();
        await vi.waitFor(() => expect(query('profitability-summary-card')).toBeNull());
        // 404 is an answer, never retried
        expect(axiosGet).toHaveBeenCalledTimes(1);
    });

    it('reserves 160px with a spinner while the summary loads', async () => {
        withSummaryUrl();
        axiosGet.mockReturnValue(new Promise(() => {}));
        mountCard();
        await settle();
        const loading = query('profitability-summary-loading');
        expect(loading).not.toBeNull();
        expect(loading?.className).toContain('min-h-[160px]');
        expect(loading?.querySelector('svg.animate-spin')).not.toBeNull();
        expect(axiosGet).toHaveBeenCalledWith(SUMMARY_URL, { params: undefined });
    });

    it('shows hours sold and consumed of the current period', async () => {
        withSummaryUrl();
        axiosGet.mockResolvedValue(summary());
        mountCard();
        await vi.waitFor(() => expect(query('profitability-summary-sold')).not.toBeNull());

        const card = query('profitability-summary-card')!;
        expect(card.className).toContain('pt-6');
        expect(card.textContent).toContain('Contract');
        expect(card.textContent).toContain('Hours sold');
        expect(card.textContent).toContain('Consumed');
        expect(text('profitability-summary-sold')).toBe('1,240 h');
        expect(text('profitability-summary-consumed')).toBe('12.5 h');
        expect(query('profitability-summary-sold')?.className).toContain('tabular-nums');
        expect(card.querySelector('svg.lucide-briefcase')).not.toBeNull();
    });

    it('shows the editor empty state when terms can be edited', async () => {
        withSummaryUrl();
        axiosGet.mockResolvedValue(summary({ contract: null, period: null }));
        mountCard();
        await vi.waitFor(() => expect(query('profitability-summary-empty')).not.toBeNull());
        expect(text('profitability-summary-empty')).toContain('No contract terms yet');
        expect(text('profitability-summary-empty')).toContain(labels.summary.empty_body_editor);
        expect(text('profitability-summary-empty')).not.toContain(labels.summary.empty_body_pm);
    });

    it('shows the project manager empty state otherwise', async () => {
        withSummaryUrl();
        axiosGet.mockResolvedValue(
            summary({ contract: null, period: null, can_edit_terms: false })
        );
        mountCard();
        await vi.waitFor(() => expect(query('profitability-summary-empty')).not.toBeNull());
        expect(text('profitability-summary-empty')).toContain(labels.summary.empty_body_pm);
        expect(text('profitability-summary-empty')).not.toContain(labels.summary.empty_body_editor);
    });

    it('shows the load error with Try again, which refetches', async () => {
        withSummaryUrl();
        axiosGet.mockRejectedValue(
            Object.assign(new Error('Server Error'), { response: { status: 500 } })
        );
        mountCard();
        await vi.waitFor(() => expect(query('profitability-summary-error')).not.toBeNull(), {
            timeout: 3000,
        });
        expect(text('profitability-summary-error')).toContain(labels.common.load_error);
        const calls = axiosGet.mock.calls.length;

        axiosGet.mockResolvedValue(summary());
        query('profitability-summary-error')!.querySelector('button')!.click();
        await vi.waitFor(() => expect(query('profitability-summary-sold')).not.toBeNull());
        expect(axiosGet.mock.calls.length).toBe(calls + 1);
    });

    it('shows the load error for a malformed payload', async () => {
        withSummaryUrl();
        axiosGet.mockResolvedValue({ data: { data: { nope: true } } });
        mountCard();
        await vi.waitFor(() => expect(query('profitability-summary-error')).not.toBeNull(), {
            timeout: 3000,
        });
    });
    it('shows the terms line, the hours KPIs, the projection caption and the meter', async () => {
        withSummaryUrl();
        axiosGet.mockResolvedValue(summary());
        mountCard();
        await vi.waitFor(() => expect(query('profitability-summary-terms')).not.toBeNull());

        expect(text('profitability-summary-terms')).toBe(
            'SEO retainer · Renews monthly · Since 1 Oct 2026'
        );
        expect(query('profitability-summary-terms')?.className).toContain('break-words');
        expect(text('profitability-summary-card')).toContain('Still to consume');
        expect(text('profitability-summary-still')).toBe('1,227.5 h');
        expect(text('profitability-summary-projected')).toBe('1,240 h');
        expect(text('profitability-summary-projection-caption')).toBe(
            'Following the plan. At the current pace: 100 h.'
        );
        const meter = document.body.querySelector('[role="meter"]');
        expect(meter?.getAttribute('data-variant')).toBe('full');
        expect(meter?.getAttribute('aria-valuenow')).toBe('12.5');
        expect(text('profitability-summary-meter-caption')).toBe(
            '12.5 h of 1,240 h consumed (1 %)'
        );
        expect(query('profitability-status')?.getAttribute('data-status')).toBe('on_track');
    });

    it('writes "Over by" in the over colour when the period is over the hours sold', async () => {
        withSummaryUrl();
        axiosGet.mockResolvedValue(
            summary(
                {},
                {
                    budget_seconds: 144000,
                    consumed_seconds: 165600,
                    still_to_consume_seconds: -21600,
                    remaining_plan_seconds: 180000,
                    status: 'over',
                }
            )
        );
        mountCard();
        await vi.waitFor(() => expect(query('profitability-summary-still')).not.toBeNull());
        expect(text('profitability-summary-card')).toContain('Over by');
        expect(text('profitability-summary-card')).not.toContain('Still to consume');
        expect(text('profitability-summary-still')).toBe('6 h');
        expect(query('profitability-summary-still')?.className).toContain('text-red-700');
        expect(text('profitability-meter-tick-label')).toBe('Sold 40 h');
        expect(query('profitability-meter-over')).not.toBeNull();
        expect(query('profitability-status')?.getAttribute('data-status')).toBe('over');
    });

    it('explains a missing run rate', async () => {
        withSummaryUrl();
        axiosGet.mockResolvedValue(summary({}, { run_rate_seconds: null }));
        mountCard();
        await vi.waitFor(() =>
            expect(query('profitability-summary-projection-caption')).not.toBeNull()
        );
        expect(text('profitability-summary-projection-caption')).toBe(
            labels.summary.run_rate_unavailable
        );
    });

    it('notes paused renewal and the end date for an archived project', async () => {
        withSummaryUrl();
        axiosGet.mockResolvedValue(
            summary({
                contract: {
                    service: null,
                    schedule: 'quarterly',
                    starts_on: '2026-01-01',
                    ends_on: '2027-06-30',
                    archived: true,
                },
            })
        );
        mountCard();
        await vi.waitFor(() => expect(query('profitability-summary-terms')).not.toBeNull());
        expect(text('profitability-summary-terms')).toBe(
            'Renews quarterly · Since 1 Jan 2026 · Until 30 Jun 2027 · Renewal paused (project archived)'
        );
    });

    it('lists the periods newest first and refetches the chosen one', async () => {
        withSummaryUrl();
        axiosGet.mockResolvedValue(summary());
        mountCard();
        await vi.waitFor(() => expect(query('profitability-summary-period')).not.toBeNull());
        expect(text('profitability-summary-period')).toBe('Nov 2026 · Current');

        query('profitability-summary-period')!.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
        );
        await vi.waitFor(() =>
            expect(
                document.body.querySelectorAll(
                    '[data-testid="profitability-summary-period-option"]'
                ).length
            ).toBe(3)
        );
        const options = [
            ...document.body.querySelectorAll(
                '[data-testid="profitability-summary-period-option"]'
            ),
        ].map((option) => option.textContent?.replace(/\s+/g, ' ').trim());
        expect(options).toEqual(['Dec 2026 · Upcoming', 'Nov 2026 · Current', 'Oct 2026 · Closed']);

        const calls = axiosGet.mock.calls.length;
        wrapper!.findComponent(Select).vm.$emit('update:modelValue', 'period-0');
        await vi.waitFor(() => expect(axiosGet.mock.calls.length).toBe(calls + 1));
        expect(axiosGet).toHaveBeenLastCalledWith(SUMMARY_URL, { params: { period: 'period-0' } });
    });
    describe('money, chart and period states', () => {
        const H = 3600;
        const QUARTER = [
            { month: '2026-10-01', planned_seconds: 40 * H, consumed_seconds: 40 * H },
            { month: '2026-11-01', planned_seconds: 40 * H, consumed_seconds: 20 * H },
            { month: '2026-12-01', planned_seconds: 40 * H, consumed_seconds: 0 },
        ];
        const QUARTER_PERIOD = {
            starts_on: '2026-10-01',
            ends_on: '2026-12-31',
            budget_seconds: 120 * H,
            consumed_seconds: 60 * H,
            months: QUARTER,
            still_to_consume_seconds: 60 * H,
            remaining_plan_seconds: 120 * H,
            run_rate_seconds: 110 * H,
        };
        const MONEY = {
            amount_cents: 1240000,
            revenue_to_date_cents: 826667,
            cost_cents: 250000,
            margin_cents: 370000,
            projected_cost_cents: 800000,
            projected_margin_cents: 440000,
            unpriced_cost_seconds: 0,
        };

        beforeEach(() => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(new Date('2026-11-15T12:00:00'));
        });

        async function mountWith(periodOverrides: Record<string, unknown>) {
            withSummaryUrl();
            axiosGet.mockResolvedValue(summary({}, { ...QUARTER_PERIOD, ...periodOverrides }));
            mountCard();
            await vi.waitFor(() => expect(query('profitability-summary-hours')).not.toBeNull());
        }

        it('renders no money element for a project manager payload', async () => {
            await mountWith({});
            const card = text('profitability-summary-card');
            expect(query('profitability-summary-money')).toBeNull();
            expect(card).not.toContain('€');
            expect(card).not.toContain('Incomplete');
            expect(card).not.toContain('Amount sold');
            expect(card).not.toContain('margin');
        });

        it('renders the four money tiles for an account manager payload', async () => {
            await mountWith(MONEY);
            const strip = query('profitability-summary-money');
            expect(strip).not.toBeNull();
            expect(strip?.querySelectorAll('dt')).toHaveLength(4);
            expect(text('profitability-summary-money')).toContain('Amount sold');
            expect(text('profitability-summary-money-amount')).toBe('€12,400.00');
            expect(text('profitability-summary-money-cost')).toBe('€2,500.00');
            expect(text('profitability-summary-money-margin')).toBe('€3,700.00');
            expect(text('profitability-summary-money-projected_margin')).toBe('€4,400.00');
            expect(query('profitability-summary-money-amount')?.className).toContain(
                'tabular-nums'
            );
        });

        it('writes a loss with a real minus in the loss colour', async () => {
            await mountWith({ ...MONEY, margin_cents: -125000 });
            expect(text('profitability-summary-money-margin')).toBe('−€1,250.00');
            expect(query('profitability-summary-money-margin')?.className).toContain(
                'text-red-700'
            );
        });

        it('shows "--" for a projected margin that is not known yet', async () => {
            await mountWith({ ...MONEY, projected_cost_cents: null, projected_margin_cents: null });
            expect(text('profitability-summary-money-projected_margin')).toBe('--');
        });

        it('replaces the margin numbers with Incomplete while hours have no cost', async () => {
            await mountWith({ ...MONEY, unpriced_cost_seconds: 7200 });
            for (const key of ['margin', 'projected_margin']) {
                const tile = query(`profitability-summary-money-${key}`);
                expect(tile?.getAttribute('data-incomplete')).toBe('true');
                expect(tile?.textContent?.trim()).toBe('Incomplete');
                expect(tile?.getAttribute('aria-label')).toBe(
                    'Incomplete cost: 2 h without an hourly cost'
                );
                expect(tile?.className).toContain('text-amber-800');
                expect(tile?.querySelector('svg.lucide-triangle-alert')).not.toBeNull();
            }
            expect(text('profitability-summary-money')).not.toContain('€3,700.00');
            // the cost to date stays a number
            expect(text('profitability-summary-money-cost')).toBe('€2,500.00');
        });

        it('shows a closed period with its result and final margin only', async () => {
            await mountWith({
                ...MONEY,
                state: 'closed',
                starts_on: '2026-07-01',
                ends_on: '2026-09-30',
                months: [
                    { month: '2026-07-01', planned_seconds: 40 * H, consumed_seconds: 40 * H },
                    { month: '2026-08-01', planned_seconds: 40 * H, consumed_seconds: 40 * H },
                    { month: '2026-09-01', planned_seconds: 40 * H, consumed_seconds: 34 * H },
                ],
                consumed_seconds: 114 * H,
                still_to_consume_seconds: 6 * H,
                remaining_plan_seconds: 114 * H,
                status: 'closed',
            });
            const hoursStrip = text('profitability-summary-hours');
            expect(hoursStrip).toContain('Hours sold');
            expect(hoursStrip).toContain('Consumed');
            expect(hoursStrip).toContain('Result');
            expect(hoursStrip).not.toContain('Still to consume');
            expect(hoursStrip).not.toContain('Projected at close');
            expect(text('profitability-summary-result')).toBe('6 h unused');
            expect(query('profitability-summary-projection-caption')).toBeNull();

            const money = query('profitability-summary-money');
            expect(money?.querySelectorAll('dt')).toHaveLength(1);
            expect(text('profitability-summary-money')).toContain('Final margin');
            expect(text('profitability-summary-money-final_margin')).toBe('€3,700.00');

            expect(query('profitability-status')?.getAttribute('data-status')).toBe('closed');
            expect(query('profitability-status')?.querySelector('svg.lucide-lock')).not.toBeNull();
            expect(query('profitability-meter-projected')).toBeNull();
            expect(text('profitability-summary-card')).not.toContain('(this month)');
        });

        it('writes "n h over" for a closed period over the hours sold', async () => {
            await mountWith({
                state: 'closed',
                consumed_seconds: 126 * H,
                still_to_consume_seconds: -6 * H,
                status: 'closed',
            });
            expect(text('profitability-summary-result')).toBe('6 h over');
            expect(query('profitability-summary-result')?.className).toContain('text-red-700');
        });

        it('shows an upcoming period with sold hours and amount and no consumption', async () => {
            await mountWith({
                ...MONEY,
                state: 'upcoming',
                starts_on: '2027-01-01',
                ends_on: '2027-03-31',
                consumed_seconds: 0,
                months: [
                    { month: '2027-01-01', planned_seconds: 40 * H, consumed_seconds: 0 },
                    { month: '2027-02-01', planned_seconds: 40 * H, consumed_seconds: 0 },
                    { month: '2027-03-01', planned_seconds: 40 * H, consumed_seconds: 0 },
                ],
                run_rate_seconds: null,
                status: 'not_started',
            });
            expect(text('profitability-summary-sold')).toBe('120 h');
            expect(text('profitability-summary-consumed')).toBe('--');
            expect(text('profitability-summary-still')).toBe('--');
            expect(text('profitability-summary-projected')).toBe('--');
            expect(query('profitability-summary-projection-caption')).toBeNull();
            expect(text('profitability-summary-money-amount')).toBe('€12,400.00');
            expect(text('profitability-summary-money-cost')).toBe('--');
            expect(text('profitability-summary-money-margin')).toBe('--');
            expect(text('profitability-summary-money-projected_margin')).toBe('--');
            expect(query('profitability-status')?.getAttribute('data-status')).toBe('not_started');
            const consumed = [
                ...document.body.querySelectorAll('[data-testid="profitability-month-consumed"]'),
            ].map((cell) => cell.textContent?.trim());
            expect(consumed).toEqual(['—', '—', '—']);
        });

        it('shows the chart and the month table for a period of several months', async () => {
            await mountWith({});
            const chart = wrapper!.findComponent({ name: 'PlannedVsConsumedChart' });
            expect(chart.exists()).toBe(true);
            expect(chart.props('months')).toHaveLength(3);
            expect(chart.props('currentMonth')).toBe('2026-11-01');
            expect(query('profitability-month-table')).not.toBeNull();
            const current = document.body.querySelector('[data-current="true"]');
            expect(current?.textContent?.replace(/\s+/g, ' ').trim()).toContain(
                'Nov 2026 (this month)'
            );
        });

        it('shows the meter and month table without a chart for a one-month period', async () => {
            await mountWith({
                starts_on: '2026-11-01',
                ends_on: '2026-11-30',
                months: [QUARTER[1]],
            });
            expect(wrapper!.findComponent({ name: 'PlannedVsConsumedChart' }).exists()).toBe(false);
            expect(document.body.querySelector('[role="meter"]')).not.toBeNull();
            expect(
                document.body.querySelectorAll('[data-testid="profitability-month-row"]')
            ).toHaveLength(1);
        });

        it('passes the twelve months of an annual period to the chart', async () => {
            const months = Array.from({ length: 12 }, (_, index) => ({
                month: `2026-${String(index + 1).padStart(2, '0')}-01`,
                planned_seconds: 10 * H,
                consumed_seconds: index < 10 ? 10 * H : 0,
            }));
            await mountWith({ starts_on: '2026-01-01', ends_on: '2026-12-31', months });
            const chart = wrapper!.findComponent({ name: 'PlannedVsConsumedChart' });
            expect(chart.props('months')).toHaveLength(12);
            expect(
                document.body.querySelectorAll('[data-testid="profitability-month-row"]')
            ).toHaveLength(12);
        });
    });
});
