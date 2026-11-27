import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import axios from 'axios';
import { Select } from '@/packages/ui/src/select';
import ProjectsView from './ProjectsView.vue';

const { pageProps, visit } = vi.hoisted(() => ({
    pageProps: {} as Record<string, unknown>,
    visit: vi.fn(),
}));

vi.mock('@inertiajs/vue3', async () => {
    const { h } = await import('vue');
    return {
        usePage: () => ({ props: pageProps }),
        router: { visit },
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
        organization: computed(() => ({ number_format: 'comma-point' })),
    }),
}));

vi.mock('axios', () => ({
    default: { get: vi.fn() },
}));

const axiosGet = vi.mocked(axios.get);

const ORG_URL = 'https://app.example.test/profitability/organizations/org-1';

const baseLabels = {
    common: {
        hours_over: ':n h over',
        not_available: 'Not available',
        try_again: 'Try again',
        load_error: 'Couldn’t load profitability figures.',
        show_all: 'Show all',
        no_client: 'No client',
    },
    period_state: { current: 'Current', upcoming: 'Upcoming', closed: 'Closed' },
    schedule: { monthly: 'Renews monthly', one_off: 'One-off' },
    status: {
        on_track: 'On track',
        at_risk: 'At risk',
        over: 'Over budget',
        not_started: 'Not started',
        closed: 'Closed',
        no_contract: 'No contract',
    },
    kpi: {
        hours_sold: 'Hours sold',
        hours_consumed: 'Hours consumed',
        still_to_consume: 'Still to consume',
        projects_at_risk: 'Projects at risk',
    },
    projects: {
        filter_label: 'Contract',
        filter: {
            active: 'Active',
            without_terms: 'Without contract terms',
            ended: 'Ended',
            all: 'All',
        },
        columns: {
            project: 'Project',
            period: 'Period',
            sold: 'Sold',
            consumed: 'Consumed',
            still_to_consume: 'Still to consume',
            projected_at_close: 'Projected at close',
            status: 'Status',
        },
        actions_aria: 'Actions for :project',
        open_project: 'Open project',
        empty_editor_title: 'No contract terms yet',
        empty_editor_body: 'Set the hours and amount sold on a billable project.',
        empty_pm_title: 'No contract terms on your projects yet',
        empty_pm_body: 'The account manager sets the hours sold.',
        empty_filter: 'No projects match this filter.',
    },
};

const moneyLabels = {
    kpi: {
        amount_sold: 'Amount sold',
        cost_to_date: 'Cost to date',
        margin_to_date: 'Margin to date',
        projected_margin: 'Projected margin',
    },
    columns: { amount: 'Amount', cost: 'Cost', margin: 'Margin' },
    incomplete: 'Incomplete',
    incomplete_tooltip: ':n h without an hourly cost. Set costs in Settings.',
    incomplete_aria: 'Incomplete cost: :n h without an hourly cost',
    totals_caption: 'Money totals cover :n of :total projects (the clients you manage).',
};

const adminLabels = {
    legacy_nonbillable: ':h on billable projects were logged as non-billable before this rule.',
};

function share(groups: { money?: boolean; admin?: boolean } = {}) {
    pageProps.profitability = {
        enabled: true,
        url: 'https://app.example.test/profitability',
        views: ['projects'],
        organization_url: ORG_URL,
        labels: {
            ...baseLabels,
            ...(groups.money ? { money: moneyLabels } : {}),
            ...(groups.admin ? { admin: adminLabels } : {}),
        },
    };
}

function row(overrides: Record<string, unknown> = {}) {
    return {
        project_id: 'p-1',
        name: 'Alpha',
        color: '#ef5350',
        client_id: 'c-1',
        client_name: 'Client A',
        archived: false,
        schedule: 'monthly',
        period: { id: 'per-1', starts_on: '2026-11-01', ends_on: '2026-11-30', state: 'current' },
        budget_seconds: 144000,
        consumed_seconds: 36000,
        still_to_consume_seconds: 108000,
        remaining_plan_seconds: 144000,
        run_rate_seconds: null,
        status: 'on_track',
        can_edit_terms: false,
        can_edit_plan: false,
        ...overrides,
    };
}

const MONEY = {
    amount_cents: 300000,
    revenue_to_date_cents: 300000,
    cost_cents: 50000,
    margin_cents: 250000,
    projected_cost_cents: 120000,
    projected_margin_cents: 180000,
    unpriced_cost_seconds: 0,
};

