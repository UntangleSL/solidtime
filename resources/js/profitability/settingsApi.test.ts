import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import {
    addAccountManager,
    addCostRate,
    addProjectManager,
    addWorkWeek,
    deleteCostRate,
    deleteWorkWeek,
    fetchAbsence,
    fetchManagers,
    fetchPeople,
    firstValidationMessage,
    hoursToSeconds,
    parseAbsence,
    parseManagers,
    parsePeople,
    pickerDate,
    removeAccountManager,
    removeProjectManager,
    settingsQueryKey,
    unitsToCents,
    updateAbsence,
    validationErrors,
} from './settingsApi';

vi.mock('@inertiajs/vue3', () => ({ usePage: () => ({ props: {} }) }));

vi.mock('axios', () => ({
    default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const axiosGet = vi.mocked(axios.get);
const axiosPost = vi.mocked(axios.post);
const axiosPut = vi.mocked(axios.put);
const axiosDelete = vi.mocked(axios.delete);

const ORG_URL = 'https://app.example.test/profitability/organizations/org-1';

function person(overrides: Record<string, unknown> = {}) {
    return {
        member_id: 'm-1',
        name: 'Ana',
        role: 'employee',
        is_placeholder: false,
        hourly_cost_cents: 4500,
        weekly_seconds: 144000,
        target_percent: 75,
        since: '2026-11-01',
        cost_rates: [
            { id: 'r-1', effective_from: '2026-01-01', hourly_cost_cents: 4000 },
            { id: 'r-2', effective_from: '2026-11-01', hourly_cost_cents: 4500 },
        ],
        work_weeks: [
            { id: 'w-1', effective_from: '2026-01-01', weekly_seconds: 144000, target_percent: 75 },
        ],
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    axiosPost.mockResolvedValue({ status: 201, data: {} });
    axiosPut.mockResolvedValue({ status: 204, data: {} });
    axiosDelete.mockResolvedValue({ status: 204, data: {} });
});

describe('parsers', () => {
    it('parses people with current values and newest-first histories', () => {
        const people = parsePeople({ data: [person(), { name: 'no id' }] });
        expect(people).toHaveLength(1);
        const ana = people?.[0];
        expect(ana?.hourly_cost_cents).toBe(4500);
        expect(ana?.cost_rates.map((rate) => rate.id)).toEqual(['r-2', 'r-1']);
        expect(ana?.work_weeks[0]?.target_percent).toBe(75);
    });

    it('keeps missing current values as null and flags placeholders', () => {
        const people = parsePeople({
            data: [
                person({
                    role: 'placeholder',
                    is_placeholder: true,
                    hourly_cost_cents: null,
                    weekly_seconds: null,
                    target_percent: null,
                    since: null,
                    cost_rates: [],
                    work_weeks: [],
                }),
            ],
        });
        expect(people?.[0]).toMatchObject({
            is_placeholder: true,
            hourly_cost_cents: null,
            weekly_seconds: null,
            target_percent: null,
            since: null,
        });
    });

    it('rejects a body without a data list', () => {
        expect(parsePeople({ data: {} })).toBeNull();
        expect(parseManagers({ data: [] })).toBeNull();
        expect(parseAbsence(null)).toBeNull();
    });

    it('parses the managers payload', () => {
        const managers = parseManagers({
            data: {
                clients: [
                    {
                        id: 'c-1',
                        name: 'Acme',
                        account_managers: [{ member_id: 'm-1', name: 'Ana' }, { bad: true }],
                    },
                ],
                projects: [
                    {
                        id: 'p-1',
                        name: 'Web',
                        client_id: 'c-1',
                        client_name: 'Acme',
                        project_managers: [],
                    },
                ],
                members: [{ member_id: 'm-1', name: 'Ana', role: 'admin' }],
            },
        });
        expect(managers?.clients[0]?.account_managers).toEqual([{ member_id: 'm-1', name: 'Ana' }]);
        expect(managers?.projects[0]?.client_name).toBe('Acme');
        expect(managers?.members[0]?.role).toBe('admin');
    });

    it('parses the absence payload', () => {
        const absence = parseAbsence({
            data: {
                project_ids: ['p-2', 7],
                projects: [
                    { id: 'p-2', name: 'Vacaciones', client_name: null, is_archived: false },
                ],
            },
        });
        expect(absence).toEqual({
            project_ids: ['p-2'],
            projects: [{ id: 'p-2', name: 'Vacaciones', client_name: null, is_archived: false }],
        });
    });
});

describe('units', () => {
    it('sends costs as cents and hours as seconds', () => {
        expect(unitsToCents(45.5)).toBe(4550);
        expect(unitsToCents(0.1 + 0.2)).toBe(30);
        expect(hoursToSeconds(40)).toBe(144000);
        expect(hoursToSeconds(37.5)).toBe(135000);
    });

    it('turns a DatePicker timestamp into its local calendar date', () => {
        expect(pickerDate('2026-11-01T00:00:00+00:00')).toBe('2026-11-01');
        expect(pickerDate(null)).toBeNull();
    });
});

describe('requests', () => {
    it('reads people, managers and absence from the settings URLs', async () => {
        axiosGet.mockResolvedValueOnce({ data: { data: [person()] } });
        await expect(fetchPeople(ORG_URL)).resolves.toHaveLength(1);
        expect(axiosGet).toHaveBeenLastCalledWith(`${ORG_URL}/settings/people`);

        axiosGet.mockResolvedValueOnce({
            data: { data: { clients: [], projects: [], members: [] } },
        });
        await fetchManagers(ORG_URL);
        expect(axiosGet).toHaveBeenLastCalledWith(`${ORG_URL}/settings/managers`);

        axiosGet.mockResolvedValueOnce({ data: { data: { project_ids: [], projects: [] } } });
        await fetchAbsence(ORG_URL);
        expect(axiosGet).toHaveBeenLastCalledWith(`${ORG_URL}/settings/absence-projects`);
    });

    it('throws on a malformed body', async () => {
        axiosGet.mockResolvedValueOnce({ data: { nope: true } });
        await expect(fetchPeople(ORG_URL)).rejects.toThrow();
    });

    it('posts and deletes cost rates and working weeks', async () => {
        await addCostRate(ORG_URL, 'm-1', {
            effective_from: '2026-11-01',
            hourly_cost_cents: 4500,
        });
        expect(axiosPost).toHaveBeenLastCalledWith(`${ORG_URL}/settings/people/m-1/cost-rates`, {
            effective_from: '2026-11-01',
            hourly_cost_cents: 4500,
        });

        await deleteCostRate(ORG_URL, 'm-1', 'r-1');
        expect(axiosDelete).toHaveBeenLastCalledWith(
            `${ORG_URL}/settings/people/m-1/cost-rates/r-1`
        );

        await addWorkWeek(ORG_URL, 'm-1', {
            effective_from: '2026-11-01',
            weekly_seconds: 144000,
            target_percent: 75,
        });
        expect(axiosPost).toHaveBeenLastCalledWith(`${ORG_URL}/settings/people/m-1/work-weeks`, {
            effective_from: '2026-11-01',
            weekly_seconds: 144000,
            target_percent: 75,
        });

        await deleteWorkWeek(ORG_URL, 'm-1', 'w-1');
        expect(axiosDelete).toHaveBeenLastCalledWith(
            `${ORG_URL}/settings/people/m-1/work-weeks/w-1`
        );
    });

    it('adds and removes project and account managers', async () => {
        await addProjectManager(ORG_URL, 'p-1', 'm-2');
        expect(axiosPost).toHaveBeenLastCalledWith(`${ORG_URL}/settings/projects/p-1/managers`, {
            member_id: 'm-2',
        });
        await removeProjectManager(ORG_URL, 'p-1', 'm-2');
        expect(axiosDelete).toHaveBeenLastCalledWith(
            `${ORG_URL}/settings/projects/p-1/managers/m-2`
        );
        await addAccountManager(ORG_URL, 'c-1', 'm-2');
        expect(axiosPost).toHaveBeenLastCalledWith(
            `${ORG_URL}/settings/clients/c-1/account-managers`,
            { member_id: 'm-2' }
        );
        await removeAccountManager(ORG_URL, 'c-1', 'm-2');
        expect(axiosDelete).toHaveBeenLastCalledWith(
            `${ORG_URL}/settings/clients/c-1/account-managers/m-2`
        );
    });

    it('replaces the absence set with a PUT', async () => {
        await updateAbsence(ORG_URL, ['p-1', 'p-2']);
        expect(axiosPut).toHaveBeenLastCalledWith(`${ORG_URL}/settings/absence-projects`, {
            project_ids: ['p-1', 'p-2'],
        });
    });

    it('keys every section under the profitability tree', () => {
        expect(settingsQueryKey('org-1', 'people')).toEqual([
            'profitability',
            'org-1',
            'settings',
            'people',
        ]);
    });
});

describe('validation errors', () => {
    const duplicate = {
        response: {
            status: 422,
            data: {
                message: 'The given data was invalid.',
                errors: { effective_from: ['There is already a value from this date.'] },
            },
        },
    };

    it('reads the first message per field of a 422', () => {
        expect(validationErrors(duplicate)).toEqual({
            effective_from: 'There is already a value from this date.',
        });
        expect(firstValidationMessage(duplicate, ['hourly_cost_cents', 'effective_from'])).toBe(
            'There is already a value from this date.'
        );
    });

    it('ignores anything that is not a 422', () => {
        expect(validationErrors({ response: { status: 500, data: {} } })).toBeNull();
        expect(validationErrors(new Error('network'))).toBeNull();
        expect(firstValidationMessage({ response: { status: 404 } })).toBeNull();
    });
});
