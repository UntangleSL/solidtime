import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, createSSRApp, h, ref, type Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { renderToString } from 'vue/server-renderer';
import type { Dayjs } from 'dayjs';
import CalendarDayColumn from '@/packages/ui/src/FullCalendar/CalendarDayColumn.vue';
import { useSlotSelection } from '@/packages/ui/src/FullCalendar/useSlotSelection';
import type { CalendarSettings } from '@/packages/ui/src/FullCalendar/calendarSettings';
import OutlookGhostLayer from './OutlookGhostLayer.vue';
import { ghostLaneWidth } from './ghostLayout';
import type { OutlookCalendarLabels, OutlookMeeting } from '@/m365/types';

const DAY = '2026-10-20';
const LANE = 'max(16px, 30%)';

const labels = {
    no_subject: '(No subject)',
    ghost_label: ':subject, :start to :end, Outlook meeting suggestion',
    layer_label: 'Outlook meetings, :weekday :date',
} as OutlookCalendarLabels;

const settings: CalendarSettings = { snapMinutes: 15, startHour: 0, endHour: 24, slotMinutes: 15 };
const minutesToPixels = (minutes: number) => minutes;

function meeting(overrides: Partial<OutlookMeeting> = {}): OutlookMeeting {
    return {
        id: 'm-1',
        subject: 'Sprint planning',
        start: '2026-10-20T08:00:00Z',
        end: '2026-10-20T09:00:00Z',
        organizer_name: 'Ada Lovelace',
        is_organizer: false,
        is_online_meeting: false,
        web_link: null,
        dismissed: false,
        ...overrides,
    };
}

const columnProps = {
    dayStr: DAY,
    totalGridHeight: 1440,
    hasActivityStatus: false,
    dayEvents: [],
    getEventStyle: () => ({}),
    getEventOpacityClass: () => '',
    getEventDurationSeconds: () => 0,
    isDragging: false,
    dragEventId: null,
    dragPreview: undefined,
    resizeEventId: null,
    resizeCrossDayPreview: undefined,
    showNowIndicator: false,
    nowIndicatorTop: 0,
    activityBoxes: [],
    getActivityBoxLabel: () => '',
    getActivityBoxActivities: () => [],
    getActivityPercentage: () => '0',
    getActivityText: () => '',
    getTopActivity: () => null,
    isDayView: false,
    showSelection: false,
    isSelectionStart: false,
    isSelectionIntermediate: false,
    isSelectionEnd: false,
    selectionTop: 0,
    selectionHeight: 0,
    selectionEndTop: 0,
    selectionEndHeight: 0,
};

function pointerDown(el: Element, init: PointerEventInit = {}) {
    el.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, ...init })
    );
}

// The day column with the ghost layer in its overlay slot, as TimeEntryCalendar forwards it.
function columnVNode(meetings: OutlookMeeting[], lane: string | null) {
    return h(
        CalendarDayColumn,
        { ...columnProps, overlayLaneWidth: lane },
        {
            overlay: (slot: { overlayLaneWidth: string | null }) =>
                h(OutlookGhostLayer, {
                    meetings,
                    labels,
                    dayStr: DAY,
                    isDayView: false,
                    minutesToPixels,
                    settings,
                    overlayLaneWidth: slot.overlayLaneWidth,
                }),
        }
    );
}

// happy-dom drops style values with nested CSS functions (calc(max(...))), so inline style
// values are asserted on the server-rendered markup, where they are emitted verbatim.
async function renderHtml(meetings: OutlookMeeting[], lane: string | null): Promise<string> {
    return renderToString(createSSRApp({ render: () => columnVNode(meetings, lane) }));
}

// Mirrors how TimeEntryCalendar wires the core pieces: the grid wrapper owns the slot selection
// pointerdown, the day column renders the ghost layer through its overlay slot.
function mountHarness(
    meetings: OutlookMeeting[],
    options: { overlayLaneWidth?: string | null } = {}
) {
    const selection: { isSelecting: Ref<boolean> | null } = { isSelecting: null };
    const lane = options.overlayLaneWidth === undefined ? LANE : options.overlayLaneWidth;

    const Harness = {
        setup() {
            const calendarSettings = ref(settings);
            const viewDays = computed<Dayjs[]>(() => []);
            const totalGridHeight = computed(() => 1440);
            const { isSelecting, onSlotPointerDown } = useSlotSelection({
                calendarSettings,
                viewDays,
                totalGridHeight,
                pixelsToMinutesFromMidnight: (px: number) => px,
                getDayFromClientX: () => DAY,
                clientYToGridPixels: () => 0,
                onSelectionComplete: () => undefined,
            });
            selection.isSelecting = isSelecting;
            return () =>
                h('div', { 'data-testid': 'grid', onPointerdown: onSlotPointerDown }, [
                    columnVNode(meetings, lane),
                ]);
        },
    };

    const wrapper = mount(Harness, {
        global: { provide: { organization: computed(() => ({ time_format: '24-hours' })) } },
        attachTo: document.body,
    });
    return { wrapper, selection };
}

