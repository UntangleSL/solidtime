import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import MicrosoftSignInButton from './MicrosoftSignInButton.vue';

const { pageProps, navigateTo } = vi.hoisted(() => ({
    pageProps: {} as Record<string, unknown>,
    navigateTo: vi.fn(),
}));

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => ({ props: pageProps }),
}));

vi.mock('@/m365/navigation', () => ({ navigateTo }));

function stubTimeZone(timeZone: string | undefined) {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
        () => ({ resolvedOptions: () => ({ timeZone }) }) as unknown as Intl.DateTimeFormat
    );
}

function enable(labels = { sign_in: 'Sign in with X', sign_in_hint: 'Use your X account' }) {
    pageProps.microsoft = {
        enabled: true,
        login_url: 'https://app.example.test/auth/microsoft/redirect',
        labels,
    };
}

describe('MicrosoftSignInButton', () => {
    beforeEach(() => {
        delete pageProps.microsoft;
        navigateTo.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders nothing when the microsoft prop is absent', () => {
        const wrapper = mount(MicrosoftSignInButton);

        expect(wrapper.find('[data-testid="microsoft-sign-in"]').exists()).toBe(false);
        expect(wrapper.text()).toBe('');
    });

    it('renders nothing when the integration is disabled', () => {
        pageProps.microsoft = { enabled: false };

        const wrapper = mount(MicrosoftSignInButton);

        expect(wrapper.find('[data-testid="microsoft-sign-in"]').exists()).toBe(false);
    });

    it('renders a button with the server-provided label and hint', () => {
        enable({ sign_in: 'Custom sign-in copy', sign_in_hint: 'Custom hint copy' });

        const wrapper = mount(MicrosoftSignInButton);
        const button = wrapper.get('[data-testid="microsoft-sign-in"]');

        expect(button.element.tagName).toBe('BUTTON');
        expect(button.attributes('type')).toBe('button');
        expect(button.text()).toContain('Custom sign-in copy');
        expect(wrapper.text()).toContain('Custom hint copy');
        expect(button.text()).not.toContain('Custom hint copy');
    });

    it('navigates once to login_url with the encoded browser time zone', async () => {
        enable();
        stubTimeZone('Europe/Berlin');

        const wrapper = mount(MicrosoftSignInButton);
        await wrapper.get('[data-testid="microsoft-sign-in"]').trigger('click');

        expect(navigateTo).toHaveBeenCalledTimes(1);
        const url = String(navigateTo.mock.calls[0]?.[0]);
        expect(url.startsWith('https://app.example.test/auth/microsoft/redirect')).toBe(true);
        expect(url).toContain('timezone=Europe%2FBerlin');
    });

    it('navigates to exactly login_url when the browser reports no time zone', async () => {
        enable();
        stubTimeZone(undefined);

        const wrapper = mount(MicrosoftSignInButton);
        await wrapper.get('[data-testid="microsoft-sign-in"]').trigger('click');

        expect(navigateTo).toHaveBeenCalledTimes(1);
        expect(navigateTo).toHaveBeenCalledWith('https://app.example.test/auth/microsoft/redirect');
    });

    it('hides the logo from assistive technology', () => {
        enable();

        const wrapper = mount(MicrosoftSignInButton);
        const svg = wrapper.get('[data-testid="microsoft-sign-in"] svg');

        expect(svg.attributes('aria-hidden')).toBe('true');
    });
});
