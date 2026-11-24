import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import OutlookSyncFlagMarker from './OutlookSyncFlagMarker.vue';
import { OUTLOOK_MEETINGS_KEY, type OutlookMeetingsContext } from './useOutlookMeetings';
import type { OutlookCalendarLabels, OutlookOutOfSyncItem } from '@/m365/types';

const labels = {
    osync_reason_moved: 'Meeting moved in Outlook: :from → :to',
    osync_reason_cancelled: 'Meeting cancelled in Outlook',
    osync_reason_removed: 'Meeting removed from Outlook',
    osync_title_moved: 'Meeting moved in Outlook',
    osync_click_hint: 'Click to review',
    osync_described: 'Out of sync with Outlook. :reason.',
} as OutlookCalendarLabels;

function flag(overrides: Partial<OutlookOutOfSyncItem> = {}): OutlookOutOfSyncItem {
    return {
        time_entry_id: 'te-1',
        kind: 'moved',
        // Tue Nov 24 and Wed Nov 25 2026 (same week, UTC in tests).
        meeting_start: '2026-11-24T10:00:00Z',
        meeting_end: '2026-11-24T11:00:00Z',
        new_start: '2026-11-25T12:00:00Z',
        new_end: '2026-11-25T13:00:00Z',
        all_day: false,
        entry_start: '2026-11-24T10:00:00Z',
        entry_end: '2026-11-24T11:00:00Z',
        description: 'Weekly sync',
        ...overrides,
    };
}

interface FakeOptions {
    canAct?: boolean;
}

function fakeContext(flags: OutlookOutOfSyncItem[], options: FakeOptions = {}) {
    const list = ref(flags);
    const canAct = ref(options.canAct ?? true);
    const openFlagPanel = vi.fn();
    const context = {
        labels: ref(labels),
        canAct,
        flagOf: (id: string) => list.value.find((item) => item.time_entry_id === id) ?? null,
        openFlagPanel,
    } as unknown as OutlookMeetingsContext;
    return { context, list, canAct, openFlagPanel };
}

// A core entry block like CalendarDayColumn renders it: role="button", aria-label, data-event-id,
// with a pointerdown (drag) and click (edit modal) listener of its own.
function renderBlock(id = 'te-1') {
    const block = document.createElement('div');
    block.setAttribute('data-event-id', id);
    block.setAttribute('role', 'button');
    block.setAttribute('tabindex', '0');
    block.setAttribute('aria-label', 'Weekly sync');
    const onPointerDown = vi.fn();
    const onClick = vi.fn();
    block.addEventListener('pointerdown', onPointerDown);
    block.addEventListener('click', onClick);
    const slot = document.createElement('div');
    block.appendChild(slot);
    document.body.appendChild(block);
    return { block, slot, onPointerDown, onClick };
}

let wrapper: VueWrapper | null = null;

function mountMarker(
    timeEntryId: string,
    context: OutlookMeetingsContext | null,
    attachTo: HTMLElement,
    timeFormat: '24-hours' | '12-hours' = '24-hours'
) {
    const provide: Record<string | symbol, unknown> = {
        organization: computed(() => ({ time_format: timeFormat })),
    };
    if (context) provide[OUTLOOK_MEETINGS_KEY as symbol] = context;
    wrapper = mount(OutlookSyncFlagMarker, {
        props: { timeEntryId },
        attachTo,
        global: { provide },
    });
    return wrapper;
}

