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
const LANE = ghostLaneWidth(false);

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Events container: inline right = lane + 4px (only on days with a lane)
function entriesRightPattern(lane: string): RegExp {
    return new RegExp(
        `class="absolute inset-y-0 left-0\\.5 right-0\\.5[^"]*" style="right:calc\\(${escapeRegExp(lane)} \\+ 4px\\);?"`
    );
}

// Outlook layer: flush with the 2px right edge, width = lane, washed and pointer-transparent
function lanePattern(lane: string): RegExp {
    return new RegExp(
        `role="group"[^>]*data-testid="outlook-lane"[^>]*class="m365-lane absolute inset-y-0 right-0\\.5 pointer-events-none"[^>]*style="width:${escapeRegExp(lane)};?"`
    );
}

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

        expect(html).toMatch(entriesRightPattern(LANE));
        expect(html).toMatch(lanePattern(LANE));

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
        expect(ghostLaneWidth(false)).toBe('min(max(88px, 50%), calc(100% - 52px))');
        expect(ghostLaneWidth(true)).toBe('min(420px, max(260px, 38%))');
    });

    it('marks the Outlook lane', () => {
        const mounted = mountHarness([meeting()]);
        wrapper = mounted.wrapper;

        const layer = wrapper.find('[data-testid="outlook-lane"]');
        expect(layer.exists()).toBe(true);
        expect(layer.attributes('role')).toBe('group');
        expect(layer.classes()).toContain('m365-lane');
        expect(layer.classes()).toContain('pointer-events-none');
    });

    it('renders a solid barred block', () => {
        const mounted = mountHarness([meeting()]);
        wrapper = mounted.wrapper;

        const block = wrapper.find('[data-calendar-overlay]');
        expect(block.classes()).toContain('m365-ghost');
        expect(block.classes()).toContain('m365-meeting');
        expect(block.classes()).toContain('rounded-sm');
        expect(block.classes()).not.toContain('m365-meeting--dismissed');
        expect(block.classes().some((cls) => cls.startsWith('shadow'))).toBe(false);
        expect(block.classes().some((cls) => cls.startsWith('border-dashed'))).toBe(false);
        expect(block.attributes('data-ghost-id')).toBe('m-1');
        expect(block.attributes('role')).toBe('button');
        expect(block.attributes('tabindex')).toBe('0');
        expect(block.attributes('data-event-id')).toBeUndefined();
        for (const cls of ['fc-event', 'touch-none', 'fc-event-resizer']) {
            expect(block.classes()).not.toContain(cls);
        }
        expect(block.find('.fc-event-resizer').exists()).toBe(false);
        // 1px gap under every block: a 60 minute meeting is drawn 59px tall
        expect((block.element as HTMLElement).style.height).toBe('59px');
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
        // 1px gap under every meeting block
        expect((ghost.element as HTMLElement).style.height).toBe('59px');
        expect((entry.element as HTMLElement).style.top).toBe('600px');
        expect((entry.element as HTMLElement).style.height).toBe('60px');

        // ...and the two never share horizontal space: events container right = lane + 4px,
        // ghost layer flush right with width = lane (disjoint)
        const html = await renderHtml([sameTime], lane, entryColumnProps());
        expect(html).toContain(`style="right:calc(${lane} + 4px);"`);
        expect(html).toMatch(lanePattern(lane));
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

    function tierOf(ghost: ReturnType<VueWrapper['find']>): string | undefined {
        return ghost.find('[data-ghost-tier]').attributes('data-ghost-tier');
    }

    it('under 18px shows the subject only, without a time line icon', () => {
        // a 10 minute meeting is drawn at the 16px minimum
        wrapper = mountLayer([lasting(10)], true);

        const ghost = wrapper.find('[data-calendar-overlay]');
        expect(tierOf(ghost)).toBe('1');
        expect(ghost.text()).toBe('Sprint planning');
        expect(ghost.find('svg').exists()).toBe(false);
        expect(ghost.find('[data-ghost-subject]').classes()).toContain('font-semibold');
    });

    it('18px to 31px shows the subject on one line only', () => {
        wrapper = mountLayer([lasting(25)], false);
        let ghost = wrapper.find('[data-calendar-overlay]');
        expect(tierOf(ghost)).toBe('2');
        expect(ghost.text()).toBe('Sprint planning');
        expect(ghost.find('[data-ghost-subject]').classes()).toContain('truncate');
        expect(ghost.find('[data-ghost-time]').exists()).toBe(false);
        wrapper.unmount();

        wrapper = mountLayer([lasting(25)], true);
        ghost = wrapper.find('[data-calendar-overlay]');
        expect(tierOf(ghost)).toBe('2');
        expect(ghost.text()).not.toContain('Ada Lovelace');
        expect(ghost.find('svg.lucide-calendar-days').exists()).toBe(false);
    });

    it('32px to 45px adds the time line with the CalendarDays icon', () => {
        wrapper = mountLayer([lasting(40)], false);

        const ghost = wrapper.find('[data-calendar-overlay]');
        expect(tierOf(ghost)).toBe('3');
        const subject = ghost.find('[data-ghost-subject]');
        expect(subject.classes()).toContain('truncate');
        expect(subject.classes()).not.toContain('line-clamp-2');
        const time = ghost.find('[data-ghost-time]');
        expect(time.text()).toBe('10:00 – 10:40');
        expect(time.find('svg.lucide-calendar-days').exists()).toBe(true);
    });

    it('from 46px the subject clamps to two lines; week view never shows the organizer', () => {
        wrapper = mountLayer([lasting(50)], false);
        let ghost = wrapper.find('[data-calendar-overlay]');
        expect(tierOf(ghost)).toBe('4');
        expect(ghost.find('[data-ghost-subject]').classes()).toContain('line-clamp-2');
        expect(ghost.find('[data-ghost-time]').text()).toBe('10:00 – 10:50');
        expect(ghost.text()).not.toContain('Ada Lovelace');
        wrapper.unmount();

        wrapper = mountLayer([lasting(100)], false);
        ghost = wrapper.find('[data-calendar-overlay]');
        expect(tierOf(ghost)).toBe('4');
        expect(ghost.find('[data-ghost-organizer]').exists()).toBe(false);
        wrapper.unmount();

        // day view under 60px stays at T4 as well
        wrapper = mountLayer([lasting(50)], true);
        expect(tierOf(wrapper.find('[data-calendar-overlay]'))).toBe('4');
    });

    it('from 60px in day view adds the organizer line', () => {
        wrapper = mountLayer([lasting(100)], true);
        let ghost = wrapper.find('[data-calendar-overlay]');
        expect(tierOf(ghost)).toBe('5');
        const organizer = ghost.find('[data-ghost-organizer]');
        expect(organizer.text()).toBe('Ada Lovelace');
        expect(organizer.find('svg.lucide-user').exists()).toBe(true);
        expect(ghost.find('[data-ghost-time]').text()).toBe('10:00 – 11:40');
        wrapper.unmount();

        wrapper = mountLayer([lasting(100, { is_organizer: true })], true);
        ghost = wrapper.find('[data-calendar-overlay]');
        expect(ghost.find('[data-ghost-organizer]').text()).toBe('You are the organizer');
    });

    it('shows a Video icon for online meetings only', () => {
        // time line tiers: right-aligned in the time line
        wrapper = mountLayer([lasting(60, { is_online_meeting: true })], false);
        let ghost = wrapper.find('[data-calendar-overlay]');
        expect(ghost.find('[data-ghost-time] svg.lucide-video').exists()).toBe(true);
        expect(ghost.findAll('svg')).toHaveLength(2);
        wrapper.unmount();

        // one-line tiers: trailing the subject, no leading icon
        wrapper = mountLayer([lasting(25, { is_online_meeting: true })], false);
        ghost = wrapper.find('[data-calendar-overlay]');
        expect(ghost.findAll('svg')).toHaveLength(1);
        expect(ghost.find('svg.lucide-video').exists()).toBe(true);
        wrapper.unmount();

        wrapper = mountLayer([lasting(60)], false);
        ghost = wrapper.find('[data-calendar-overlay]');
        expect(ghost.find('svg.lucide-video').exists()).toBe(false);
        expect(ghost.findAll('svg')).toHaveLength(1);
    });

    it('never fades meeting text with opacity', () => {
        wrapper = mountLayer([lasting(100, { dismissed: true })], true);
        expect(wrapper.html()).not.toMatch(/\bopacity-/);
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
        expect((ghosts[0]!.element as HTMLElement).style.width).toBe('calc(50% - 3px)');
        expect((ghosts[0]!.element as HTMLElement).style.left).toBe('2px');
        expect((ghosts[1]!.element as HTMLElement).style.left).toBe('calc(50% + 1px)');
    });
});

