import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import type {
    OutlookCalendarLabels,
    OutlookFlagPanelRequest,
    OutlookOutOfSyncItem,
} from '@/m365/types';
import type { OutlookFlagActionResult } from './conversionApi';
import OutlookSyncFlagPanel from './OutlookSyncFlagPanel.vue';
import { OUTLOOK_MEETINGS_KEY, type OutlookMeetingsContext } from './useOutlookMeetings';

const labels = {
    cancel: 'Cancel',
    osync_title_moved: 'Meeting moved in Outlook',
    osync_title_cancelled: 'Meeting cancelled in Outlook',
    osync_title_removed: 'Meeting removed from Outlook',
    osync_row_before: 'Before',
    osync_row_now: 'Now',
    osync_row_entry: 'Your entry',
    osync_row_meeting: 'Meeting',
    osync_note_moved: "You changed this entry's time, so it was not moved automatically.",
    osync_note_gone: 'Nothing is deleted unless you choose to.',
    osync_not_in_view: 'This entry is outside the days or hours shown.',
    osync_adjust: 'Adjust to Outlook',
    osync_keep: 'Keep as is',
    osync_delete: 'Delete entry',
    osync_delete_question: "Delete this time entry? This can't be undone.",
    osync_delete_confirm: 'Delete entry',
} as OutlookCalendarLabels;

// A moved meeting (Tue 10:00-11:00 -> Wed 12:00-13:00) whose entry the user edited to 10:15.
function flag(overrides: Partial<OutlookOutOfSyncItem> = {}): OutlookOutOfSyncItem {
    return {
        time_entry_id: 'te-1',
        kind: 'moved',
        meeting_start: '2026-11-24T10:00:00Z',
        meeting_end: '2026-11-24T11:00:00Z',
        new_start: '2026-11-25T12:00:00Z',
        new_end: '2026-11-25T13:00:00Z',
        all_day: false,
        entry_start: '2026-11-24T10:15:00Z',
        entry_end: '2026-11-24T11:00:00Z',
        description: 'Weekly sync',
        ...overrides,
    };
}

function cancelled(overrides: Partial<OutlookOutOfSyncItem> = {}): OutlookOutOfSyncItem {
    return flag({
        kind: 'cancelled',
        new_start: null,
        new_end: null,
        entry_start: '2026-11-24T10:00:00Z',
        ...overrides,
    });
}

// Fake context: the actions behave like the composable's (pending while they run; ok and stale
// drop the flag / close the popover of that entry; failed leaves everything as it was).
const flags = ref<OutlookOutOfSyncItem[]>([]);
const flagPanel = ref<OutlookFlagPanelRequest | null>(null);
const canAct = ref(true);
const pendingIds = ref<string[]>([]);
let seq = 0;
let answer: OutlookFlagActionResult;
let gate: Promise<unknown> | null;

function act(id: string): Promise<OutlookFlagActionResult> {
    return (async () => {
        pendingIds.value = [...pendingIds.value, id];
        if (gate) await gate;
        pendingIds.value = pendingIds.value.filter((value) => value !== id);
        const result = answer;
        if (result.status === 'ok') {
            flags.value = flags.value.filter((item) => item.time_entry_id !== id);
        }
        if (result.status !== 'failed' && flagPanel.value?.timeEntryId === id) {
            flagPanel.value = null;
        }
        return result;
    })();
}

const keepFlag = vi.fn(act);
const adjustFlag = vi.fn(act);
const deleteFlaggedEntry = vi.fn(act);
const closeFlagPanel = vi.fn(() => {
    flagPanel.value = null;
});

function context(): OutlookMeetingsContext {
    return {
        labels: computed(() => labels),
        canAct,
        flagPanel,
        closeFlagPanel,
        flagOf: (id: string) => flags.value.find((item) => item.time_entry_id === id) ?? null,
        keepFlag,
        adjustFlag,
        deleteFlaggedEntry,
        isFlagPending: (id: string) => pendingIds.value.includes(id),
    } as unknown as OutlookMeetingsContext;
}