function respond(rows: unknown[], meta: Record<string, unknown> = {}) {
    const moneyRows = rows.filter((entry) => 'amount_cents' in (entry as object)).length;
    axiosGet.mockResolvedValue({
        data: { data: rows, meta: { total_rows: rows.length, money_rows: moneyRows, ...meta } },
    });
}

let wrapper: VueWrapper | null = null;

function mountView() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = mount(ProjectsView, {
        attachTo: document.body,
        global: { plugins: [[VueQueryPlugin, { queryClient }]] },
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

function text(testid: string): string {
    return query(testid)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('ProjectsView', () => {
    beforeEach(() => {
        for (const key of Object.keys(pageProps)) delete pageProps[key];
        axiosGet.mockReset();
        visit.mockReset();
        window.localStorage.clear();
        window.history.replaceState(null, '', '/profitability');
    });

    afterEach(() => {
        wrapper?.unmount();
        wrapper = null;
        document.body.innerHTML = '';
    });

    it('renders no money column, tile or placeholder for a project manager payload', async () => {
        share();
        respond([row(), row({ project_id: 'p-2', name: 'Bravo' })]);
        mountView();
        await settle();

        const table = text('profitability-projects-table');
        expect(table).toContain('Alpha');
        expect(table).not.toContain('Amount');
        expect(table).not.toContain('Margin');
        expect(query('profitability-money-kpis')).toBeNull();
        expect(all('profitability-money-not-available')).toHaveLength(0);
        expect(document.body.innerHTML).not.toContain('€');
        expect(document.body.innerHTML).not.toContain('Not available');
    });

    it('fetches the active filter by default and shows the hours KPIs over current periods', async () => {
        share();
        respond([
            row(),
            row({
                project_id: 'p-2',
                name: 'Bravo',
                status: 'over',
                budget_seconds: 36000,
                consumed_seconds: 57600,
                still_to_consume_seconds: 0,
            }),
            row({
                project_id: 'p-3',
                name: 'Closed one',
                status: 'closed',
                period: {
                    id: 'per-3',
                    starts_on: '2026-10-01',
                    ends_on: '2026-10-31',
                    state: 'closed',
                },
            }),
        ]);
        mountView();
        await settle();

        expect(axiosGet).toHaveBeenCalledWith(`${ORG_URL}/views/projects`, {
            params: { contract: 'active' },
        });
        const values = Array.from(
            document.body.querySelectorAll('dl')[0]?.querySelectorAll('dd') ?? []
        ).map((dd) => dd.textContent?.trim());
        // The closed row is left out: 40 h + 10 h sold, 10 h + 16 h consumed, 30 h + 0 h still to
        // consume, 1 project at risk or over
        expect(values).toEqual(['50 h', '26 h', '30 h', '1']);
    });

    it('shows "n h over" in the over colour for an over-budget row', async () => {
        share();
        respond([
            row({
                status: 'over',
                budget_seconds: 36000,
                consumed_seconds: 57600,
                still_to_consume_seconds: 0,
            }),
        ]);
        mountView();
        await settle();

        const over = query('profitability-hours-over');
        expect(over?.textContent?.trim()).toBe('6 h over');
        expect(over?.className).toContain('text-red-700');
    });

    it('labels the money cells of rows without money and shows the totals caption', async () => {
        share({ money: true });
        respond([
            row({ ...MONEY, can_edit_terms: true }),
            row({ project_id: 'p-2', name: 'Bravo' }),
        ]);
        mountView();
        await settle();

        expect(text('profitability-projects-table')).toContain('Amount');
        const empty = all('profitability-money-not-available');
        expect(empty).toHaveLength(3);
        for (const cell of empty) {
            expect(cell.getAttribute('aria-label')).toBe('Not available');
            expect(cell.textContent?.trim()).toBe('');
        }
        expect(query('profitability-money-kpis')).not.toBeNull();
        expect(text('profitability-money-caption')).toBe(
            'Money totals cover 1 of 2 projects (the clients you manage).'
        );
    });

    it('shows "Incomplete" instead of a margin when hours have no cost', async () => {
        share({ money: true });
        respond([row({ ...MONEY, unpriced_cost_seconds: 7200, projected_margin_cents: null })]);
        mountView();
        await settle();

        const cell = query('profitability-margin-incomplete');
        expect(cell?.textContent?.trim()).toBe('Incomplete');
        expect(cell?.getAttribute('aria-label')).toBe(
            'Incomplete cost: 2 h without an hourly cost'
        );
        expect(query('profitability-money-caption')).toBeNull();
    });

    it('shows the legacy notice only when the meta key is present', async () => {
        share({ money: true, admin: true });
        respond([row(MONEY)], { nonbillable_legacy_seconds: 5400 });
        mountView();
        await settle();
        expect(text('profitability-legacy-notice')).toContain('1.5 h on billable projects');

        wrapper?.unmount();
        document.body.innerHTML = '';
        respond([row(MONEY)]);
        mountView();
        await settle();
        expect(query('profitability-legacy-notice')).toBeNull();
    });

    it('sorts worst status first by default', async () => {
        share();
        respond([
            row({ project_id: 'a', name: 'On track one', status: 'on_track' }),
            row({ project_id: 'b', name: 'Not started one', status: 'not_started' }),
            row({ project_id: 'c', name: 'At risk one', status: 'at_risk' }),
            row({ project_id: 'd', name: 'Over one', status: 'over' }),
        ]);
        mountView();
        await settle();

        const order = all('profitability-projects-row').map((el) =>
            el.getAttribute('data-project-id')
        );
        expect(order).toEqual(['d', 'c', 'a', 'b']);
    });

    it('opens the project on row click but not from the actions button', async () => {
        share();
        respond([row()]);
        mountView();
        await settle();

        query('profitability-projects-actions')?.click();
        expect(visit).not.toHaveBeenCalled();

        const cells = query('profitability-projects-row')?.children;
        (cells?.[2] as HTMLElement).click();
        expect(visit).toHaveBeenCalledWith('/projects/p-1');
    });

    it('shows the editor empty state for scopes that can set terms', async () => {
        share({ money: true });
        respond([]);
        mountView();
        await settle();

        expect(text('profitability-projects-empty-editor')).toContain('No contract terms yet');
    });

    it('shows the project manager empty state otherwise', async () => {
        share();
        respond([]);
        mountView();
        await settle();

        expect(text('profitability-projects-empty-pm')).toContain(
            'No contract terms on your projects yet'
        );
    });

    it('offers "Show all" when a filter has no rows', async () => {
        window.history.replaceState(null, '', '/profitability?contract=ended');
        share();
        respond([]);
        mountView();
        await settle();

        expect(text('profitability-projects-empty-filter')).toContain(
            'No projects match this filter.'
        );
        const button = Array.from(document.body.querySelectorAll('button')).find(
            (el) => el.textContent?.trim() === 'Show all'
        );
        button?.click();
        await settle();

        expect(window.location.search).toContain('contract=all');
        expect(axiosGet).toHaveBeenLastCalledWith(`${ORG_URL}/views/projects`, {
            params: { contract: 'all' },
        });
    });

    it('writes the contract filter to ?contract=', async () => {
        share();
        respond([row()]);
        const view = mountView();
        await settle();

        view.findComponent(Select).vm.$emit('update:modelValue', 'ended');
        await settle();

        expect(window.location.search).toContain('contract=ended');
        expect(axiosGet).toHaveBeenLastCalledWith(`${ORG_URL}/views/projects`, {
            params: { contract: 'ended' },
        });
    });

    it('shows the load error card and retries with Try again', async () => {
        share();
        axiosGet.mockRejectedValue(new Error('offline'));
        mountView();
        // The query retries once (300 ms) before it gives up
        await vi.waitFor(() => expect(query('profitability-projects-error')).not.toBeNull(), {
            timeout: 3000,
        });

        expect(text('profitability-projects-error')).toContain('Couldn’t load');
        respond([row()]);
        const retry = Array.from(document.body.querySelectorAll('button')).find(
            (el) => el.textContent?.trim() === 'Try again'
        );
        retry?.click();
        await vi.waitFor(() => expect(query('profitability-projects-error')).toBeNull(), {
            timeout: 3000,
        });
        await settle();

        expect(text('profitability-projects-table')).toContain('Alpha');
    });

    it('shows a spinner and "--" KPIs on the first load', async () => {
        share();
        axiosGet.mockReturnValue(new Promise(() => {}));
        mountView();
        await settle();

        expect(query('profitability-projects-loading')).not.toBeNull();
        expect(document.body.querySelector('dl')?.textContent).toContain('--');
    });
});
