import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import OutlookGhostLayer from './OutlookGhostLayer.vue';
import { OUTLOOK_MEETINGS_KEY, type OutlookMeetingsContext } from './useOutlookMeetings';
import { resetHoverCardDelay } from './hoverCardDelay';
import type { CalendarSettings } from '@/packages/ui/src/FullCalendar/calendarSettings';
import type { OutlookCalendarLabels, OutlookMeeting } from '@/m365/types';

const DAY = '2026-10-20';

const labels = {
    no_subject: '(No subject)',
    ghost_label: ':subject, :start to :end, Outlook meeting suggestion',
    layer_label: 'Outlook meetings, :weekday :date',
    eyebrow: 'Outlook meeting',
    eyebrow_dismissed: 'Outlook meeting · Dismissed',
    organized_by: 'Organized by :name',
    you_organize: 'You are the organizer',
    online: 'Online meeting',
    open_in_outlook: 'Open in Outlook',
    opens_new_tab: '(opens in a new tab)',
    dismiss: 'Dismiss meeting',
    restore: 'Restore meeting',
    dismissed_suffix: ', dismissed',
    hover_hint: 'Click for details',
} as OutlookCalendarLabels;

const settings: CalendarSettings = { snapMinutes: 15, startHour: 0, endHour: 24, slotMinutes: 15 };
const minutesToPixels = (minutes: number) => minutes;

function meeting(overrides: Partial<OutlookMeeting> = {}): OutlookMeeting {
    return {
        id: 'm-1',
        subject: 'Sprint planning',
        start: '2026-10-20T08:00:00Z',
        end: '2026-10-20T09:00:00Z',
        organizer_name: 'Test Organizer',
        is_organizer: false,
        is_online_meeting: false,
        web_link: null,
        dismissed: false,
        ...overrides,
    };
}

let wrapper: VueWrapper | null = null;

function mountLayer(meetings: OutlookMeeting[]) {
    const context = {
        canAct: { value: true },
        includeDismissed: { value: false },
        dismiss: vi.fn(),
        restore: vi.fn(),
    } as unknown as OutlookMeetingsContext;
    wrapper = mount(OutlookGhostLayer, {
        attachTo: document.body,
        props: { meetings, labels, dayStr: DAY, isDayView: false, minutesToPixels, settings },
        global: {
            provide: {
                [OUTLOOK_MEETINGS_KEY as symbol]: context,
                organization: computed(() => ({ time_format: '24-hours' })),
            },
        },
    });
    return wrapper;
}

function block(id = 'm-1'): HTMLElement {
    const el = document.body.querySelector<HTMLElement>(`[data-ghost-id="${id}"]`);
    expect(el).not.toBeNull();
    return el as HTMLElement;
}

function card(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>('[data-testid="outlook-hover-card"]');
}

function pointer(el: Element, type: string, pointerType: string, init: PointerEventInit = {}) {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType, ...init }));
}

// Leaving a block: reka closes an open card once the pointer moves outside the grace area (whose
// pointermove tracking is attached on the next tick)
async function leave(el: Element) {
    pointer(el, 'pointerleave', 'mouse', { clientX: 0, clientY: 0 });
    await nextTick();
    pointer(document.body, 'pointermove', 'mouse', { clientX: 900, clientY: 900 });
}

async function advance(ms: number) {
    await vi.advanceTimersByTimeAsync(ms);
    await nextTick();
}

beforeEach(() => {
    vi.useFakeTimers();
    resetHoverCardDelay();
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
    resetHoverCardDelay();
    vi.useRealTimers();
});

