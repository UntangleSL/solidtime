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
import { useOutlookSelection } from './useOutlookSelection';
import type { OutlookAssignment, OutlookCalendarLabels, OutlookMeeting } from '@/m365/types';

const labels = {
    no_subject: '(No subject)',
    open_in_outlook: 'Open in Outlook',
    opens_new_tab: '(opens in a new tab)',
    dismiss: 'Dismiss meeting',
    restore: 'Restore meeting',
    create_entry: 'Create time entry',
    select: 'Select meeting',
    deselect: 'Deselect meeting',
    confirm: 'Confirm',
    edit: 'Edit',
    ignore_series: 'Always ignore this series',
    unignore_series: 'Stop ignoring this series',
    forget_series: 'Forget this series',
} as OutlookCalendarLabels;

const assignment: OutlookAssignment = {
    project_id: 'p-1',
    project_name: 'Acme Website',
    project_color: '#ef5350',
    client_name: 'Acme',
    task_id: null,
    task_name: null,
    tags: [],
    billable: true,
    converted_at: '2026-10-20T10:00:00Z',
};

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

// A pre-assigned occurrence of a recurring series (Phase 5).
function preassigned(overrides: Partial<OutlookMeeting> = {}): OutlookMeeting {
    return meeting({ series_key: 'series-1', assignment, suggestions: [], ...overrides });
}

interface FakeOptions {
    canAct?: boolean;
    includeDismissed?: boolean;
    // Ids whose confirm is in flight (isConfirmPending).
    pending?: string[];
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
    // Records whether the menu was still in the DOM when the form was requested (layering rule).
    const menuAtOpenForm: boolean[] = [];
    const openForm = vi.fn((_id: string) => {
        menuAtOpenForm.push(menu() !== null);
    });
    // Records whether the menu was still in the DOM when the confirm was sent (layering rule).
    const menuAtConfirm: boolean[] = [];
    const confirmOne = vi.fn(async (_id: string) => {
        menuAtConfirm.push(menu() !== null);
        return null;
    });
    // Series actions mirror the optimistic composable: ignoring hides every occurrence of the series
    // (or fades them while dismissed meetings are shown), stop ignoring un-fades them, forget drops
    // their pre-assignment.
    const seriesOf = (id: string) => list.value.find((m) => m.id === id)?.series_key ?? null;
    const ignoreSeries = vi.fn(async (id: string) => {
        const key = seriesOf(id);
        if (key === null) return;
        if (includeDismissed.value) {
            list.value = list.value.map((m) =>
                m.series_key === key ? { ...m, series_ignored: true } : m
            );
        } else {
            const gone = list.value.filter((m) => m.series_key === key).map((m) => m.id);
            list.value = list.value.filter((m) => m.series_key !== key);
            gone.forEach((goneId) =>
                document
                    .querySelectorAll(`[data-ghost-id="${goneId}"]`)
                    .forEach((el) => el.remove())
            );
        }
    });
    const unignoreSeries = vi.fn(async (id: string) => {
        const key = seriesOf(id);
        list.value = list.value.map((m) =>
            key !== null && m.series_key === key ? { ...m, series_ignored: false } : m
        );
    });
    const forgetSeries = vi.fn(async (id: string) => {
        const key = seriesOf(id);
        list.value = list.value.map((m) =>
            key !== null && m.series_key === key ? { ...m, assignment: null } : m
        );
    });
    const pending = new Set<string>(options.pending ?? []);
    const isConfirmPending = vi.fn((id: string) => pending.has(id));
    const selection = useOutlookSelection();
    const context = {
        labels: ref(labels),
        meetings: list,
        canAct: ref(options.canAct ?? true),
        includeDismissed,
        dismiss,
        restore,
        openForm,
        confirmOne,
        isConfirmPending,
        ignoreSeries,
        unignoreSeries,
        forgetSeries,
        selection,
    } as unknown as OutlookMeetingsContext;
    return {
        context,
        dismiss,
        restore,
        list,
        openForm,
        menuAtOpenForm,
        confirmOne,
        menuAtConfirm,
        ignoreSeries,
        unignoreSeries,
        forgetSeries,
        selection,
    };
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

function renderSyncButton(): HTMLElement {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'outlook-sync-button');
    document.body.appendChild(button);
    return button;
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

// Test ids of the menu entries in DOM order, separators as 'separator'.
function itemOrder(): string[] {
    const root = menu();
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>('[data-testid], [role="separator"]')).map(
        (el) => (el.getAttribute('role') === 'separator' ? 'separator' : el.dataset.testid!)
    );
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

