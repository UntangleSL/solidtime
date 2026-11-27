import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import {
    fetchProjectsView,
    isContractFilter,
    parseProjectsView,
    parseProjectsViewRow,
} from './projectsApi';

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => ({ props: {} }),
}));

vi.mock('@/utils/useUser', () => ({ getCurrentOrganizationId: () => 'org-1' }));

vi.mock('axios', () => ({
    default: { get: vi.fn() },
}));

const axiosGet = vi.mocked(axios.get);

function hoursRow(overrides: Record<string, unknown> = {}) {
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
        can_edit_plan: true,
        ...overrides,
    };
}

const MONEY = {
    amount_cents: 300000,
    revenue_to_date_cents: 300000,
    cost_cents: 50000,
    margin_cents: 250000,
    projected_cost_cents: null,
    projected_margin_cents: null,
    unpriced_cost_seconds: 0,
};

describe('parseProjectsViewRow', () => {
    it('keeps absent money keys absent on an hours-only row', () => {
        const row = parseProjectsViewRow(hoursRow());

        expect(row).not.toBeNull();
        for (const key of [
            'amount_cents',
            'revenue_to_date_cents',
            'cost_cents',
            'margin_cents',
            'projected_cost_cents',
            'projected_margin_cents',
            'unpriced_cost_seconds',
        ]) {
            expect(key in (row as object)).toBe(false);
        }
        expect(row?.period?.state).toBe('current');
        expect(row?.status).toBe('on_track');
        expect(row?.can_edit_plan).toBe(true);
    });

    it('copies the money keys of a money row and keeps unknown projections as null', () => {
        const row = parseProjectsViewRow(hoursRow(MONEY));

        expect(row?.amount_cents).toBe(300000);
        expect(row?.margin_cents).toBe(250000);
        expect(row?.unpriced_cost_seconds).toBe(0);
        expect(row && 'projected_margin_cents' in row).toBe(true);
        expect(row?.projected_margin_cents).toBeNull();
    });

    it('drops a malformed money value instead of showing it as 0', () => {
        const row = parseProjectsViewRow(hoursRow({ amount_cents: '300000', cost_cents: 10 }));

        expect(row && 'amount_cents' in row).toBe(false);
        expect(row?.cost_cents).toBe(10);
        // Projections are only meaningful next to an amount
        expect(row && 'projected_margin_cents' in row).toBe(false);
    });

    it('reads a row without contract terms', () => {
        const row = parseProjectsViewRow(hoursRow({ schedule: null, period: null, status: null }));

        expect(row?.schedule).toBeNull();
        expect(row?.period).toBeNull();
        expect(row?.status).toBeNull();
    });

    it('rejects a row without a project id or name', () => {
        expect(parseProjectsViewRow(hoursRow({ project_id: undefined }))).toBeNull();
        expect(parseProjectsViewRow(hoursRow({ name: 7 }))).toBeNull();
        expect(parseProjectsViewRow('nope')).toBeNull();
    });
});

describe('parseProjectsView', () => {
    it('returns null when data is not a list', () => {
        expect(parseProjectsView({ data: {} })).toBeNull();
        expect(parseProjectsView(null)).toBeNull();
    });

    it('keeps the legacy notice key only when the server sent it', () => {
        const without = parseProjectsView({
            data: [hoursRow()],
            meta: { total_rows: 1, money_rows: 0 },
        });
        expect(without && 'nonbillable_legacy_seconds' in without.meta).toBe(false);

        const withKey = parseProjectsView({
            data: [hoursRow(MONEY)],
            meta: { total_rows: 1, money_rows: 1, nonbillable_legacy_seconds: 1800 },
        });
        expect(withKey?.meta.nonbillable_legacy_seconds).toBe(1800);
    });

    it('skips malformed rows and derives missing counts', () => {
        const view = parseProjectsView({ data: [hoursRow(MONEY), { name: 'x' }, hoursRow()] });

        expect(view?.data).toHaveLength(2);
        expect(view?.meta).toEqual({ total_rows: 2, money_rows: 1 });
    });
});

describe('fetchProjectsView', () => {
    beforeEach(() => {
        axiosGet.mockReset();
    });

    it('asks the organization view URL with the contract filter', async () => {
        axiosGet.mockResolvedValueOnce({
            data: { data: [hoursRow()], meta: { total_rows: 1, money_rows: 0 } },
        });

        const view = await fetchProjectsView(
            'https://app.test/profitability/organizations/o',
            'ended'
        );

        expect(axiosGet).toHaveBeenCalledWith(
            'https://app.test/profitability/organizations/o/views/projects',
            { params: { contract: 'ended' } }
        );
        expect(view.data[0]?.name).toBe('Alpha');
    });

    it('throws on a malformed body so the view shows its error state', async () => {
        axiosGet.mockResolvedValueOnce({ data: { rows: [] } });

        await expect(fetchProjectsView('https://app.test/x', 'active')).rejects.toThrow();
    });
});

describe('isContractFilter', () => {
    it('accepts the four filters only', () => {
        expect(['active', 'without', 'ended', 'all'].every(isContractFilter)).toBe(true);
        expect(isContractFilter('archived')).toBe(false);
        expect(isContractFilter(undefined)).toBe(false);
    });
});
