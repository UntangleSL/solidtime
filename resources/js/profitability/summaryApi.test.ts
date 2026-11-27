import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { fetchProjectSummary, isNotFound, parseProjectSummary } from './summaryApi';

vi.mock('axios', () => ({
    default: { get: vi.fn() },
}));

const axiosGet = vi.mocked(axios.get);

const URL = 'https://app.example.test/profitability/organizations/org-1/projects/p-1/summary';

function payload(overrides: Record<string, unknown> = {}) {
    return {
        project_id: 'p-1',
        can_edit_terms: true,
        can_edit_plan: false,
        contract: {
            service: 'SEO retainer',
            schedule: 'monthly',
            starts_on: '2026-10-15',
            ends_on: null,
            archived: false,
        },
        periods: [
            { id: 'period-2', starts_on: '2026-12-01', ends_on: '2026-12-31', state: 'upcoming' },
            { id: 'period-1', starts_on: '2026-11-01', ends_on: '2026-11-30', state: 'current' },
        ],
        period: {
            id: 'period-1',
            starts_on: '2026-11-01',
            ends_on: '2026-11-30',
            state: 'current',
            budget_seconds: 144000,
            consumed_seconds: 45000,
            months: [{ month: '2026-11-01', planned_seconds: 144000, consumed_seconds: 45000 }],
            still_to_consume_seconds: 99000,
            remaining_plan_seconds: 144000,
            run_rate_seconds: 108000,
            status: 'on_track',
        },
        ...overrides,
    };
}

const MONEY = {
    amount_cents: 1240000,
    revenue_to_date_cents: 620000,
    cost_cents: 250000,
    margin_cents: 370000,
    projected_cost_cents: 800000,
    projected_margin_cents: 440000,
    unpriced_cost_seconds: 0,
};

