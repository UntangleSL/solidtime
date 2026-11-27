import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import axios from 'axios';
import ContractEditor from './ContractEditor.vue';
import ProjectSummaryCard from './ProjectSummaryCard.vue';
import ProjectsView from './ProjectsView.vue';
import { Combobox } from '@/packages/ui/src/combobox';
import { NumberField } from '@/packages/ui/src/number-field';
import { Select } from '@/packages/ui/src/select';
import DatePicker from '@/packages/ui/src/Input/DatePicker.vue';
import { getLocalizedDayJsFromMinutes } from '@/packages/ui/src/utils/time';

const { pageProps, addNotification } = vi.hoisted(() => ({
    pageProps: {} as Record<string, unknown>,
    addNotification: vi.fn(),
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
    projects: {
        only_billable_helper: 'Only billable projects can have contract terms.',
        open_project: 'Open project',
        actions_aria: 'Actions for :project',
    },
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

// NumberField reads the organization's number format through an inject (core app.ts provides it)
const PROVIDE = { organization: computed(() => ({ number_format: 'comma-point' })) };

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
        global: { plugins: [[VueQueryPlugin, { queryClient }]], provide: PROVIDE },
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
                    provide: PROVIDE,
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

    describe('editing existing terms', () => {
        const CONTRACT: Record<string, unknown> = {
            service: 'SEO retainer',
            schedule: 'monthly',
            starts_on: '2026-10-01',
            ends_on: null,
            archived: false,
        };
        const PERIODS = [
            { id: 'dec', starts_on: '2026-12-01', ends_on: '2026-12-31', state: 'upcoming' },
            { id: 'nov', starts_on: '2026-11-01', ends_on: '2026-11-30', state: 'current' },
            { id: 'oct', starts_on: '2026-10-01', ends_on: '2026-10-31', state: 'closed' },
        ];

        function respondSummary(contract = CONTRACT, periods = PERIODS) {
            axiosGet.mockImplementation(async (_url, config) => {
                const params = (config as { params?: { period?: string } } | undefined)?.params;
                const id = params?.period ?? 'nov';
                const ref = periods.find((item) => item.id === id) ?? periods[0]!;
                return {
                    data: {
                        data: {
                            project_id: 'p-1',
                            can_edit_terms: true,
                            can_edit_plan: true,
                            contract,
                            periods,
                            period: {
                                ...ref,
                                budget_seconds: 144000,
                                consumed_seconds: 0,
                                months: [],
                                amount_cents: 300000,
                            },
                        },
                    },
                };
            });
        }

        beforeEach(() => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(new Date('2026-11-27T10:00:00'));
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('prefills the terms and locks schedule and start once a period has started', async () => {
            respondSummary();
            mountEditor({ mode: 'edit' });
            await settle();

            expect(document.body.textContent).toContain('Edit contract terms');
            expect(numberField('contract-hours').props('modelValue')).toBe(40);
            expect(numberField('contract-amount').props('modelValue')).toBe(3000);
            expect(wrapper!.findAllComponents(Select)[0]!.props('disabled')).toBe(true);
            expect(text('contract-start-locked')).toBe('1 Oct 2026');
            // The end date of a renewing contract may still move
            expect(wrapper!.findAllComponents(DatePicker)).toHaveLength(1);
            expect(query('contract-stub')).toBeNull();

            expect(text('contract-apply-to')).toContain(
                'This period (Nov 2026) and the following ones'
            );
            expect(text('contract-apply-to')).toContain('From the next period (1 Dec 2026) on');
            expect(text('contract-apply-to')).not.toContain('Oct 2026');
            expect((query('contract-apply-current') as HTMLInputElement).checked).toBe(true);
        });

        it('warns about the rescale and sends apply_to', async () => {
            respondSummary();
            axiosPut.mockResolvedValue({ status: 204 });
            mountEditor({ mode: 'edit' });
            await settle();
            expect(query('contract-rescale-notice')).toBeNull();

            await setNumber('contract-hours', 50);
            expect(text('contract-rescale-notice')).toBe(
                'The monthly plan of this period will be rescaled to the new total.'
            );

            (query('contract-apply-next') as HTMLInputElement).click();
            await settle();
            expect(query('contract-rescale-notice')).toBeNull();

            query('contract-save')?.click();
            await settle();
            expect(lastPutBody()).toEqual({
                service: 'SEO retainer',
                schedule: 'monthly',
                starts_on: '2026-10-01',
                ends_on: null,
                budget_seconds: 180000,
                amount_cents: 300000,
                apply_to: 'next_period',
            });
        });

        it('sends current_and_following by default', async () => {
            respondSummary();
            axiosPut.mockResolvedValue({ status: 204 });
            mountEditor({ mode: 'edit' });
            await settle();
            query('contract-save')?.click();
            await settle();
            expect(lastPutBody()).toMatchObject({ apply_to: 'current_and_following' });
        });

        it('locks the end date of a started one-off', async () => {
            respondSummary({ ...CONTRACT, schedule: 'one_off', ends_on: '2027-03-31' }, [
                { id: 'nov', starts_on: '2026-10-01', ends_on: '2027-03-31', state: 'current' },
            ]);
            mountEditor({ mode: 'edit' });
            await settle();
            expect(text('contract-end-locked')).toBe('31 Mar 2027');
            expect(wrapper!.findAllComponents(DatePicker)).toHaveLength(0);
        });

        it('keeps everything editable before the start and asks no apply_to', async () => {
            respondSummary({ ...CONTRACT, starts_on: '2026-12-15' }, [
                { id: 'nov', starts_on: '2026-12-15', ends_on: '2026-12-31', state: 'upcoming' },
            ]);
            axiosPut.mockResolvedValue({ status: 204 });
            mountEditor({ mode: 'edit' });
            await settle();
            expect(wrapper!.findAllComponents(Select)[0]!.props('disabled')).toBe(false);
            expect(query('contract-apply-to')).toBeNull();
            expect(query('contract-stub')).not.toBeNull();
            query('contract-save')?.click();
            await settle();
            expect(lastPutBody()).not.toHaveProperty('apply_to');
        });

        it('shows the server message under Apply changes to', async () => {
            respondSummary();
            axiosPut.mockRejectedValue(
                Object.assign(new Error('Unprocessable'), {
                    response: {
                        status: 422,
                        data: { errors: { apply_to: ['The apply to field is required.'] } },
                    },
                })
            );
            mountEditor({ mode: 'edit' });
            await settle();
            query('contract-save')?.click();
            await settle();
            expect(text('contract-error-apply_to')).toBe('The apply to field is required.');
        });
    });

    describe('project picker', () => {
        const ROW = {
            color: '#ef5350',
            client_id: 'c-1',
            archived: false,
            schedule: null,
            period: null,
            budget_seconds: 0,
            consumed_seconds: 0,
            still_to_consume_seconds: 0,
            remaining_plan_seconds: 0,
            run_rate_seconds: null,
            status: null,
            can_edit_plan: false,
        };

        it('is not shown when the editor has a project', async () => {
            mountEditor();
            await settle();
            expect(query('contract-project-picker')).toBeNull();
            expect(axiosGet).not.toHaveBeenCalled();
        });

        it('lists billable projects without terms and saves to the chosen one', async () => {
            axiosGet.mockResolvedValue({
                data: {
                    data: [
                        {
                            ...ROW,
                            project_id: 'p-7',
                            name: 'Brand',
                            client_name: 'Acme',
                            can_edit_terms: true,
                        },
                        {
                            ...ROW,
                            project_id: 'p-8',
                            name: 'Other',
                            client_name: 'Beta',
                            can_edit_terms: false,
                        },
                    ],
                    meta: { total_rows: 2, money_rows: 0 },
                },
            });
            axiosPut.mockResolvedValue({ status: 204 });
            mountEditor({ projectId: null, projectName: null });
            await settle();

            expect(axiosGet).toHaveBeenCalledWith(`${ORG_URL}/views/projects`, {
                params: { contract: 'without' },
            });
            expect(text('contract-project-picker')).toContain(
                'Only billable projects can have contract terms.'
            );
            expect((query('contract-save') as HTMLButtonElement).disabled).toBe(true);

            const combobox = wrapper!.findComponent(Combobox);
            combobox.vm.$emit('update:open', true);
            await settle();
            const options = Array.from(
                document.body.querySelectorAll('[data-testid="contract-project-option"]')
            ).map((option) => option.textContent?.replace(/\s+/g, ' ').trim());
            expect(options).toEqual(['BrandAcme']);

            combobox.vm.$emit('update:modelValue', 'p-7');
            await settle();
            await setNumber('contract-hours', 40);
            await setNumber('contract-amount', 3000);
            query('contract-save')?.click();
            await settle();
            expect(axiosPut.mock.calls[0]![0]).toBe(`${ORG_URL}/projects/p-7/contract`);
        });
    });

    describe('from the Projects view', () => {
        const MONEY = {
            amount_cents: 300000,
            revenue_to_date_cents: 300000,
            cost_cents: 0,
            margin_cents: 300000,
            projected_cost_cents: null,
            projected_margin_cents: null,
            unpriced_cost_seconds: 0,
        };

        function viewRow(overrides: Record<string, unknown> = {}) {
            return {
                project_id: 'p-1',
                name: 'Alpha',
                color: '#ef5350',
                client_id: 'c-1',
                client_name: 'Client A',
                archived: false,
                schedule: 'monthly',
                period: {
                    id: 'per-1',
                    starts_on: '2026-11-01',
                    ends_on: '2026-11-30',
                    state: 'current',
                },
                budget_seconds: 144000,
                consumed_seconds: 36000,
                still_to_consume_seconds: 108000,
                remaining_plan_seconds: 144000,
                run_rate_seconds: null,
                status: 'on_track',
                can_edit_terms: true,
                can_edit_plan: true,
                ...MONEY,
                ...overrides,
            };
        }

        function mountView(rows: unknown[]) {
            axiosGet.mockResolvedValue({
                data: { data: rows, meta: { total_rows: rows.length, money_rows: rows.length } },
            });
            const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
            wrapper = mount(ProjectsView, {
                attachTo: document.body,
                global: { plugins: [[VueQueryPlugin, { queryClient }]], provide: PROVIDE },
            });
            return wrapper;
        }

        async function openMenu(index: number): Promise<string[]> {
            const triggers = document.body.querySelectorAll<HTMLElement>(
                '[data-testid="profitability-projects-actions"]'
            );
            const trigger = triggers[index]!;
            trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await settle();
            return Array.from(document.body.querySelectorAll('[role="menuitem"]')).map(
                (item) => item.textContent?.trim() ?? ''
            );
        }

        beforeEach(() => {
            window.localStorage.clear();
            window.history.replaceState(null, '', '/profitability');
        });

        it('opens the editor with the project picker from the toolbar', async () => {
            mountView([viewRow()]);
            await settle();
            expect(text('profitability-projects-set-terms')).toBe('Set contract terms');
            query('profitability-projects-set-terms')?.click();
            await settle();
            expect(query('profitability-contract-editor')).not.toBeNull();
            expect(query('contract-project-picker')).not.toBeNull();
        });

        it('offers Edit contract terms and Plan months by the row flags', async () => {
            mountView([viewRow()]);
            await settle();
            expect(await openMenu(0)).toEqual([
                'Open project',
                'Edit contract terms',
                'Plan months',
            ]);
        });

        it('offers neither for a closed period or without the flags', async () => {
            mountView([
                viewRow({
                    period: {
                        id: 'per-0',
                        starts_on: '2026-10-01',
                        ends_on: '2026-10-31',
                        state: 'closed',
                    },
                }),
            ]);
            await settle();
            expect(await openMenu(0)).toEqual(['Open project']);
        });

        it('offers nothing to a scope without the flags', async () => {
            mountView([viewRow({ can_edit_terms: false, can_edit_plan: false })]);
            await settle();
            expect(await openMenu(0)).toEqual(['Open project']);
        });

        it('opens the row editor in edit mode without a picker', async () => {
            mountView([viewRow()]);
            await settle();
            await openMenu(0);
            (
                document.body.querySelector(
                    '[data-testid="profitability-projects-edit-terms"]'
                ) as HTMLElement
            ).click();
            await settle();
            expect(query('profitability-contract-editor')).not.toBeNull();
            expect(document.body.textContent).toContain('Edit contract terms');
            expect(query('contract-project-picker')).toBeNull();
            expect(axiosGet).toHaveBeenCalledWith(`${ORG_URL}/projects/p-1/summary`, {
                params: undefined,
            });
        });
    });
});
