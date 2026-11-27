import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { fetchPeopleView, parsePeopleView, parsePeopleViewRow } from './peopleApi';

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => ({ props: {} }),
}));

vi.mock('@/utils/useUser', () => ({ getCurrentOrganizationId: () => 'org-1' }));

vi.mock('axios', () => ({
    default: { get: vi.fn() },
}));

const axiosGet = vi.mocked(axios.get);

const H = 3600;

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

const META = {
    range: {
        key: 'this_month',
        from: '2026-11-01',
        to: '2026-11-30',
        capped_to: '2026-11-27',
        contains_today: true,
    },
    team: {
        billable_seconds: 112 * H,
        available_seconds: 160 * H,
        absence_seconds: 8 * H,
        internal_seconds: 40 * H,
        chargeability: 0.7,
        target_percent: 75,
    },
};

describe('parsePeopleViewRow', () => {
    it('reads a person with a working week', () => {
        expect(parsePeopleViewRow(person())).toEqual({
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
        });
    });

    it('keeps the unknown figures of a person without a working week as null, never 0', () => {
        const row = parsePeopleViewRow(
            person({
                weekly_seconds: null,
                available_seconds: null,
                chargeability: null,
                target_percent: null,
                gap_points: null,
                status: null,
            })
        );
        expect(row).toMatchObject({
            weekly_seconds: null,
            available_seconds: null,
            chargeability: null,
            target_percent: null,
            gap_points: null,
            status: null,
        });
    });

    it('reads the placeholder flag and drops an unknown status', () => {
        const row = parsePeopleViewRow(person({ is_placeholder: true, status: 'over' }));
        expect(row?.is_placeholder).toBe(true);
        expect(row?.status).toBeNull();
    });

    it('rejects a row without a member id or name', () => {
        expect(parsePeopleViewRow(person({ member_id: undefined }))).toBeNull();
        expect(parsePeopleViewRow(person({ name: 3 }))).toBeNull();
        expect(parsePeopleViewRow('nope')).toBeNull();
    });
});

describe('parsePeopleView', () => {
    it('returns null when data is not a list', () => {
        expect(parsePeopleView({ data: {} })).toBeNull();
        expect(parsePeopleView(null)).toBeNull();
    });

    it('reads the range and team meta and skips malformed rows', () => {
        const view = parsePeopleView({ data: [person(), { name: 'x' }], meta: META });
        expect(view?.data).toHaveLength(1);
        expect(view?.meta.range).toEqual(META.range);
        expect(view?.meta.team).toEqual({
            billable_seconds: 112 * H,
            available_seconds: 160 * H,
            absence_seconds: 8 * H,
            chargeability: 0.7,
            target_percent: 75,
        });
    });

    it('falls back to an empty team and no range when meta is missing', () => {
        const view = parsePeopleView({ data: [] });
        expect(view?.meta.range).toBeNull();
        expect(view?.meta.team).toEqual({
            billable_seconds: 0,
            available_seconds: 0,
            absence_seconds: 0,
            chargeability: null,
            target_percent: null,
        });
    });
});

describe('fetchPeopleView', () => {
    beforeEach(() => {
        axiosGet.mockReset();
    });

    it('asks the organization people view with the range', async () => {
        axiosGet.mockResolvedValue({ data: { data: [person()], meta: META } });
        const view = await fetchPeopleView(
            'https://app.example.test/profitability/organizations/org-1',
            'last_quarter'
        );
        expect(axiosGet).toHaveBeenCalledWith(
            'https://app.example.test/profitability/organizations/org-1/views/people',
            { params: { range: 'last_quarter' } }
        );
        expect(view.data[0]?.name).toBe('Ana');
    });

    it('throws on a malformed body so the view shows its error state', async () => {
        axiosGet.mockResolvedValue({ data: { data: 'nope' } });
        await expect(fetchPeopleView('https://x.test', 'this_month')).rejects.toThrow(
            'Malformed people view'
        );
    });
});
