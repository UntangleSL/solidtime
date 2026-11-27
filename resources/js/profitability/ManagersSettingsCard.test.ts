import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import axios from 'axios';
import { Combobox } from '@/packages/ui/src/combobox';
import ManagersSettingsCard from './ManagersSettingsCard.vue';

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
const axiosPost = vi.mocked(axios.post);
const axiosDelete = vi.mocked(axios.delete);

const ORG_URL = 'https://app.example.test/profitability/organizations/org-1';

const labels = {
    common: {
        save_error: 'Couldn’t save your changes.',
        load_error: 'Couldn’t load profitability figures.',
        try_again: 'Try again',
        no_client: 'No client',
    },
    admin: {
        settings: {
            managers_title: 'Project and account managers',
            managers_filter: 'Filter clients and projects',
            managers_columns: { client: 'Client', project: 'Project' },
            account_managers: 'Account managers',
            account_managers_helper: 'Account managers set contract terms.',
            add_account_manager: 'Add account manager',
            remove_account_manager_aria: 'Remove :name as account manager',
            project_managers: 'Project managers',
            project_managers_helper: 'Project managers plan the monthly hours.',
            add_project_manager: 'Add project manager',
            remove_project_manager_aria: 'Remove :name as project manager',
        },
        toasts: { manager_added: 'Manager added.', manager_removed: 'Manager removed.' },
    },
};

function payload(clientCount = 1) {
    const clients = Array.from({ length: clientCount }, (_, index) => ({
        id: `c-${index + 1}`,
        name: index === 0 ? 'Acme' : `Client ${index + 1}`,
        account_managers: index === 0 ? [{ member_id: 'm-1', name: 'Ana' }] : [],
    }));
    return {
        data: {
            clients,
            projects: [
                {
                    id: 'p-2',
                    name: 'Zeta',
                    client_id: null,
                    client_name: null,
                    project_managers: [],
                },
                {
                    id: 'p-1',
                    name: 'Web',
                    client_id: 'c-1',
                    client_name: 'Acme',
                    project_managers: [{ member_id: 'm-2', name: 'Bruno' }],
                },
            ],
            members: [
                { member_id: 'm-1', name: 'Ana', role: 'admin' },
                { member_id: 'm-2', name: 'Bruno', role: 'employee' },
                { member_id: 'm-9', name: 'Old Placeholder', role: 'placeholder' },
            ],
        },
    };
}

let wrapper: VueWrapper | null = null;

async function mountCard() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = mount(ManagersSettingsCard, {
        attachTo: document.body,
        global: { plugins: [[VueQueryPlugin, { queryClient }]] },
    });
    await flushPromises();
    return wrapper;
}

function rows(): HTMLElement[] {
    return Array.from(
        document.body.querySelectorAll<HTMLElement>('[data-testid="profitability-managers-row"]')
    );
}

function row(key: string): HTMLElement {
    const found = rows().find((element) => element.dataset.rowKey === key);
    if (!found) throw new Error(`No row ${key}`);
    return found;
}

function pickerIndex(key: string): number {
    return rows().findIndex((element) => element.dataset.rowKey === key);
}

beforeEach(() => {
    vi.clearAllMocks();
    pageProps.profitability = {
        enabled: true,
        views: ['settings'],
        organization_url: ORG_URL,
        labels,
    };
    axiosGet.mockResolvedValue({ data: payload() });
    axiosPost.mockResolvedValue({ status: 204, data: '' });
    axiosDelete.mockResolvedValue({ status: 204, data: '' });
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
});

describe('ManagersSettingsCard', () => {
    it('lists clients with their account managers and billable projects grouped by client', async () => {
        await mountCard();
        expect(axiosGet).toHaveBeenCalledWith(`${ORG_URL}/settings/managers`);
        expect(rows().map((element) => element.dataset.rowKey)).toEqual([
            'account:c-1',
            'project:p-1',
            'project:p-2',
        ]);
        expect(row('account:c-1').textContent).toContain('Ana');
        expect(row('project:p-1').textContent).toContain('Bruno');
        expect(row('project:p-2').textContent).toContain('No client');
    });

    it('offers members without placeholders and without the ones already assigned', async () => {
        const card = await mountCard();
        card.findAllComponents(Combobox)[pickerIndex('account:c-1')]?.vm.$emit('update:open', true);
        await flushPromises();
        const options = Array.from(
            document.body.querySelectorAll('[data-testid="profitability-manager-option"]')
        ).map((option) => option.textContent?.trim());
        expect(options).toEqual(['Bruno']);
        expect(options).not.toContain('Old Placeholder');
    });

    it('adds an account manager at once with a toast', async () => {
        const card = await mountCard();
        card.findAllComponents(Combobox)[pickerIndex('account:c-1')]?.vm.$emit(
            'update:modelValue',
            'm-2'
        );
        await flushPromises();
        expect(axiosPost).toHaveBeenCalledWith(`${ORG_URL}/settings/clients/c-1/account-managers`, {
            member_id: 'm-2',
        });
        expect(addNotification).toHaveBeenCalledWith('success', 'Manager added.');
    });

    it('adds a project manager at once with a toast', async () => {
        const card = await mountCard();
        card.findAllComponents(Combobox)[pickerIndex('project:p-2')]?.vm.$emit(
            'update:modelValue',
            'm-1'
        );
        await flushPromises();
        expect(axiosPost).toHaveBeenCalledWith(`${ORG_URL}/settings/projects/p-2/managers`, {
            member_id: 'm-1',
        });
        expect(addNotification).toHaveBeenCalledWith('success', 'Manager added.');
    });

    it('removes a manager from its chip without confirmation', async () => {
        await mountCard();
        const remove = row('project:p-1').querySelector<HTMLElement>(
            '[data-testid="profitability-manager-remove"]'
        );
        expect(remove?.getAttribute('aria-label')).toBe('Remove Bruno as project manager');
        remove?.click();
        await flushPromises();
        expect(axiosDelete).toHaveBeenCalledWith(`${ORG_URL}/settings/projects/p-1/managers/m-2`);
        expect(addNotification).toHaveBeenCalledWith('success', 'Manager removed.');

        row('account:c-1')
            .querySelector<HTMLElement>('[data-testid="profitability-manager-remove"]')
            ?.click();
        await flushPromises();
        expect(axiosDelete).toHaveBeenCalledWith(
            `${ORG_URL}/settings/clients/c-1/account-managers/m-1`
        );
    });

    it('toasts the save error when a change fails', async () => {
        axiosPost.mockRejectedValueOnce({ response: { status: 422, data: {} } });
        const card = await mountCard();
        card.findAllComponents(Combobox)[0]?.vm.$emit('update:modelValue', 'm-2');
        await flushPromises();
        expect(addNotification).toHaveBeenCalledWith('error', 'Couldn’t save your changes.');
    });

    it('shows the filter only above 10 rows and filters clients and projects', async () => {
        await mountCard();
        expect(document.body.querySelector('[data-testid="profitability-managers-filter"]')).toBe(
            null
        );
        wrapper?.unmount();
        document.body.innerHTML = '';

        axiosGet.mockResolvedValue({ data: payload(9) });
        await mountCard();
        const filter = document.body.querySelector<HTMLInputElement>(
            '[data-testid="profitability-managers-filter"]'
        );
        expect(filter).not.toBe(null);
        expect(rows()).toHaveLength(11);

        filter!.value = 'acme';
        filter!.dispatchEvent(new Event('input'));
        await flushPromises();
        expect(rows().map((element) => element.dataset.rowKey)).toEqual([
            'account:c-1',
            'project:p-1',
        ]);
    });
});
