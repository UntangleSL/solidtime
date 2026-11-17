import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { HoverCardRoot, HoverCardTrigger } from 'reka-ui';
import OutlookGhostLayer from './OutlookGhostLayer.vue';
import OutlookMeetingHoverCard from './OutlookMeetingHoverCard.vue';
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
    hover_hint_select: 'Click for details. Ctrl+click to select several.',
    hover_hint_select_mac: 'Click for details. ⌘+click to select several.',
    create_entry: 'Create time entry',
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

// The card on its own, open, inside a HoverCardRoot as the lane supplies it.
describe('Outlook meeting hover card actions', () => {
    let standalone: VueWrapper | null = null;
    const platform = Object.getOwnPropertyDescriptor(navigator, 'platform');

    function setPlatform(value: string): void {
        Object.defineProperty(navigator, 'platform', { value, configurable: true });
    }

    function mountCard(
        context: Partial<OutlookMeetingsContext> | null,
        slots: { actions?: () => unknown } = {}
    ) {
        const Host = defineComponent({
            setup() {
                return () =>
                    h(
                        HoverCardRoot,
                        { open: true },
                        {
                            default: () => [
                                h(
                                    HoverCardTrigger,
                                    { asChild: true },
                                    {
                                        default: () =>
                                            h('div', { 'data-testid': 'trigger' }, 'meeting'),
                                    }
                                ),
                                h(
                                    OutlookMeetingHoverCard,
                                    { meeting: meeting(), labels },
                                    slots.actions ? { actions: slots.actions } : {}
                                ),
                            ],
                        }
                    );
            },
        });
        standalone = mount(Host, {
            attachTo: document.body,
            global: {
                provide: {
                    ...(context ? { [OUTLOOK_MEETINGS_KEY as symbol]: context } : {}),
                    organization: computed(() => ({ time_format: '24-hours' })),
                },
            },
        });
        return standalone;
    }

    function hint(): string {
        return (
            document.body
                .querySelector('[data-testid="outlook-hover-hint"]')
                ?.textContent?.trim() ?? ''
        );
    }

    function createButton(): HTMLButtonElement | null {
        return document.body.querySelector<HTMLButtonElement>(
            '[data-testid="outlook-hover-create"]'
        );
    }

    function actingContext() {
        const openForm = vi.fn();
        return {
            context: { canAct: { value: true }, openForm } as unknown as OutlookMeetingsContext,
            openForm,
        };
    }

    beforeEach(() => {
        setPlatform('Win32');
    });

    afterEach(() => {
        standalone?.unmount();
        standalone = null;
        if (platform) Object.defineProperty(navigator, 'platform', platform);
        else delete (navigator as unknown as Record<string, unknown>).platform;
    });

    it('with canAct shows the select hint and a "Create time entry" button', async () => {
        mountCard(actingContext().context);
        await nextTick();

        expect(card()).not.toBeNull();
        expect(hint()).toBe('Click for details. Ctrl+click to select several.');
        const button = createButton();
        expect(button?.textContent?.trim()).toBe('Create time entry');
        expect(button?.getAttribute('type')).toBe('button');
    });

    it('names the Cmd key on macOS', async () => {
        setPlatform('MacIntel');
        mountCard(actingContext().context);
        await nextTick();

        expect(hint()).toBe('Click for details. ⌘+click to select several.');
    });

    it("the button asks the context for the meeting's form once", async () => {
        const { context, openForm } = actingContext();
        mountCard(context);
        await nextTick();

        createButton()?.click();
        await nextTick();

        expect(openForm).toHaveBeenCalledTimes(1);
        expect(openForm).toHaveBeenCalledWith('m-1');
        // The card never hosts the form itself (D-17)
        expect(card()?.querySelector('input')).toBeNull();
    });

    it('without canAct keeps the plain hint and offers no button', async () => {
        mountCard({ canAct: { value: false } } as unknown as OutlookMeetingsContext);
        await nextTick();

        expect(hint()).toBe('Click for details');
        expect(createButton()).toBeNull();
    });

    it('without a provided context keeps the plain hint and offers no button', async () => {
        mountCard(null);
        await nextTick();

        expect(hint()).toBe('Click for details');
        expect(createButton()).toBeNull();
    });

    it("still renders the caller's actions slot beside the button", async () => {
        mountCard(actingContext().context, {
            actions: () => h('button', { 'data-testid': 'extra-action' }, 'Extra'),
        });
        await nextTick();

        const row = createButton()?.parentElement;
        expect(row?.querySelector('[data-testid="extra-action"]')).not.toBeNull();
    });

    it('renders the slot row without canAct when the caller fills it', async () => {
        mountCard(null, {
            actions: () => h('button', { 'data-testid': 'extra-action' }, 'Extra'),
        });
        await nextTick();

        expect(document.body.querySelector('[data-testid="extra-action"]')).not.toBeNull();
        expect(createButton()).toBeNull();
    });
});