describe('parseProjectSummary', () => {
    it('keeps the fields of the summary payload', () => {
        const summary = parseProjectSummary(payload());
        expect(summary).toEqual({
            project_id: 'p-1',
            can_edit_terms: true,
            can_edit_plan: false,
            contract: {
                service: 'SEO retainer',
                schedule: 'monthly',
                starts_on: '2026-10-15',
                ends_on: null,
                archived: false,
            },
            periods: [
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
                budget_seconds: 144000,
                consumed_seconds: 45000,
                months: [{ month: '2026-11-01', planned_seconds: 144000, consumed_seconds: 45000 }],
                still_to_consume_seconds: 99000,
                remaining_plan_seconds: 144000,
                run_rate_seconds: 108000,
                status: 'on_track',
            },
        });
    });

    it('keeps the period list order and drops invalid entries', () => {
        const summary = parseProjectSummary(
            payload({
                periods: [
                    { id: 'period-2', starts_on: '2026-12-01', ends_on: '2026-12-31' },
                    { id: 'period-x', starts_on: 3 },
                    'nope',
                ],
            })
        );
        expect(summary?.periods).toEqual([
            { id: 'period-2', starts_on: '2026-12-01', ends_on: '2026-12-31', state: 'current' },
        ]);
        expect(parseProjectSummary(payload({ periods: undefined }))?.periods).toEqual([]);
    });

    it('derives the projection fields an older payload does not carry', () => {
        const raw = payload();
        const period = raw.period as Record<string, unknown>;
        delete period.still_to_consume_seconds;
        delete period.remaining_plan_seconds;
        delete period.run_rate_seconds;
        delete period.status;
        period.state = 'closed';
        expect(parseProjectSummary(raw)?.period).toMatchObject({
            still_to_consume_seconds: 99000,
            remaining_plan_seconds: 45000,
            run_rate_seconds: null,
            status: 'closed',
        });
    });

    it('copies the period money block when the payload carries amount_cents', () => {
        const raw = payload();
        Object.assign(raw.period as Record<string, unknown>, MONEY);
        expect(parseProjectSummary(raw)?.period).toMatchObject(MONEY);

        const unpriced = payload();
        Object.assign(unpriced.period as Record<string, unknown>, MONEY, {
            projected_cost_cents: null,
            projected_margin_cents: null,
            unpriced_cost_seconds: 7200,
        });
        const period = parseProjectSummary(unpriced)?.period;
        expect(period?.projected_cost_cents).toBeNull();
        expect(period?.projected_margin_cents).toBeNull();
        expect(period?.unpriced_cost_seconds).toBe(7200);
    });

    it('reads no money key of a period without amount_cents', () => {
        const raw = payload();
        const { amount_cents: _amount, ...rest } = MONEY;
        Object.assign(raw.period as Record<string, unknown>, rest);
        const period = parseProjectSummary(raw)?.period as unknown as Record<string, unknown>;
        for (const key of Object.keys(MONEY)) {
            expect(key in period).toBe(false);
        }
    });

    it('keeps a money key only when the payload carries it, and never defaults it', () => {
        const without = parseProjectSummary(payload());
        expect(without?.contract && 'amount_cents' in without.contract).toBe(false);
        expect(without?.period && 'amount_cents' in without.period).toBe(false);

        const raw = payload();
        (raw.contract as Record<string, unknown>).amount_cents = 1240000;
        (raw.period as Record<string, unknown>).amount_cents = 1240000;
        const withMoney = parseProjectSummary(raw);
        expect(withMoney?.contract?.amount_cents).toBe(1240000);
        expect(withMoney?.period?.amount_cents).toBe(1240000);
    });

    it('drops a money key whose value is not a number', () => {
        const raw = payload();
        (raw.period as Record<string, unknown>).amount_cents = '1240000';
        (raw.contract as Record<string, unknown>).amount_cents = null;
        const summary = parseProjectSummary(raw);
        expect(summary?.period && 'amount_cents' in summary.period).toBe(false);
        expect(summary?.contract && 'amount_cents' in summary.contract).toBe(false);
    });

    it('drops invalid months and reads missing numbers as 0', () => {
        const raw = payload();
        (raw.period as Record<string, unknown>).months = [
            { month: '2026-11-01', planned_seconds: 'x', consumed_seconds: 10 },
            { planned_seconds: 1, consumed_seconds: 1 },
            'nope',
        ];
        expect(parseProjectSummary(raw)?.period?.months).toEqual([
            { month: '2026-11-01', planned_seconds: 0, consumed_seconds: 10 },
        ]);
    });

    it('reads a missing months list as empty and edit flags as false unless true', () => {
        const raw = payload({ can_edit_terms: 'yes', can_edit_plan: undefined });
        delete (raw.period as Record<string, unknown>).months;
        const summary = parseProjectSummary(raw);
        expect(summary?.can_edit_terms).toBe(false);
        expect(summary?.can_edit_plan).toBe(false);
        expect(summary?.period?.months).toEqual([]);
    });

    it('keeps a null contract and period', () => {
        const summary = parseProjectSummary(payload({ contract: null, period: null }));
        expect(summary?.contract).toBeNull();
        expect(summary?.period).toBeNull();
    });

    it('drops a period without valid numbers and a contract without dates', () => {
        const raw = payload();
        (raw.period as Record<string, unknown>).budget_seconds = 'lots';
        (raw.contract as Record<string, unknown>).starts_on = 7;
        const summary = parseProjectSummary(raw);
        expect(summary?.period).toBeNull();
        expect(summary?.contract).toBeNull();
    });

    it('answers null for a payload without a project id', () => {
        expect(parseProjectSummary(null)).toBeNull();
        expect(parseProjectSummary([])).toBeNull();
        expect(parseProjectSummary(payload({ project_id: 5 }))).toBeNull();
    });
});

describe('fetchProjectSummary', () => {
    beforeEach(() => {
        axiosGet.mockReset();
    });

    it('reads the data envelope of the summary URL', async () => {
        axiosGet.mockResolvedValueOnce({ data: { data: payload() } });
        const summary = await fetchProjectSummary(URL);
        expect(axiosGet).toHaveBeenCalledWith(URL, { params: undefined });
        expect(summary.period?.budget_seconds).toBe(144000);
    });

    it('asks for a selected period with ?period=', async () => {
        axiosGet.mockResolvedValueOnce({ data: { data: payload() } });
        await fetchProjectSummary(URL, 'period-9');
        expect(axiosGet).toHaveBeenCalledWith(URL, { params: { period: 'period-9' } });
    });

    it('rejects a malformed payload so the card shows its error state', async () => {
        axiosGet.mockResolvedValueOnce({ data: { data: { nope: true } } });
        await expect(fetchProjectSummary(URL)).rejects.toThrow();
    });

    it('passes a 404 through and recognises it', async () => {
        const notFound = Object.assign(new Error('Not Found'), { response: { status: 404 } });
        axiosGet.mockRejectedValueOnce(notFound);
        const error = await fetchProjectSummary(URL).catch((caught: unknown) => caught);
        expect(error).toBe(notFound);
        expect(isNotFound(error)).toBe(true);
        expect(isNotFound(Object.assign(new Error('x'), { response: { status: 500 } }))).toBe(
            false
        );
        expect(isNotFound(new Error('network'))).toBe(false);
        expect(isNotFound(null)).toBe(false);
    });
});
