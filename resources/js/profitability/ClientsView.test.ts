import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import axios from 'axios';
import ClientsView from './ClientsView.vue';
import { discoverViews, viewKeyFromPath } from './labels';

const { pageProps } = vi.hoisted(() => ({
    pageProps: {} as Record<string, unknown>,
}));

vi.mock('@inertiajs/vue3', async () => {
    const { h } = await import('vue');
    return {
        usePage: () => ({ props: pageProps }),
        router: { visit: vi.fn() },
        Link: {
            props: { href: { type: String, default: '' } },
            setup(props: { href: string }, { slots }: { slots: { default?: () => unknown } }) {
                return () => h('a', { href: props.href }, slots.default?.() as never);
            },
        },
    };
});

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

const ORG_URL = 'https://app.example.test/profitability/organizations/org-1';

const LABELS = {
    common: {
        try_again: 'Try again',
        load_error: 'Couldn’t load profitability figures.',
        no_client: 'No client',
        figures_up_to_today: ':range. Figures up to today, :date.',
    },
    status: { on_track: 'On track', at_risk: 'At risk', over: 'Over budget' },
    kpi: { hours_sold: 'Hours sold', hours_consumed: 'Hours consumed' },
    ranges: {
        label: 'Range',
        this_month: 'This month',
        last_month: 'Last month',
        this_quarter: 'This quarter',
        last_quarter: 'Last quarter',
        year_to_date: 'Year to date',
        last_12_months: 'Last 12 months',
    },
    clients: {
        columns: {
            client: 'Client',
            hours_sold: 'Hours sold',
            hours_consumed: 'Hours consumed',
            status: 'Status',
        },
        project_count: ':count projects',
        project_count_one: ':count project',
        expand_aria: 'Show projects of :client',
        collapse_aria: 'Hide projects of :client',
        empty_title: 'No client figures for this range',
        empty_body: 'Clients appear here once their projects have contract terms.',
    },
    money: {
        kpi: { amount_sold: 'Amount sold', cost: 'Cost', margin: 'Margin', margin_pct: 'Margin %' },
        columns: {
            amount_sold: 'Amount sold',
            cost: 'Cost',
            margin: 'Margin',
            margin_pct: 'Margin %',
        },
        incomplete: 'Incomplete',
        incomplete_tooltip: ':n h without an hourly cost. Set costs in Settings.',
        incomplete_aria: 'Incomplete cost: :n h without an hourly cost',
        margin_chart_title: 'Margin by client',
        margin_chart_aria: 'Margin by client for :range. Details in the table below.',
        margin_chart_tooltip: ':client · Margin :margin (:pct) · Sold :amount · Cost :cost',
        other_clients: 'Other clients',
        incomplete_chart_tooltip: 'Incomplete: :n h without an hourly cost',
    },
};

function share() {
    pageProps.profitability = {
        enabled: true,
        url: 'https://app.example.test/profitability',
        views: ['projects', 'clients'],
        organization_url: ORG_URL,
        labels: LABELS,
    };
}

function project(
    id: string,
    name: string,
    margin: number,
    overrides: Record<string, unknown> = {}
) {
    return {
        project_id: id,
        name,
        color: '#ef5350',
        client_id: 'c-1',
        archived: false,
        hours_sold_seconds: 36000,
        consumed_seconds: 18000,
        amount_cents: 100000,
        cost_cents: 100000 - margin,
        margin_cents: margin,
        margin_percent: margin / 1000,
        unpriced_cost_seconds: 0,
        status: 'on_track',
        ...overrides,
    };
}

function client(
    id: string | null,
    name: string | null,
    margin: number,
    overrides: Record<string, unknown> = {}
) {
    const projects = [project(`${id ?? 'none'}-p1`, `${name ?? 'Loose'} project`, margin)];
    return {
        client_id: id,
        name,
        project_count: projects.length,
        hours_sold_seconds: 36000,
        consumed_seconds: 18000,
        amount_cents: 100000,
        cost_cents: 100000 - margin,
        margin_cents: margin,
        margin_percent: margin / 1000,
        unpriced_cost_seconds: 0,
        status: margin < 0 ? 'over' : 'on_track',
        projects,
        ...overrides,
    };
}

const THIS_MONTH = {
    key: 'this_month',
    from: '2026-11-01',
    to: '2026-11-30',
    capped_to: '2026-11-27',
    contains_today: true,
};

