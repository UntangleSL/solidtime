import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, type PropType } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuTrigger,
} from '@/packages/ui/src/context-menu';
import OutlookMeetingContextItems from './OutlookMeetingContextItems.vue';
import { OUTLOOK_MEETINGS_KEY, type OutlookMeetingsContext } from './useOutlookMeetings';
import type { OutlookCalendarLabels, OutlookMeeting } from '@/m365/types';

const labels = {
    no_subject: '(No subject)',
    open_in_outlook: 'Open in Outlook',
    opens_new_tab: '(opens in a new tab)',
    dismiss: 'Dismiss meeting',
    restore: 'Restore meeting',
} as OutlookCalendarLabels;

function meeting(overrides: Partial<OutlookMeeting> = {}): OutlookMeeting {
    return {
        id: 'm-1',
        subject: 'Weekly sync',
        start: '2026-10-27T09:00:00Z',
        end: '2026-10-27T10:00:00Z',
        organizer_name: 'Ada Lovelace',
        is_organizer: false,
        is_online_meeting: false,
        web_link: null,
        dismissed: false,
        ...overrides,
    };
}

interface FakeOptions {
    canAct?: boolean;
    includeDismissed?: boolean;
}

function fakeContext(meetings: OutlookMeeting[], options: FakeOptions = {}) {
    const list = ref<OutlookMeeting[]>(meetings);
    const includeDismissed = ref(options.includeDismissed ?? false);
    // Mirrors the optimistic path of the composable: the block leaves the lane at once, or turns
    // into the dismissed variant while dismissed meetings are shown.
    const dismiss = vi.fn(async (id: string) => {
        if (includeDismissed.value) {
            list.value = list.value.map((m) => (m.id === id ? { ...m, dismissed: true } : m));
        } else {
            list.value = list.value.filter((m) => m.id !== id);
            document.querySelectorAll(`[data-ghost-id="${id}"]`).forEach((el) => el.remove());
        }
    });
    const restore = vi.fn(async (id: string) => {
        list.value = list.value.map((m) => (m.id === id ? { ...m, dismissed: false } : m));
    });
    const context = {
        labels: ref(labels),
        meetings: list,
        canAct: ref(options.canAct ?? true),
        includeDismissed,
        dismiss,
        restore,
    } as unknown as OutlookMeetingsContext;
    return { context, dismiss, restore, list };
}

// A day lane like OutlookGhostLayer renders it: a group with focusable blocks in start order.
function renderLane(ids: string[]): HTMLElement[] {
    const group = document.createElement('div');
    group.setAttribute('role', 'group');
    group.setAttribute('data-testid', 'outlook-lane');
    const blocks = ids.map((id) => {
        const block = document.createElement('div');
        block.setAttribute('data-calendar-overlay', '');
        block.setAttribute('data-ghost-id', id);
        block.setAttribute('tabindex', '0');
        block.setAttribute('role', 'button');
        group.appendChild(block);
        return block;
    });
    document.body.appendChild(group);
    return blocks;
}

const Harness = defineComponent({
    props: {
        element: { type: Object as PropType<HTMLElement>, required: true },
    },
    setup(props) {
        return () =>
            h(ContextMenu, null, {
                default: () => [
                    h(
                        ContextMenuTrigger,
                        { as: 'div', 'data-testid': 'harness-trigger' },
                        { default: () => 'grid' }
                    ),
                    h(ContextMenuContent, null, {
                        default: () => h(OutlookMeetingContextItems, { element: props.element }),
                    }),
                ],
            });
    },
});

let wrapper: VueWrapper | null = null;

