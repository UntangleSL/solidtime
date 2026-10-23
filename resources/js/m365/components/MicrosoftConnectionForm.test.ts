import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import MicrosoftConnectionForm from './MicrosoftConnectionForm.vue';
import type { MicrosoftAccountProps } from '@/m365/types';

const { pageProps, navigateTo, routerDelete } = vi.hoisted(() => ({
    pageProps: {} as Record<string, unknown>,
    navigateTo: vi.fn(),
    routerDelete: vi.fn(),
}));

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => ({ props: pageProps }),
    router: { delete: routerDelete },
}));

vi.mock('@/m365/navigation', () => ({ navigateTo }));

// The real DialogModal renders through a teleported reka-ui dialog; render its slots inline
// (only while open) so the confirmation flow can be asserted on the wrapper.
const DialogModalStub = defineComponent({
    props: { show: { type: Boolean, default: false } },
    emits: ['close', 'submit'],
    setup(props, { slots }) {
        return () =>
            props.show
                ? h('div', { 'data-testid': 'dialog' }, [
                      h('h3', slots.title?.()),
                      h('div', slots.content?.()),
                      h('div', slots.footer?.()),
                  ])
                : null;
    },
});

function account(overrides: Partial<MicrosoftAccountProps> = {}): MicrosoftAccountProps {
    return {
        linked: true,
        connected: true,
        email: 'ada@example.test',
        has_password: true,
        connect_url: 'https://app.example.test/auth/microsoft/redirect?intent=connect',
        disconnect_url: 'https://app.example.test/user/microsoft',
        notice: null,
        labels: {
            section_title: 'Title copy',
            section_description: 'Description copy',
            connected_as: 'Connected as ada@example.test',
            not_connected: 'Not-connected copy',
            disconnected_status: 'Disconnected-status copy',
            connect: 'Connect copy',
            disconnect: 'Disconnect copy',
            disconnect_title: 'Dialog title copy',
            disconnect_body: 'Dialog body copy',
            disconnect_body_passwordless: 'Passwordless copy',
            cancel: 'Cancel copy',
        },
        ...overrides,
    };
}

function setAccount(value: MicrosoftAccountProps | undefined) {
    pageProps.microsoft = {
        enabled: true,
        login_url: 'https://app.example.test/auth/microsoft/redirect',
        labels: { sign_in: 'x', sign_in_hint: 'y' },
        ...(value ? { account: value } : {}),
    };
}

function mountForm() {
    return mount(MicrosoftConnectionForm, {
        global: { stubs: { DialogModal: DialogModalStub } },
    });
}

describe('MicrosoftConnectionForm', () => {
    beforeEach(() => {
        delete pageProps.microsoft;
        navigateTo.mockReset();
        routerDelete.mockReset();
    });

    it('renders nothing when the prop is absent, disabled or has no account', () => {
        expect(mountForm().find('[data-testid="microsoft-connection"]').exists()).toBe(false);

        pageProps.microsoft = { enabled: false };
        expect(mountForm().find('[data-testid="microsoft-connection"]').exists()).toBe(false);

        setAccount(undefined);
        expect(mountForm().find('[data-testid="microsoft-connection"]').exists()).toBe(false);
    });

    it('shows Not connected and a Connect button for an unlinked user', async () => {
        setAccount(account({ linked: false, connected: false, email: null }));

        const wrapper = mountForm();

        expect(wrapper.get('[data-testid="microsoft-status"]').text()).toBe('Not-connected copy');
        expect(wrapper.text()).toContain('Title copy');
        expect(wrapper.text()).toContain('Description copy');
        expect(wrapper.find('[data-testid="microsoft-disconnect"]').exists()).toBe(false);

        await wrapper.get('[data-testid="microsoft-connect"]').trigger('click');

        expect(navigateTo).toHaveBeenCalledTimes(1);
        expect(navigateTo).toHaveBeenCalledWith(
            'https://app.example.test/auth/microsoft/redirect?intent=connect'
        );
        expect(routerDelete).not.toHaveBeenCalled();
    });

    it('shows the disconnected status and Connect (no Disconnect) when linked but disconnected', () => {
        setAccount(account({ linked: true, connected: false }));

        const wrapper = mountForm();

        expect(wrapper.get('[data-testid="microsoft-status"]').text()).toBe(
            'Disconnected-status copy'
        );
        expect(wrapper.find('[data-testid="microsoft-connect"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="microsoft-disconnect"]').exists()).toBe(false);
    });

    it('shows Connected as and a Disconnect button when connected', () => {
        setAccount(account());

        const wrapper = mountForm();

        expect(wrapper.get('[data-testid="microsoft-status"]').text()).toBe(
            'Connected as ada@example.test'
        );
        expect(wrapper.find('[data-testid="microsoft-connect"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="microsoft-disconnect"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="dialog"]').exists()).toBe(false);
    });

    it('opens the dialog on Disconnect without sending a request, then deletes on confirm', async () => {
        setAccount(account());

        const wrapper = mountForm();
        await wrapper.get('[data-testid="microsoft-disconnect"]').trigger('click');

        const dialog = wrapper.get('[data-testid="dialog"]');
        expect(dialog.text()).toContain('Dialog title copy');
        expect(dialog.text()).toContain('Dialog body copy');
        expect(dialog.find('[data-testid="microsoft-passwordless-warning"]').exists()).toBe(false);
        expect(routerDelete).not.toHaveBeenCalled();

        await wrapper.get('[data-testid="microsoft-confirm-disconnect"]').trigger('click');

        expect(routerDelete).toHaveBeenCalledTimes(1);
        const [url, options] = routerDelete.mock.calls[0] as [
            string,
            { preserveScroll: boolean; onFinish: () => void },
        ];
        expect(url).toBe('https://app.example.test/user/microsoft');
        expect(options.preserveScroll).toBe(true);

        options.onFinish();
        await wrapper.vm.$nextTick();
        expect(wrapper.find('[data-testid="dialog"]').exists()).toBe(false);
    });

    it('closes the dialog on Cancel without calling the server', async () => {
        setAccount(account());

        const wrapper = mountForm();
        await wrapper.get('[data-testid="microsoft-disconnect"]').trigger('click');
        await wrapper.get('[data-testid="microsoft-cancel"]').trigger('click');

        expect(wrapper.find('[data-testid="dialog"]').exists()).toBe(false);
        expect(routerDelete).not.toHaveBeenCalled();
    });

    it('adds the passwordless warning to the dialog when the user has no password', async () => {
        setAccount(account({ has_password: false }));

        const wrapper = mountForm();
        await wrapper.get('[data-testid="microsoft-disconnect"]').trigger('click');

        expect(wrapper.get('[data-testid="microsoft-passwordless-warning"]').text()).toBe(
            'Passwordless copy'
        );
    });

    it('renders the notice when present', () => {
        setAccount(account({ notice: 'Notice copy' }));

        const wrapper = mountForm();

        expect(wrapper.get('[data-testid="microsoft-notice"]').text()).toBe('Notice copy');
    });

    it('does not send a second delete while one is in flight', async () => {
        setAccount(account());

        const wrapper = mountForm();
        await wrapper.get('[data-testid="microsoft-disconnect"]').trigger('click');
        await wrapper.get('[data-testid="microsoft-confirm-disconnect"]').trigger('click');
        await wrapper.get('[data-testid="microsoft-confirm-disconnect"]').trigger('click');

        expect(routerDelete).toHaveBeenCalledTimes(1);
    });
});