describe('columns from the measured lane width', () => {
    let wrapper: VueWrapper | null = null;

    beforeEach(() => {
        vi.mocked(window.getTimezoneSetting).mockReturnValue('Europe/Madrid');
    });

    afterEach(() => {
        wrapper?.unmount();
        wrapper = null;
        vi.unstubAllGlobals();
        vi.mocked(window.getTimezoneSetting).mockReturnValue('UTC');
    });

    // Reports a lane of `width` px (border box; the content box excludes the 1px divider) as soon
    // as the layer element is observed.
    function stubLaneWidth(width: number) {
        class FakeResizeObserver {
            callback: ResizeObserverCallback;
            constructor(callback: ResizeObserverCallback) {
                this.callback = callback;
            }
            observe(target: Element) {
                const entry = {
                    target,
                    contentRect: { width: width - 1 },
                    borderBoxSize: [{ inlineSize: width, blockSize: 0 }],
                } as unknown as ResizeObserverEntry;
                this.callback([entry], this as unknown as ResizeObserver);
            }
            unobserve() {}
            disconnect() {}
        }
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    }

    async function mountMeasured(meetings: OutlookMeeting[], isDayView: boolean) {
        const mounted = mount(OutlookGhostLayer, {
            props: { meetings, labels, dayStr: DAY, isDayView, minutesToPixels, settings },
            global: { provide: { organization: computed(() => ({ time_format: '24-hours' })) } },
        });
        await nextTick();
        await nextTick();
        return mounted;
    }

    function at(minutes: number, id: string, overrides: Partial<OutlookMeeting> = {}) {
        const start = getLocalizedDayJsFromMinutes(DAY, 600);
        return meeting({
            id,
            subject: `Meeting ${id}`,
            start: start.utc().format(),
            end: start.add(minutes, 'minute').utc().format(),
            ...overrides,
        });
    }

    function styleOf(el: { element: Element }) {
        const style = (el.element as HTMLElement).style;
        return { left: style.left, width: style.width };
    }

    it('a 113px week lane fits two side by side and cascades the third', async () => {
        stubLaneWidth(113);
        wrapper = await mountMeasured([at(60, 'a'), at(60, 'b'), at(60, 'c')], false);

        const ghosts = wrapper.findAll('[data-calendar-overlay]');
        expect(ghosts.map((g) => g.attributes('data-ghost-id'))).toEqual(['a', 'b', 'c']);
        expect(styleOf(ghosts[0]!)).toEqual({ left: '2px', width: 'calc(50% - 3px)' });
        expect(styleOf(ghosts[1]!)).toEqual({ left: 'calc(50% + 1px)', width: 'calc(50% - 3px)' });
        expect(styleOf(ghosts[2]!)).toEqual({
            left: 'calc(50% + 9px)',
            width: 'calc(50% - 11px)',
        });
        expect(ghosts[0]!.classes()).not.toContain('m365-meeting--cascaded');
        expect(ghosts[1]!.classes()).not.toContain('m365-meeting--cascaded');
        expect(ghosts[2]!.classes()).toContain('m365-meeting--cascaded');
    });

    it('an 88px week lane keeps one column and cascades every overlap', async () => {
        stubLaneWidth(88);
        wrapper = await mountMeasured([at(60, 'a'), at(60, 'b')], false);

        const ghosts = wrapper.findAll('[data-calendar-overlay]');
        expect(styleOf(ghosts[0]!)).toEqual({ left: '2px', width: 'calc(100% - 4px)' });
        expect(styleOf(ghosts[1]!)).toEqual({ left: '10px', width: 'calc(100% - 12px)' });
        expect(ghosts[1]!.classes()).toContain('m365-meeting--cascaded');
    });

    it('a 420px day lane fits four side by side', async () => {
        stubLaneWidth(420);
        wrapper = await mountMeasured([at(60, 'a'), at(60, 'b'), at(60, 'c'), at(60, 'd')], true);

        const lefts = wrapper
            .findAll('[data-calendar-overlay]')
            .map((ghost) => styleOf(ghost).left);
        expect(lefts).toEqual(['2px', 'calc(25% + 1.5px)', 'calc(50% + 1px)', 'calc(75% + 0.5px)']);
        expect(wrapper.find('.m365-meeting--cascaded').exists()).toBe(false);
    });

    it('uses the column cap until the lane has been measured', async () => {
        wrapper = await mountMeasured([at(60, 'a'), at(60, 'b'), at(60, 'c'), at(60, 'd')], false);

        const ghosts = wrapper.findAll('[data-calendar-overlay]');
        expect(styleOf(ghosts[2]!).left).toBe('calc(66.6667% + 0.6667px)');
        expect(ghosts[3]!.classes()).toContain('m365-meeting--cascaded');
    });

    it('shows the inline start-end of a one-line block only from 150px of block width', async () => {
        stubLaneWidth(160);
        wrapper = await mountMeasured([at(25, 'a')], false);
        const inline = wrapper.find('[data-ghost-time-inline]');
        expect(inline.exists()).toBe(true);
        expect(inline.text()).toBe('10:00 – 10:25');
        wrapper.unmount();
        vi.unstubAllGlobals();

        stubLaneWidth(120);
        wrapper = await mountMeasured([at(25, 'a')], false);
        expect(wrapper.find('[data-ghost-time-inline]').exists()).toBe(false);
        expect(wrapper.find('[data-calendar-overlay]').text()).toBe('Meeting a');
    });

    it('shows the start time only in the time line under 96px of block width', async () => {
        stubLaneWidth(90);
        wrapper = await mountMeasured([at(50, 'a')], false);
        expect(wrapper.find('[data-ghost-time]').text()).toBe('10:00');
        wrapper.unmount();
        vi.unstubAllGlobals();

        stubLaneWidth(120);
        wrapper = await mountMeasured([at(50, 'a')], false);
        expect(wrapper.find('[data-ghost-time]').text()).toBe('10:00 – 10:50');
    });

    it('keeps start order in the DOM (and so in the Tab order) with cascaded blocks', async () => {
        stubLaneWidth(88);
        wrapper = await mountMeasured(
            [
                at(60, 'late', { start: getLocalizedDayJsFromMinutes(DAY, 620).utc().format() }),
                at(60, 'early'),
                at(60, 'mid', { start: getLocalizedDayJsFromMinutes(DAY, 610).utc().format() }),
            ],
            false
        );

        const ids = wrapper
            .findAll('[data-calendar-overlay]')
            .map((ghost) => ghost.attributes('data-ghost-id'));
        expect(ids).toEqual(['early', 'mid', 'late']);
        expect(
            wrapper.findAll('[data-calendar-overlay]').map((g) => g.attributes('tabindex'))
        ).toEqual(['0', '0', '0']);
    });
});

