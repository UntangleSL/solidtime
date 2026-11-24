import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from '@/packages/ui/src/context-menu';
import OutlookEntryMenuItems from './OutlookEntryMenuItems.vue';
import { OUTLOOK_MEETINGS_KEY, type OutlookMeetingsContext } from './useOutlookMeetings';
import type { OutlookCalendarLabels, OutlookOutOfSyncItem } from '@/m365/types';

const labels = {
    osync_review: 'Review Outlook change',
} as OutlookCalendarLabels;

function flag(timeEntryId = 'te-1'): OutlookOutOfSyncItem {
    return {
        time_entry_id: timeEntryId,
        kind: 'cancelled',
        meeting_start: '2026-11-24T10:00:00Z',
        meeting_end: '2026-11-24T11:00:00Z',
        new_start: null,
        new_end: null,
        all_day: false,
        entry_start: '2026-11-24T10:00:00Z',
        entry_end: '2026-11-24T11:00:00Z',
        description: '',
    };
}

function fakeContext(flags: OutlookOutOfSyncItem[], options: { canAct?: boolean } = {}) {
    // Records whether the menu was still in the DOM when the popover was requested.
    const menuAtOpen: boolean[] = [];
    const openFlagPanel = vi.fn(() => {
        menuAtOpen.push(menuRoot() !== null);
    });
    const context = {
        labels: ref(labels),
        canAct: ref(options.canAct ?? true),
        flagOf: (id: string) => flags.find((item) => item.time_entry_id === id) ?? null,
        openFlagPanel,
    } as unknown as OutlookMeetingsContext;
    return { context, openFlagPanel, menuAtOpen };
}

// The core entry menu: the fork items first, then the core items (here one stand-in "Edit").
const Harness = defineComponent({
    props: {
        timeEntryId: { type: String, required: true },
    },
    setup(props) {
        return () =>
            h(ContextMenu, null, {
                default: () => [
                    h(
                        ContextMenuTrigger,
                        { as: 'div', 'data-testid': 'harness-trigger' },
                        { default: () => 'entry' }
                    ),
                    h(ContextMenuContent, null, {
                        default: () => [
                            h(OutlookEntryMenuItems, { timeEntryId: props.timeEntryId }),
                            h(
                                ContextMenuItem,
                                { 'data-testid': 'core-edit' },
                                { default: () => 'Edit' }
                            ),
                        ],
                    }),
                ],
            });
    },
});

let wrapper: VueWrapper | null = null;

async function openMenu(timeEntryId: string, context: OutlookMeetingsContext | null) {
    wrapper = mount(Harness, {
        attachTo: document.body,
        props: { timeEntryId },
        global: {
            provide: context ? { [OUTLOOK_MEETINGS_KEY as symbol]: context } : {},
        },
    });
    const trigger = document.body.querySelector<HTMLElement>('[data-testid="harness-trigger"]');
    trigger?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })
    );
    await nextTick();
    await nextTick();
    return wrapper;
}

function menuRoot(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>('[role="menu"]');
}

function item(testId: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

// Test ids of the menu entries in DOM order, separators as 'separator'.
function itemOrder(): string[] {
    const root = menuRoot();
    if (!root) return [];
    return Array.from(
        root.querySelectorAll<HTMLElement>('[role="menuitem"], [role="separator"]')
    ).map((el) => (el.getAttribute('role') === 'separator' ? 'separator' : el.dataset.testid!));
}

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
});

describe('OutlookEntryMenuItems', () => {
    it('starts the menu of a flagged entry with "Review Outlook change" and a separator', async () => {
        const { context } = fakeContext([flag()]);
        await openMenu('te-1', context);

        expect(menuRoot()).not.toBeNull();
        expect(item('outlook-entry-menu')).not.toBeNull();
        expect(itemOrder()).toEqual(['outlook-entry-menu-review', 'separator', 'core-edit']);

        const review = item('outlook-entry-menu-review');
        expect(review?.textContent?.trim()).toBe('Review Outlook change');
        const icon = review?.querySelector('svg');
        const iconClasses = icon?.getAttribute('class') ?? '';
        expect(iconClasses).toContain('lucide-triangle-alert');
        for (const cls of ['w-4', 'h-4', 'text-amber-700', 'dark:text-amber-400']) {
            expect(iconClasses).toContain(cls);
        }
        expect(icon?.getAttribute('aria-hidden')).toBe('true');
    });

    it('asks for the review popover anchored to the entry only after the menu has closed', async () => {
        const { context, openFlagPanel, menuAtOpen } = fakeContext([flag()]);
        await openMenu('te-1', context);

        item('outlook-entry-menu-review')?.click();

        await vi.waitFor(() => expect(openFlagPanel).toHaveBeenCalledTimes(1));
        expect(openFlagPanel).toHaveBeenCalledWith('te-1', { anchor: 'entry', origin: 'entry' });
        expect(menuAtOpen).toEqual([false]);
        expect(menuRoot()).toBeNull();
    });

    it('renders nothing for an unflagged entry (the core menu stays as it is)', async () => {
        const { context } = fakeContext([flag('te-9')]);
        await openMenu('te-1', context);

        expect(menuRoot()).not.toBeNull();
        expect(item('outlook-entry-menu')).toBeNull();
        expect(itemOrder()).toEqual(['core-edit']);
    });

    it('renders nothing while the context cannot act', async () => {
        const { context } = fakeContext([flag()], { canAct: false });
        await openMenu('te-1', context);

        expect(item('outlook-entry-menu')).toBeNull();
        expect(itemOrder()).toEqual(['core-edit']);
    });

    it('renders nothing without the Outlook context', async () => {
        await openMenu('te-1', null);

        expect(menuRoot()).not.toBeNull();
        expect(item('outlook-entry-menu')).toBeNull();
        expect(itemOrder()).toEqual(['core-edit']);
    });
});
