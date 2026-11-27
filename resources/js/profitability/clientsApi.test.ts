import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import {
    fetchClientsView,
    formatMarginPercent,
    isClientSortColumn,
    marginPercent,
    parseClientsView,
    parseClientsViewClient,
    sortClientRows,
    type ClientsViewClient,
} from './clientsApi';

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => ({ props: {} }),
}));

vi.mock('@/utils/useUser', () => ({ getCurrentOrganizationId: () => 'org-1' }));

vi.mock('axios', () => ({
    default: { get: vi.fn() },
}));

const axiosGet = vi.mocked(axios.get);

function project(overrides: Record<string, unknown> = {}) {
    return {
        project_id: 'p-1',
        name: 'Alpha',
        color: '#ef5350',
        client_id: 'c-1',
        archived: false,
        hours_sold_seconds: 144000,
        consumed_seconds: 36000,
        amount_cents: 300000,
        cost_cents: 50000,
        margin_cents: 250000,
        margin_percent: 83.33,
        unpriced_cost_seconds: 0,
        status: 'on_track',
        ...overrides,
    };
}

function client(overrides: Record<string, unknown> = {}) {
    return {
        client_id: 'c-1',
        name: 'Client A',
        project_count: 1,
        hours_sold_seconds: 144000,
        consumed_seconds: 36000,
        amount_cents: 300000,
        cost_cents: 50000,
        margin_cents: 250000,
        margin_percent: 83.33,
        unpriced_cost_seconds: 0,
        status: 'on_track',
        projects: [project()],
        ...overrides,
    };
}

const RANGE = {
    key: 'this_month',
    from: '2026-11-01',
    to: '2026-11-30',
    capped_to: '2026-11-27',
    contains_today: true,
};

describe('parseClientsViewClient', () => {
    it('reads a client with its projects', () => {
        const row = parseClientsViewClient(client());

        expect(row?.client_id).toBe('c-1');
        expect(row?.name).toBe('Client A');
        expect(row?.margin_percent).toBe(83.33);
        expect(row?.projects).toHaveLength(1);
        expect(row?.projects[0]?.project_id).toBe('p-1');
    });

    it('keeps the No client bucket with a null id and name', () => {
        const row = parseClientsViewClient(client({ client_id: null, name: null }));

        expect(row).not.toBeNull();
        expect(row?.client_id).toBeNull();
        expect(row?.name).toBeNull();
    });

    it('keeps a null margin percent null, never 0', () => {
        const row = parseClientsViewClient(client({ margin_percent: null, amount_cents: 0 }));

        expect(row?.margin_percent).toBeNull();
    });

    it('drops a client with an id but no name, and malformed projects', () => {
        expect(parseClientsViewClient(client({ name: null }))).toBeNull();
        expect(parseClientsViewClient('nope')).toBeNull();
        const row = parseClientsViewClient(client({ projects: [project(), { name: 'x' }] }));
        expect(row?.projects).toHaveLength(1);
    });
});

describe('parseClientsView', () => {
    it('reads data, range and totals', () => {
        const view = parseClientsView({
            data: [client()],
            meta: {
                range: RANGE,
                totals: {
                    hours_sold_seconds: 144000,
                    consumed_seconds: 36000,
                    amount_cents: 300000,
                    cost_cents: 50000,
                    margin_cents: 250000,
                    margin_percent: 83.33,
                    unpriced_cost_seconds: 0,
                },
            },
        });

        expect(view?.data).toHaveLength(1);
        expect(view?.meta.range).toEqual(RANGE);
        expect(view?.meta.totals.margin_cents).toBe(250000);
        expect(view?.meta.totals.margin_percent).toBe(83.33);
    });

    it('sums the rows when the totals are missing', () => {
        const view = parseClientsView({
            data: [client(), client({ client_id: 'c-2', name: 'B', margin_cents: -50000 })],
        });

        expect(view?.meta.range).toBeNull();
        expect(view?.meta.totals.amount_cents).toBe(600000);
        expect(view?.meta.totals.margin_cents).toBe(200000);
        expect(view?.meta.totals.margin_percent).toBeCloseTo(33.33, 1);
    });

    it('rejects a body without a data list', () => {
        expect(parseClientsView({ data: 'x' })).toBeNull();
        expect(parseClientsView(null)).toBeNull();
    });
});

describe('fetchClientsView', () => {
    beforeEach(() => {
        axiosGet.mockReset();
    });

    it('calls the clients view with the range', async () => {
        axiosGet.mockResolvedValue({ data: { data: [], meta: { range: RANGE } } });

        const view = await fetchClientsView('https://x.test/profitability/org', 'last_quarter');

        expect(axiosGet).toHaveBeenCalledWith('https://x.test/profitability/org/views/clients', {
            params: { range: 'last_quarter' },
        });
        expect(view.data).toEqual([]);
    });

    it('throws on a malformed body', async () => {
        axiosGet.mockResolvedValue({ data: '<html>' });

        await expect(fetchClientsView('https://x.test/o', 'this_month')).rejects.toThrow();
    });
});

describe('sortClientRows', () => {
    function rows(): ClientsViewClient[] {
        return [
            client({ client_id: null, name: null, margin_cents: -900000 }),
            client({ client_id: 'c-1', name: 'Gain', margin_cents: 100000 }),
            client({ client_id: 'c-2', name: 'Loss', margin_cents: -20000 }),
            client({ client_id: 'c-3', name: 'Even', margin_cents: 0, margin_percent: null }),
        ].map((row) => parseClientsViewClient(row) as ClientsViewClient);
    }

    it('puts losses first by default and the No client bucket last', () => {
        const sorted = sortClientRows(rows(), 'margin', 'asc');

        expect(sorted.map((row) => row.name)).toEqual(['Loss', 'Even', 'Gain', null]);
    });

    it('keeps the No client bucket last when descending', () => {
        const sorted = sortClientRows(rows(), 'margin', 'desc');

        expect(sorted.map((row) => row.name)).toEqual(['Gain', 'Even', 'Loss', null]);
    });

    it('sorts empty values last in both directions', () => {
        const asc = sortClientRows(rows(), 'margin_pct', 'asc');
        const desc = sortClientRows(rows(), 'margin_pct', 'desc');

        expect(asc[2]?.name).toBe('Even');
        expect(desc[2]?.name).toBe('Even');
    });

    it('does not pin project rows', () => {
        const projects = [
            project({ project_id: 'a', name: 'A', client_id: null, margin_cents: 10 }),
            project({ project_id: 'b', name: 'B', client_id: null, margin_cents: -10 }),
        ];
        const sorted = sortClientRows(
            projects.map((row) => ({ ...row, status: row.status as string | null })),
            'margin',
            'asc',
            false
        );

        expect(sorted.map((row) => row.name)).toEqual(['B', 'A']);
    });

    it('recognises the sort columns', () => {
        expect(isClientSortColumn('margin')).toBe(true);
        expect(isClientSortColumn('period')).toBe(false);
    });
});

describe('margin percent', () => {
    it('is null without an amount', () => {
        expect(marginPercent(0, -100)).toBeNull();
        expect(marginPercent(1000, 250)).toBe(25);
    });

    it('formats an integer with a real minus', () => {
        expect(formatMarginPercent(68.4)).toBe('68 %');
        expect(formatMarginPercent(-12.4)).toBe('−12 %');
        expect(formatMarginPercent(-0.2)).toBe('0 %');
        expect(formatMarginPercent(null)).toBe('--');
    });
});
