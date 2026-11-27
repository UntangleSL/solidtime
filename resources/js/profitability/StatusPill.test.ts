import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import StatusPill from './StatusPill.vue';

const labels = {
    status: {
        on_track: 'On track',
        at_risk: 'At risk',
        over: 'Over budget',
        not_started: 'Not started',
        closed: 'Closed',
        below_target: 'Below target',
        incomplete: 'Incomplete',
        no_contract: 'No contract',
    },
    status_tooltip: {
        on_track: 'Projected to close within the hours sold.',
        at_risk: 'Projected to close up to 10 % above the hours sold.',
        over: 'Projected to close more than 10 % above the hours sold.',
    },
};

let wrapper: VueWrapper | null = null;

function mountPill(status: string) {
    wrapper = mount(StatusPill, { props: { status, labels }, attachTo: document.body });
    return wrapper;
}

function pill(): HTMLElement {
    const found = document.body.querySelector<HTMLElement>('[data-testid="profitability-status"]');
    expect(found).not.toBeNull();
    return found as HTMLElement;
}

async function settle() {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
}

const CASES = [
    ['on_track', 'On track', 'lucide-circle-check', ['text-green-800', 'dark:text-green-400']],
    ['at_risk', 'At risk', 'lucide-triangle-alert', ['text-amber-800', 'dark:text-amber-400']],
    ['over', 'Over budget', 'lucide-octagon-alert', ['text-red-700', 'dark:text-red-400']],
    ['below_target', 'Below target', 'lucide-octagon-alert', ['text-red-700', 'dark:text-red-400']],
    ['not_started', 'Not started', 'lucide-circle-dashed', ['text-text-secondary']],
    ['closed', 'Closed', 'lucide-lock', ['text-text-secondary']],
    ['incomplete', 'Incomplete', 'lucide-info', ['text-text-secondary']],
] as const;

describe('StatusPill', () => {
    afterEach(() => {
        wrapper?.unmount();
        wrapper = null;
        document.body.innerHTML = '';
    });

    it.each(CASES)('renders %s as icon + label + colour', async (status, text, icon, tones) => {
        mountPill(status);
        await settle();

        const root = pill();
        expect(root.getAttribute('data-status')).toBe(status);
        expect(root.textContent?.trim()).toBe(text);
        for (const tone of tones) expect(root.className).toContain(tone);
        expect(root.className).toContain('inline-flex');
        expect(root.className).toContain('items-center');
        expect(root.className).toContain('gap-1');
        expect(root.className).toContain('text-xs');
        expect(root.className).toContain('font-semibold');
        // colour on text and icon only: no fill, no border
        expect(root.className).not.toMatch(/\bbg-|\bborder\b/);

        const svg = root.querySelector('svg')!;
        expect(svg.getAttribute('class')).toContain(icon);
        expect(svg.getAttribute('class')).toContain('size-3.5');
        expect(svg.getAttribute('aria-hidden')).toBe('true');
    });

    it('never uses a raw hex or a red/amber/green tone for the neutral statuses', async () => {
        mountPill('closed');
        await settle();
        expect(pill().className).not.toMatch(/red|amber|green|#/);
    });

    it.each(['on_track', 'at_risk', 'over'] as const)(
        'explains %s with the status tooltip',
        async (status) => {
            mountPill(status);
            await settle();

            const root = pill();
            root.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
            root.focus();
            await new Promise((resolve) => setTimeout(resolve, 350));
            await settle();

            const tooltip = document.body.querySelector(
                '[data-testid="profitability-status-tooltip"]'
            );
            expect(tooltip?.textContent).toContain(labels.status_tooltip[status]);
        }
    );

    it('has no tooltip for statuses without an explanation', async () => {
        mountPill('closed');
        await settle();
        const root = pill();
        root.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
        root.focus();
        await new Promise((resolve) => setTimeout(resolve, 350));
        await settle();
        expect(document.body.querySelector('[data-testid="profitability-status-tooltip"]')).toBe(
            null
        );
        expect(root.getAttribute('tabindex')).toBeNull();
    });

    it('falls back to the neutral look for an unknown status', async () => {
        mountPill('something_new');
        await settle();
        expect(pill().className).toContain('text-text-secondary');
        expect(pill().querySelector('svg')?.getAttribute('class')).toContain('lucide-info');
    });
});