// The layer with its detail panels, an injected context and a stand-in Sync button (the focus
// fallback after the last ghost of a day is dismissed).
function mountInteractive(initial: OutlookMeeting[], canAct = true, includeDismissed = false) {
    const list = ref(initial);
    // Mirrors the composable: a dismiss removes the ghost, or flags it while dismissed ones are shown
    const dismiss = vi.fn(async (id: string) => {
        list.value = includeDismissed
            ? list.value.map((item) => (item.id === id ? { ...item, dismissed: true } : item))
            : list.value.filter((item) => item.id !== id);
    });
    const restore = vi.fn(async (id: string) => {
        list.value = list.value.map((item) =>
            item.id === id ? { ...item, dismissed: false } : item
        );
    });
    const context = {
        canAct: ref(canAct),
        includeDismissed: ref(includeDismissed),
        dismiss,
        restore,
    } as unknown as OutlookMeetingsContext;
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
    return { wrapper, dismiss, restore };
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
        expect(ghost.hasAttribute('data-panel-open')).toBe(true);
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

    it('drives the open-panel ring from data-panel-open', async () => {
        wrapper = mountInteractive([meeting()]).wrapper;
        const ghost = ghostElements()[0]!;

        expect(ghost.hasAttribute('data-panel-open')).toBe(false);
        expect(ghost.className).toContain('data-[panel-open]:ring-2');
        expect(ghost.className).toContain('data-[panel-open]:ring-accent-700');
        expect(ghost.className).toContain('dark:data-[panel-open]:ring-accent-200');
        expect(ghost.className).not.toContain('data-[state=open]');

        ghost.click();
        await settle();
        expect(ghost.hasAttribute('data-panel-open')).toBe(true);

        keydown(document.body, 'Escape');
        await settle();
        expect(ghost.hasAttribute('data-panel-open')).toBe(false);
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

describe('OutlookGhostLayer dismissed variant', () => {
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

    it('renders a dismissed meeting with the dotted variant, EyeOff icon and a ", dismissed" label', () => {
        wrapper = mountInteractive(
            [meeting({ dismissed: true }), meeting({ id: 'm-2' })],
            true,
            true
        ).wrapper;

        const [dismissed, regular] = ghostElements();
        // The dismissed modifier carries the dotted border and drops the bar (scoped style)
        expect(dismissed!.classList.contains('m365-meeting--dismissed')).toBe(true);
        expect(dismissed!.classList.contains('m365-meeting')).toBe(true);
        expect(
            dismissed!.querySelector('[data-ghost-subject]')!.classList.contains('font-semibold')
        ).toBe(false);
        expect(dismissed!.querySelector('svg.lucide-eye-off')).not.toBeNull();
        expect(dismissed!.querySelector('svg.lucide-calendar-days')).toBeNull();
        expect(dismissed!.getAttribute('aria-label')).toMatch(/, dismissed$/);

        expect(regular!.classList.contains('m365-meeting--dismissed')).toBe(false);
        expect(
            regular!.querySelector('[data-ghost-subject]')!.classList.contains('font-semibold')
        ).toBe(true);
        expect(regular!.querySelector('svg.lucide-calendar-days')).not.toBeNull();
        expect(regular!.getAttribute('aria-label')).not.toMatch(/dismissed/);
    });

    it('the panel of a dismissed meeting offers Restore, which calls restore(id) and keeps focus on the ghost', async () => {
        const mounted = mountInteractive([meeting({ dismissed: true })], true, true);
        wrapper = mounted.wrapper;
        ghostElements()[0]!.click();
        await settle();

        const action = document.body.querySelector<HTMLElement>(
            '[data-testid="outlook-detail-action"]'
        )!;
        expect(action.textContent?.trim()).toBe('Restore meeting');
        action.click();
        await settle();

        expect(mounted.restore).toHaveBeenCalledWith('m-1');
        expect(mounted.dismiss).not.toHaveBeenCalled();
        expect(document.body.querySelector('[role="dialog"]')).toBeNull();
        const ghosts = ghostElements();
        expect(ghosts).toHaveLength(1);
        expect(ghosts[0]!.classList.contains('m365-meeting--dismissed')).toBe(false);
        expect(document.activeElement).toBe(ghosts[0]);
    });

    it('a dismiss with the switch on turns the ghost into the dismissed variant and keeps focus on it', async () => {
        const mounted = mountInteractive(
            [
                meeting({ id: 'a', subject: 'First' }),
                meeting({
                    id: 'b',
                    subject: 'Second',
                    start: '2026-10-20T10:00:00Z',
                    end: '2026-10-20T11:00:00Z',
                }),
            ],
            true,
            true
        );
        wrapper = mounted.wrapper;
        const first = ghostElements()[0]!;
        first.click();
        await settle();

        document.body.querySelector<HTMLElement>('[data-testid="outlook-detail-action"]')!.click();
        await settle();

        expect(mounted.dismiss).toHaveBeenCalledWith('a');
        const ghosts = ghostElements();
        expect(ghosts).toHaveLength(2);
        expect(ghosts[0]!.classList.contains('m365-meeting--dismissed')).toBe(true);
        expect(document.activeElement).toBe(ghosts[0]);
        // Not the neighbour: the focused ghost is the one that was dismissed
        expect(document.activeElement).not.toBe(ghosts[1]);
    });

    it('with the switch off a dismiss still moves focus to the next ghost', async () => {
        const mounted = mountInteractive(
            [
                meeting({ id: 'a' }),
                meeting({ id: 'b', start: '2026-10-20T10:00:00Z', end: '2026-10-20T11:00:00Z' }),
            ],
            true,
            false
        );
        wrapper = mounted.wrapper;
        ghostElements()[0]!.click();
        await settle();

        document.body.querySelector<HTMLElement>('[data-testid="outlook-detail-action"]')!.click();
        await settle();

        const remaining = ghostElements();
        expect(remaining).toHaveLength(1);
        expect(document.activeElement).toBe(remaining[0]);
    });
});
