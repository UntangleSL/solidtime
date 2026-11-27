import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import axios from 'axios';
import ProjectSummaryCard from './ProjectSummaryCard.vue';

const { pageProps } = vi.hoisted(() => ({
    pageProps: {} as Record<string, unknown>,
}));

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => ({ props: pageProps }),
}));

vi.mock('@/utils/useUser', () => ({ getCurrentOrganizationId: () => 'org-1' }));

vi.mock('@/utils/useOrganizationQuery', () => ({
    useOrganizationQuery: () => ({
        organization: computed(() => ({ number_format: 'comma-point' })),
    }),
}));

vi.mock('axios', () => ({
    default: { get: vi.fn() },
}));

const axiosGet = vi.mocked(axios.get);

const SUMMARY_URL =
    'https://app.example.test/profitability/organizations/org-1/projects/p-1/summary';

const labels = {
    common: {
        load_error: 'Couldn’t load profitability figures.',
        try_again: 'Try again',
    },
    kpi: { hours_sold: 'Hours sold', consumed: 'Consumed' },
    summary: {
        title: 'Contract',
        empty_title: 'No contract terms yet',
        empty_body_editor: 'Set the hours and amount sold to follow this project’s budget.',
        empty_body_pm: 'The account manager sets the hours sold.',
    },
};

function withSummaryUrl() {
    pageProps.profitability = {
        enabled: true,
        url: 'https://app.example.test/profitability',
        views: ['projects'],
        labels,
        organization_url: 'https://app.example.test/profitability/organizations/org-1',
        project: { summary_url: SUMMARY_URL },
    };
}

function summary(overrides: Record<string, unknown> = {}) {
    return {
        data: {
            data: {
                project_id: 'p-1',
                can_edit_terms: true,
                can_edit_plan: true,
                contract: {
                    service: 'SEO retainer',
                    schedule: 'monthly',
                    starts_on: '2026-10-01',
                    ends_on: null,
                    archived: false,
                },
                period: {
                    id: 'period-1',
                    starts_on: '2026-11-01',
                    ends_on: '2026-11-30',
                    state: 'current',
                    budget_seconds: 4464000,
                    consumed_seconds: 45000,
                    months: [],
                },
                ...overrides,
            },
        },
    };
}

let wrapper: VueWrapper | null = null;

function mountCard() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = mount(ProjectSummaryCard, {
        props: { projectId: 'p-1' },
        attachTo: document.body,
        global: { plugins: [[VueQueryPlugin, { queryClient }]] },
    });
    return wrapper;
}

async function settle() {
    for (let i = 0; i < 3; i++) {
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

describe('ProjectSummaryCard', () => {
    beforeEach(() => {
        for (const key of Object.keys(pageProps)) delete pageProps[key];
        axiosGet.mockReset();
    });

    afterEach(() => {
        wrapper?.unmount();
        wrapper = null;
        document.body.innerHTML = '';
    });

    it('renders nothing and sends no request without a summary URL', async () => {
        pageProps.profitability = { enabled: false };
        mountCard();
        await settle();
        expect(query('profitability-summary-card')).toBeNull();
        expect(wrapper?.html()).not.toContain('Contract');

        wrapper?.unmount();
        pageProps.profitability = { enabled: true, url: 'x', views: ['projects'], labels: {} };
        mountCard();
        await settle();
        expect(query('profitability-summary-card')).toBeNull();

        wrapper?.unmount();
        delete pageProps.profitability;
        mountCard();
        await settle();
        expect(query('profitability-summary-card')).toBeNull();
        expect(axiosGet).toHaveBeenCalledTimes(0);
    });

    it('renders nothing when the summary endpoint answers 404', async () => {
        withSummaryUrl();
        axiosGet.mockRejectedValue(
            Object.assign(new Error('Not Found'), { response: { status: 404 } })
        );
        mountCard();
        await vi.waitFor(() => expect(query('profitability-summary-card')).toBeNull());
        // 404 is an answer, never retried
        expect(axiosGet).toHaveBeenCalledTimes(1);
    });

    it('reserves 160px with a spinner while the summary loads', async () => {
        withSummaryUrl();
        axiosGet.mockReturnValue(new Promise(() => {}));
        mountCard();
        await settle();
        const loading = query('profitability-summary-loading');
        expect(loading).not.toBeNull();
        expect(loading?.className).toContain('min-h-[160px]');
        expect(loading?.querySelector('svg.animate-spin')).not.toBeNull();
        expect(axiosGet).toHaveBeenCalledWith(SUMMARY_URL, { params: undefined });
    });

    it('shows hours sold and consumed of the current period', async () => {
        withSummaryUrl();
        axiosGet.mockResolvedValue(summary());
        mountCard();
        await vi.waitFor(() => expect(query('profitability-summary-sold')).not.toBeNull());

        const card = query('profitability-summary-card')!;
        expect(card.className).toContain('pt-6');
        expect(card.textContent).toContain('Contract');
        expect(card.textContent).toContain('Hours sold');
        expect(card.textContent).toContain('Consumed');
        expect(text('profitability-summary-sold')).toBe('1,240 h');
        expect(text('profitability-summary-consumed')).toBe('12.5 h');
        expect(query('profitability-summary-sold')?.className).toContain('tabular-nums');
        expect(card.querySelector('svg.lucide-briefcase')).not.toBeNull();
    });

    it('shows the editor empty state when terms can be edited', async () => {
        withSummaryUrl();
        axiosGet.mockResolvedValue(summary({ contract: null, period: null }));
        mountCard();
        await vi.waitFor(() => expect(query('profitability-summary-empty')).not.toBeNull());
        expect(text('profitability-summary-empty')).toContain('No contract terms yet');
        expect(text('profitability-summary-empty')).toContain(labels.summary.empty_body_editor);
        expect(text('profitability-summary-empty')).not.toContain(labels.summary.empty_body_pm);
    });

    it('shows the project manager empty state otherwise', async () => {
        withSummaryUrl();
        axiosGet.mockResolvedValue(
            summary({ contract: null, period: null, can_edit_terms: false })
        );
        mountCard();
        await vi.waitFor(() => expect(query('profitability-summary-empty')).not.toBeNull());
        expect(text('profitability-summary-empty')).toContain(labels.summary.empty_body_pm);
        expect(text('profitability-summary-empty')).not.toContain(labels.summary.empty_body_editor);
    });

    it('shows the load error with Try again, which refetches', async () => {
        withSummaryUrl();
        axiosGet.mockRejectedValue(
            Object.assign(new Error('Server Error'), { response: { status: 500 } })
        );
        mountCard();
        await vi.waitFor(() => expect(query('profitability-summary-error')).not.toBeNull(), {
            timeout: 3000,
        });
        expect(text('profitability-summary-error')).toContain(labels.common.load_error);
        const calls = axiosGet.mock.calls.length;

        axiosGet.mockResolvedValue(summary());
        query('profitability-summary-error')!.querySelector('button')!.click();
        await vi.waitFor(() => expect(query('profitability-summary-sold')).not.toBeNull());
        expect(axiosGet.mock.calls.length).toBe(calls + 1);
    });

    it('shows the load error for a malformed payload', async () => {
        withSummaryUrl();
        axiosGet.mockResolvedValue({ data: { data: { nope: true } } });
        mountCard();
        await vi.waitFor(() => expect(query('profitability-summary-error')).not.toBeNull(), {
            timeout: 3000,
        });
    });
});
