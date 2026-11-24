import { afterEach, describe, expect, it } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import OutlookEntryBadge from './OutlookEntryBadge.vue';
import { OUTLOOK_MEETINGS_KEY, type OutlookMeetingsContext } from './useOutlookMeetings';
import type { OutlookAutoAdjusted, OutlookCalendarLabels } from '@/m365/types';

const LABEL = 'Created from an Outlook meeting';

const labels = {
    from_meeting: LABEL,
    auto_adjusted_note: 'Updated from Outlook: :from → :to',
} as OutlookCalendarLabels;

// Tue Nov 24 10:00-11:00 -> Wed Nov 25 12:00-13:00 2026 (same week, UTC in tests).
const ADJUSTED: OutlookAutoAdjusted = {
    time_entry_id: 'e1',
    at: '2026-11-23T08:00:00Z',
    from_start: '2026-11-24T10:00:00Z',
    from_end: '2026-11-24T11:00:00Z',
    to_start: '2026-11-25T12:00:00Z',
    to_end: '2026-11-25T13:00:00Z',
};

function fakeContext(linkedTimeEntryIds: string[], adjusted: OutlookAutoAdjusted[] = []) {
    const adjustedList = ref(adjusted);
    const context = {
        labels: ref(labels),
        linkedTimeEntryIds: ref(linkedTimeEntryIds),
        autoAdjustedOf: (id: string) =>
            adjustedList.value.find((item) => item.time_entry_id === id) ?? null,
    } as unknown as OutlookMeetingsContext;
    return { context, adjustedList };
}

let wrapper: VueWrapper | null = null;

// A core entry block (aria-label hides inner text) with a slot element the badge mounts into.
function renderBlock(): { block: HTMLElement; slot: HTMLElement } {
    const block = document.createElement('div');
    block.setAttribute('data-event-id', 'e1');
    block.setAttribute('role', 'button');
    block.setAttribute('aria-label', 'Weekly sync');
    const slot = document.createElement('div');
    block.appendChild(slot);
    document.body.appendChild(block);
    return { block, slot };
}

function mountBadge(
    timeEntryId: string,
    context: OutlookMeetingsContext | null,
    attachTo?: HTMLElement
) {
    const provide: Record<string | symbol, unknown> = {
        organization: computed(() => ({ time_format: '24-hours' })),
    };
    if (context) provide[OUTLOOK_MEETINGS_KEY as symbol] = context;
    wrapper = mount(OutlookEntryBadge, {
        props: { timeEntryId },
        attachTo,
        global: { provide },
    });
    return wrapper;
}

function describedText(block: HTMLElement): string {
    const ids = (block.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
}

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
});

describe('OutlookEntryBadge', () => {
    it('marks an entry created from a meeting with a 12px icon and a tooltip', () => {
        const badge = mountBadge('e1', fakeContext(['e1']).context);

        const marker = badge.find('[data-testid="outlook-entry-badge"]');
        expect(marker.exists()).toBe(true);
        expect(marker.attributes('title')).toBe(LABEL);
        expect(marker.attributes('data-auto-adjusted')).toBeUndefined();

        const icon = marker.find('svg');
        expect(icon.exists()).toBe(true);
        expect(icon.classes()).toEqual(expect.arrayContaining(['w-3', 'h-3', 'shrink-0']));
        expect(icon.attributes('aria-hidden')).toBe('true');
        // Inherits the entry text colour: no colour utility of its own
        expect(icon.classes().some((c) => c.startsWith('text-'))).toBe(false);

        // The origin text is no longer an sr-only span (the block's aria-label hides it).
        expect(marker.find('.sr-only').exists()).toBe(false);
    });

    it('describes the origin on the block through aria-describedby and removes it on unmount', async () => {
        const { block, slot } = renderBlock();
        mountBadge('e1', fakeContext(['e1']).context, slot);
        await nextTick();

        const ids = (block.getAttribute('aria-describedby') ?? '').split(' ');
        expect(ids).toHaveLength(1);
        const description = document.getElementById(ids[0]!);
        expect(description?.hidden).toBe(true);
        expect(block.contains(description)).toBe(true);
        expect(describedText(block)).toBe('Created from an Outlook meeting.');

        wrapper?.unmount();
        wrapper = null;
        expect(block.hasAttribute('aria-describedby')).toBe(false);
    });

    it('adds the auto-adjust line to the tooltip and the description for 7 days', async () => {
        const { block, slot } = renderBlock();
        const { context, adjustedList } = fakeContext(['e1'], [ADJUSTED]);
        const badge = mountBadge('e1', context, slot);
        await nextTick();

        const marker = badge.find('[data-testid="outlook-entry-badge"]');
        expect(marker.attributes('title')).toBe(
            'Created from an Outlook meeting\nUpdated from Outlook: Tue 10:00 – 11:00 → Wed 12:00 – 13:00'
        );
        expect(marker.attributes('data-auto-adjusted')).toBeDefined();
        expect(describedText(block)).toBe(
            'Created from an Outlook meeting. Updated from Outlook: Tue 10:00 – 11:00 → Wed 12:00 – 13:00.'
        );
        // No other visual change: still the single origin icon.
        expect(marker.findAll('svg')).toHaveLength(1);

        // The read stops serving it after 7 days: back to the single line.
        adjustedList.value = [];
        await nextTick();
        expect(marker.attributes('title')).toBe(LABEL);
        expect(marker.attributes('data-auto-adjusted')).toBeUndefined();
        expect(describedText(block)).toBe('Created from an Outlook meeting.');
    });

    it('ignores the auto-adjust of another entry', () => {
        const { context } = fakeContext(['e1'], [{ ...ADJUSTED, time_entry_id: 'e9' }]);
        const badge = mountBadge('e1', context);

        const marker = badge.find('[data-testid="outlook-entry-badge"]');
        expect(marker.attributes('title')).toBe(LABEL);
        expect(marker.attributes('data-auto-adjusted')).toBeUndefined();
    });

    it('renders nothing for an entry that did not come from a meeting', () => {
        const { block, slot } = renderBlock();
        const badge = mountBadge('e2', fakeContext(['e1']).context, slot);

        expect(badge.find('[data-testid="outlook-entry-badge"]').exists()).toBe(false);
        expect(badge.find('svg').exists()).toBe(false);
        expect(block.hasAttribute('aria-describedby')).toBe(false);
    });

    it('follows the linked ids as they change', async () => {
        const { block, slot } = renderBlock();
        const { context } = fakeContext([]);
        const badge = mountBadge('e1', context, slot);
        expect(badge.find('[data-testid="outlook-entry-badge"]').exists()).toBe(false);

        (context.linkedTimeEntryIds as unknown as { value: string[] }).value = ['e1'];
        await nextTick();
        await nextTick();
        expect(badge.find('[data-testid="outlook-entry-badge"]').exists()).toBe(true);
        expect(block.hasAttribute('aria-describedby')).toBe(true);

        (context.linkedTimeEntryIds as unknown as { value: string[] }).value = [];
        await nextTick();
        await nextTick();
        expect(badge.find('[data-testid="outlook-entry-badge"]').exists()).toBe(false);
        expect(block.hasAttribute('aria-describedby')).toBe(false);
    });

    it('renders nothing without a provided context', () => {
        const badge = mountBadge('e1', null);

        expect(badge.find('[data-testid="outlook-entry-badge"]').exists()).toBe(false);
        expect(badge.html()).not.toContain('svg');
    });
});
