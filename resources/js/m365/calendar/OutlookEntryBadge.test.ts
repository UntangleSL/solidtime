import { afterEach, describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import OutlookEntryBadge from './OutlookEntryBadge.vue';
import { OUTLOOK_MEETINGS_KEY, type OutlookMeetingsContext } from './useOutlookMeetings';
import type { OutlookCalendarLabels } from '@/m365/types';

const LABEL = 'Created from an Outlook meeting';

function fakeContext(linkedTimeEntryIds: string[]) {
    return {
        labels: ref({ from_meeting: LABEL } as OutlookCalendarLabels),
        linkedTimeEntryIds: ref(linkedTimeEntryIds),
    } as unknown as OutlookMeetingsContext;
}

let wrapper: VueWrapper | null = null;

function mountBadge(timeEntryId: string, context: OutlookMeetingsContext | null) {
    wrapper = mount(OutlookEntryBadge, {
        props: { timeEntryId },
        global: { provide: context ? { [OUTLOOK_MEETINGS_KEY as symbol]: context } : {} },
    });
    return wrapper;
}

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
});

describe('OutlookEntryBadge', () => {
    it('marks an entry created from a meeting with a 12px icon, tooltip and sr-only text', () => {
        const badge = mountBadge('e1', fakeContext(['e1']));

        const marker = badge.find('[data-testid="outlook-entry-badge"]');
        expect(marker.exists()).toBe(true);
        expect(marker.attributes('title')).toBe(LABEL);

        const icon = marker.find('svg');
        expect(icon.exists()).toBe(true);
        expect(icon.classes()).toEqual(expect.arrayContaining(['w-3', 'h-3', 'shrink-0']));
        expect(icon.attributes('aria-hidden')).toBe('true');
        // Inherits the entry text colour: no colour utility of its own
        expect(icon.classes().some((c) => c.startsWith('text-'))).toBe(false);

        const srOnly = marker.find('.sr-only');
        expect(srOnly.exists()).toBe(true);
        expect(srOnly.text()).toBe(LABEL);
    });

    it('renders nothing for an entry that did not come from a meeting', () => {
        const badge = mountBadge('e2', fakeContext(['e1']));

        expect(badge.find('[data-testid="outlook-entry-badge"]').exists()).toBe(false);
        expect(badge.find('svg').exists()).toBe(false);
    });

    it('follows the linked ids as they change', async () => {
        const context = fakeContext([]);
        const badge = mountBadge('e1', context);
        expect(badge.find('[data-testid="outlook-entry-badge"]').exists()).toBe(false);

        (context.linkedTimeEntryIds as unknown as { value: string[] }).value = ['e1'];
        await badge.vm.$nextTick();
        expect(badge.find('[data-testid="outlook-entry-badge"]').exists()).toBe(true);

        (context.linkedTimeEntryIds as unknown as { value: string[] }).value = [];
        await badge.vm.$nextTick();
        expect(badge.find('[data-testid="outlook-entry-badge"]').exists()).toBe(false);
    });

    it('renders nothing without a provided context', () => {
        const badge = mountBadge('e1', null);

        expect(badge.find('[data-testid="outlook-entry-badge"]').exists()).toBe(false);
        expect(badge.html()).not.toContain('svg');
    });
});