    it('lists the items in the UI-SPEC order', async () => {
        const [block] = renderLane(['m-1']);
        const { context } = fakeContext([meeting({ web_link: 'https://outlook.example.test/a' })]);
        await openMenu(block!, context);

        expect(itemOrder()).toEqual([
            'outlook-menu-label',
            'outlook-menu-create',
            'outlook-menu-select',
            'outlook-menu-open',
            'separator',
            'outlook-menu-dismiss',
        ]);
        expect(item('outlook-menu-create')?.textContent?.trim()).toBe('Create time entry');
    });

    it('"Create time entry" asks for the form only after the menu has closed', async () => {
        const [block] = renderLane(['m-1']);
        const { context, openForm, menuAtOpenForm, dismiss } = fakeContext([meeting()]);
        await openMenu(block!, context);

        item('outlook-menu-create')?.click();

        await vi.waitFor(() => expect(openForm).toHaveBeenCalledTimes(1));
        expect(openForm).toHaveBeenCalledWith('m-1');
        expect(menuAtOpenForm).toEqual([false]);
        expect(menu()).toBeNull();
        expect(dismiss).not.toHaveBeenCalled();
    });

    it('offers neither "Create time entry" nor "Select meeting" when the context cannot act', async () => {
        const [block] = renderLane(['m-1']);
        const { context, openForm } = fakeContext([meeting()], { canAct: false });
        await openMenu(block!, context);

        expect(menu()).not.toBeNull();
        expect(item('outlook-menu-create')).toBeNull();
        expect(item('outlook-menu-select')).toBeNull();
        expect(openForm).not.toHaveBeenCalled();
    });

    it('"Select meeting" adds the right-clicked meeting to the selection only', async () => {
        const [first] = renderLane(['m-1', 'm-2']);
        const { context, selection } = fakeContext([meeting(), meeting({ id: 'm-2' })]);
        selection.toggle('m-2');
        await openMenu(first!, context);

        const select = item('outlook-menu-select');
        expect(select?.textContent?.trim()).toBe('Select meeting');
        expect(select?.querySelector('svg')?.getAttribute('class')).toContain('list-checks');
        select?.click();
        await nextTick();

        expect(selection.selectedIds.value).toEqual(['m-2', 'm-1']);
    });

