import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import axios from 'axios';
import { Combobox } from '@/packages/ui/src/combobox';
import AbsenceProjectsCard from './AbsenceProjectsCard.vue';

const { pageProps, addNotification } = vi.hoisted(() => ({
    pageProps: {} as Record<string, unknown>,
    addNotification: vi.fn(),
}));

vi.mock('@inertiajs/vue3', () => ({ usePage: () => ({ props: pageProps }) }));
vi.mock('@/utils/useUser', () => ({ getCurrentOrganizationId: () => 'org-1' }));
vi.mock('@/utils/notification', () => ({ useNotificationsStore: () => ({ addNotification }) }));
vi.mock('axios', () => ({
    default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const axiosGet = vi.mocked(axios.get);
const axiosPut = vi.mocked(axios.put);

const ORG_URL = 'https://app.example.test/profitability/organizations/org-1';

const EMPTY =
    'No absence projects marked. Until you mark them, holidays count as internal time and lower chargeability.';

const labels = {
    common: {
        save_error: 'Couldn’t save your changes.',
        load_error: 'Couldn’t load profitability figures.',
        try_again: 'Try again',
    },
    admin: {
        settings: {
            absence_title: 'Absence projects',
            mark_absence: 'Mark absence project',
            unmark_absence_aria: 'Unmark :project as absence',
            absence_helper: 'Time on these projects counts as absence.',
            absence_empty: EMPTY,
        },
        toasts: { absence_updated: 'Absence projects updated.' },
    },
};

const projects = [
    { id: 'p-1', name: 'Festivo', client_name: null, is_archived: false },
    { id: 'p-2', name: 'Vacaciones', client_name: null, is_archived: false },
    { id: 'p-3', name: 'Web', client_name: 'Acme', is_archived: false },
];

function absence(projectIds: string[]) {
    return { data: { data: { project_ids: projectIds, projects } } };
}

let wrapper: VueWrapper | null = null;

async function mountCard() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = mount(AbsenceProjectsCard, {
        attachTo: document.body,
        global: { plugins: [[VueQueryPlugin, { queryClient }]] },
    });
    await flushPromises();
    return wrapper;
}

function byTestId(testid: string): HTMLElement[] {
    return Array.from(document.body.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`));
}

beforeEach(() => {
    vi.clearAllMocks();
    pageProps.profitability = {
        enabled: true,
        views: ['settings'],
        organization_url: ORG_URL,
        labels,
    };
    axiosPut.mockResolvedValue({ status: 200, data: {} });
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
});

describe('AbsenceProjectsCard', () => {
    it('warns while no absence project is marked', async () => {
        axiosGet.mockResolvedValue(absence([]));
        await mountCard();
        expect(axiosGet).toHaveBeenCalledWith(`${ORG_URL}/settings/absence-projects`);
        expect(byTestId('profitability-absence-empty')[0]?.textContent).toContain(EMPTY);
        expect(byTestId('profitability-absence-chip')).toHaveLength(0);
    });

    it('shows marked projects as chips and no warning', async () => {
        axiosGet.mockResolvedValue(absence(['p-2']));
        await mountCard();
        expect(byTestId('profitability-absence-empty')).toHaveLength(0);
        const chips = byTestId('profitability-absence-chip');
        expect(chips).toHaveLength(1);
        expect(chips[0]?.textContent).toContain('Vacaciones');
        expect(byTestId('profitability-absence-unmark')[0]?.getAttribute('aria-label')).toBe(
            'Unmark Vacaciones as absence'
        );
    });

    it('marks a project by sending the whole set with a PUT and toasts', async () => {
        axiosGet.mockResolvedValue(absence(['p-2']));
        const card = await mountCard();
        card.findComponent(Combobox).vm.$emit('update:modelValue', ['p-2', 'p-1']);
        await flushPromises();
        expect(axiosPut).toHaveBeenCalledWith(`${ORG_URL}/settings/absence-projects`, {
            project_ids: ['p-2', 'p-1'],
        });
        expect(addNotification).toHaveBeenCalledWith('success', 'Absence projects updated.');
    });

    it('unmarks a project from its chip without confirmation', async () => {
        axiosGet.mockResolvedValue(absence(['p-1', 'p-2']));
        await mountCard();
        byTestId('profitability-absence-unmark')[0]?.click();
        await flushPromises();
        expect(axiosPut).toHaveBeenCalledWith(`${ORG_URL}/settings/absence-projects`, {
            project_ids: ['p-2'],
        });
    });

    it('lists every project of the organization in the picker', async () => {
        axiosGet.mockResolvedValue(absence([]));
        const card = await mountCard();
        card.findComponent(Combobox).vm.$emit('update:open', true);
        await flushPromises();
        expect(byTestId('profitability-absence-option').map((o) => o.textContent?.trim())).toEqual(
            expect.arrayContaining([
                expect.stringContaining('Festivo'),
                expect.stringContaining('Vacaciones'),
                expect.stringContaining('Web'),
            ])
        );
    });

    it('toasts the save error and goes back to the saved set on failure', async () => {
        axiosGet.mockResolvedValue(absence([]));
        axiosPut.mockRejectedValueOnce({ response: { status: 500, data: {} } });
        const card = await mountCard();
        card.findComponent(Combobox).vm.$emit('update:modelValue', ['p-1']);
        await flushPromises();
        expect(addNotification).toHaveBeenCalledWith('error', 'Couldn’t save your changes.');
        expect(byTestId('profitability-absence-chip')).toHaveLength(0);
        expect(byTestId('profitability-absence-empty')).toHaveLength(1);
    });
});
