import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { OutlookCalendarLabels, OutlookOutOfSyncItem } from '@/m365/types';
import OutlookSyncFlagCounter from './OutlookSyncFlagCounter.vue';
import { OUTLOOK_MEETINGS_KEY, type OutlookMeetingsContext } from './useOutlookMeetings';

const labels = {
    osync_count_one: '1 out of sync',
    osync_count_many: ':count out of sync',
    osync_count_aria_one: '1 time entry out of sync with Outlook. Show it.',
    osync_count_aria_many: ':count time entries out of sync with Outlook. Show the first one.',
    osync_count_tooltip: 'Show the first entry that changed in Outlook',
} as OutlookCalendarLabels;

function flag(id: string, start: string): OutlookOutOfSyncItem {
    return {
        time_entry_id: id,
        kind: 'cancelled',
        meeting_start: start,
        meeting_end: start.replace('T09', 'T10'),
        new_start: null,
        new_end: null,
        all_day: false,
        entry_start: start,
        entry_end: start.replace('T09', 'T10'),
        description: '',
    };
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

// Fake context: jumpToFirst behaves like the real one (busy from the click until it settles).
const outOfSync = ref<OutlookOutOfSyncItem[]>([]);
const canAct = ref(true);
const jumpBusy = ref(false);
const labelsRef = ref<OutlookCalendarLabels | null>(labels);
let gate: Promise<void> | null = null;
const jumpToFirst = vi.fn(async () => {
    jumpBusy.value = true;
    try {
        if (gate) await gate;
    } finally {
        jumpBusy.value = false;
    }
});

function context(): OutlookMeetingsContext {
    return {
        labels: labelsRef,
        canAct,
        outOfSync,
        jumpBusy,
        jumpToFirst,
    } as unknown as OutlookMeetingsContext;
}

let wrapper: VueWrapper | null = null;

function mountCounter() {
    wrapper = mount(OutlookSyncFlagCounter, {
        attachTo: document.body,
        global: {
            provide: {
                [OUTLOOK_MEETINGS_KEY as symbol]: context(),
            },
        },
    });
    return wrapper;
}

async function settle() {
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

const TWO = [flag('te-2', '2026-11-04T09:00:00Z'), flag('te-1', '2026-11-03T09:00:00Z')];

describe('OutlookSyncFlagCounter', () => {
    beforeEach(() => {
        outOfSync.value = [];
        canAct.value = true;
        jumpBusy.value = false;
        labelsRef.value = labels;
        gate = null;
        jumpToFirst.mockClear();
    });

    afterEach(() => {
        wrapper?.unmount();
        wrapper = null;
        document.body.innerHTML = '';
    });

    it('shows "2 out of sync" with the count and aria-label of the whole window', async () => {
        outOfSync.value = TWO;
        mountCounter();
        await settle();

        const button = el('outlook-out-of-sync');
        expect(button.tagName).toBe('BUTTON');
        expect(button.getAttribute('type')).toBe('button');
        expect(button.getAttribute('data-count')).toBe('2');
        expect(button.textContent?.replace(/\s+/g, ' ').trim()).toBe('2 out of sync');
        expect(button.getAttribute('aria-label')).toBe(
            '2 time entries out of sync with Outlook. Show the first one.'
        );
        expect(button.getAttribute('aria-busy')).toBe('false');
    });

    it('says "1 out of sync" and "Show it." for one flagged entry', async () => {
        outOfSync.value = [flag('te-1', '2026-11-03T09:00:00Z')];
        mountCounter();
        await settle();

        const button = el('outlook-out-of-sync');
        expect(button.getAttribute('data-count')).toBe('1');
        expect(button.textContent?.replace(/\s+/g, ' ').trim()).toBe('1 out of sync');
        expect(button.getAttribute('aria-label')).toBe(
            '1 time entry out of sync with Outlook. Show it.'
        );
    });

    it('keeps the count visible below md and the words from md on (outline sm, amber icon)', async () => {
        outOfSync.value = TWO;
        mountCounter();
        await settle();

        const button = el('outlook-out-of-sync');
        // Outline small button, neutral like Sync; tighter padding below md
        expect(button.className).toContain('h-8');
        expect(button.className).toContain('border');
        expect(button.className).toContain('px-2');
        expect(button.className).toContain('md:px-3');

        const count = el('outlook-out-of-sync-count');
        expect(count.textContent?.trim()).toBe('2');
        expect(count.className).not.toContain('hidden');
        expect(count.closest('.tabular-nums')).not.toBeNull();
        // The words around the count only from md on
        const words = Array.from(button.querySelectorAll<HTMLElement>('.md\\:inline'));
        expect(words.length).toBeGreaterThan(0);
        words.forEach((part) => expect(part.className).toContain('hidden'));
        expect(words.map((part) => part.textContent).join('')).toBe(' out of sync');

        // Amber only for the icon, hidden from assistive technology
        const icon = button.querySelector('svg')!;
        expect(icon.getAttribute('aria-hidden')).toBe('true');
        expect(icon.getAttribute('class')).toContain('text-amber-700');
        expect(icon.getAttribute('class')).toContain('dark:text-amber-400');
        expect(icon.getAttribute('class')).toContain('lucide-triangle-alert');
    });

    it('keeps the whole label when the count is not part of the copy', async () => {
        labelsRef.value = { ...labels, osync_count_many: 'Out of sync: many' };
        outOfSync.value = TWO;
        mountCounter();
        await settle();

        const button = el('outlook-out-of-sync');
        expect(el('outlook-out-of-sync-count').textContent?.trim()).toBe('2');
        expect(el('outlook-out-of-sync-count').className).toContain('md:hidden');
        const words = Array.from(button.querySelectorAll<HTMLElement>('.md\\:inline'));
        expect(words.map((part) => part.textContent?.trim()).join('')).toBe('Out of sync: many');
    });

    it('shows the tooltip copy after the 300 ms delay', async () => {
        outOfSync.value = TWO;
        mountCounter();
        await settle();

        const button = el('outlook-out-of-sync');
        button.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
        button.focus();
        await new Promise((resolve) => setTimeout(resolve, 350));
        await settle();
        expect(el('outlook-out-of-sync-tooltip').textContent).toContain(
            'Show the first entry that changed in Outlook'
        );
    });

    it('renders nothing at 0, without canAct or without labels', async () => {
        for (const setup of [
            () => (outOfSync.value = []),
            () => {
                outOfSync.value = TWO;
                canAct.value = false;
            },
            () => {
                outOfSync.value = TWO;
                labelsRef.value = null;
            },
        ]) {
            outOfSync.value = [];
            canAct.value = true;
            labelsRef.value = labels;
            setup();
            mountCounter();
            await settle();

            expect(query('outlook-out-of-sync')).toBeNull();
            wrapper?.unmount();
            wrapper = null;
        }
    });

    it('renders nothing without the context or with a context that has no flags', async () => {
        wrapper = mount(OutlookSyncFlagCounter, { attachTo: document.body });
        await settle();
        expect(query('outlook-out-of-sync')).toBeNull();
        wrapper.unmount();

        wrapper = mount(OutlookSyncFlagCounter, {
            attachTo: document.body,
            global: {
                provide: {
                    [OUTLOOK_MEETINGS_KEY as symbol]: {
                        labels: computed(() => labels),
                        canAct,
                    } as unknown as OutlookMeetingsContext,
                },
            },
        });
        await settle();
        expect(query('outlook-out-of-sync')).toBeNull();
    });

    it('follows the list: appears, updates its count and disappears at 0', async () => {
        mountCounter();
        await settle();
        expect(query('outlook-out-of-sync')).toBeNull();

        outOfSync.value = TWO;
        await settle();
        expect(el('outlook-out-of-sync').getAttribute('data-count')).toBe('2');

        outOfSync.value = [TWO[0]!];
        await settle();
        expect(el('outlook-out-of-sync').getAttribute('data-count')).toBe('1');

        outOfSync.value = [];
        await settle();
        expect(query('outlook-out-of-sync')).toBeNull();
    });

    it('jumps to the first flagged entry on click', async () => {
        outOfSync.value = TWO;
        mountCounter();
        await settle();

        el('outlook-out-of-sync').click();
        await settle();

        expect(jumpToFirst).toHaveBeenCalledTimes(1);
    });

    it('is aria-busy while the jump runs and ignores further clicks', async () => {
        outOfSync.value = TWO;
        const pending = deferred();
        gate = pending.promise;
        mountCounter();
        await settle();

        const button = el('outlook-out-of-sync');
        button.click();
        await settle();
        expect(button.getAttribute('aria-busy')).toBe('true');

        button.click();
        button.click();
        await settle();
        expect(jumpToFirst).toHaveBeenCalledTimes(1);

        pending.resolve();
        await settle();
        expect(el('outlook-out-of-sync').getAttribute('aria-busy')).toBe('false');

        el('outlook-out-of-sync').click();
        await settle();
        expect(jumpToFirst).toHaveBeenCalledTimes(2);
    });

    it('ignores clicks while the context reports a jump in progress', async () => {
        outOfSync.value = TWO;
        jumpBusy.value = true;
        mountCounter();
        await settle();

        const button = el('outlook-out-of-sync');
        expect(button.getAttribute('aria-busy')).toBe('true');
        button.click();
        await settle();
        expect(jumpToFirst).not.toHaveBeenCalled();
    });
});