function marker(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>('[data-testid="outlook-sync-flag-marker"]');
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

describe('OutlookSyncFlagMarker', () => {
    it('marks a moved entry with a 12px amber TriangleAlert and a two-line reason title', () => {
        const { block, slot } = renderBlock();
        const { context } = fakeContext([flag()]);
        mountMarker('te-1', context, slot);

        const el = marker();
        expect(el).not.toBeNull();
        expect(block.contains(el)).toBe(true);
        expect(el?.dataset.flagKind).toBe('moved');
        expect(el?.getAttribute('title')).toBe(
            'Meeting moved in Outlook: Tue 10:00 – 11:00 → Wed 12:00 – 13:00\nClick to review'
        );
        // Not focusable and without a role (a button inside the block's role="button" is invalid).
        expect(el?.hasAttribute('tabindex')).toBe(false);
        expect(el?.hasAttribute('role')).toBe(false);
        expect(el?.tagName).toBe('SPAN');
        expect(el?.className).toContain('cursor-pointer');

        const icon = el?.querySelector('svg');
        expect(icon?.getAttribute('class')).toContain('lucide-triangle-alert');
        const iconClasses = icon?.getAttribute('class') ?? '';
        for (const cls of [
            'size-3',
            'shrink-0',
            'text-amber-700',
            'fill-amber-100',
            'dark:text-amber-300',
            'dark:fill-amber-950',
        ]) {
            expect(iconClasses).toContain(cls);
        }
        expect(icon?.getAttribute('aria-hidden')).toBe('true');
    });

    it('follows the organization 12-hour format', () => {
        const { slot } = renderBlock();
        const { context } = fakeContext([flag()]);
        mountMarker('te-1', context, slot, '12-hours');

        expect(marker()?.getAttribute('title')).toBe(
            'Meeting moved in Outlook: Tue 10:00 AM – 11:00 AM → Wed 12:00 PM – 01:00 PM\nClick to review'
        );
    });

    it('names a cancelled or removed meeting', async () => {
        const { slot } = renderBlock();
        const { context, list } = fakeContext([
            flag({ kind: 'cancelled', new_start: null, new_end: null }),
        ]);
        mountMarker('te-1', context, slot);

        expect(marker()?.dataset.flagKind).toBe('cancelled');
        expect(marker()?.getAttribute('title')).toBe(
            'Meeting cancelled in Outlook\nClick to review'
        );

        list.value = [flag({ kind: 'removed', new_start: null, new_end: null })];
        await nextTick();
        expect(marker()?.dataset.flagKind).toBe('removed');
        expect(marker()?.getAttribute('title')).toBe(
            'Meeting removed from Outlook\nClick to review'
        );
    });

    it('describes the flag on the block through aria-describedby and removes it on unmount', async () => {
        const { block, slot } = renderBlock();
        block.setAttribute('aria-describedby', 'origin-1');
        const origin = document.createElement('span');
        origin.id = 'origin-1';
        origin.hidden = true;
        origin.textContent = 'Created from an Outlook meeting.';
        document.body.appendChild(origin);

        const { context } = fakeContext([
            flag({ kind: 'cancelled', new_start: null, new_end: null }),
        ]);
        mountMarker('te-1', context, slot);
        await nextTick();

        const ids = (block.getAttribute('aria-describedby') ?? '').split(' ');
        expect(ids).toHaveLength(2);
        expect(ids[0]).toBe('origin-1');
        const description = document.getElementById(ids[1]!);
        expect(description).not.toBeNull();
        expect(description?.hidden).toBe(true);
        expect(description?.textContent).toBe(
            'Out of sync with Outlook. Meeting cancelled in Outlook.'
        );
        expect(describedText(block)).toBe(
            'Created from an Outlook meeting. Out of sync with Outlook. Meeting cancelled in Outlook.'
        );

        wrapper?.unmount();
        wrapper = null;
        expect(block.getAttribute('aria-describedby')).toBe('origin-1');
    });

    it('describes a moved flag with both ranges', async () => {
        const { block, slot } = renderBlock();
        const { context } = fakeContext([flag()]);
        mountMarker('te-1', context, slot);
        await nextTick();

        expect(describedText(block)).toBe(
            'Out of sync with Outlook. Meeting moved in Outlook: Tue 10:00 – 11:00 → Wed 12:00 – 13:00.'
        );
    });

    it('drops the description when the flag is resolved', async () => {
        const { block, slot } = renderBlock();
        const { context, list } = fakeContext([flag()]);
        mountMarker('te-1', context, slot);
        await nextTick();
        expect(block.hasAttribute('aria-describedby')).toBe(true);

        list.value = [];
        await nextTick();
        await nextTick();
        expect(marker()).toBeNull();
        expect(block.hasAttribute('aria-describedby')).toBe(false);
    });

    it('stops pointerdown and click at the marker and asks for the review popover', async () => {
        const { slot, onPointerDown, onClick } = renderBlock();
        const { context, openFlagPanel } = fakeContext([flag()]);
        mountMarker('te-1', context, slot);

        const el = marker()!;
        el.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await nextTick();

        expect(onPointerDown).not.toHaveBeenCalled();
        expect(onClick).not.toHaveBeenCalled();
        expect(openFlagPanel).toHaveBeenCalledTimes(1);
        expect(openFlagPanel).toHaveBeenCalledWith('te-1', { anchor: 'entry', origin: 'entry' });
    });

    it('leaves the rest of the block to core', () => {
        const { block, slot, onPointerDown, onClick } = renderBlock();
        const { context, openFlagPanel } = fakeContext([flag()]);
        mountMarker('te-1', context, slot);

        block.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        block.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(onPointerDown).toHaveBeenCalledTimes(1);
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(openFlagPanel).not.toHaveBeenCalled();
    });

    it('never sets aria-busy on the block', async () => {
        const { block, slot } = renderBlock();
        const { context } = fakeContext([flag()]);
        mountMarker('te-1', context, slot);
        marker()?.click();
        await nextTick();

        expect(block.hasAttribute('aria-busy')).toBe(false);
        expect(marker()?.hasAttribute('aria-busy')).toBe(false);
    });

    it('renders nothing for an unflagged entry', () => {
        const { block, slot } = renderBlock('te-2');
        const { context } = fakeContext([flag()]);
        mountMarker('te-2', context, slot);

        expect(marker()).toBeNull();
        expect(block.hasAttribute('aria-describedby')).toBe(false);
    });

    it('renders nothing without a context', () => {
        const { block, slot } = renderBlock();
        mountMarker('te-1', null, slot);

        expect(marker()).toBeNull();
        expect(block.hasAttribute('aria-describedby')).toBe(false);
    });

    it('renders nothing while the context cannot act', async () => {
        const { block, slot } = renderBlock();
        const { context, canAct } = fakeContext([flag()], { canAct: false });
        mountMarker('te-1', context, slot);
        expect(marker()).toBeNull();
        expect(block.hasAttribute('aria-describedby')).toBe(false);

        canAct.value = true;
        await nextTick();
        await nextTick();
        expect(marker()).not.toBeNull();
        expect(block.hasAttribute('aria-describedby')).toBe(true);
    });

    it('renders the reason as text only', () => {
        const { slot } = renderBlock();
        const { context } = fakeContext([
            flag({ kind: 'cancelled', new_start: null, new_end: null }),
        ]);
        (context.labels as unknown as { value: OutlookCalendarLabels }).value = {
            ...labels,
            osync_reason_cancelled: '<img src=x onerror=alert(1)>',
        };
        mountMarker('te-1', context, slot);

        expect(marker()?.querySelector('img')).toBeNull();
        expect(marker()?.getAttribute('title')).toContain('<img src=x onerror=alert(1)>');
    });
});