describe('OutlookGhostLayer in a day column', () => {
    let wrapper: VueWrapper | null = null;

    beforeEach(() => {
        vi.mocked(window.getTimezoneSetting).mockReturnValue('Europe/Madrid');
    });

    afterEach(() => {
        wrapper?.unmount();
        wrapper = null;
        vi.mocked(window.getTimezoneSetting).mockReturnValue('UTC');
    });

    it('pointerdown on a ghost starts no selection', () => {
        const mounted = mountHarness([meeting()]);
        wrapper = mounted.wrapper;

        const ghost = wrapper.find('[data-calendar-overlay]');
        expect(ghost.exists()).toBe(true);
        pointerDown(ghost.element);
        expect(mounted.selection.isSelecting?.value).toBe(false);

        // Control: the same pointerdown on the empty column area starts a selection
        pointerDown(wrapper.find('.fc-timegrid-col').element);
        expect(mounted.selection.isSelecting?.value).toBe(true);
    });

    it('ghost DOM carries no time-entry hooks', () => {
        const mounted = mountHarness([meeting()]);
        wrapper = mounted.wrapper;

        const ghost = wrapper.find('[data-calendar-overlay]');
        expect(ghost.attributes('role')).toBe('button');
        expect(ghost.attributes('tabindex')).toBe('0');
        expect(ghost.classes()).toContain('m365-ghost');
        for (const cls of ['fc-event', 'fc-timegrid-col', 'fc-event-resizer', 'touch-none']) {
            expect(ghost.classes()).not.toContain(cls);
        }
        expect(ghost.attributes('data-event-id')).toBeUndefined();
        expect(ghost.find('.fc-event-resizer').exists()).toBe(false);
        expect(ghost.element.closest('.fc-event')).toBeNull();
        expect(ghost.element.querySelector('[data-event-id]')).toBeNull();
    });

    it('days with ghosts inset the events container by the Outlook lane', async () => {
        const html = await renderHtml([meeting()], LANE);

        // Events container: inline right = lane + 4px (only on days with a lane)
        expect(html).toMatch(
            /class="absolute inset-y-0 left-0\.5 right-0\.5[^"]*" style="right:calc\(max\(16px, 30%\) \+ 4px\);?"/
        );
        // Ghost layer: flush with the 2px right edge, width = lane
        expect(html).toMatch(
            /role="group"[^>]*class="absolute inset-y-0 right-0\.5 pointer-events-none"[^>]*style="width:max\(16px, 30%\);?"/
        );

        const mounted = mountHarness([meeting()]);
        wrapper = mounted.wrapper;
        const layer = wrapper.find('[role="group"]');
        expect(layer.classes()).toContain('right-0.5');
        expect(layer.classes()).toContain('pointer-events-none');
        expect(layer.attributes('aria-label')).toBe('Outlook meetings, Tuesday 20 Oct');
    });

    it('a day without a lane renders the events container exactly as upstream', async () => {
        const html = await renderHtml([], null);

        expect(html).toContain('class="absolute inset-y-0 left-0.5 right-0.5"');
        expect(html).not.toContain('calc(');
        expect(html).not.toContain('role="group"');
    });

    it('renders meeting text as text', () => {
        const mounted = mountHarness([meeting({ subject: '<b>x</b>' })]);
        wrapper = mounted.wrapper;

        const ghost = wrapper.find('[data-calendar-overlay]');
        expect(ghost.text()).toBe('<b>x</b>');
        expect(ghost.find('b').exists()).toBe(false);
    });

    it('reads the aria-label from the labels with local times and shows (No subject)', () => {
        const mounted = mountHarness([meeting({ subject: '' })]);
        wrapper = mounted.wrapper;

        const ghost = wrapper.find('[data-calendar-overlay]');
        expect(ghost.attributes('aria-label')).toBe(
            '(No subject), 10:00 to 11:00, Outlook meeting suggestion'
        );
        expect(ghost.text()).toContain('(No subject)');
    });

    it('uses the lane width helper for both views', () => {
        expect(ghostLaneWidth(false)).toBe('max(16px, 30%)');
        expect(ghostLaneWidth(true)).toBe('min(240px, 25%)');
    });
});
