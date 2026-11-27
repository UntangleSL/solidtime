import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import axios from 'axios';
import PlanGrid from './PlanGrid.vue';
import ProjectSummaryCard from './ProjectSummaryCard.vue';
import { NumberField } from '@/packages/ui/src/number-field';

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
        organization: computed(() => ({ number_format: 'comma-point' })),
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
        hours_over: ':n h over',
        hours_left: ':n h left',
        hours_unused: ':n h unused',
        on_plan: 'On plan',
        total: 'Total',
        this_month_suffix: '(this month)',
    },
    period_state: { current: 'Current', upcoming: 'Upcoming', closed: 'Closed' },
    schedule: { quarterly: 'Renews quarterly', monthly: 'Renews monthly' },
    summary: {
        title: 'Contract',
        since: 'Since :date',
        period_option: ':period · :state',
        period_select: 'Period',
        month: 'Month',
        planned: 'Planned',
        consumed: 'Consumed',
        difference: 'Difference',
        plan_months: 'Plan months',
        edit_terms: 'Edit contract terms',
    },
    plan_editor: {
        title: 'Plan months',
        subtitle: ':project · :period · :sold sold',
        split_evenly: 'Split evenly',
        save: 'Save plan',
        sum_equal: 'Planned :sold of :sold',
        sum_under: 'Planned :x of :sold · :n h left to distribute',
        sum_over: 'Planned :x of :sold · :n h above the hours sold',
        save_disabled_reason: 'The months must add up to the hours sold before you can save.',
    },
    toasts: { plan_saved: 'Plan saved.' },
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

// A quarter of 40 h, split 13.5 / 13.5 / 13 (the server's even split)
function summary(periodOverrides: Record<string, unknown> = {}, overrides = {}) {
    return {
        data: {
            data: {
                project_id: 'p-1',
                can_edit_terms: true,
                can_edit_plan: true,
                contract: {
                    service: null,
                    schedule: 'quarterly',
                    starts_on: '2026-10-01',
                    ends_on: null,
                    archived: false,
                },
                periods: [
                    { id: 'q4', starts_on: '2026-10-01', ends_on: '2026-12-31', state: 'current' },
                ],
                period: {
                    id: 'q4',
                    starts_on: '2026-10-01',
                    ends_on: '2026-12-31',
                    state: 'current',
                    budget_seconds: 144000,
                    consumed_seconds: 54000,
                    months: [
                        { month: '2026-10-01', planned_seconds: 48600, consumed_seconds: 36000 },
                        { month: '2026-11-01', planned_seconds: 48600, consumed_seconds: 18000 },
                        { month: '2026-12-01', planned_seconds: 46800, consumed_seconds: 0 },
                    ],
                    ...periodOverrides,
                },
                ...overrides,
            },
        },
    };
}

// NumberField reads the organization's number format through an inject (core app.ts provides it)
const PROVIDE = { organization: computed(() => ({ number_format: 'comma-point' })) };

let wrapper: VueWrapper | null = null;

