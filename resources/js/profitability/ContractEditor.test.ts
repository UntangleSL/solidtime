import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import axios from 'axios';
import ContractEditor from './ContractEditor.vue';
import ProjectSummaryCard from './ProjectSummaryCard.vue';
import { NumberField } from '@/packages/ui/src/number-field';
import { Select } from '@/packages/ui/src/select';
import DatePicker from '@/packages/ui/src/Input/DatePicker.vue';
import { getLocalizedDayJsFromMinutes } from '@/packages/ui/src/utils/time';

const { pageProps, addNotification } = vi.hoisted(() => ({
    pageProps: {} as Record<string, unknown>,
    addNotification: vi.fn(),
}));

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => ({ props: pageProps }),
}));

vi.mock('@/utils/useUser', () => ({ getCurrentOrganizationId: () => 'org-1' }));

vi.mock('@/utils/notification', () => ({ useNotificationsStore: () => ({ addNotification }) }));

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
    default: { get: vi.fn(), put: vi.fn() },
}));

const axiosGet = vi.mocked(axios.get);
const axiosPut = vi.mocked(axios.put);

const ORG_URL = 'https://app.example.test/profitability/organizations/org-1';

const labels = {
    common: {
        save_error: 'Couldn’t save your changes. Nothing was changed. Try again.',
        discard_changes: 'Discard changes',
        load_error: 'Couldn’t load profitability figures.',
        try_again: 'Try again',
    },
    schedule: {
        one_off: 'One-off',
        monthly: 'Renews monthly',
        quarterly: 'Renews quarterly',
        annual: 'Renews annually',
    },
    period_state: { current: 'Current', upcoming: 'Upcoming', closed: 'Closed' },
    summary: {
        title: 'Contract',
        set_terms: 'Set contract terms',
        edit_terms: 'Edit contract terms',
        plan_months: 'Plan months',
        empty_title: 'No contract terms yet',
        empty_body_editor: 'Set the hours and amount sold to follow this project’s budget.',
        empty_body_pm: 'The account manager sets the hours sold.',
    },
    contract_editor: {
        title_set: 'Set contract terms',
        title_edit: 'Edit contract terms',
        project: 'Project',
        project_placeholder: 'Choose a project',
        service: 'Service',
        service_placeholder: 'For example: SEO retainer',
        schedule: 'Schedule',
        start_date: 'Start date',
        end_date: 'End date',
        end_date_helper: 'Leave empty to keep renewing.',
        hours_per: {
            one_off: 'Hours',
            monthly: 'Hours per month',
            quarterly: 'Hours per quarter',
            annual: 'Hours per year',
        },
        first_period_legend: 'First period: :period',
        first_period_helper: 'Prorated to :d of :n days. You can change these.',
        first_period_hours: 'First period hours',
        apply_to_legend: 'Apply changes to',
        apply_to_current: 'This period (:period) and the following ones',
        apply_to_next: 'From the next period (:date) on',
        rescale_notice: 'The monthly plan of this period will be rescaled to the new total.',
        save: 'Save contract terms',
    },
    projects: { only_billable_helper: 'Only billable projects can have contract terms.' },
    toasts: { terms_saved: 'Contract terms saved.' },
    money: {
        editor: {
            amount_per: {
                one_off: 'Amount',
                monthly: 'Amount per month',
                quarterly: 'Amount per quarter',
                annual: 'Amount per year',
            },
            first_period_amount: 'First period amount',
        },
    },
};

function share() {
    pageProps.profitability = {
        enabled: true,
        url: 'https://app.example.test/profitability',
        views: ['projects'],
        labels,
        organization_url: ORG_URL,
        project: { summary_url: `${ORG_URL}/projects/p-1/summary` },
    };
}

let wrapper: VueWrapper | null = null;