describe('Outlook meeting hover card', () => {
    it('opens after 400 ms of mouse hover', async () => {
        mountLayer([meeting({ is_online_meeting: true })]);

        pointer(block(), 'pointerenter', 'mouse');
        await advance(399);
        expect(card()).toBeNull();

        await advance(1);
        const el = card();
        expect(el).not.toBeNull();
        const text = el?.textContent ?? '';
        expect(text).toContain('Outlook meeting');
        expect(text).not.toContain('Dismissed');
        expect(text).toContain('Sprint planning');
        expect(el?.querySelector('[data-testid="outlook-hover-time"]')?.textContent).toMatch(
            /Oct 20 · \d\d:\d\d – \d\d:\d\d · /
        );
        expect(
            el?.querySelector('[data-testid="outlook-hover-organizer"]')?.textContent?.trim()
        ).toBe('Organized by Test Organizer');
        expect(el?.querySelector('[data-testid="outlook-hover-online"]')?.textContent?.trim()).toBe(
            'Online meeting'
        );
        expect(text).toContain('Click for details');
        // Supplemental surface: no dialog role, panel test ids untouched
        expect(el?.getAttribute('role')).toBeNull();
        expect(el?.querySelector('[data-testid^="outlook-detail-"]')).toBeNull();
    });

    it('closes 120 ms after the pointer leaves', async () => {
        mountLayer([meeting()]);
        pointer(block(), 'pointerenter', 'mouse');
        await advance(400);
        expect(card()).not.toBeNull();

        await leave(block());
        await advance(119);
        expect(card()).not.toBeNull();

        await advance(1);
        expect(card()).toBeNull();
    });

    it('stays open while the pointer is over the card itself', async () => {
        mountLayer([meeting()]);
        pointer(block(), 'pointerenter', 'mouse');
        await advance(400);

        pointer(block(), 'pointerleave', 'mouse', { clientX: 0, clientY: 0 });
        await nextTick();
        pointer(card() as HTMLElement, 'pointermove', 'mouse', { clientX: 900, clientY: 900 });
        pointer(card() as HTMLElement, 'pointerenter', 'mouse');
        await advance(1000);

        expect(card()).not.toBeNull();
    });

    it('reopens instantly on the next meeting within 300 ms', async () => {
        mountLayer([
            meeting({ id: 'a', subject: 'First' }),
            meeting({
                id: 'b',
                subject: 'Second',
                start: '2026-10-20T10:00:00Z',
                end: '2026-10-20T11:00:00Z',
            }),
        ]);

        pointer(block('a'), 'pointerenter', 'mouse');
        await advance(400);
        expect(card()?.textContent).toContain('First');

        await leave(block('a'));
        await advance(120);
        expect(card()).toBeNull();

        await advance(100);
        pointer(block('b'), 'pointerenter', 'mouse');
        await advance(0);
        expect(card()?.textContent).toContain('Second');

        // After 300 ms without any card the next open needs the full delay again
        await leave(block('b'));
        await advance(120);
        expect(card()).toBeNull();
        await advance(300);

        pointer(block('a'), 'pointerenter', 'mouse');
        await advance(399);
        expect(card()).toBeNull();
        await advance(1);
        expect(card()?.textContent).toContain('First');
    });

    it('never opens for touch pointers', async () => {
        mountLayer([meeting()]);

        pointer(block(), 'pointerenter', 'touch');
        await advance(1000);

        expect(card()).toBeNull();
    });

    it('opens for a pen resting on the meeting', async () => {
        mountLayer([meeting()]);

        pointer(block(), 'pointerenter', 'pen');
        await advance(400);

        expect(card()).not.toBeNull();
    });

    it('does not open on keyboard focus', async () => {
        mountLayer([meeting()]);

        block().focus();
        expect(document.activeElement).toBe(block());
        await advance(1000);

        expect(card()).toBeNull();
    });

    it('a click closes the card and opens the panel', async () => {
        mountLayer([meeting()]);
        pointer(block(), 'pointerenter', 'mouse');
        await advance(400);
        expect(card()).not.toBeNull();

        block().click();
        await advance(50);

        expect(card()).toBeNull();
        expect(document.body.querySelector('[data-testid="outlook-ghost-detail"]')).not.toBeNull();

        // The focus that follows the click does not bring the card back next to the panel
        block().focus();
        await advance(1000);
        expect(card()).toBeNull();
    });

    it('renders meeting text as text', async () => {
        const html = '<img src=x onerror="alert(1)"><b>bold</b>';
        mountLayer([meeting({ subject: html, organizer_name: '<i>evil</i>' })]);
        pointer(block(), 'pointerenter', 'mouse');
        await advance(400);

        const el = card() as HTMLElement;
        expect(el.textContent).toContain(html);
        expect(el.textContent).toContain('Organized by <i>evil</i>');
        expect(el.querySelector('img')).toBeNull();
        expect(el.querySelector('b')).toBeNull();
        expect(el.querySelector('i')).toBeNull();
    });

    it('shows the dismissed eyebrow', async () => {
        mountLayer([meeting({ dismissed: true })]);
        pointer(block(), 'pointerenter', 'mouse');
        await advance(400);

        expect(card()?.textContent).toContain('Outlook meeting · Dismissed');
    });
});
