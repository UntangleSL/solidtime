import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import axios from 'axios';
import PeopleView from './PeopleView.vue';

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
        organization: computed(() => ({ number_format: 'comma-point' })),
    }),
}));

vi.mock('axios', () => ({
    default: { get: vi.fn() },
}));

const axiosGet = vi.mocked(axios.get);

const ORG_URL = 'https://app.example.test/profitability/organizations/org-1';
const H = 3600;

const labels = {
    tabs: { people: 'People' },
    common: {
        former_member: 'Former member',
        try_again: 'Try again',
        load_error: 'Couldn’t load profitability figures.',
        figures_up_to_today: ':range. Figures up to today, :date.',
    },
    ranges: {
        label: 'Range',
        this_month: 'This month',
        last_month: 'Last month',
        this_quarter: 'This quarter',
        last_quarter: 'Last quarter',
        year_to_date: 'Year to date',
        last_12_months: 'Last 12 months',
    },
    status: { on_track: 'On track', below_target: 'Below target' },
    admin: {
        people: {
            kpi: {
                team_chargeability: 'Team chargeability',
                billable_hours: 'Billable hours',
                available_hours: 'Available hours',
                absence_hours: 'Absence hours',
                target: 'Target :pct',
            },
            chart_title: 'Chargeability vs target',
            chart_aria: 'Chargeability and target per person for :range.',
            chart_legend_chargeability: 'Chargeability',
            chart_legend_target: 'Target',
            chart_tooltip:
                ':name · :pct (target :target) · :billable billable of :available available',
            columns: {
                person: 'Person',
                working_week: 'Working week',
                available: 'Available',
                absence: 'Absence',
                billable: 'Billable',
                internal: 'Internal',
                chargeability: 'Chargeability',
                target: 'Target',
                gap: 'Gap',
                status: 'Status',
            },
            no_working_week: 'No working week',
            set_in_settings: 'Set in Settings',
            empty_title: 'No working weeks set',
            empty_body: 'Set each person’s working week in Settings to calculate chargeability.',
            go_to_settings: 'Go to Settings',
        },
    },
};

function share() {
    pageProps.profitability = {
        enabled: true,
        url: 'https://app.example.test/profitability',
        views: ['projects', 'people'],
        organization_url: ORG_URL,
        labels,
    };
}

function person(overrides: Record<string, unknown> = {}) {
    return {
        member_id: 'm-1',
        name: 'Ana',
        is_placeholder: false,
        weekly_seconds: 40 * H,
        available_seconds: 160 * H,
        absence_seconds: 8 * H,
        billable_seconds: 112 * H,
        internal_seconds: 40 * H,
        chargeability: 0.7,
        target_percent: 75,
        gap_points: -5,
        status: 'below_target',
        ...overrides,
    };
}

const NO_WEEK = {
    weekly_seconds: null,
    available_seconds: null,
    chargeability: null,
    target_percent: null,
    gap_points: null,
    status: null,
};

function respond(rows: unknown[], range: Record<string, unknown> = {}) {
    axiosGet.mockResolvedValue({
        data: {
            data: rows,
            meta: {
                range: {
                    key: 'this_month',
                    from: '2026-11-01',
                    to: '2026-11-30',
                    capped_to: '2026-11-27',
                    contains_today: true,
                    ...range,
                },
                team: {
                    billable_seconds: 112 * H,
                    available_seconds: 160 * H,
                    absence_seconds: 8 * H,
                    internal_seconds: 40 * H,
                    chargeability: 0.7,
                    target_percent: 75,
                },
            },
        },
    });
}

let wrapper: VueWrapper | null = null;