function mountEditor(props: Record<string, unknown> = {}) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = mount(ContractEditor, {
        props: {
            show: true,
            projectId: 'p-1',
            projectName: 'Website',
            'onUpdate:show': (value: boolean) => wrapper?.setProps({ show: value }),
            ...props,
        },
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

function query(testid: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
}

function text(testid: string): string {
    return query(testid)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function numberField(id: string) {
    const field = wrapper!.findAllComponents(NumberField).find((item) => item.props('id') === id);
    if (!field) throw new Error(`No number field ${id}`);
    return field;
}

async function setNumber(id: string, value: number | null) {
    numberField(id).vm.$emit('update:modelValue', value);
    await settle();
}

async function setDate(index: number, date: string | null) {
    const picker = wrapper!.findAllComponents(DatePicker)[index]!;
    picker.vm.$emit(
        'update:modelValue',
        date === null ? null : getLocalizedDayJsFromMinutes(date, 12 * 60).format()
    );
    await settle();
}

async function setSchedule(value: string) {
    wrapper!.findAllComponents(Select)[0]!.vm.$emit('update:modelValue', value);
    await settle();
}

function lastPutBody(): Record<string, unknown> {
    const call = axiosPut.mock.calls.at(-1);
    if (!call) throw new Error('No PUT');
    return call[1] as Record<string, unknown>;
}

describe('ContractEditor', () => {
    beforeAll(() => {
        const settings = window as unknown as Record<string, unknown>;
        settings.getTimezoneSetting = () => 'Europe/Madrid';
        settings.getWeekStartSetting = () => 'monday';
    });

    beforeEach(() => {
        for (const key of Object.keys(pageProps)) delete pageProps[key];
        axiosGet.mockReset();
        axiosPut.mockReset();
        addNotification.mockReset();
        share();
    });

    afterEach(() => {
        wrapper?.unmount();
        wrapper = null;
        document.body.innerHTML = '';
    });

    it('shows the set title with the project name and the monthly default', async () => {
        mountEditor();
        await settle();
        expect(query('profitability-contract-editor')).not.toBeNull();
        expect(document.body.textContent).toContain('Set contract terms');
        expect(text('profitability-contract-editor-project')).toBe('Website');
        expect(document.body.textContent).toContain('Hours per month');
        expect(document.body.textContent).toContain('Amount per month');
    });

    it('prorates a stub first period from the 15th and keeps a manual value (UI-D8)', async () => {
        mountEditor();
        await settle();
        await setNumber('contract-hours', 40);
        await setNumber('contract-amount', 3000);
        expect(query('contract-stub')).toBeNull();

        await setDate(0, '2026-11-15');
        expect(query('contract-stub')).not.toBeNull();
        expect(text('contract-stub')).toContain('First period: 15 – 30 Nov 2026');
        expect(text('contract-stub')).toContain('Prorated to 16 of 30 days.');
        expect(numberField('contract-stub-hours').props('modelValue')).toBe(21.5);
        expect(numberField('contract-stub-amount').props('modelValue')).toBe(1600);

        // A new start date re-prorates while the stub values are untouched
        await setDate(0, '2026-11-16');
        expect(numberField('contract-stub-hours').props('modelValue')).toBe(20);

        // After a manual edit it never overwrites the user's value
        await setNumber('contract-stub-hours', 18);
        await setDate(0, '2026-11-20');
        expect(numberField('contract-stub-hours').props('modelValue')).toBe(18);
    });

    it('sends seconds and cents, toasts and closes on success', async () => {
        axiosPut.mockResolvedValue({ status: 204 });
        const wrapper = mountEditor();
        await settle();
        await setNumber('contract-hours', 40);
        await setNumber('contract-amount', 3000);
        await setDate(0, '2026-11-15');

        query('contract-save')?.click();
        await settle();

        expect(axiosPut).toHaveBeenCalledTimes(1);
        expect(axiosPut.mock.calls[0]![0]).toBe(`${ORG_URL}/projects/p-1/contract`);
        expect(lastPutBody()).toEqual({
            service: null,
            schedule: 'monthly',
            starts_on: '2026-11-15',
            ends_on: null,
            budget_seconds: 144000,
            amount_cents: 300000,
            first_period_budget_seconds: 77400,
            first_period_amount_cents: 160000,
        });
        expect(addNotification).toHaveBeenCalledWith('success', 'Contract terms saved.');
        expect(wrapper.emitted('update:show')?.at(-1)).toEqual([false]);
        expect(wrapper.emitted('saved')).toHaveLength(1);
    });

    it('shows the server FieldError for a one-off without an end date', async () => {
        axiosPut.mockRejectedValue(
            Object.assign(new Error('Unprocessable'), {
                response: {
                    status: 422,
                    data: { errors: { ends_on: ['A one-off contract needs an end date.'] } },
                },
            })
        );
        const wrapper = mountEditor();
        await settle();
        await setSchedule('one_off');
        expect(document.body.textContent).toContain('Hours');
        await setNumber('contract-hours', 100);
        await setNumber('contract-amount', 5000);

        query('contract-save')?.click();
        await settle();

        expect(lastPutBody()).toMatchObject({ schedule: 'one_off', ends_on: null });
        expect(text('contract-error-ends_on')).toBe('A one-off contract needs an end date.');
        // The dialog stays open with the user's values
        expect(wrapper.emitted('update:show')).toBeUndefined();
        expect(numberField('contract-hours').props('modelValue')).toBe(100);
        expect(addNotification).not.toHaveBeenCalled();
    });

    it('keeps the dialog and its values on a transport error and toasts the save error', async () => {
        axiosPut.mockRejectedValue(new Error('Network Error'));
        const wrapper = mountEditor();
        await settle();
        await setNumber('contract-hours', 40);

        query('contract-save')?.click();
        await settle();

        expect(addNotification).toHaveBeenCalledWith(
            'error',
            'Couldn’t save your changes. Nothing was changed. Try again.'
        );
        expect(wrapper.emitted('update:show')).toBeUndefined();
        expect(numberField('contract-hours').props('modelValue')).toBe(40);
    });

    it('closes without a request on Discard changes', async () => {
        const wrapper = mountEditor();
        await settle();
        await setNumber('contract-hours', 40);
        query('contract-discard')?.click();
        await settle();
        expect(axiosPut).not.toHaveBeenCalled();
        expect(wrapper.emitted('update:show')?.at(-1)).toEqual([false]);
    });

    it('offers no delete action and never uses the billable-rate input', async () => {
        mountEditor();
        await settle();
        expect(document.body.textContent?.toLowerCase()).not.toContain('delete');
    });

    describe('on the project card', () => {
        function summary(overrides: Record<string, unknown> = {}) {
            return {
                data: {
                    data: {
                        project_id: 'p-1',
                        can_edit_terms: true,
                        can_edit_plan: true,
                        contract: null,
                        periods: [],
                        period: null,
                        ...overrides,
                    },
                },
            };
        }

        function mountCard() {
            const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
            queryClient.setQueryData(['projects', 'org-1'], {
                data: [{ id: 'p-1', name: 'Website' }],
            });
            wrapper = mount(ProjectSummaryCard, {
                props: { projectId: 'p-1' },
                attachTo: document.body,
                global: {
                    plugins: [[VueQueryPlugin, { queryClient }]],
                    stubs: { PlannedVsConsumedChart: true },
                },
            });
            return wrapper;
        }

        it('opens the editor from the empty card for scopes that can set terms', async () => {
            axiosGet.mockResolvedValue(summary());
            mountCard();
            await settle();
            expect(query('profitability-contract-editor')).toBeNull();
            expect(text('profitability-summary-set-terms')).toBe('Set contract terms');

            query('profitability-summary-set-terms')?.click();
            await settle();
            expect(query('profitability-contract-editor')).not.toBeNull();
            expect(text('profitability-contract-editor-project')).toBe('Website');
        });

        it('shows no button to a project manager', async () => {
            axiosGet.mockResolvedValue(summary({ can_edit_terms: false }));
            mountCard();
            await settle();
            expect(query('profitability-summary-empty')).not.toBeNull();
            expect(query('profitability-summary-set-terms')).toBeNull();
        });

        it('refetches the card after a save so the new period shows', async () => {
            axiosGet.mockResolvedValue(summary());
            axiosPut.mockResolvedValue({ status: 204 });
            mountCard();
            await settle();
            query('profitability-summary-set-terms')?.click();
            await settle();
            await setNumber('contract-hours', 40);
            await setNumber('contract-amount', 3000);
            const before = axiosGet.mock.calls.length;
            query('contract-save')?.click();
            await settle();
            expect(axiosPut).toHaveBeenCalledTimes(1);
            expect(axiosGet.mock.calls.length).toBeGreaterThan(before);
        });
    });
});
