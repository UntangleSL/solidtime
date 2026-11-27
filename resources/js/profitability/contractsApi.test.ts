import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { QueryClient } from '@tanstack/vue-query';
import {
    centsFromAmount,
    contractUrl,
    isStubStart,
    loadExistingTerms,
    nextPeriodStart,
    planUrl,
    projectNameFromCache,
    prorateCents,
    prorateSeconds,
    saveContractTerms,
    savePlan,
    secondsFromHours,
    stubDays,
    stubEnd,
    templatePeriod,
    validationErrors,
} from './contractsApi';

vi.mock('@/utils/useUser', () => ({ getCurrentOrganizationId: () => 'org-1' }));

vi.mock('axios', () => ({
    default: { get: vi.fn(), put: vi.fn() },
}));

const axiosGet = vi.mocked(axios.get);
const axiosPut = vi.mocked(axios.put);

const ORG_URL = 'https://app.example.test/profitability/organizations/org-1';

describe('contractsApi', () => {
    beforeEach(() => {
        axiosGet.mockReset();
        axiosPut.mockReset();
    });

    it('PUTs the contract terms to the project contract URL', async () => {
        axiosPut.mockResolvedValue({ status: 204 });
        const body = {
            service: 'SEO retainer',
            schedule: 'monthly' as const,
            starts_on: '2026-11-15',
            ends_on: null,
            budget_seconds: 144000,
            amount_cents: 300000,
            first_period_budget_seconds: 77400,
            first_period_amount_cents: 160000,
        };
        await saveContractTerms(ORG_URL, 'p-1', body);
        expect(axiosPut).toHaveBeenCalledWith(`${ORG_URL}/projects/p-1/contract`, body);
        expect(contractUrl(ORG_URL, 'p-1')).toBe(`${ORG_URL}/projects/p-1/contract`);
    });

    it('PUTs the plan months to the period plan URL', async () => {
        axiosPut.mockResolvedValue({ status: 204 });
        const months = [
            { month: '2026-10-01', planned_seconds: 72000 },
            { month: '2026-11-01', planned_seconds: 72000 },
        ];
        await savePlan(ORG_URL, 'p-1', 'period-1', months);
        expect(axiosPut).toHaveBeenCalledWith(`${ORG_URL}/projects/p-1/periods/period-1/plan`, {
            months,
        });
        expect(planUrl(ORG_URL, 'p-1', 'period-1')).toBe(
            `${ORG_URL}/projects/p-1/periods/period-1/plan`
        );
    });

    it('reads the first message of each field of a 422', () => {
        const error = Object.assign(new Error('Unprocessable'), {
            response: {
                status: 422,
                data: {
                    message: 'A one-off contract needs an end date.',
                    errors: {
                        ends_on: ['A one-off contract needs an end date.', 'Second'],
                        budget_seconds: ['The budget seconds field is required.'],
                    },
                },
            },
        });
        expect(validationErrors(error)).toEqual({
            ends_on: 'A one-off contract needs an end date.',
            budget_seconds: 'The budget seconds field is required.',
        });
    });

    it('returns null for anything that is not a 422', () => {
        expect(validationErrors(new Error('Network Error'))).toBeNull();
        expect(
            validationErrors(Object.assign(new Error('x'), { response: { status: 500 } }))
        ).toBeNull();
        expect(validationErrors(null)).toBeNull();
        expect(validationErrors('boom')).toBeNull();
    });

    it('converts hours to seconds and amounts to cents', () => {
        expect(secondsFromHours(21.5)).toBe(77400);
        expect(secondsFromHours(null)).toBeNull();
        expect(centsFromAmount(1600)).toBe(160000);
        expect(centsFromAmount(12.34)).toBe(1234);
        expect(centsFromAmount(null)).toBeNull();
    });

    it('prorates a stub first period like the server (D-15)', () => {
        expect(isStubStart('monthly', '2026-11-15')).toBe(true);
        expect(isStubStart('monthly', '2026-11-01')).toBe(false);
        expect(isStubStart('one_off', '2026-11-15')).toBe(false);
        expect(stubDays('2026-11-15')).toEqual({ days: 16, of: 30 });
        expect(stubEnd('2026-11-15')).toBe('2026-11-30');
        // 40 h per month from the 15th of a 30-day month -> 21.5 h; 3000 per month -> 1600
        expect(prorateSeconds(144000, 'monthly', '2026-11-15')).toBe(77400);
        expect(prorateCents(300000, 'monthly', '2026-11-15')).toBe(160000);
        // A quarter is three months: one month's share times the stub's share of its month
        expect(prorateSeconds(432000, 'quarterly', '2026-11-15')).toBe(77400);
        expect(prorateSeconds(144000, 'one_off', '2026-11-15')).toBe(144000);
    });

    it('takes the template from the newest full period and the next start', () => {
        const periods = [
            { id: 'stub', starts_on: '2026-10-15', ends_on: '2026-10-31', state: 'closed' },
            { id: 'nov', starts_on: '2026-11-01', ends_on: '2026-11-30', state: 'current' },
            { id: 'dec', starts_on: '2026-12-01', ends_on: '2026-12-31', state: 'upcoming' },
        ];
        expect(templatePeriod('monthly', periods)?.id).toBe('dec');
        expect(templatePeriod('monthly', [periods[0]!])).toBeNull();
        expect(nextPeriodStart(periods, periods[1]!)).toBe('2026-12-01');
        expect(nextPeriodStart(periods.slice(0, 2), periods[1]!)).toBe('2026-12-01');
        expect(nextPeriodStart([], null)).toBeNull();
    });

    it('loads existing terms from the summary and the template period', async () => {
        const base = {
            project_id: 'p-1',
            can_edit_terms: true,
            can_edit_plan: true,
            contract: {
                service: 'SEO',
                schedule: 'monthly',
                starts_on: '2026-10-15',
                ends_on: null,
                archived: false,
            },
            periods: [
                { id: 'dec', starts_on: '2026-12-01', ends_on: '2026-12-31', state: 'upcoming' },
                { id: 'nov', starts_on: '2026-11-01', ends_on: '2026-11-30', state: 'current' },
                { id: 'stub', starts_on: '2026-10-15', ends_on: '2026-10-31', state: 'closed' },
            ],
        };
        const period = (id: string, starts: string, ends: string, seconds: number) => ({
            id,
            starts_on: starts,
            ends_on: ends,
            state: id === 'dec' ? 'upcoming' : 'current',
            budget_seconds: seconds,
            consumed_seconds: 0,
            months: [],
            amount_cents: seconds === 144000 ? 300000 : 250000,
        });
        axiosGet.mockImplementation(async (_url, config) => {
            const params = (config as { params?: { period?: string } } | undefined)?.params;
            const shown =
                params?.period === 'dec'
                    ? period('dec', '2026-12-01', '2026-12-31', 144000)
                    : period('nov', '2026-11-01', '2026-11-30', 108000);
            return { data: { data: { ...base, period: shown } } };
        });

        const terms = await loadExistingTerms(ORG_URL, 'p-1', '2026-11-27');
        expect(axiosGet).toHaveBeenCalledWith(`${ORG_URL}/projects/p-1/summary`, {
            params: undefined,
        });
        expect(axiosGet).toHaveBeenCalledWith(`${ORG_URL}/projects/p-1/summary`, {
            params: { period: 'dec' },
        });
        expect(terms).toMatchObject({
            schedule: 'monthly',
            budgetSeconds: 144000,
            amountCents: 300000,
            started: true,
            current: { id: 'nov' },
            nextStartsOn: '2026-12-01',
        });

        const before = await loadExistingTerms(ORG_URL, 'p-1', '2026-10-01');
        expect(before?.started).toBe(false);
    });

    it('reads a project name from the core projects cache only', () => {
        const queryClient = new QueryClient();
        expect(projectNameFromCache(queryClient, 'p-1')).toBeNull();
        queryClient.setQueryData(['projects', 'org-1'], {
            data: [
                { id: 'p-0', name: 'Other' },
                { id: 'p-1', name: 'Website' },
            ],
        });
        expect(projectNameFromCache(queryClient, 'p-1')).toBe('Website');
        expect(projectNameFromCache(queryClient, 'p-9')).toBeNull();
    });
});
