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
        organization: computed(() => ({ number_format: 'comma-point' })),
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
        global: { plugins: [[VueQueryPlugin, { queryClient }]] },
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
});