function open(
    id = 'te-1',
    anchor: OutlookFlagPanelRequest['anchor'] = 'entry',
    origin: OutlookFlagPanelRequest['origin'] = 'entry'
): void {
    seq += 1;
    flagPanel.value = { timeEntryId: id, anchor, origin, seq };
}

let wrapper: VueWrapper | null = null;

function mountPanel() {
    wrapper = mount(OutlookSyncFlagPanel, {
        attachTo: document.body,
        global: {
            provide: {
                [OUTLOOK_MEETINGS_KEY as symbol]: context(),
                organization: computed(() => ({ time_format: '24-hours' })),
            },
        },
    });
    return wrapper;
}

// The calendar root with one focusable block per entry (what the core calendar draws).
function renderBlocks(ids: string[]): void {
    let root = document.body.querySelector<HTMLElement>('.fc');
    if (!root) {
        root = document.createElement('div');
        root.className = 'fc';
        document.body.appendChild(root);
    }
    root.replaceChildren(...ids.map(block));
}

function block(id: string): HTMLElement {
    const element = document.createElement('div');
    element.dataset.eventId = id;
    element.setAttribute('role', 'button');
    element.tabIndex = 0;
    element.textContent = 'Entry ' + id;
    return element;
}

function blockOf(id: string): HTMLElement {
    return document.body.querySelector<HTMLElement>(`[data-event-id="${id}"]`)!;
}

// The toolbar: the counter (when `counter`) and the Sync button.
function renderToolbar(counter = true): void {
    document.body.querySelector('[data-toolbar]')?.remove();
    const toolbar = document.createElement('div');
    toolbar.dataset.toolbar = '';
    if (counter) {
        const button = document.createElement('button');
        button.dataset.testid = 'outlook-out-of-sync';
        button.textContent = '1 out of sync';
        toolbar.appendChild(button);
    }
    const sync = document.createElement('button');
    sync.dataset.testid = 'outlook-sync-button';
    sync.textContent = 'Sync';
    toolbar.appendChild(sync);
    document.body.appendChild(toolbar);
}

function removeCounter(): void {
    query('outlook-out-of-sync')?.remove();
}

async function settle() {
    await nextTick();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
}

function query(testid: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
}

function el(testid: string): HTMLElement {
    const found = query(testid);
    expect(found, testid).not.toBeNull();
    return found as HTMLElement;
}

function text(testid: string): string {
    return el(testid).textContent?.trim() ?? '';
}

function pressEscape(target: EventTarget = document.activeElement ?? document.body) {
    target.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
}

async function openPanel(
    id = 'te-1',
    anchor: OutlookFlagPanelRequest['anchor'] = 'entry',
    origin: OutlookFlagPanelRequest['origin'] = 'entry'
) {
    open(id, anchor, origin);
    await settle();
    expect(query('outlook-sync-flag-panel')).not.toBeNull();
}

beforeEach(() => {
    keepFlag.mockClear();
    adjustFlag.mockClear();
    deleteFlaggedEntry.mockClear();
    closeFlagPanel.mockClear();
    answer = { status: 'ok' };
    gate = null;
    canAct.value = true;
    pendingIds.value = [];
    flagPanel.value = null;
    flags.value = [flag()];
    renderBlocks(['te-1', 'te-2']);
    renderToolbar();
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
});

