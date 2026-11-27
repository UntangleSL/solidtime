import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import axios from 'axios';
import DatePicker from '@/packages/ui/src/Input/DatePicker.vue';
import { NumberField } from '@/packages/ui/src/number-field';
import PersonSettingsDialog from './PersonSettingsDialog.vue';
import type { SettingsPerson } from './settingsApi';

const { pageProps, addNotification } = vi.hoisted(() => ({
    pageProps: {} as Record<string, unknown>,
    addNotification: vi.fn(),
}));

vi.mock('@inertiajs/vue3', () => ({ usePage: () => ({ props: pageProps }) }));
vi.mock('@/utils/useUser', () => ({ getCurrentOrganizationId: () => 'org-1' }));
vi.mock('@/utils/useOrganizationQuery', () => ({
    useOrganizationQuery: () => ({
        organization: computed(() => ({ number_format: 'comma-point' })),
    }),
}));
vi.mock('@/utils/notification', () => ({ useNotificationsStore: () => ({ addNotification }) }));
vi.mock('axios', () => ({
    default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const axiosPost = vi.mocked(axios.post);
const axiosDelete = vi.mocked(axios.delete);

const ORG_URL = 'https://app.example.test/profitability/organizations/org-1';

const labels = {
    common: { save_error: 'Couldn’t save your changes.' },
    admin: {
        settings: {
            per_hour: ':value / h',
            dialog: {
                cost_legend: 'Hourly cost',
                effective_from: 'Effective from',
                cost_per_hour: 'Cost per hour',
                add_cost: 'Add cost',
                cost_helper: 'Each cost applies from its date until the next one.',
                work_week_legend: 'Working week and chargeability target',
                hours_per_week: 'Hours per week',
                target: 'Target',
                add_work_week: 'Add working week',
                work_week_helper:
                    'Available hours are the working week spread over Monday to Friday.',
                history_empty: 'No values yet.',
                close: 'Close person settings',
                delete_cost_aria: 'Delete hourly cost from :date',
                delete_work_week_aria: 'Delete working week from :date',
            },
            delete_cost: {
                title: 'Delete this hourly cost?',
                body: 'From :date, :name’s time will use the previous cost.',
                body_no_previous: 'From :date, :name’s time will show as incomplete.',
                keep: 'Keep cost',
                confirm: 'Delete cost',
            },
            delete_work_week: {
                title: 'Delete this working week?',
                body: 'From :date, :name’s available hours and target will use the previous values.',
                keep: 'Keep working week',
                confirm: 'Delete working week',
            },
        },
        toasts: {
            cost_added: 'Hourly cost added.',
            cost_deleted: 'Hourly cost deleted.',
            work_week_added: 'Working week added.',
            work_week_deleted: 'Working week deleted.',
        },
    },
};

function person(overrides: Partial<SettingsPerson> = {}): SettingsPerson {
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
            { id: 'r-2', effective_from: '2026-11-01', hourly_cost_cents: 4500 },
            { id: 'r-1', effective_from: '2026-01-01', hourly_cost_cents: 4000 },
        ],
        work_weeks: [
            { id: 'w-1', effective_from: '2026-01-01', weekly_seconds: 144000, target_percent: 75 },
        ],
        ...overrides,
    };
}

let wrapper: VueWrapper | null = null;

function mountDialog(subject: SettingsPerson = person()) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = mount(PersonSettingsDialog, {
        props: { show: true, person: subject },
        attachTo: document.body,
        global: { plugins: [[VueQueryPlugin, { queryClient }]] },
    });
    return wrapper;
}