    it('"Deselect meeting" (X icon) removes a selected meeting', async () => {
        const [block] = renderLane(['m-1', 'm-2']);
        const { context, selection } = fakeContext([meeting(), meeting({ id: 'm-2' })]);
        selection.toggle('m-1');
        selection.toggle('m-2');
        await openMenu(block!, context);

        const deselect = item('outlook-menu-select');
        expect(deselect?.textContent?.trim()).toBe('Deselect meeting');
        const icon = deselect?.querySelector('svg')?.getAttribute('class') ?? '';
        expect(icon).toContain('lucide-x');
        expect(icon).not.toContain('list-checks');
        deselect?.click();
        await nextTick();

        expect(selection.selectedIds.value).toEqual(['m-2']);
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

    it('renders only the label for a stale element', async () => {
        const [block] = renderLane(['gone']);
        const { context } = fakeContext([
            meeting({ id: 'm-2', web_link: 'https://outlook.example.test/b' }),
        ]);
        await openMenu(block!, context);

        expect(menu()).not.toBeNull();
        expect(item('outlook-menu-label')?.textContent?.trim()).toBe('(No subject)');
        expect(item('outlook-menu-open')).toBeNull();
        expect(item('outlook-menu-dismiss')).toBeNull();
        expect(item('outlook-menu-restore')).toBeNull();
        expect(item('outlook-menu-create')).toBeNull();
        expect(item('outlook-menu-select')).toBeNull();
        expect(menu()?.querySelector('[role="separator"]')).toBeNull();
        expect(itemOrder()).toEqual(['outlook-menu-label']);
    });
});

// Phase 5 (UI-SPEC section 4): a pre-assigned meeting is confirmed or edited from its menu.
describe('OutlookMeetingContextItems pre-assigned meetings', () => {
    it('offers Confirm with the project hint and Edit instead of "Create time entry"', async () => {
        const [block] = renderLane(['m-1']);
        const { context } = fakeContext([
            preassigned({ series_key: null, web_link: 'https://outlook.example.test/a' }),
        ]);
        await openMenu(block!, context);

        expect(itemOrder()).toEqual([
            'outlook-menu-label',
            'outlook-menu-confirm',
            'outlook-project-dot',
            'outlook-menu-project-hint',
            'outlook-menu-edit',
            'outlook-menu-select',
            'outlook-menu-open',
            'separator',
            'outlook-menu-dismiss',
            'outlook-menu-forget-series',
        ]);
        expect(item('outlook-menu-create')).toBeNull();

        const confirm = item('outlook-menu-confirm') as HTMLElement;
        expect(confirm.textContent).toContain('Confirm');
        expect(confirm.querySelector('svg')?.getAttribute('class')).toContain('lucide-check');
        const hint = item('outlook-menu-project-hint') as HTMLElement;
        expect(hint.textContent?.trim()).toBe('Acme Website');
        expect(hint.className).toContain('max-w-32');
        expect(hint.className).toContain('truncate');
        expect(hint.className).toContain('text-text-tertiary');
        expect(hint.parentElement?.className).toContain('ml-auto');
        const dot = confirm.querySelector<HTMLElement>('[data-testid="outlook-project-dot"]');
        expect(dot?.getAttribute('aria-hidden')).toBe('true');
        expect(dot?.compareDocumentPosition(hint)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

        const edit = item('outlook-menu-edit') as HTMLElement;
        expect(edit.textContent?.trim()).toBe('Edit');
        expect(edit.querySelector('svg')?.getAttribute('class')).toContain('pencil');
    });

    it('renders the project name of the hint as text only', async () => {
        const [block] = renderLane(['m-1']);
        const { context } = fakeContext([
            preassigned({
                assignment: { ...assignment, project_name: '<img src=x onerror=alert(1)>' },
            }),
        ]);
        await openMenu(block!, context);

        const hint = item('outlook-menu-project-hint') as HTMLElement;
        expect(hint.textContent?.trim()).toBe('<img src=x onerror=alert(1)>');
        expect(hint.querySelector('img')).toBeNull();
    });

    it('Confirm sends the confirm once, after the menu has closed', async () => {
        const [block] = renderLane(['m-1']);
        const { context, confirmOne, menuAtConfirm, openForm } = fakeContext([preassigned()]);
        await openMenu(block!, context);

        item('outlook-menu-confirm')?.click();

        await vi.waitFor(() => expect(confirmOne).toHaveBeenCalledTimes(1));
        expect(confirmOne).toHaveBeenCalledWith('m-1');
        expect(menuAtConfirm).toEqual([false]);
        expect(menu()).toBeNull();
        expect(openForm).not.toHaveBeenCalled();
    });

    it('Confirm is disabled while a confirm of the meeting runs', async () => {
        const [block] = renderLane(['m-1']);
        const { context } = fakeContext([preassigned()], { pending: ['m-1'] });
        await openMenu(block!, context);

        const confirm = item('outlook-menu-confirm') as HTMLElement;
        expect(confirm.hasAttribute('data-disabled')).toBe(true);
        expect(confirm.getAttribute('aria-disabled')).toBe('true');
    });

    it('Edit asks for the form only after the menu has closed', async () => {
        const [block] = renderLane(['m-1']);
        const { context, openForm, menuAtOpenForm, confirmOne } = fakeContext([preassigned()]);
        await openMenu(block!, context);

        item('outlook-menu-edit')?.click();

        await vi.waitFor(() => expect(openForm).toHaveBeenCalledTimes(1));
        expect(openForm).toHaveBeenCalledWith('m-1');
        expect(menuAtOpenForm).toEqual([false]);
        expect(confirmOne).not.toHaveBeenCalled();
    });

    it('a faded pre-assigned meeting offers "Create time entry" instead', async () => {
        const [block] = renderLane(['m-1']);
        const { context } = fakeContext([preassigned({ dismissed: true })], {
            includeDismissed: true,
        });
        await openMenu(block!, context);

        expect(item('outlook-menu-create')).not.toBeNull();
        expect(item('outlook-menu-confirm')).toBeNull();
        expect(item('outlook-menu-edit')).toBeNull();
    });

    it('offers neither Confirm nor Edit when the context cannot act', async () => {
        const [block] = renderLane(['m-1']);
        const { context, confirmOne } = fakeContext([preassigned()], { canAct: false });
        await openMenu(block!, context);

        expect(menu()).not.toBeNull();
        expect(item('outlook-menu-confirm')).toBeNull();
        expect(item('outlook-menu-edit')).toBeNull();
        expect(item('outlook-menu-create')).toBeNull();
        expect(confirmOne).not.toHaveBeenCalled();
    });
});

// Phase 5 series controls (UI-SPEC sections 4 and 5, D-10, D-11).
describe('OutlookMeetingContextItems series controls', () => {
    it('a recurring meeting offers "Always ignore this series" after Dismiss', async () => {
        const [block] = renderLane(['m-1']);
        const { context } = fakeContext([meeting({ series_key: 'series-1' })]);
        await openMenu(block!, context);

        expect(itemOrder()).toEqual([
            'outlook-menu-label',
            'outlook-menu-create',
            'outlook-menu-select',
            'separator',
            'outlook-menu-dismiss',
            'outlook-menu-ignore-series',
        ]);
        const ignore = item('outlook-menu-ignore-series') as HTMLElement;
        expect(ignore.textContent?.trim()).toBe('Always ignore this series');
        expect(ignore.querySelector('svg')?.getAttribute('class')).toContain('calendar-off');
        expect(item('outlook-menu-unignore-series')).toBeNull();
        expect(item('outlook-menu-forget-series')).toBeNull();
    });

    it('a pre-assigned recurring meeting also offers "Forget this series" last', async () => {
        const [block] = renderLane(['m-1']);
        const { context } = fakeContext([preassigned()]);
        await openMenu(block!, context);

        expect(itemOrder()).toEqual([
            'outlook-menu-label',
            'outlook-menu-confirm',
            'outlook-project-dot',
            'outlook-menu-project-hint',
            'outlook-menu-edit',
            'outlook-menu-select',
            'separator',
            'outlook-menu-dismiss',
            'outlook-menu-ignore-series',
            'outlook-menu-forget-series',
        ]);
        const forget = item('outlook-menu-forget-series') as HTMLElement;
        expect(forget.textContent?.trim()).toBe('Forget this series');
        expect(forget.querySelector('svg')?.getAttribute('class')).toContain('unlink');
    });

    it('an occurrence of an ignored series offers "Stop ignoring this series" instead', async () => {
        const [block] = renderLane(['m-1']);
        const { context } = fakeContext([preassigned({ series_ignored: true })], {
            includeDismissed: true,
        });
        await openMenu(block!, context);

        expect(itemOrder()).toEqual([
            'outlook-menu-label',
            'outlook-menu-create',
            'outlook-menu-select',
            'separator',
            'outlook-menu-dismiss',
            'outlook-menu-unignore-series',
        ]);
        const unignore = item('outlook-menu-unignore-series') as HTMLElement;
        expect(unignore.textContent?.trim()).toBe('Stop ignoring this series');
        expect(unignore.querySelector('svg')?.getAttribute('class')).toMatch(/undo-?2/);
        expect(item('outlook-menu-ignore-series')).toBeNull();
        // Faded, so not pre-assigned: no Confirm, Edit or Forget.
        expect(item('outlook-menu-confirm')).toBeNull();
        expect(item('outlook-menu-forget-series')).toBeNull();
    });

    it('a dismissed occurrence of an ignored series offers Restore and Stop ignoring', async () => {
        const [block] = renderLane(['m-1']);
        const { context } = fakeContext(
            [meeting({ series_key: 'series-1', series_ignored: true, dismissed: true })],
            { includeDismissed: true }
        );
        await openMenu(block!, context);

        expect(item('outlook-menu-restore')).not.toBeNull();
        expect(item('outlook-menu-unignore-series')).not.toBeNull();
        expect(item('outlook-menu-dismiss')).toBeNull();
        expect(item('outlook-menu-ignore-series')).toBeNull();
    });

    it('a single meeting offers none of the series items', async () => {
        const [block] = renderLane(['m-1']);
        const { context } = fakeContext([meeting({ series_key: null })]);
        await openMenu(block!, context);

        expect(item('outlook-menu-dismiss')).not.toBeNull();
        expect(item('outlook-menu-ignore-series')).toBeNull();
        expect(item('outlook-menu-unignore-series')).toBeNull();
        expect(item('outlook-menu-forget-series')).toBeNull();
    });

    it('offers none of the Phase 5 items when the context cannot act', async () => {
        const [block] = renderLane(['m-1']);
        const regular = fakeContext([preassigned()], { canAct: false });
        await openMenu(block!, regular.context);
        expect(menu()).not.toBeNull();
        for (const id of [
            'outlook-menu-confirm',
            'outlook-menu-edit',
            'outlook-menu-ignore-series',
            'outlook-menu-unignore-series',
            'outlook-menu-forget-series',
        ]) {
            expect(item(id)).toBeNull();
        }

        unmountMenu();
        const ignored = fakeContext([meeting({ series_key: 'series-1', series_ignored: true })], {
            canAct: false,
            includeDismissed: true,
        });
        await openMenu(block!, ignored.context);
        expect(menu()).not.toBeNull();
        expect(itemOrder()).toEqual(['outlook-menu-label']);
    });

    it('selecting the series items calls the series actions with the meeting id', async () => {
        const [block] = renderLane(['m-1']);
        const first = fakeContext([preassigned()]);
        await openMenu(block!, first.context);
        item('outlook-menu-forget-series')?.click();
        await vi.waitFor(() => expect(first.forgetSeries).toHaveBeenCalledWith('m-1'));
        expect(first.ignoreSeries).not.toHaveBeenCalled();

        unmountMenu();
        const second = fakeContext([meeting({ series_key: 'series-1', series_ignored: true })], {
            includeDismissed: true,
        });
        await openMenu(block!, second.context);
        item('outlook-menu-unignore-series')?.click();
        await vi.waitFor(() => expect(second.unignoreSeries).toHaveBeenCalledWith('m-1'));
        expect(second.restore).not.toHaveBeenCalled();
        expect(second.dismiss).not.toHaveBeenCalled();
    });
});

// Focus after a menu Dismiss / Restore mirrors the detail panel (Phase 3 03-09 / 03-10). Nothing is
// focused before the menu opens, so the menu's own focus return cannot satisfy these assertions.
describe('OutlookMeetingContextItems focus', () => {
    const three = [
        meeting({ id: 'a', subject: 'A' }),
        meeting({ id: 'b', subject: 'B' }),
        meeting({ id: 'c', subject: 'C' }),
    ];

    function block(id: string): HTMLElement | null {
        return document.body.querySelector<HTMLElement>(`[data-ghost-id="${id}"]`);
    }

    it('after Dismiss focuses the next meeting of the day', async () => {
        const [, middle] = renderLane(['a', 'b', 'c']);
        renderSyncButton();
        const { context, dismiss } = fakeContext(three);
        await openMenu(middle!, context);

        item('outlook-menu-dismiss')?.click();

        await vi.waitFor(() => expect(document.activeElement).toBe(block('c')));
        expect(dismiss).toHaveBeenCalledWith('b');
        expect(block('b')).toBeNull();
        expect(menu()).toBeNull();
    });

    it('dismissing the last meeting focuses the previous one', async () => {
        const [, , last] = renderLane(['a', 'b', 'c']);
        renderSyncButton();
        const { context } = fakeContext(three);
        await openMenu(last!, context);

        item('outlook-menu-dismiss')?.click();

        await vi.waitFor(() => expect(document.activeElement).toBe(block('b')));
    });

    it('without any meeting left focuses the Sync button', async () => {
        const [only] = renderLane(['a']);
        const sync = renderSyncButton();
        const { context } = fakeContext([meeting({ id: 'a' })]);
        await openMenu(only!, context);

        item('outlook-menu-dismiss')?.click();

        await vi.waitFor(() => expect(document.activeElement).toBe(sync));
    });

    it('with dismissed meetings shown keeps focus on the same meeting', async () => {
        const [, middle] = renderLane(['a', 'b', 'c']);
        renderSyncButton();
        const { context, list } = fakeContext(three, { includeDismissed: true });
        await openMenu(middle!, context);

        item('outlook-menu-dismiss')?.click();

        await vi.waitFor(() => expect(document.activeElement).toBe(middle));
        expect(list.value.find((m) => m.id === 'b')?.dismissed).toBe(true);
    });

    it('after Restore keeps focus on the same meeting', async () => {
        const [, middle] = renderLane(['a', 'b', 'c']);
        renderSyncButton();
        const { context, restore } = fakeContext([
            meeting({ id: 'a' }),
            meeting({ id: 'b', dismissed: true }),
            meeting({ id: 'c' }),
        ]);
        await openMenu(middle!, context);

        item('outlook-menu-restore')?.click();

        await vi.waitFor(() => expect(document.activeElement).toBe(middle));
        expect(restore).toHaveBeenCalledWith('b');
    });

    it('after "Always ignore this series" focuses the next meeting outside the series', async () => {
        const [, middle] = renderLane(['a', 'b', 'c', 'd']);
        renderSyncButton();
        const { context, ignoreSeries } = fakeContext([
            meeting({ id: 'a', series_key: null }),
            meeting({ id: 'b', series_key: 'series-1' }),
            meeting({ id: 'c', series_key: 'series-1' }),
            meeting({ id: 'd', series_key: null }),
        ]);
        await openMenu(middle!, context);

        item('outlook-menu-ignore-series')?.click();

        await vi.waitFor(() => expect(document.activeElement).toBe(block('d')));
        expect(ignoreSeries).toHaveBeenCalledWith('b');
        expect(block('b')).toBeNull();
        expect(block('c')).toBeNull();
        expect(menu()).toBeNull();
    });

    it('ignoring the series of the last meeting focuses the previous one', async () => {
        const [, , last] = renderLane(['a', 'b', 'c']);
        renderSyncButton();
        const { context } = fakeContext([
            meeting({ id: 'a' }),
            meeting({ id: 'b' }),
            meeting({ id: 'c', series_key: 'series-1' }),
        ]);
        await openMenu(last!, context);

        item('outlook-menu-ignore-series')?.click();

        await vi.waitFor(() => expect(document.activeElement).toBe(block('b')));
    });

    it('ignoring the only series of the day focuses the Sync button', async () => {
        const [first] = renderLane(['a', 'b']);
        const sync = renderSyncButton();
        const { context } = fakeContext([
            meeting({ id: 'a', series_key: 'series-1' }),
            meeting({ id: 'b', series_key: 'series-1' }),
        ]);
        await openMenu(first!, context);

        item('outlook-menu-ignore-series')?.click();

        await vi.waitFor(() => expect(document.activeElement).toBe(sync));
    });

    it('ignoring with dismissed meetings shown keeps focus on the same meeting', async () => {
        const [, middle] = renderLane(['a', 'b', 'c']);
        renderSyncButton();
        const { context, list } = fakeContext(
            [
                meeting({ id: 'a' }),
                meeting({ id: 'b', series_key: 'series-1' }),
                meeting({ id: 'c' }),
            ],
            { includeDismissed: true }
        );
        await openMenu(middle!, context);

        item('outlook-menu-ignore-series')?.click();

        await vi.waitFor(() => expect(document.activeElement).toBe(middle));
        expect(list.value.find((m) => m.id === 'b')?.series_ignored).toBe(true);
    });

    it('after "Stop ignoring this series" keeps focus on the same meeting', async () => {
        const [, middle] = renderLane(['a', 'b', 'c']);
        renderSyncButton();
        const { context, unignoreSeries } = fakeContext(
            [
                meeting({ id: 'a' }),
                meeting({ id: 'b', series_key: 'series-1', series_ignored: true }),
                meeting({ id: 'c' }),
            ],
            { includeDismissed: true }
        );
        await openMenu(middle!, context);

        item('outlook-menu-unignore-series')?.click();

        await vi.waitFor(() => expect(document.activeElement).toBe(middle));
        expect(unignoreSeries).toHaveBeenCalledWith('b');
    });

    it('after "Forget this series" keeps focus on the same meeting', async () => {
        const [, middle] = renderLane(['a', 'b', 'c']);
        renderSyncButton();
        const { context, forgetSeries, list } = fakeContext([
            meeting({ id: 'a' }),
            preassigned({ id: 'b' }),
            meeting({ id: 'c' }),
        ]);
        await openMenu(middle!, context);

        item('outlook-menu-forget-series')?.click();

        await vi.waitFor(() => expect(document.activeElement).toBe(middle));
        expect(forgetSeries).toHaveBeenCalledWith('b');
        expect(list.value.find((m) => m.id === 'b')?.assignment).toBeNull();
    });
});