describe('OutlookSyncFlagPanel: moved flag', () => {
    it('shows what moved, anchored to the entry block, with focus on Adjust', async () => {
        mountPanel();
        await openPanel();

        const panel = el('outlook-sync-flag-panel');
        expect(panel.dataset.kind).toBe('moved');
        expect(panel.dataset.anchor).toBe('entry');
        expect(panel.className).toContain('w-96');
        expect(panel.className).toContain('p-4');
        expect(panel.getAttribute('role')).toBe('dialog');
        expect(panel.getAttribute('aria-labelledby')).toBe(el('outlook-sync-flag-title').id);

        expect(text('outlook-sync-flag-title')).toBe('Meeting moved in Outlook');
        expect(el('outlook-sync-flag-title').className).toContain('font-semibold');
        expect(text('outlook-sync-flag-description')).toBe('Weekly sync');
        expect(el('outlook-sync-flag-description').getAttribute('title')).toBe('Weekly sync');
        expect(text('outlook-sync-flag-before')).toBe('Tue, Nov 24 · 10:00 – 11:00');
        expect(text('outlook-sync-flag-now')).toBe('Wed, Nov 25 · 12:00 – 13:00');
        expect(text('outlook-sync-flag-entry')).toBe('Tue, Nov 24 · 10:15 – 11:00');
        expect(el('outlook-sync-flag-now').className).toContain('font-semibold');
        expect(panel.textContent).toContain('Before');
        expect(panel.textContent).toContain('Now');
        expect(panel.textContent).toContain('Your entry');
        expect(panel.querySelector('dl')!.className).toContain('tabular-nums');
        expect(text('outlook-sync-flag-note')).toBe(
            "You changed this entry's time, so it was not moved automatically."
        );
        expect(query('outlook-sync-flag-meeting')).toBeNull();
        expect(query('outlook-sync-flag-delete')).toBeNull();
        expect(query('outlook-sync-flag-not-in-view')).toBeNull();

        expect(text('outlook-sync-flag-keep')).toBe('Keep as is');
        expect(text('outlook-sync-flag-adjust')).toBe('Adjust to Outlook');
        expect(document.activeElement).toBe(el('outlook-sync-flag-adjust'));
    });

    it('shows "No description" for an entry without one, with the full text as title', async () => {
        flags.value = [flag({ description: '' })];
        mountPanel();
        await openPanel();

        expect(text('outlook-sync-flag-description')).toBe('No description');
        expect(el('outlook-sync-flag-description').className).toContain('truncate');
    });

    it('renders text only (markup in the description stays text)', async () => {
        flags.value = [flag({ description: '<img src=x onerror=alert(1)>' })];
        mountPanel();
        await openPanel();

        expect(text('outlook-sync-flag-description')).toBe('<img src=x onerror=alert(1)>');
        expect(el('outlook-sync-flag-panel').querySelector('img')).toBeNull();
    });

    it('adjusts the entry, closes and focuses the moved entry block', async () => {
        mountPanel();
        await openPanel();

        el('outlook-sync-flag-adjust').click();
        await settle();

        expect(adjustFlag).toHaveBeenCalledTimes(1);
        expect(adjustFlag).toHaveBeenCalledWith('te-1');
        expect(keepFlag).not.toHaveBeenCalled();
        expect(query('outlook-sync-flag-panel')).toBeNull();
        expect(flagPanel.value).toBeNull();
        expect(document.activeElement).toBe(blockOf('te-1'));
    });

    it('after an adjust opened from the counter, focuses the counter while it is shown', async () => {
        mountPanel();
        await openPanel('te-1', 'entry', 'counter');

        el('outlook-sync-flag-adjust').click();
        await settle();

        expect(query('outlook-sync-flag-panel')).toBeNull();
        expect(document.activeElement).toBe(el('outlook-out-of-sync'));
    });

    it('after an adjust, falls back to the counter, then to Sync, when the block is not rendered', async () => {
        mountPanel();
        await openPanel();
        el('outlook-sync-flag-adjust').addEventListener('click', () => renderBlocks(['te-2']));

        el('outlook-sync-flag-adjust').click();
        await settle();
        expect(document.activeElement).toBe(el('outlook-out-of-sync'));

        flags.value = [flag()];
        renderBlocks(['te-1']);
        await openPanel();
        el('outlook-sync-flag-adjust').addEventListener('click', () => {
            renderBlocks([]);
            removeCounter();
        });
        el('outlook-sync-flag-adjust').click();
        await settle();
        expect(document.activeElement).toBe(el('outlook-sync-button'));
    });

    it('hides Adjust for an all-day moved meeting and focuses Keep as is', async () => {
        flags.value = [
            flag({
                all_day: true,
                meeting_start: '2026-11-24T00:00:00Z',
                meeting_end: '2026-11-25T00:00:00Z',
                new_start: '2026-11-26T00:00:00Z',
                new_end: '2026-11-27T00:00:00Z',
            }),
        ];
        mountPanel();
        await openPanel();

        expect(query('outlook-sync-flag-adjust')).toBeNull();
        expect(text('outlook-sync-flag-before')).toBe('Tue, Nov 24');
        expect(text('outlook-sync-flag-now')).toBe('Thu, Nov 26');
        expect(document.activeElement).toBe(el('outlook-sync-flag-keep'));
    });

    it('renders nothing without a request, for an unflagged entry, or without canAct', async () => {
        mountPanel();
        await settle();
        expect(query('outlook-sync-flag-panel')).toBeNull();

        open('te-2');
        await settle();
        expect(query('outlook-sync-flag-panel')).toBeNull();

        canAct.value = false;
        open('te-1');
        await settle();
        expect(query('outlook-sync-flag-panel')).toBeNull();
    });
});

