import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import axios from 'axios';
import PeopleSettingsCard from './PeopleSettingsCard.vue';

const { pageProps } = vi.hoisted(() => ({ pageProps: {} as Record<string, unknown> }));

vi.mock('@inertiajs/vue3', () => ({ usePage: () => ({ props: pageProps }) }));
vi.mock('@/utils/useUser', () => ({ getCurrentOrganizationId: () => 'org-1' }));
vi.mock('@/utils/useOrganizationQuery', () => ({
    useOrganizationQuery: () => ({
        organization: computed(() => ({
            number_format: 'comma-point',
            currency_format: 'symbol-before',
            currency_symbol: '€',
        })),
    }),
}));
vi.mock('@/utils/notification', () => ({
    useNotificationsStore: () => ({ addNotification: vi.fn() }),
}));
vi.mock('axios', () => ({
    default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const axiosGet = vi.mocked(axios.get);

const ORG_URL = 'https://app.example.test/profitability/organizations/org-1';

const labels = {
    common: {
        former_member: 'Former member',
        load_error: 'Couldn’t load profitability figures.',
        try_again: 'Try again',
    },
    admin: {
        settings: {
            people_title: 'People',
            people_columns: {
                person: 'Person',
                role: 'Role',
                hourly_cost: 'Hourly cost',
                working_week: 'Working week',
                target: 'Target',
                since: 'Since',
            },
            per_hour: ':value / h',
            edit_aria: 'Edit :name',
            not_set: 'Not set',
            not_set_tooltip: 'Margins and chargeability are incomplete without this.',
            dialog: { close: 'Close person settings', cost_legend: 'Hourly cost' },
        },
    },
};

function person(overrides: Record<string, unknown> = {}) {
    return {
        member_id: 'm-1',
        name: 'Ana',
        role: 'admin',
        is_placeholder: false,
        hourly_cost_cents: 4500,
        weekly_seconds: 144000,
        target_percent: 75,
        since: '2026-11-01',
        cost_rates: [{ id: 'r-1', effective_from: '2026-11-01', hourly_cost_cents: 4500 }],
        work_weeks: [
            { id: 'w-1', effective_from: '2026-01-01', weekly_seconds: 144000, target_percent: 75 },
        ],
        ...overrides,
    };
}

const people = [
    person(),
    person({
        member_id: 'm-2',
        name: 'Bruno',
        role: 'employee',
        hourly_cost_cents: null,
        since: '2026-01-01',
        cost_rates: [],
    }),
    person({
        member_id: 'm-3',
        name: 'Carla',
        role: 'placeholder',
        is_placeholder: true,
        hourly_cost_cents: null,
        weekly_seconds: null,
        target_percent: null,
        since: null,
        cost_rates: [],
        work_weeks: [],
    }),
];

let wrapper: VueWrapper | null = null;

async function mountCard() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = mount(PeopleSettingsCard, {
        attachTo: document.body,
        global: { plugins: [[VueQueryPlugin, { queryClient }]] },
    });
    await flushPromises();
    return wrapper;
}

function rows(): HTMLElement[] {
    return Array.from(
        document.body.querySelectorAll<HTMLElement>(
            '[data-testid="profitability-settings-person-row"]'
        )
    );
}

function row(memberId: string): HTMLElement {
    const found = rows().find((element) => element.dataset.memberId === memberId);
    if (!found) throw new Error(`No row ${memberId}`);
    return found;
}

beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/profitability?view=settings');
    pageProps.profitability = {
        enabled: true,
        views: ['projects', 'settings'],
        organization_url: ORG_URL,
        labels,
    };
    axiosGet.mockResolvedValue({ data: { data: people } });
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
});

describe('PeopleSettingsCard', () => {
    it('reads the people settings endpoint and lists every member', async () => {
        await mountCard();
        expect(axiosGet).toHaveBeenCalledWith(`${ORG_URL}/settings/people`);
        expect(rows()).toHaveLength(3);
        expect(document.body.textContent).toContain('People');
    });

    it('shows the current cost, working week, target, role and since date', async () => {
        await mountCard();
        const text = row('m-1').textContent ?? '';
        expect(text).toContain('Admin');
        expect(text).toContain('€45.00 / h');
        expect(text).toContain('40 h');
        expect(text).toContain('75 %');
        expect(text).toContain('1.11.2026');
        expect(row('m-1').querySelector('[data-testid="profitability-settings-not-set"]')).toBe(
            null
        );
    });

    it('flags a missing cost or working week as Not set with the amber icon and its tooltip label', async () => {
        await mountCard();
        const bruno = row('m-2').querySelectorAll('[data-testid="profitability-settings-not-set"]');
        expect(bruno).toHaveLength(1);
        expect(bruno[0]?.textContent).toContain('Not set');
        const icon = bruno[0]?.querySelector('svg');
        expect(icon?.getAttribute('class')).toContain('text-amber-800');
        expect(icon?.getAttribute('aria-label')).toBe(
            'Margins and chargeability are incomplete without this.'
        );

        const carla = row('m-3').querySelectorAll('[data-testid="profitability-settings-not-set"]');
        expect(carla).toHaveLength(2);
    });

    it('lists placeholders with the Former member badge', async () => {
        await mountCard();
        expect(
            row('m-3').querySelector('[data-testid="profitability-former-member"]')?.textContent
        ).toContain('Former member');
        expect(row('m-1').querySelector('[data-testid="profitability-former-member"]')).toBe(null);
    });

    it('opens the person dialog from the labelled edit button', async () => {
        await mountCard();
        const edit = row('m-2').querySelector<HTMLElement>(
            '[data-testid="profitability-settings-edit-person"]'
        );
        expect(edit?.getAttribute('aria-label')).toBe('Edit Bruno');
        edit?.click();
        await flushPromises();
        const dialog = document.body.querySelector('[data-testid="profitability-person-dialog"]');
        expect(dialog).not.toBe(null);
        expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Bruno');
    });

    it('opens the dialog of the person named in ?member=', async () => {
        window.history.replaceState(null, '', '/profitability?view=settings&member=m-3');
        await mountCard();
        expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Carla');
    });

    it('shows the load error with a retry', async () => {
        axiosGet.mockRejectedValue(new Error('network'));
        await mountCard();
        // The query retries once after 300 ms before it reports the error.
        await vi.waitFor(() =>
            expect(
                document.body.querySelector('[data-testid="profitability-settings-people-error"]')
                    ?.textContent
            ).toContain('Couldn’t load profitability figures.')
        );
    });
});
