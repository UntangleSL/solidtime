import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import OrganizationSwitcher from '@/Components/OrganizationSwitcher.vue';
import OrganizationIcon from './OrganizationIcon.vue';
import { firstGrapheme, organizationIconPath, useOrganizationIcons } from './organizationIcons';

const { pageProps } = vi.hoisted(() => ({
    pageProps: {} as Record<string, unknown>,
}));

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => ({ props: pageProps }),
    Link: { name: 'Link', render: () => null },
}));

// The switcher's menu helpers reach for billing, permissions and the API client; none of them is
// under test here (the menu content stays closed).
vi.mock('@/utils/billing', () => ({ isBillingActivated: () => false }));
vi.mock('@/utils/permissions', () => ({ canManageBilling: () => false }));
vi.mock('@/utils/useOrganization', () => ({ switchOrganization: vi.fn() }));

function setPage(orgIcons?: Record<string, string>): void {
    for (const key of Object.keys(pageProps)) delete pageProps[key];
    const current = { id: 'org-1', name: 'Acme' };
    pageProps.auth = {
        user: {
            current_team: current,
            current_team_id: current.id,
            all_teams: [current, { id: 'org-2', name: 'Zeta' }],
        },
    };
    pageProps.appearance = orgIcons ? { org_icons: orgIcons } : {};
}

beforeEach(() => {
    setPage();
});

describe('organizationIcons helpers', () => {
    it('firstGrapheme trims, uppercases and keeps surrogate pairs whole', () => {
        expect(firstGrapheme('Acme')).toBe('A');
        expect(firstGrapheme('  zeta ')).toBe('Z');
        expect(firstGrapheme('🚀 Rocket')).toBe('🚀');
        expect(firstGrapheme('   ')).toBe('');
    });

    it('organizationIconPath builds the fork route path', () => {
        expect(organizationIconPath('uuid')).toBe('/organizations/uuid/icon');
    });

    it('useOrganizationIcons reads appearance.org_icons and treats a missing map as empty', () => {
        setPage({ 'org-1': 'https://cdn.test/a.png' });
        const { iconFor } = useOrganizationIcons();
        expect(iconFor('org-1')).toBe('https://cdn.test/a.png');
        expect(iconFor('org-2')).toBeNull();

        setPage();
        expect(useOrganizationIcons().iconFor('org-1')).toBeNull();
    });
});

describe('OrganizationIcon', () => {
    it('renders the image with the URL, the alt and the size classes', () => {
        const wrapper = mount(OrganizationIcon, {
            props: {
                name: 'Acme',
                iconUrl: 'https://cdn.test/a.png',
                size: 'lg',
                alt: 'Acme icon',
            },
        });
        const img = wrapper.get('img');
        expect(img.attributes('src')).toBe('https://cdn.test/a.png');
        expect(img.attributes('alt')).toBe('Acme icon');
        expect(img.classes()).toEqual(
            expect.arrayContaining(['h-20', 'w-20', 'object-cover', 'bg-[#F9FCFD]'])
        );
    });

    it('defaults the alt to empty and uses the small size', () => {
        const wrapper = mount(OrganizationIcon, {
            props: { name: 'Acme', iconUrl: 'https://cdn.test/a.png', size: 'sm' },
        });
        const img = wrapper.get('img');
        expect(img.attributes('alt')).toBe('');
        expect(img.classes()).toEqual(expect.arrayContaining(['h-5', 'w-5', 'object-cover']));
    });

    it.each([
        [null, 'Acme', 'A'],
        ['', '  zeta ', 'Z'],
        [null, '🚀 Rocket', '🚀'],
    ])('renders the letter tile when the URL is %j (%s -> %s)', (iconUrl, name, letter) => {
        const wrapper = mount(OrganizationIcon, { props: { name, iconUrl, size: 'sm' } });
        expect(wrapper.find('img').exists()).toBe(false);
        const tile = wrapper.get('[data-testid="organization_icon_letter"]');
        expect(tile.text()).toBe(letter);
        expect(tile.classes()).toEqual(
            expect.arrayContaining([
                'bg-[color:var(--theme-color-accent-solid)]',
                'text-[color:var(--color-on-accent)]',
                'text-xs',
                'font-semibold',
            ])
        );
    });

    it('uses the 20 px text in the large tile', () => {
        const wrapper = mount(OrganizationIcon, {
            props: { name: 'Acme', iconUrl: null, size: 'lg' },
        });
        expect(wrapper.get('[data-testid="organization_icon_letter"]').classes()).toEqual(
            expect.arrayContaining(['text-xl', 'h-20', 'w-20'])
        );
    });

    it('falls back to the letter on an image error and retries when the URL changes', async () => {
        const wrapper = mount(OrganizationIcon, {
            props: { name: 'Acme', iconUrl: 'https://cdn.test/broken.png', size: 'sm' },
        });
        await wrapper.get('img').trigger('error');
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.get('[data-testid="organization_icon_letter"]').text()).toBe('A');

        await wrapper.setProps({ iconUrl: 'https://cdn.test/new.png' });
        expect(wrapper.get('img').attributes('src')).toBe('https://cdn.test/new.png');
    });
});

describe('OrganizationSwitcher', () => {
    function mountSwitcher() {
        // Wrap so the reka dropdown has a stable root in the test DOM.
        const Host = defineComponent({ render: () => h(OrganizationSwitcher) });
        return mount(Host, { global: { mocks: { route: () => '#' } } });
    }

    it('shows the current organization icon in the trigger when org_icons has it', () => {
        setPage({ 'org-1': 'https://cdn.test/acme.png' });
        const wrapper = mountSwitcher();
        const trigger = wrapper.get('[data-testid="organization_switcher"]');
        const img = trigger.get('img');
        expect(img.attributes('src')).toBe('https://cdn.test/acme.png');
        expect(img.attributes('alt')).toBe('');
        expect(trigger.text()).toContain('Acme');
        expect(trigger.find('.bg-blue-900').exists()).toBe(false);
    });

    it('shows the accent letter tile in the trigger when there is no icon', () => {
        setPage({ 'org-2': 'https://cdn.test/zeta.png' });
        const wrapper = mountSwitcher();
        const trigger = wrapper.get('[data-testid="organization_switcher"]');
        expect(trigger.find('img').exists()).toBe(false);
        const tile = trigger.get('[data-testid="organization_icon_letter"]');
        expect(tile.text()).toBe('A');
        expect(tile.classes()).toContain('bg-[color:var(--theme-color-accent-solid)]');
        expect(trigger.text()).toContain('Acme');
    });
});