const LAST_MONTH = {
    key: 'last_month',
    from: '2026-10-01',
    to: '2026-10-31',
    capped_to: '2026-10-31',
    contains_today: false,
};

function respond(clients: unknown[], range: Record<string, unknown> = THIS_MONTH) {
    axiosGet.mockResolvedValue({ data: { data: clients, meta: { range } } });
}

let wrapper: VueWrapper | null = null;

function mountView() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = mount(ClientsView, {
        attachTo: document.body,
        global: {
            plugins: [[VueQueryPlugin, { queryClient }]],
            stubs: { ClientMarginChart: true },
        },
    });
    return wrapper;
}

async function settle() {
    for (let i = 0; i < 4; i++) {
        await nextTick();
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await nextTick();
}

function all(testid: string): HTMLElement[] {
    return Array.from(document.body.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`));
}

function query(testid: string): HTMLElement | null {
    return all(testid)[0] ?? null;
}

function clientNames(): string[] {
    return all('profitability-clients-name').map((node) => node.textContent?.trim() ?? '');
}

describe('ClientsView', () => {
    beforeEach(() => {
        for (const key of Object.keys(pageProps)) delete pageProps[key];
        window.history.replaceState(null, '', '/profitability?view=clients');
        window.localStorage.clear();
        axiosGet.mockReset();
        share();
    });

    afterEach(() => {
        wrapper?.unmount();
        wrapper = null;
        document.body.innerHTML = '';
    });

    it('is the clients tab of the page by its file name', () => {
        expect(viewKeyFromPath('./ClientsView.vue')).toBe('clients');
        const discovered = discoverViews(
            import.meta.glob<{ default: unknown }>('./*View.vue', { eager: true })
        );
        expect(Object.keys(discovered)).toContain('clients');
    });

    it('fetches the range from ?range= and lists losses first with No client last', async () => {
        window.history.replaceState(null, '', '/profitability?view=clients&range=last_quarter');
        respond([
            client(null, null, -500000),
            client('c-1', 'Gain Corp', 40000),
            client('c-2', 'Loss Ltd', -20000),
            client('c-3', 'Middle SA', 5000),
        ]);
        mountView();
        await settle();

        expect(axiosGet).toHaveBeenCalledWith(`${ORG_URL}/views/clients`, {
            params: { range: 'last_quarter' },
        });
        expect(clientNames()).toEqual(['Loss Ltd', 'Middle SA', 'Gain Corp', 'No client']);
        const lossMargin = all('profitability-clients-margin')[0];
        expect(lossMargin?.textContent).toContain('−');
        expect(lossMargin?.className).toContain('text-red-700');
    });

    it('shows the money and hours KPIs from the totals', async () => {
        axiosGet.mockResolvedValue({
            data: {
                data: [client('c-1', 'Gain Corp', 40000)],
                meta: {
                    range: THIS_MONTH,
                    totals: {
                        hours_sold_seconds: 36000,
                        consumed_seconds: 18000,
                        amount_cents: 100000,
                        cost_cents: 125000,
                        margin_cents: -25000,
                        margin_percent: -25,
                        unpriced_cost_seconds: 0,
                    },
                },
            },
        });
        mountView();
        await settle();

        const kpis = query('profitability-clients-kpis')?.textContent ?? '';
        expect(kpis).toContain('Amount sold');
        expect(kpis).toContain('Hours sold');
        expect(kpis).toContain('10 h');
        expect(kpis).toContain('5 h');
        expect(kpis).toContain('−25 %');
        expect(query('profitability-clients-kpi-margin')?.className).toContain('text-red-700');
    });

    it('expands a client into its projects and collapses it again', async () => {
        respond([
            client('c-1', 'Gain Corp', 40000, {
                project_count: 2,
                projects: [project('p-1', 'Website', 30000), project('p-2', 'Ads', 10000)],
            }),
        ]);
        mountView();
        await settle();

        const toggle = query('profitability-clients-toggle') as HTMLButtonElement;
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.getAttribute('aria-label')).toBe('Show projects of Gain Corp');
        expect(all('profitability-clients-project-row')).toHaveLength(0);
        expect(query('profitability-clients-row')?.textContent).toContain('2 projects');

        toggle.click();
        await settle();

        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(toggle.getAttribute('aria-label')).toBe('Hide projects of Gain Corp');
        const projects = all('profitability-clients-project-row');
        expect(projects.map((row) => row.dataset.projectId)).toEqual(['p-2', 'p-1']);
        const link = document.body.querySelector('a[href="/projects/p-1"]');
        expect(link?.textContent?.trim()).toBe('Website');

        toggle.click();
        await settle();

        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(all('profitability-clients-project-row')).toHaveLength(0);
    });

    it('labels the No client toggle with the No client copy', async () => {
        respond([client(null, null, 1000)]);
        mountView();
        await settle();

        expect(query('profitability-clients-toggle')?.getAttribute('aria-label')).toBe(
            'Show projects of No client'
        );
        expect(query('profitability-clients-row')?.textContent).toContain('1 project');
    });

    it('shows Incomplete instead of a margin when hours have no cost', async () => {
        respond([client('c-1', 'Gain Corp', 40000, { unpriced_cost_seconds: 7200 })]);
        mountView();
        await settle();

        const incomplete = query('profitability-clients-margin-incomplete');
        expect(incomplete?.textContent).toContain('Incomplete');
        expect(incomplete?.getAttribute('aria-label')).toBe(
            'Incomplete cost: 2 h without an hourly cost'
        );
        expect(query('profitability-clients-margin-pct')?.textContent?.trim()).toBe('--');
    });

    it('hides the margin chart with fewer than two clients', async () => {
        respond([client('c-1', 'Gain Corp', 40000)]);
        mountView();
        await settle();

        expect(query('profitability-client-margin-card')).toBeNull();
        expect(wrapper!.findComponent({ name: 'ClientMarginChart' }).exists()).toBe(false);
    });

    it('shows the margin chart for two or more clients, No client included by name', async () => {
        respond([client('c-1', 'Gain Corp', 40000), client(null, null, -3000)]);
        mountView();
        await settle();

        expect(query('profitability-client-margin-card')?.textContent).toContain(
            'Margin by client'
        );
        const chart = wrapper!.findComponent({ name: 'ClientMarginChart' });
        expect(chart.exists()).toBe(true);
        const entries = chart.props('clients') as Array<{ name: string; margin_cents: number }>;
        expect(entries.map((entry) => entry.name)).toEqual(['Gain Corp', 'No client']);
        expect(chart.props('rangeLabel')).toBe('This month');
        const formatMoney = chart.props('formatMoney') as (cents: number) => string;
        expect(formatMoney(-3000)).toMatch(/^−/);
    });

    it('shows the empty state for a range without figures', async () => {
        respond([], LAST_MONTH);
        mountView();
        await settle();

        const empty = query('profitability-clients-empty');
        expect(empty?.textContent).toContain('No client figures for this range');
        expect(empty?.textContent).toContain('Clients appear here');
        expect(query('profitability-clients-table')).toBeNull();
    });

    it('shows the caption only when the range contains today', async () => {
        respond([client('c-1', 'Gain Corp', 40000)], THIS_MONTH);
        mountView();
        await settle();

        expect(query('profitability-range-caption')?.textContent?.trim()).toBe(
            'This month. Figures up to today, 27 Nov 2026.'
        );

        wrapper?.unmount();
        document.body.innerHTML = '';
        window.history.replaceState(null, '', '/profitability?range=last_month');
        respond([client('c-1', 'Gain Corp', 40000)], LAST_MONTH);
        mountView();
        await settle();

        expect(query('profitability-range-caption')).toBeNull();
    });

    it('replaces the body with the load error and retries', async () => {
        axiosGet.mockRejectedValue(new Error('offline'));
        mountView();
        // The query retries once (300 ms) before it gives up
        await vi.waitFor(() => expect(query('profitability-clients-error')).not.toBeNull(), {
            timeout: 3000,
        });

        const error = query('profitability-clients-error');
        expect(error?.textContent).toContain('Couldn’t load profitability figures.');
        expect(query('profitability-clients-table')).toBeNull();

        respond([client('c-1', 'Gain Corp', 40000)]);
        (error?.querySelector('button') as HTMLButtonElement).click();
        await settle();

        expect(query('profitability-clients-error')).toBeNull();
        expect(clientNames()).toEqual(['Gain Corp']);
    });
});
