import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, createSSRApp, defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { renderToString } from 'vue/server-renderer';
import type { Dayjs } from 'dayjs';
import CalendarDayColumn from '@/packages/ui/src/FullCalendar/CalendarDayColumn.vue';
import { useSlotSelection } from '@/packages/ui/src/FullCalendar/useSlotSelection';
import type { CalendarSettings } from '@/packages/ui/src/FullCalendar/calendarSettings';
import OutlookGhostLayer from './OutlookGhostLayer.vue';
import { OUTLOOK_MEETINGS_KEY, type OutlookMeetingsContext } from './useOutlookMeetings';
import { ghostLaneWidth } from './ghostLayout';
import { useCalendarEvents } from '@/packages/ui/src/FullCalendar/useCalendarEvents';
import type { DayEvent } from '@/packages/ui/src/FullCalendar/calendarTypes';
import type { TimeEntry } from '@/packages/api/src';
import { getLocalizedDayJs, getLocalizedDayJsFromMinutes } from '@/packages/ui/src/utils/time';
import type { OutlookCalendarLabels, OutlookMeeting } from '@/m365/types';

const DAY = '2026-10-20';
const LANE = 'max(16px, 30%)';

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
function columnVNode(
    meetings: OutlookMeeting[],
    lane: string | null,
    extra: Record<string, unknown> = {}
) {
    return h(
        CalendarDayColumn,
        { ...columnProps, overlayLaneWidth: lane, ...extra },
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
async function renderHtml(
    meetings: OutlookMeeting[],
    lane: string | null,
    extra: Record<string, unknown> = {}
): Promise<string> {
    return renderToString(createSSRApp({ render: () => columnVNode(meetings, lane, extra) }));
}

// Mirrors how TimeEntryCalendar wires the core pieces: the grid wrapper owns the slot selection
// pointerdown, the day column renders the ghost layer through its overlay slot.
function mountHarness(
    meetings: OutlookMeeting[],
    options: { overlayLaneWidth?: string | null; extra?: Record<string, unknown> } = {}
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
                    columnVNode(meetings, lane, options.extra),
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
        expect(ghost.text()).toContain('<b>x</b>');
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

function timeEntryEvent(): DayEvent {
    return {
        event: {
            id: 'entry-1',
            timeEntry: {} as TimeEntry,
            isRunning: false,
            isBreak: false,
            isMisplacedBreak: false,
            durationMinutes: 60,
            title: 'Logged work',
            backgroundColor: '#dbeafe',
            borderColor: '#93c5fd',
            dayStart: getLocalizedDayJs('2026-10-20T08:00:00Z'),
            dayEnd: getLocalizedDayJs('2026-10-20T09:00:00Z'),
        },
        top: 600,
        height: 60,
        left: '0%',
        width: '100%',
        isClippedStart: false,
        isClippedEnd: false,
    };
}

describe('D-01 reachability: a meeting beside a logged entry', () => {
    let wrapper: VueWrapper | null = null;

    beforeEach(() => {
        vi.mocked(window.getTimezoneSetting).mockReturnValue('Europe/Madrid');
    });

    afterEach(() => {
        wrapper?.unmount();
        wrapper = null;
        vi.mocked(window.getTimezoneSetting).mockReturnValue('UTC');
    });

    const entryColumnProps = () => ({
        dayEvents: [timeEntryEvent()],
        getEventStyle: () => ({ top: '600px', height: '60px' }),
    });

    it('a ghost exactly overlapping an entry stays rendered and clickable beside it', async () => {
        const onEventPointerdown = vi.fn();
        const onResizerPointerdown = vi.fn();
        const lane = ghostLaneWidth(false);
        // 10:00 to 11:00 local, exactly the entry's time
        const sameTime = meeting();

        const mounted = mountHarness([sameTime], {
            overlayLaneWidth: lane,
            extra: { ...entryColumnProps(), onEventPointerdown, onResizerPointerdown },
        });
        wrapper = mounted.wrapper;

        // The ghost is rendered with the entry's top and height
        const ghost = wrapper.find('[data-calendar-overlay]');
        const entry = wrapper.find('.fc-event');
        expect(ghost.exists()).toBe(true);
        expect((ghost.element as HTMLElement).style.top).toBe('600px');
        expect((ghost.element as HTMLElement).style.height).toBe('60px');
        expect((entry.element as HTMLElement).style.top).toBe('600px');
        expect((entry.element as HTMLElement).style.height).toBe('60px');

        // ...and the two never share horizontal space: events container right = lane + 4px,
        // ghost layer flush right with width = lane (disjoint)
        const html = await renderHtml([sameTime], lane, entryColumnProps());
        expect(html).toContain('style="right:calc(max(16px, 30%) + 4px);"');
        expect(html).toMatch(
            /class="absolute inset-y-0 right-0\.5 pointer-events-none"[^>]*style="width:max\(16px, 30%\);?"/
        );
        expect(wrapper.find('[role="group"]').classes()).toContain('right-0.5');

        // Clicking the ghost neither reaches the entry nor starts a selection
        pointerDown(ghost.element);
        expect(onEventPointerdown).not.toHaveBeenCalled();
        expect(onResizerPointerdown).not.toHaveBeenCalled();
        expect(mounted.selection.isSelecting?.value).toBe(false);

        // The entry keeps its pointerdown (drag), resize and edit hooks
        pointerDown(entry.element);
        expect(onEventPointerdown).toHaveBeenCalledTimes(1);
        expect(mounted.selection.isSelecting?.value).toBe(false);

        pointerDown(wrapper.find('.fc-event-resizer-end').element);
        expect(onResizerPointerdown).toHaveBeenCalledTimes(1);
        expect(onResizerPointerdown.mock.calls[0]![1]).toMatchObject({
            event: { id: 'entry-1' },
        });
        expect(onResizerPointerdown.mock.calls[0]![2]).toBe('end');
    });
});

describe('totals are not affected by ghosts', () => {
    let wrapper: VueWrapper | null = null;

    beforeEach(() => {
        vi.mocked(window.getTimezoneSetting).mockReturnValue('Europe/Madrid');
    });

    afterEach(() => {
        wrapper?.unmount();
        wrapper = null;
        vi.mocked(window.getTimezoneSetting).mockReturnValue('UTC');
    });

    function entry(id: string, start: string, end: string): TimeEntry {
        return {
            id,
            start,
            end,
            type: 'work',
            description: id,
            project_id: null,
            task_id: null,
            billable: false,
            tags: [],
            user_id: 'u1',
            organization_id: 'o1',
        } as unknown as TimeEntry;
    }

    it('day and week totals are unchanged when ghosts are injected', async () => {
        const entries = [
            entry('e1', '2026-10-20T08:00:00Z', '2026-10-20T09:00:00Z'),
            entry('e2', '2026-10-21T08:00:00Z', '2026-10-21T10:30:00Z'),
        ];
        const weekDays = [
            '2026-10-19',
            '2026-10-20',
            '2026-10-21',
            '2026-10-22',
            '2026-10-23',
            '2026-10-24',
            '2026-10-25',
        ];
        const meetings = ref<OutlookMeeting[]>([]);
        const captured: { dailyTotals: Ref<Record<string, number>> | null } = {
            dailyTotals: null,
        };

        const Harness = {
            setup() {
                const calendarSettings = ref(settings);
                const viewDays = computed(() =>
                    weekDays.map((day) => getLocalizedDayJsFromMinutes(day, 0))
                );
                const { eventsByDay, dailyTotals } = useCalendarEvents({
                    timeEntries: () => entries,
                    projects: () => [],
                    clients: () => [],
                    tasks: () => [],
                    calendarSettings,
                    viewDays,
                    currentTime: ref(getLocalizedDayJs('2026-10-26T12:00:00Z')),
                    cssBackground: ref('#ffffff'),
                    minutesToPixels,
                    timeToMinutesFromMidnight: (time: Dayjs) => time.hour() * 60 + time.minute(),
                });
                captured.dailyTotals = dailyTotals;

                return () =>
                    h(
                        'div',
                        weekDays.map((day) =>
                            h(
                                CalendarDayColumn,
                                {
                                    ...columnProps,
                                    dayStr: day,
                                    key: day,
                                    dayEvents: eventsByDay.value[day] ?? [],
                                    overlayLaneWidth: meetings.value.length > 0 ? LANE : null,
                                },
                                {
                                    overlay: (slot: { dayStr: string }) =>
                                        h(OutlookGhostLayer, {
                                            meetings: meetings.value,
                                            labels,
                                            dayStr: slot.dayStr,
                                            isDayView: false,
                                            minutesToPixels,
                                            settings,
                                        }),
                                }
                            )
                        )
                    );
            },
        };

        wrapper = mount(Harness, {
            global: { provide: { organization: computed(() => ({ time_format: '24-hours' })) } },
        });

        const weekSum = (totals: Record<string, number>) =>
            weekDays.reduce((sum, day) => sum + (totals[day] ?? 0), 0);
        const before = JSON.parse(JSON.stringify(captured.dailyTotals!.value));
        expect(wrapper.findAll('[data-calendar-overlay]')).toHaveLength(0);
        expect(before['2026-10-20']).toBe(3600);
        expect(before['2026-10-21']).toBe(9000);

        // Three ghosts overlapping both entries
        meetings.value = [
            meeting({ id: 'g1', start: '2026-10-20T08:00:00Z', end: '2026-10-20T09:00:00Z' }),
            meeting({ id: 'g2', start: '2026-10-20T08:30:00Z', end: '2026-10-20T09:30:00Z' }),
            meeting({ id: 'g3', start: '2026-10-21T07:00:00Z', end: '2026-10-21T11:00:00Z' }),
        ];
        await nextTick();

        expect(wrapper.findAll('[data-calendar-overlay]')).toHaveLength(3);
        const after = JSON.parse(JSON.stringify(captured.dailyTotals!.value));
        expect(after).toEqual(before);
        expect(weekSum(after)).toBe(weekSum(before));
        expect(weekSum(after)).toBe(3600 + 9000);
    });
});

describe('ghost content by available height', () => {
    let wrapper: VueWrapper | null = null;

    beforeEach(() => {
        vi.mocked(window.getTimezoneSetting).mockReturnValue('Europe/Madrid');
    });

    afterEach(() => {
        wrapper?.unmount();
        wrapper = null;
        vi.mocked(window.getTimezoneSetting).mockReturnValue('UTC');
    });

    // identity minutesToPixels: a meeting of N minutes is drawn N px tall
    function mountLayer(meetings: OutlookMeeting[], isDayView: boolean, dayStr = DAY) {
        return mount(OutlookGhostLayer, {
            props: { meetings, labels, dayStr, isDayView, minutesToPixels, settings },
            global: { provide: { organization: computed(() => ({ time_format: '24-hours' })) } },
        });
    }

    function lasting(minutes: number, overrides: Partial<OutlookMeeting> = {}) {
        const start = getLocalizedDayJsFromMinutes(DAY, 600);
        return meeting({
            start: start.utc().format(),
            end: start.add(minutes, 'minute').utc().format(),
            ...overrides,
        });
    }

    it('under 24px shows the marker icon and the subject only', () => {
        wrapper = mountLayer([lasting(20)], true);

        const ghost = wrapper.find('[data-calendar-overlay]');
        expect(ghost.find('svg').exists()).toBe(true);
        expect(ghost.text()).toBe('Sprint planning');
    });

    it('24px to 39px shows the subject only in week view and adds the time inline in day view', () => {
        wrapper = mountLayer([lasting(30)], false);
        expect(wrapper.find('[data-calendar-overlay]').text()).toBe('Sprint planning');
        wrapper.unmount();

        wrapper = mountLayer([lasting(30)], true);
        const ghost = wrapper.find('[data-calendar-overlay]');
        expect(ghost.text()).toContain('Sprint planning');
        expect(ghost.find('[data-ghost-time-inline]').text()).toBe('10:00 – 10:30');
        expect(ghost.text()).not.toContain('Ada Lovelace');
    });

    it('40px and over shows the time line, plus the organizer in day view', () => {
        wrapper = mountLayer([lasting(60)], false);
        expect(wrapper.find('[data-calendar-overlay]').text()).toContain('10:00 – 11:00');
        expect(wrapper.find('[data-calendar-overlay]').text()).not.toContain('Ada Lovelace');
        wrapper.unmount();

        wrapper = mountLayer([lasting(60)], true);
        const text = wrapper.find('[data-calendar-overlay]').text();
        expect(text).toContain('Sprint planning');
        expect(text).toContain('10:00 – 11:00');
        expect(text).toContain('Ada Lovelace');
        expect(wrapper.find('[data-ghost-time-inline]').exists()).toBe(false);
    });

    it('shows a Video icon for online meetings only', () => {
        wrapper = mountLayer([lasting(60, { is_online_meeting: true })], false);
        expect(wrapper.find('[data-calendar-overlay]').findAll('svg')).toHaveLength(2);
        wrapper.unmount();

        wrapper = mountLayer([lasting(60)], false);
        expect(wrapper.find('[data-calendar-overlay]').findAll('svg')).toHaveLength(1);
    });

    it('squares the clipped side of a meeting that crosses midnight', () => {
        const overnight = meeting({
            start: '2026-10-26T21:00:00Z',
            end: '2026-10-27T00:00:00Z',
        });

        wrapper = mountLayer([overnight], false, '2026-10-26');
        let classes = wrapper.find('[data-calendar-overlay]').classes();
        expect(classes).toContain('rounded-b-none');
        expect(classes).not.toContain('rounded-t-none');
        wrapper.unmount();

        wrapper = mountLayer([overnight], false, '2026-10-27');
        classes = wrapper.find('[data-calendar-overlay]').classes();
        expect(classes).toContain('rounded-t-none');
        expect(classes).not.toContain('rounded-b-none');
    });

    it('splits the lane between overlapping ghosts', () => {
        wrapper = mountLayer(
            [lasting(60, { id: 'a' }), lasting(60, { id: 'b', subject: 'Second' })],
            false
        );

        const ghosts = wrapper.findAll('[data-calendar-overlay]');
        expect(ghosts).toHaveLength(2);
        expect((ghosts[0]!.element as HTMLElement).style.width).toBe('50%');
        expect((ghosts[0]!.element as HTMLElement).style.left).toBe('0%');
        expect((ghosts[1]!.element as HTMLElement).style.left).toBe('50%');
    });
});

// The layer with its detail panels, an injected context and a stand-in Sync button (the focus
// fallback after the last ghost of a day is dismissed).
function mountInteractive(initial: OutlookMeeting[], canAct = true) {
    const list = ref(initial);
    const dismiss = vi.fn(async (id: string) => {
        list.value = list.value.filter((item) => item.id !== id);
    });
    const context = { canAct: ref(canAct), dismiss } as unknown as OutlookMeetingsContext;
    const Host = defineComponent({
        setup() {
            return () =>
                h('div', [
                    h(OutlookGhostLayer, {
                        meetings: list.value,
                        labels,
                        dayStr: DAY,
                        isDayView: false,
                        minutesToPixels,
                        settings,
                    }),
                    h('button', { 'data-testid': 'outlook-sync-button' }, 'Sync'),
                ]);
        },
    });
    const wrapper = mount(Host, {
        attachTo: document.body,
        global: {
            provide: {
                [OUTLOOK_MEETINGS_KEY as symbol]: context,
                organization: computed(() => ({ time_format: '24-hours' })),
            },
        },
    });
    return { wrapper, dismiss };
}

function ghostElements(): HTMLElement[] {
    return Array.from(document.body.querySelectorAll<HTMLElement>('[data-calendar-overlay]'));
}

function keydown(el: Element, key: string) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

async function settle() {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await nextTick();
}

describe('OutlookGhostLayer detail panel', () => {
    let wrapper: VueWrapper | null = null;

    beforeEach(() => {
        vi.mocked(window.getTimezoneSetting).mockReturnValue('Europe/Madrid');
    });

    afterEach(() => {
        wrapper?.unmount();
        wrapper = null;
        document.body.innerHTML = '';
        vi.mocked(window.getTimezoneSetting).mockReturnValue('UTC');
    });

    it('announces a dialog popup on the ghost and is collapsed while closed', () => {
        wrapper = mountInteractive([meeting()]).wrapper;

        const ghost = ghostElements()[0]!;
        expect(ghost.getAttribute('aria-haspopup')).toBe('dialog');
        expect(ghost.getAttribute('aria-expanded')).toBe('false');
        expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    });

    it.each([
        ['Enter', 'Enter'],
        ['Space', ' '],
    ])('%s on a focused ghost opens the panel', async (_name, key) => {
        wrapper = mountInteractive([meeting()]).wrapper;
        const ghost = ghostElements()[0]!;
        ghost.focus();

        keydown(ghost, key);
        await settle();

        expect(ghost.getAttribute('aria-expanded')).toBe('true');
        expect(ghost.getAttribute('data-state')).toBe('open');
        expect(ghost.className).toContain('data-[state=open]:ring-accent-500');
        const dialog = document.body.querySelector('[role="dialog"]');
        expect(dialog?.textContent).toContain('Sprint planning');
    });

    it('a click opens the panel and Escape closes it again', async () => {
        wrapper = mountInteractive([meeting()]).wrapper;
        const ghost = ghostElements()[0]!;

        ghost.click();
        await settle();
        expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

        keydown(document.body, 'Escape');
        await settle();

        expect(document.body.querySelector('[role="dialog"]')).toBeNull();
        expect(ghost.getAttribute('aria-expanded')).toBe('false');
        // Reka hands focus back to the trigger, which is the ghost
        expect(document.activeElement).toBe(ghost);
    });

    it('offers no Dismiss button when the context cannot act', async () => {
        wrapper = mountInteractive([meeting()], false).wrapper;

        ghostElements()[0]!.click();
        await settle();

        expect(document.body.querySelector('[data-testid="outlook-detail-action"]')).toBeNull();
    });

    it('dismiss calls the context, closes the panel and focuses the next ghost of the day', async () => {
        const mounted = mountInteractive([
            meeting({ id: 'a', subject: 'First' }),
            meeting({
                id: 'b',
                subject: 'Second',
                start: '2026-10-20T10:00:00Z',
                end: '2026-10-20T11:00:00Z',
            }),
        ]);
        wrapper = mounted.wrapper;
        ghostElements()[0]!.click();
        await settle();

        document.body.querySelector<HTMLElement>('[data-testid="outlook-detail-action"]')!.click();
        await settle();

        expect(mounted.dismiss).toHaveBeenCalledWith('a');
        expect(document.body.querySelector('[role="dialog"]')).toBeNull();
        const remaining = ghostElements();
        expect(remaining).toHaveLength(1);
        expect(document.activeElement).toBe(remaining[0]);
    });

    it('dismissing the last ghost of the day focuses the Sync button', async () => {
        const mounted = mountInteractive([meeting()]);
        wrapper = mounted.wrapper;
        ghostElements()[0]!.click();
        await settle();

        document.body.querySelector<HTMLElement>('[data-testid="outlook-detail-action"]')!.click();
        await settle();

        expect(ghostElements()).toHaveLength(0);
        expect(document.activeElement).toBe(
            document.body.querySelector('[data-testid="outlook-sync-button"]')
        );
    });
});