function byTestId(testid: string): HTMLElement[] {
    return Array.from(document.body.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`));
}

function one(testid: string): HTMLElement {
    const element = byTestId(testid)[0];
    if (!element) throw new Error(`No element ${testid}`);
    return element;
}

async function click(testid: string, index = 0) {
    const element = byTestId(testid)[index];
    if (!element) throw new Error(`No element ${testid}[${index}]`);
    element.click();
    await flushPromises();
}

function unprocessable(field: string, message: string) {
    return { response: { status: 422, data: { message, errors: { [field]: [message] } } } };
}

beforeEach(() => {
    vi.clearAllMocks();
    pageProps.profitability = {
        enabled: true,
        views: ['settings'],
        organization_url: ORG_URL,
        labels,
    };
    axiosPost.mockResolvedValue({ status: 201, data: {} });
    axiosDelete.mockResolvedValue({ status: 204, data: {} });
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
});

describe('PersonSettingsDialog', () => {
    it('lists both histories newest first with the person name as title', async () => {
        mountDialog();
        await flushPromises();
        expect(document.body.textContent).toContain('Ana');
        const costs = byTestId('profitability-cost-row').map((row) => row.textContent ?? '');
        expect(costs).toHaveLength(2);
        expect(costs[0]).toContain('45.00');
        expect(costs[1]).toContain('40.00');
        expect(byTestId('profitability-work-week-row')[0]?.textContent).toContain('40 h');
        expect(byTestId('profitability-work-week-row')[0]?.textContent).toContain('75 %');
    });

    it('adds an hourly cost in cents from the picked date, toasts and resets the amount', async () => {
        const dialog = mountDialog();
        await flushPromises();
        dialog.findComponent(DatePicker).vm.$emit('update:modelValue', '2026-10-01T00:00:00Z');
        dialog.findAllComponents(NumberField)[0]?.vm.$emit('update:modelValue', 45.5);
        await flushPromises();
        await click('profitability-add-cost');

        expect(axiosPost).toHaveBeenCalledWith(`${ORG_URL}/settings/people/m-1/cost-rates`, {
            effective_from: '2026-10-01',
            hourly_cost_cents: 4550,
        });
        expect(addNotification).toHaveBeenCalledWith('success', 'Hourly cost added.');
    });

    it('defaults the effective date to the first day of the current month', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-27T12:00:00Z'));
        try {
            const dialog = mountDialog();
            await flushPromises();
            dialog.findAllComponents(NumberField)[0]?.vm.$emit('update:modelValue', 50);
            await flushPromises();
            await click('profitability-add-cost');
            expect(axiosPost).toHaveBeenCalledWith(`${ORG_URL}/settings/people/m-1/cost-rates`, {
                effective_from: '2026-11-01',
                hourly_cost_cents: 5000,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('adds a working week in seconds with its target', async () => {
        const dialog = mountDialog();
        await flushPromises();
        const datePickers = dialog.findAllComponents(DatePicker);
        datePickers[1]?.vm.$emit('update:modelValue', '2026-12-01T00:00:00Z');
        const fields = dialog.findAllComponents(NumberField);
        fields[1]?.vm.$emit('update:modelValue', 37.5);
        fields[2]?.vm.$emit('update:modelValue', 80);
        await flushPromises();
        await click('profitability-add-work-week');

        expect(axiosPost).toHaveBeenCalledWith(`${ORG_URL}/settings/people/m-1/work-weeks`, {
            effective_from: '2026-12-01',
            weekly_seconds: 135000,
            target_percent: 80,
        });
        expect(addNotification).toHaveBeenCalledWith('success', 'Working week added.');
    });

    it('sends the 40 h / 75 % defaults when the working week row is untouched', async () => {
        mountDialog();
        await flushPromises();
        await click('profitability-add-work-week');
        expect(axiosPost).toHaveBeenCalledWith(
            `${ORG_URL}/settings/people/m-1/work-weeks`,
            expect.objectContaining({ weekly_seconds: 144000, target_percent: 75 })
        );
    });

    it('shows a duplicate date 422 under the add row and keeps the values', async () => {
        const message =
            'There is already a value from this date. Delete it first or pick another date.';
        axiosPost.mockRejectedValueOnce(unprocessable('effective_from', message));
        const dialog = mountDialog();
        await flushPromises();
        dialog.findAllComponents(NumberField)[0]?.vm.$emit('update:modelValue', 45);
        await flushPromises();
        await click('profitability-add-cost');

        expect(one('profitability-cost-error').textContent).toContain(message);
        expect(addNotification).not.toHaveBeenCalled();
        expect(dialog.findAllComponents(NumberField)[0]?.props('modelValue')).toBe(45);
    });

    it('shows the working week 422 under its own add row', async () => {
        axiosPost.mockRejectedValueOnce(unprocessable('effective_from', 'Duplicate date.'));
        mountDialog();
        await flushPromises();
        await click('profitability-add-work-week');
        expect(one('profitability-work-week-error').textContent).toContain('Duplicate date.');
        expect(byTestId('profitability-cost-error')).toHaveLength(0);
    });

    it('toasts the save error on any other failure and keeps the values', async () => {
        axiosPost.mockRejectedValueOnce({ response: { status: 500, data: {} } });
        const dialog = mountDialog();
        await flushPromises();
        dialog.findAllComponents(NumberField)[0]?.vm.$emit('update:modelValue', 45);
        await flushPromises();
        await click('profitability-add-cost');

        expect(addNotification).toHaveBeenCalledWith('error', 'Couldn’t save your changes.');
        expect(dialog.findAllComponents(NumberField)[0]?.props('modelValue')).toBe(45);
    });

    it('asks for confirmation before deleting a cost, then deletes it', async () => {
        mountDialog();
        await flushPromises();
        const button = byTestId('profitability-delete-cost')[0];
        expect(button?.getAttribute('aria-label')).toBe('Delete hourly cost from 1.11.2026');
        await click('profitability-delete-cost', 0);

        expect(axiosDelete).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain('Delete this hourly cost?');
        expect(one('profitability-delete-confirm-body').textContent).toContain(
            'From 1.11.2026, Ana’s time will use the previous cost.'
        );
        await click('profitability-delete-confirm-button');

        expect(axiosDelete).toHaveBeenCalledWith(`${ORG_URL}/settings/people/m-1/cost-rates/r-2`);
        expect(addNotification).toHaveBeenCalledWith('success', 'Hourly cost deleted.');
    });

    it('uses the no-previous-cost body for the oldest cost row', async () => {
        mountDialog();
        await flushPromises();
        await click('profitability-delete-cost', 1);
        expect(one('profitability-delete-confirm-body').textContent).toContain(
            'From 1.1.2026, Ana’s time will show as incomplete.'
        );
    });

    it('keeps the row when the confirmation is dismissed', async () => {
        mountDialog();
        await flushPromises();
        await click('profitability-delete-cost', 0);
        await click('profitability-delete-keep');
        expect(axiosDelete).not.toHaveBeenCalled();
        expect(byTestId('profitability-delete-confirm')).toHaveLength(0);
    });

    it('confirms and deletes a working week', async () => {
        mountDialog();
        await flushPromises();
        await click('profitability-delete-work-week');
        expect(axiosDelete).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain('Delete this working week?');
        await click('profitability-delete-confirm-button');
        expect(axiosDelete).toHaveBeenCalledWith(`${ORG_URL}/settings/people/m-1/work-weeks/w-1`);
        expect(addNotification).toHaveBeenCalledWith('success', 'Working week deleted.');
    });

    it('shows the empty history line for a person without values', async () => {
        mountDialog(person({ cost_rates: [], work_weeks: [] }));
        await flushPromises();
        expect(byTestId('profitability-cost-history-empty')).toHaveLength(1);
        expect(byTestId('profitability-work-week-history-empty')).toHaveLength(1);
    });

    it('emits close from the footer button', async () => {
        const dialog = mountDialog();
        await flushPromises();
        await click('profitability-person-close');
        expect(dialog.emitted('close')).toHaveLength(1);
    });
});