describe('OutlookSyncFlagPanel: cancelled and removed flags', () => {
    it('shows a cancelled meeting with Keep as is and Delete entry, focus on Keep', async () => {
        flags.value = [cancelled()];
        mountPanel();
        await openPanel();

        const panel = el('outlook-sync-flag-panel');
        expect(panel.dataset.kind).toBe('cancelled');
        expect(text('outlook-sync-flag-title')).toBe('Meeting cancelled in Outlook');
        expect(text('outlook-sync-flag-description')).toBe('Weekly sync');
        expect(panel.textContent).toContain('Meeting');
        expect(text('outlook-sync-flag-meeting')).toBe('Tue, Nov 24 · 10:00 – 11:00');
        // Same times as the meeting: no "Your entry" row
        expect(query('outlook-sync-flag-entry')).toBeNull();
        expect(query('outlook-sync-flag-before')).toBeNull();
        expect(query('outlook-sync-flag-now')).toBeNull();
        expect(text('outlook-sync-flag-note')).toBe('Nothing is deleted unless you choose to.');

        expect(query('outlook-sync-flag-adjust')).toBeNull();
        expect(text('outlook-sync-flag-keep')).toBe('Keep as is');
        const remove = el('outlook-sync-flag-delete');
        expect(remove.textContent?.trim()).toBe('Delete entry');
        expect(remove.className).toContain('text-destructive');
        expect(remove.className).toContain('border');
        expect(remove.querySelector('svg')).not.toBeNull();
        expect(document.activeElement).toBe(el('outlook-sync-flag-keep'));
    });

    it('lists the entry when its times differ from the meeting', async () => {
        flags.value = [cancelled({ entry_start: '2026-11-24T10:15:00Z' })];
        mountPanel();
        await openPanel();

        expect(text('outlook-sync-flag-meeting')).toBe('Tue, Nov 24 · 10:00 – 11:00');
        expect(text('outlook-sync-flag-entry')).toBe('Tue, Nov 24 · 10:15 – 11:00');
    });

    it('shows a removed meeting with its own title', async () => {
        flags.value = [cancelled({ kind: 'removed' })];
        mountPanel();
        await openPanel();

        expect(el('outlook-sync-flag-panel').dataset.kind).toBe('removed');
        expect(text('outlook-sync-flag-title')).toBe('Meeting removed from Outlook');
        expect(text('outlook-sync-flag-note')).toBe('Nothing is deleted unless you choose to.');
        expect(query('outlook-sync-flag-delete')).not.toBeNull();
    });

    it('keeps the entry as is, closes and focuses the entry block', async () => {
        flags.value = [cancelled()];
        mountPanel();
        await openPanel();

        el('outlook-sync-flag-keep').click();
        await settle();

        expect(keepFlag).toHaveBeenCalledTimes(1);
        expect(keepFlag).toHaveBeenCalledWith('te-1');
        expect(deleteFlaggedEntry).not.toHaveBeenCalled();
        expect(query('outlook-sync-flag-panel')).toBeNull();
        expect(document.activeElement).toBe(blockOf('te-1'));
    });

    it('after Keep opened from the counter, focuses the counter, else the entry block', async () => {
        mountPanel();
        await openPanel('te-1', 'entry', 'counter');
        el('outlook-sync-flag-keep').click();
        await settle();
        expect(document.activeElement).toBe(el('outlook-out-of-sync'));

        flags.value = [flag()];
        await openPanel('te-1', 'entry', 'counter');
        el('outlook-sync-flag-keep').addEventListener('click', removeCounter);
        el('outlook-sync-flag-keep').click();
        await settle();
        expect(document.activeElement).toBe(blockOf('te-1'));
    });

    it('a single click on Delete entry never deletes: it asks first, focused on Cancel', async () => {
        flags.value = [cancelled()];
        mountPanel();
        await openPanel();

        el('outlook-sync-flag-delete').click();
        await settle();

        expect(deleteFlaggedEntry).not.toHaveBeenCalled();
        expect(query('outlook-sync-flag-panel')).not.toBeNull();
        expect(query('outlook-sync-flag-keep')).toBeNull();
        expect(query('outlook-sync-flag-delete')).toBeNull();
        expect(text('outlook-sync-flag-delete-question')).toBe(
            "Delete this time entry? This can't be undone."
        );
        expect(text('outlook-sync-flag-delete-cancel')).toBe('Cancel');
        const confirm = el('outlook-sync-flag-delete-confirm');
        expect(confirm.textContent?.trim()).toBe('Delete entry');
        expect(confirm.className).toContain('bg-destructive');
        expect(confirm.querySelector('svg')).not.toBeNull();
        expect(document.activeElement).toBe(el('outlook-sync-flag-delete-cancel'));
    });

    it('Cancel returns to the normal footer with focus on Delete entry', async () => {
        flags.value = [cancelled()];
        mountPanel();
        await openPanel();
        el('outlook-sync-flag-delete').click();
        await settle();

        el('outlook-sync-flag-delete-cancel').click();
        await settle();

        expect(deleteFlaggedEntry).not.toHaveBeenCalled();
        expect(query('outlook-sync-flag-delete-confirm')).toBeNull();
        expect(query('outlook-sync-flag-keep')).not.toBeNull();
        expect(document.activeElement).toBe(el('outlook-sync-flag-delete'));
    });

    it('Esc closes the confirmation first, then the popover, returning focus to the block', async () => {
        flags.value = [cancelled()];
        mountPanel();
        await openPanel();
        el('outlook-sync-flag-delete').click();
        await settle();

        pressEscape();
        await settle();
        expect(query('outlook-sync-flag-panel')).not.toBeNull();
        expect(query('outlook-sync-flag-delete-confirm')).toBeNull();
        expect(document.activeElement).toBe(el('outlook-sync-flag-delete'));

        pressEscape();
        await settle();
        expect(query('outlook-sync-flag-panel')).toBeNull();
        expect(closeFlagPanel).toHaveBeenCalled();
        expect(flagPanel.value).toBeNull();
        expect(deleteFlaggedEntry).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(blockOf('te-1'));
    });

    it('Delete deletes exactly once, closes and focuses the counter, else Sync', async () => {
        flags.value = [cancelled()];
        mountPanel();
        await openPanel();
        el('outlook-sync-flag-delete').click();
        await settle();

        el('outlook-sync-flag-delete-confirm').click();
        await settle();

        expect(deleteFlaggedEntry).toHaveBeenCalledTimes(1);
        expect(deleteFlaggedEntry).toHaveBeenCalledWith('te-1');
        expect(keepFlag).not.toHaveBeenCalled();
        expect(query('outlook-sync-flag-panel')).toBeNull();
        expect(document.activeElement).toBe(el('outlook-out-of-sync'));

        flags.value = [cancelled({ kind: 'removed' })];
        await openPanel();
        el('outlook-sync-flag-delete').click();
        await settle();
        el('outlook-sync-flag-delete-confirm').addEventListener('click', removeCounter);
        el('outlook-sync-flag-delete-confirm').click();
        await settle();
        expect(deleteFlaggedEntry).toHaveBeenCalledTimes(2);
        expect(document.activeElement).toBe(el('outlook-sync-button'));
    });

    it('a new request resets the confirmation', async () => {
        flags.value = [cancelled()];
        mountPanel();
        await openPanel();
        el('outlook-sync-flag-delete').click();
        await settle();
        expect(query('outlook-sync-flag-delete-confirm')).not.toBeNull();

        await openPanel();
        expect(query('outlook-sync-flag-delete-confirm')).toBeNull();
        expect(document.activeElement).toBe(el('outlook-sync-flag-keep'));
    });
});