function mountGrid() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = mount(PlanGrid, {
        props: {
            show: true,
            projectId: 'p-1',
            periodId: 'q4',
            projectName: 'Website',
            'onUpdate:show': (value: boolean) => wrapper?.setProps({ show: value }),
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

function cell(index: number) {
    const field = wrapper!
        .findAllComponents(NumberField)
        .find((item) => item.props('id') === `plan-month-${index}`);
    if (!field) throw new Error(`No cell ${index}`);
    return field;
}

async function setCell(index: number, hours: number | null) {
    cell(index).vm.$emit('update:modelValue', hours);
    await settle();
}

function saveButton(): HTMLButtonElement {
    return query('plan-save') as HTMLButtonElement;
}

describe('PlanGrid', () => {
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

    it('loads the period months with the title, subtitle and an equal sum', async () => {
        axiosGet.mockResolvedValue(summary());
        mountGrid();
        await settle();
        expect(axiosGet).toHaveBeenCalledWith(`${ORG_URL}/projects/p-1/summary`, {
            params: { period: 'q4' },
        });
        expect(query('profitability-plan-grid')).not.toBeNull();
        expect(text('plan-grid-subtitle')).toBe('Website · Oct – Dec 2026 · 40 h sold');
        expect(document.body.querySelectorAll('[data-testid="plan-grid-row"]')).toHaveLength(3);
        expect(cell(0).props('modelValue')).toBe(13.5);
        expect(cell(2).props('modelValue')).toBe(13);
        expect(text('plan-grid-sum')).toContain('Planned 40 h of 40 h');
        expect(query('plan-grid-sum')?.getAttribute('aria-live')).toBe('polite');
        expect(saveButton().disabled).toBe(false);
    });

    it('enables Save plan only when the sum equals the hours sold, with a visible reason', async () => {
        axiosGet.mockResolvedValue(summary());
        mountGrid();
        await settle();

        await setCell(0, 10);
        expect(text('plan-grid-sum')).toContain(
            'Planned 36.5 h of 40 h · 3.5 h left to distribute'
        );
        expect(
            document.body
                .querySelector('[data-testid="plan-grid-sum"] [data-sum]')
                ?.getAttribute('data-sum')
        ).toBe('under');
        expect(saveButton().disabled).toBe(true);
        expect(saveButton().getAttribute('title')).toBe(
            'The months must add up to the hours sold before you can save.'
        );
        expect(text('plan-grid-reason')).toBe(
            'The months must add up to the hours sold before you can save.'
        );

        await setCell(0, 20);
        expect(text('plan-grid-sum')).toContain(
            'Planned 46.5 h of 40 h · 6.5 h above the hours sold'
        );
        expect(saveButton().disabled).toBe(true);

        // Uneven months are fine as long as the total holds (D-02)
        await setCell(0, 13.5);
        await setCell(1, 20);
        await setCell(2, 6.5);
        expect(query('plan-grid-reason')).toBeNull();
        expect(saveButton().disabled).toBe(false);
        expect(saveButton().hasAttribute('title')).toBe(false);
    });

    it('splits evenly like the server, without saving', async () => {
        axiosGet.mockResolvedValue(summary());
        mountGrid();
        await settle();
        await setCell(0, 0);
        await setCell(1, 0);
        await setCell(2, 0);

        query('plan-split-evenly')?.click();
        await settle();
        expect([0, 1, 2].map((index) => cell(index).props('modelValue'))).toEqual([13.5, 13.5, 13]);
        expect(axiosPut).not.toHaveBeenCalled();
        expect(saveButton().disabled).toBe(false);
    });

    it('moves to the next month on Enter and selects a cell on focus', async () => {
        axiosGet.mockResolvedValue(summary());
        mountGrid();
        await settle();
        const first = query('plan-input-0') as HTMLInputElement;
        const second = query('plan-input-1') as HTMLInputElement;
        const select = vi.spyOn(second, 'select');

        first.focus();
        first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await settle();
        expect(document.activeElement).toBe(second);
        expect(select).toHaveBeenCalled();
    });

    it('saves the months in seconds, toasts and closes', async () => {
        axiosGet.mockResolvedValue(summary());
        axiosPut.mockResolvedValue({ status: 204 });
        const wrapper = mountGrid();
        await settle();
        await setCell(1, 20);
        await setCell(2, 6.5);

        saveButton().click();
        await settle();
        expect(axiosPut).toHaveBeenCalledWith(`${ORG_URL}/projects/p-1/periods/q4/plan`, {
            months: [
                { month: '2026-10-01', planned_seconds: 48600 },
                { month: '2026-11-01', planned_seconds: 72000 },
                { month: '2026-12-01', planned_seconds: 23400 },
            ],
        });
        expect(addNotification).toHaveBeenCalledWith('success', 'Plan saved.');
        expect(wrapper.emitted('update:show')?.at(-1)).toEqual([false]);
    });

    it('keeps the values and shows the server message on a 422', async () => {
        axiosGet.mockResolvedValue(summary());
        axiosPut.mockRejectedValue(
            Object.assign(new Error('Unprocessable'), {
                response: {
                    status: 422,
                    data: {
                        errors: {
                            months: [
                                'The months add up to 40 h, but 30 h were sold. Adjust 10 h before saving.',
                            ],
                        },
                    },
                },
            })
        );
        const wrapper = mountGrid();
        await settle();
        await setCell(1, 20);
        await setCell(2, 6.5);
        saveButton().click();
        await settle();

        expect(text('plan-grid-server-error')).toBe(
            'The months add up to 40 h, but 30 h were sold. Adjust 10 h before saving.'
        );
        expect(cell(1).props('modelValue')).toBe(20);
        expect(wrapper.emitted('update:show')).toBeUndefined();
        expect(addNotification).not.toHaveBeenCalled();
    });

    it('toasts the save error on a transport failure and stays open', async () => {
        axiosGet.mockResolvedValue(summary());
        axiosPut.mockRejectedValue(new Error('Network Error'));
        const wrapper = mountGrid();
        await settle();
        saveButton().click();
        await settle();
        expect(addNotification).toHaveBeenCalledWith(
            'error',
            'Couldn’t save your changes. Nothing was changed. Try again.'
        );
        expect(wrapper.emitted('update:show')).toBeUndefined();
    });

    it('discards without a request', async () => {
        axiosGet.mockResolvedValue(summary());
        const wrapper = mountGrid();
        await settle();
        await setCell(0, 1);
        query('plan-discard')?.click();
        await settle();
        expect(axiosPut).not.toHaveBeenCalled();
        expect(wrapper.emitted('update:show')?.at(-1)).toEqual([false]);
        expect(document.body.textContent?.toLowerCase()).not.toContain('delete');
    });

    describe('on the project card', () => {
        function mountCard() {
            const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

        it('opens Plan months for the selected period', async () => {
            axiosGet.mockResolvedValue(summary());
            mountCard();
            await settle();
            expect(text('profitability-summary-plan-months')).toBe('Plan months');
            query('profitability-summary-plan-months')?.click();
            await settle();
            expect(query('profitability-plan-grid')).not.toBeNull();
            expect(text('plan-grid-sum')).toContain('Planned 40 h of 40 h');
        });

        it('hides Plan months for a closed period and without can_edit_plan', async () => {
            axiosGet.mockResolvedValue(summary({ state: 'closed' }));
            mountCard();
            await settle();
            expect(query('profitability-summary-hours')).not.toBeNull();
            expect(query('profitability-summary-plan-months')).toBeNull();

            wrapper?.unmount();
            axiosGet.mockResolvedValue(summary({}, { can_edit_plan: false }));
            mountCard();
            await settle();
            expect(query('profitability-summary-hours')).not.toBeNull();
            expect(query('profitability-summary-plan-months')).toBeNull();
        });
    });
});