// Mounts the harness and opens the menu the way a right-click does.
async function openMenu(element: HTMLElement, context: OutlookMeetingsContext | null) {
    wrapper = mount(Harness, {
        attachTo: document.body,
        props: { element },
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

function unmountMenu(): void {
    wrapper?.unmount();
    wrapper = null;
}

function menu(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>('[data-testid="outlook-meeting-menu"]');
}

function item(testId: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

afterEach(() => {
    vi.restoreAllMocks();
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
});

describe('OutlookMeetingContextItems', () => {
    it('labels the menu with the subject', async () => {
        const [block] = renderLane(['m-1']);
        const { context, list } = fakeContext([meeting()]);
        await openMenu(block!, context);

        expect(menu()).not.toBeNull();
        expect(item('outlook-menu-label')?.textContent?.trim()).toBe('Weekly sync');

        list.value = [meeting({ subject: '   ' })];
        await nextTick();
        expect(item('outlook-menu-label')?.textContent?.trim()).toBe('(No subject)');

        list.value = [meeting({ subject: '<img src=x onerror=alert(1)>' })];
        await nextTick();
        const label = item('outlook-menu-label') as HTMLElement;
        expect(label.textContent?.trim()).toBe('<img src=x onerror=alert(1)>');
        expect(label.querySelector('img')).toBeNull();
    });

    it('offers Open in Outlook only for a safe https link and opens it without an opener', async () => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        const [block] = renderLane(['m-1']);
        const { context, list } = fakeContext([
            meeting({ web_link: 'https://outlook.example.test/a' }),
        ]);
        await openMenu(block!, context);

        const link = item('outlook-menu-open');
        expect(link?.textContent).toContain('Open in Outlook');
        expect(link?.textContent).toContain('(opens in a new tab)');
        link?.click();
        await nextTick();
        expect(open).toHaveBeenCalledWith(
            'https://outlook.example.test/a',
            '_blank',
            'noopener,noreferrer'
        );

        unmountMenu();
        list.value = [meeting({ web_link: null })];
        await openMenu(block!, context);
        expect(menu()).not.toBeNull();
        expect(item('outlook-menu-open')).toBeNull();

        unmountMenu();
        list.value = [meeting({ web_link: 'javascript:alert(1)' })];
        await openMenu(block!, context);
        expect(menu()).not.toBeNull();
        expect(item('outlook-menu-open')).toBeNull();
    });

    it('offers Dismiss or Restore only when the context can act', async () => {
        const [block] = renderLane(['m-1']);
        const regular = fakeContext([meeting()]);
        await openMenu(block!, regular.context);
        expect(item('outlook-menu-dismiss')?.textContent).toContain('Dismiss meeting');
        expect(item('outlook-menu-restore')).toBeNull();
        expect(menu()?.querySelector('[role="separator"]')).not.toBeNull();

        unmountMenu();
        const dismissed = fakeContext([meeting({ dismissed: true })]);
        await openMenu(block!, dismissed.context);
        expect(item('outlook-menu-restore')?.textContent).toContain('Restore meeting');
        expect(item('outlook-menu-dismiss')).toBeNull();

        unmountMenu();
        const readOnly = fakeContext([meeting()], { canAct: false });
        await openMenu(block!, readOnly.context);
        expect(menu()).not.toBeNull();
        expect(item('outlook-menu-dismiss')).toBeNull();
        expect(item('outlook-menu-restore')).toBeNull();
        expect(menu()?.querySelector('[role="separator"]')).toBeNull();
    });

    it('selecting Dismiss calls dismiss(id)', async () => {
        const [block] = renderLane(['m-1']);
        const { context, dismiss, restore } = fakeContext([meeting()]);
        await openMenu(block!, context);

        item('outlook-menu-dismiss')?.click();
        await nextTick();

        expect(dismiss).toHaveBeenCalledWith('m-1');
        expect(restore).not.toHaveBeenCalled();
    });

    it('selecting Restore calls restore(id)', async () => {
        const [block] = renderLane(['m-1']);
        const { context, dismiss, restore } = fakeContext([meeting({ dismissed: true })]);
        await openMenu(block!, context);

        item('outlook-menu-restore')?.click();
        await nextTick();

        expect(restore).toHaveBeenCalledWith('m-1');
        expect(dismiss).not.toHaveBeenCalled();
    });

    it('renders nothing without the Outlook context', async () => {
        const [block] = renderLane(['m-1']);
        await openMenu(block!, null);

        expect(menu()).toBeNull();
    });
});
