import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { TabBar } from '@/packages/ui/src';
import ProfitabilityPage from './ProfitabilityPage.vue';
import {
    discoverViews,
    initialRange,
    readQueryParam,
    replaceQueryParam,
    resolveActiveView,
    viewKeyFromPath,
    visibleViews,
} from './labels';

const { pageProps } = vi.hoisted(() => ({
    pageProps: {} as Record<string, unknown>,
}));

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => ({ props: pageProps }),
}));

// Render-function stubs (plain objects): the layout keeps its title and slot, nothing else.
vi.mock('@/Layouts/AppLayout.vue', async () => {
    const { h } = await import('vue');
    return {
        default: {
            props: { title: { type: String, default: '' } },
            setup(props: { title: string }, { slots }: { slots: { default?: () => unknown } }) {
                return () =>
                    h(
                        'div',
                        { 'data-testid': 'layout', title: props.title },
                        slots.default?.() as never
                    );
            },
        },
    };
});

// The real view fetches data; the page only needs to know a component exists for `projects`.
vi.mock('./ProjectsView.vue', async () => {
    const { h } = await import('vue');
    return {
        default: {
            setup() {
                return () => h('div', { 'data-testid': 'stub-projects-view' });
            },
        },
    };
});

const labels = {
    page: { title: 'Profitability' },
    tabs: { projects: 'Projects', clients: 'Clients', people: 'People', settings: 'Settings' },
};

function share(views: string[]) {
    pageProps.profitability = {
        enabled: true,
        url: 'https://app.example.test/profitability',
        views,
        labels,
        organization_url: 'https://app.example.test/profitability/organizations/org-1',
    };
}

describe('view discovery', () => {
    it('maps <Name>View.vue to the lower-cased name', () => {
        expect(viewKeyFromPath('./ProjectsView.vue')).toBe('projects');
        expect(viewKeyFromPath('./SettingsView.vue')).toBe('settings');
        expect(viewKeyFromPath('./PeopleView.vue')).toBe('people');
        expect(viewKeyFromPath('./BudgetMeter.vue')).toBeNull();
        expect(viewKeyFromPath('./View.vue')).toBeNull();
    });

    it('builds the component map from glob modules', () => {
        const projects = { name: 'P' };
        const clients = { name: 'C' };
        const views = discoverViews({
            './ProjectsView.vue': { default: projects },
            './ClientsView.vue': { default: clients },
        });
        expect(Object.keys(views).sort()).toEqual(['clients', 'projects']);
        expect(views.projects).toBe(projects);
    });

    it('lists only the views the server allows and a component exists for, in page order', () => {
        expect(visibleViews(['settings', 'projects', 'clients'], ['projects', 'settings'])).toEqual(
            ['projects', 'settings']
        );
        // A component alone never adds a tab (T-08-62)
        expect(visibleViews(['projects'], ['projects', 'clients', 'people'])).toEqual(['projects']);
        expect(visibleViews(undefined, ['projects'])).toEqual([]);
    });

    it('falls back to the first view for an unknown or forbidden value', () => {
        expect(resolveActiveView('clients', ['projects', 'clients'])).toBe('clients');
        expect(resolveActiveView('settings', ['projects', 'clients'])).toBe('projects');
        expect(resolveActiveView('nonsense', ['projects'])).toBe('projects');
        expect(resolveActiveView(null, ['projects'])).toBe('projects');
        expect(resolveActiveView('projects', [])).toBeNull();
    });
});

describe('ProfitabilityPage', () => {
    beforeEach(() => {
        window.history.replaceState(null, '', '/profitability');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete pageProps.profitability;
    });

    it('renders the header and one tab per allowed view with a component', () => {
        share(['projects', 'unknown']);
        const wrapper = mount(ProfitabilityPage);

        expect(wrapper.find('[data-testid="profitability-page"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="layout"]').attributes('title')).toBe('Profitability');
        expect(wrapper.find('[data-testid="profitability-tab-projects"]').text()).toBe('Projects');
        expect(wrapper.find('[data-testid="profitability-tab-unknown"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="stub-projects-view"]').exists()).toBe(true);
    });

    it('renders no tab and no view the server does not list', () => {
        share([]);
        const wrapper = mount(ProfitabilityPage);

        expect(wrapper.find('[data-testid="profitability-tab-projects"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="stub-projects-view"]').exists()).toBe(false);
    });

    it('falls back silently to the first view for a forbidden ?view=', () => {
        window.history.replaceState(null, '', '/profitability?view=settings');
        share(['projects']);
        const wrapper = mount(ProfitabilityPage);

        expect(wrapper.find('[data-testid="stub-projects-view"]').exists()).toBe(true);
    });

    it('writes ?view= with history.replaceState when a tab is selected', async () => {
        share(['projects']);
        const replaceState = vi.spyOn(window.history, 'replaceState');
        const wrapper = mount(ProfitabilityPage);

        wrapper.findComponent(TabBar).vm.$emit('update:modelValue', 'projects');
        await nextTick();

        expect(replaceState).toHaveBeenCalledTimes(1);
        expect(String(replaceState.mock.calls[0]?.[2])).toContain('view=projects');
    });

    it('ignores a tab value that is not an allowed view', async () => {
        share(['projects']);
        const replaceState = vi.spyOn(window.history, 'replaceState');
        const wrapper = mount(ProfitabilityPage);

        wrapper.findComponent(TabBar).vm.$emit('update:modelValue', 'settings');
        await nextTick();

        expect(replaceState).not.toHaveBeenCalled();
    });
});

describe('URL state helpers', () => {
    afterEach(() => {
        window.history.replaceState(null, '', '/profitability');
    });

    it('starts the range from a known ?range= and falls back to this month', () => {
        window.history.replaceState(null, '', '/profitability?view=clients&range=last_quarter');
        expect(initialRange()).toBe('last_quarter');
        window.history.replaceState(null, '', '/profitability?range=forever');
        expect(initialRange()).toBe('this_month');
    });

    it('rewrites one query parameter and keeps the others', () => {
        window.history.replaceState(null, '', '/profitability?view=projects');
        replaceQueryParam('contract', 'ended');
        expect(readQueryParam('view')).toBe('projects');
        expect(readQueryParam('contract')).toBe('ended');
        replaceQueryParam('contract', null);
        expect(readQueryParam('contract')).toBeNull();
    });
});