function mountView() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = mount(PeopleView, {
        attachTo: document.body,
        global: {
            plugins: [[VueQueryPlugin, { queryClient }]],
            // The canvas chart has its own option-builder spec; here only its presence matters.
            stubs: { ChargeabilityChart: { template: '<div data-testid="stub-chart" />' } },
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

function text(testid: string): string {
    return query(testid)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('PeopleView', () => {
    beforeEach(() => {
        for (const key of Object.keys(pageProps)) delete pageProps[key];
        axiosGet.mockReset();
        window.history.replaceState(null, '', '/profitability?view=people');
    });

    afterEach(() => {
        wrapper?.unmount();
        wrapper = null;
        document.body.innerHTML = '';
    });

    it('fetches this month by default and shows the team KPIs with the target caption', async () => {
        share();
        respond([person()]);
        mountView();
        await settle();

        expect(axiosGet).toHaveBeenCalledWith(`${ORG_URL}/views/people`, {
            params: { range: 'this_month' },
        });
        expect(text('profitability-people-team')).toBe('70 %');
        expect(text('profitability-people-team-target')).toBe('Target 75 %');
        const values = Array.from(document.body.querySelectorAll('dd')).map((dd) =>
            dd.textContent?.replace(/\s+/g, ' ').trim()
        );
        expect(values.slice(1)).toEqual(['112 h', '160 h', '8 h']);
    });

    it('starts from ?range= and shows the figures-up-to-today caption', async () => {
        window.history.replaceState(null, '', '/profitability?view=people&range=this_quarter');
        share();
        respond([person()], { key: 'this_quarter', from: '2026-10-01', to: '2026-12-31' });
        mountView();
        await settle();

        expect(axiosGet).toHaveBeenCalledWith(`${ORG_URL}/views/people`, {
            params: { range: 'this_quarter' },
        });
        expect(text('profitability-range-caption')).toBe(
            'This quarter. Figures up to today, 27 Nov 2026.'
        );
    });

    it('renders a row with chargeability, meter, target, gap and status', async () => {
        share();
        respond([person()]);
        mountView();
        await settle();

        const row = query('profitability-people-row');
        const cells = Array.from(row?.querySelectorAll('[role="cell"]') ?? []).map((cell) =>
            cell.textContent?.replace(/\s+/g, ' ').trim()
        );
        expect(cells).toEqual([
            'Ana',
            '40 h',
            '160 h',
            '8 h',
            '112 h',
            '40 h',
            '70 %',
            '75 %',
            '−5 pp',
            'Below target',
        ]);
        const meter = query('profitability-people-meter');
        expect(meter?.getAttribute('aria-valuenow')).toBe('70');
        expect(meter?.getAttribute('aria-valuetext')).toBe('70 % · Target 75 %');
        expect(query('profitability-people-meter-tick')?.style.left).toBe('calc(75% - 1px)');
    });

    it('colours the gap as a loss below target only', async () => {
        share();
        respond([
            person(),
            person({
                member_id: 'm-2',
                name: 'Bea',
                chargeability: 0.8,
                gap_points: 5,
                status: 'on_track',
            }),
        ]);
        mountView();
        await settle();

        const [below, above] = all('profitability-people-gap');
        expect(below?.textContent?.trim()).toBe('−5 pp');
        expect(below?.className).toContain('text-red-700');
        expect(above?.textContent?.trim()).toBe('+5 pp');
        expect(above?.className).not.toContain('text-red-700');
        const statuses = all('profitability-people-status').map((el) =>
            el.getAttribute('data-status')
        );
        expect(statuses).toEqual(['below_target', 'on_track']);
    });

    it('links a person without a working week to their Settings dialog', async () => {
        window.history.replaceState(null, '', '/profitability?view=people&range=last_month');
        share();
        respond([person(), person({ member_id: 'm-2', name: 'Bea', ...NO_WEEK })]);
        mountView();
        await settle();

        const missing = all('profitability-people-no-working-week');
        expect(missing).toHaveLength(1);
        expect(missing[0]?.textContent).toContain('No working week');
        const link = query('profitability-people-set-in-settings');
        expect(link?.textContent?.trim()).toBe('Set in Settings');
        const href = new URL(link?.getAttribute('href') ?? '', 'https://app.example.test');
        expect(href.pathname).toBe('/profitability');
        expect(href.searchParams.get('view')).toBe('settings');
        expect(href.searchParams.get('member')).toBe('m-2');
        expect(query('profitability-people-empty')).toBeNull();
    });

    it('shows the empty state with "Go to Settings" when nobody has a working week', async () => {
        share();
        respond([person({ ...NO_WEEK })]);
        mountView();
        await settle();

        expect(text('profitability-people-empty')).toContain('No working weeks set');
        const link = query('profitability-people-go-to-settings');
        expect(link?.textContent?.trim()).toBe('Go to Settings');
        const href = new URL(link?.getAttribute('href') ?? '', 'https://app.example.test');
        expect(href.searchParams.get('view')).toBe('settings');
        expect(href.searchParams.has('member')).toBe(false);
        expect(query('profitability-people-table')).toBeNull();
    });

    it('marks placeholder members as former members', async () => {
        share();
        respond([person(), person({ member_id: 'm-9', name: 'Old Timer', is_placeholder: true })]);
        mountView();
        await settle();

        const badges = all('profitability-people-former');
        expect(badges).toHaveLength(1);
        expect(badges[0]?.textContent?.trim()).toBe('Former member');
        expect(badges[0]?.closest('[data-member-id]')?.getAttribute('data-member-id')).toBe('m-9');
    });

    it('shows the chart card with people to plot and hides it in the empty state', async () => {
        share();
        respond([person()]);
        mountView();
        await settle();
        expect(text('profitability-people-chart')).toContain('Chargeability vs target');
        expect(query('stub-chart')).not.toBeNull();

        wrapper?.unmount();
        document.body.innerHTML = '';
        respond([person({ ...NO_WEEK })]);
        mountView();
        await settle();
        expect(query('profitability-people-chart')).toBeNull();
    });

    it('shows the load error with Try again', async () => {
        share();
        axiosGet.mockRejectedValue(new Error('network'));
        mountView();
        // The query retries once after 300 ms before it reports the error
        await new Promise((resolve) => setTimeout(resolve, 400));
        await settle();

        expect(text('profitability-people-error')).toContain('Couldn’t load');
        axiosGet.mockReset();
        respond([person()]);
        const retry = Array.from(document.body.querySelectorAll('button')).find(
            (el) => el.textContent?.trim() === 'Try again'
        );
        retry?.click();
        await settle();
        expect(query('profitability-people-error')).toBeNull();
        expect(query('profitability-people-table')).not.toBeNull();
    });
});
