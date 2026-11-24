/* eslint-disable vue/one-component-per-file */
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
import { resetHoverCardDelay } from './hoverCardDelay';
import { useOutlookSelection, type OutlookSelection } from './useOutlookSelection';
import { useCalendarEvents } from '@/packages/ui/src/FullCalendar/useCalendarEvents';
import type { DayEvent } from '@/packages/ui/src/FullCalendar/calendarTypes';
import type { TimeEntry } from '@/packages/api/src';
import { getLocalizedDayJs, getLocalizedDayJsFromMinutes } from '@/packages/ui/src/utils/time';
import type {
    OutlookAssignment,
    OutlookCalendarLabels,
    OutlookConversionResult,
    OutlookMeeting,
} from '@/m365/types';
import type { OutlookFlagActionResult } from './conversionApi';

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
    dismiss: 'Dismiss',
    restore: 'Restore',
    dismissed_suffix: ', dismissed',
    // Phase 5
    preassigned_suffix: ', pre-assigned to :project',
    preassigned_eyebrow: 'Pre-assigned · Same series',
    why_series: 'You logged this series to :project on :date.',
    confirm: 'Confirm',
    edit: 'Edit',
    confirm_failed: 'Could not confirm this meeting',
    tags_one: '1 Tag',
    tags_many: ':count Tags',
    billable: 'Billable',
    non_billable: 'Non-Billable',
    more_actions: 'More actions',
    ignore_series: 'Always ignore this series',
    unignore_series: 'Stop ignoring this series',
    forget_series: 'Forget this series',
    eyebrow_series_ignored: 'Outlook meeting · Series ignored',
    series_ignored_suffix: ', series ignored',
    selected_suffix: ', selected',
    // Phase 6 (D-03)
    moved_eyebrow: 'Moved in Outlook · Already logged',
    moved_body:
        'You logged it on :when. Create a new entry for this session, or move that one here.',
    moved_hover_note: 'Moved in Outlook. You logged it on :date.',
    moved_suffix: ', already logged on :date',
    move_entry_here: 'Move my entry here',
    move_entry_failed: 'Could not move the time entry',
} as OutlookCalendarLabels;

const settings: CalendarSettings = { snapMinutes: 15, startHour: 0, endHour: 24, slotMinutes: 15 };
const minutesToPixels = (minutes: number) => minutes;

const assignment: OutlookAssignment = {
    project_id: 'p-1',
    project_name: 'Acme Website',
    project_color: '#ef5350',
    client_name: 'Acme',
    task_id: null,
    task_name: null,
    tags: [],
    billable: true,
    converted_at: '2026-10-13T08:00:00Z',
};

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

    describe('pre-assigned meetings (Phase 5)', () => {
        const preassigned = (minutes: number, overrides: Partial<OutlookMeeting> = {}) =>
            lasting(minutes, { series_key: 'series-1', assignment, ...overrides });

        function line(ghost: ReturnType<VueWrapper['find']>) {
            return ghost.find('[data-testid="outlook-preassigned-line"]');
        }

        it('T3 shows the subject on one line and the project line instead of the time line', () => {
            wrapper = mountLayer([preassigned(40)], false);

            const ghost = wrapper.find('[data-calendar-overlay]');
            expect(tierOf(ghost)).toBe('3');
            expect(ghost.attributes('data-preassigned')).toBe('');
            expect(ghost.find('[data-ghost-subject]').classes()).toContain('truncate');
            expect(ghost.find('[data-ghost-time]').exists()).toBe(false);
            const project = line(ghost);
            expect(project.exists()).toBe(true);
            expect(project.classes()).toContain('m365-meeting__meta');
            expect(project.find('[data-testid="outlook-project-dot"]').exists()).toBe(true);
            expect(project.text()).toBe('Acme Website');
            expect(project.find('span.truncate').attributes('title')).toBe('Acme Website');
            expect(ghost.attributes('aria-label')).toBe(
                'Sprint planning, 10:00 to 10:40, Outlook meeting suggestion, pre-assigned to Acme Website'
            );
        });

        it('the project colour reaches the dot only, never the block', () => {
            wrapper = mountLayer([preassigned(40)], false);

            const ghost = wrapper.find('[data-calendar-overlay]');
            const dot = ghost.find('[data-testid="outlook-project-dot"]');
            expect((dot.element as HTMLElement).style.backgroundColor).not.toBe('');
            expect(ghost.attributes('style')).not.toContain('239, 83, 80');
            expect(ghost.attributes('style')).not.toContain('#ef5350');
            expect(line(ghost).attributes('style')).toBeUndefined();
            expect(ghost.find('button').exists()).toBe(false);
        });

        it('T1 and T2 put the dot before the subject on the one line', () => {
            wrapper = mountLayer([preassigned(10)], false);
            let ghost = wrapper.find('[data-calendar-overlay]');
            expect(tierOf(ghost)).toBe('1');
            let html = ghost.html();
            expect(html.indexOf('outlook-project-dot')).toBeGreaterThan(-1);
            expect(html.indexOf('outlook-project-dot')).toBeLessThan(
                html.indexOf('data-ghost-subject')
            );
            expect(line(ghost).exists()).toBe(false);
            wrapper.unmount();

            wrapper = mountLayer([preassigned(25)], false);
            ghost = wrapper.find('[data-calendar-overlay]');
            expect(tierOf(ghost)).toBe('2');
            html = ghost.html();
            expect(html.indexOf('outlook-project-dot')).toBeLessThan(
                html.indexOf('data-ghost-subject')
            );
            expect(ghost.text()).toBe('Sprint planning');
        });

        it('T4 under 60px: subject on one line, time line, project line', () => {
            wrapper = mountLayer([preassigned(50)], false);

            const ghost = wrapper.find('[data-calendar-overlay]');
            expect(tierOf(ghost)).toBe('4');
            expect(ghost.find('[data-ghost-subject]').classes()).toContain('truncate');
            expect(ghost.find('[data-ghost-subject]').classes()).not.toContain('line-clamp-2');
            expect(ghost.find('[data-ghost-time]').text()).toBe('10:00 – 10:50');
            const html = ghost.html();
            expect(html.indexOf('outlook-preassigned-line')).toBeGreaterThan(
                html.indexOf('data-ghost-time')
            );
        });

        it('from 60px the subject takes up to two lines and the organizer line never shows', () => {
            wrapper = mountLayer([preassigned(100)], true);

            const ghost = wrapper.find('[data-calendar-overlay]');
            expect(tierOf(ghost)).toBe('5');
            expect(ghost.find('[data-ghost-subject]').classes()).toContain('line-clamp-2');
            expect(ghost.find('[data-ghost-time]').exists()).toBe(true);
            expect(line(ghost).exists()).toBe(true);
            expect(ghost.find('[data-ghost-organizer]').exists()).toBe(false);
            expect(ghost.text()).not.toContain('Ada Lovelace');
        });

        it('a long project name truncates in the line and keeps the full name in its title', () => {
            const long = 'A very long project name that never fits into a narrow meeting block';
            wrapper = mountLayer(
                [preassigned(40, { assignment: { ...assignment, project_name: long } })],
                false
            );

            const name = line(wrapper.find('[data-calendar-overlay]')).find('span.truncate');
            expect(name.classes()).toContain('min-w-0');
            expect(name.attributes('title')).toBe(long);
        });

        it('a plain meeting renders none of it', () => {
            wrapper = mountLayer([lasting(40)], false);

            const ghost = wrapper.find('[data-calendar-overlay]');
            expect(ghost.attributes('data-preassigned')).toBeUndefined();
            expect(line(ghost).exists()).toBe(false);
            expect(ghost.find('[data-testid="outlook-project-dot"]').exists()).toBe(false);
            expect(ghost.attributes('aria-label')).not.toContain('pre-assigned');
        });

        it('a dismissed occurrence shows the dismissed variant without a project line', () => {
            wrapper = mountLayer([preassigned(40, { dismissed: true })], false);

            const ghost = wrapper.find('[data-calendar-overlay]');
            expect(ghost.classes()).toContain('m365-meeting--dismissed');
            expect(ghost.attributes('data-preassigned')).toBeUndefined();
            expect(line(ghost).exists()).toBe(false);
            expect(ghost.attributes('aria-label')).toMatch(/, dismissed$/);
        });

        it('shows the line without an Outlook context (the server sent the assignment)', () => {
            wrapper = mountLayer([preassigned(40)], false);

            expect(line(wrapper.find('[data-calendar-overlay]')).exists()).toBe(true);
        });
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

// Vue's DOM listeners ignore an event stamped no later than the moment they were attached. The
// lane's click.capture listener stamps every click first, so under fake timers (frozen Date) a click
// right after mounting (or right after a re-render attached a listener) would never reach the
// block's own listeners. Moving the fake clock forward restores the ordering of a real browser.
function passMountTime(): void {
    vi.setSystemTime(Date.now() + 1);
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

// Dismiss / Restore live in the panel's More actions menu (owner feedback, 2026-11-23).
async function chooseFromMore(testid: 'outlook-more-dismiss' | 'outlook-more-restore') {
    document.body.querySelector<HTMLElement>('[data-testid="outlook-detail-more"]')!.click();
    await settle();
    const item = document.body.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
    expect(item, testid).not.toBeNull();
    item!.click();
    await settle();
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

    it('offers no Dismiss action when the context cannot act', async () => {
        wrapper = mountInteractive([meeting()], false).wrapper;

        ghostElements()[0]!.click();
        await settle();

        expect(document.body.querySelector('[data-testid="outlook-detail-action"]')).toBeNull();
        expect(document.body.querySelector('[data-testid="outlook-detail-more"]')).toBeNull();
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

        await chooseFromMore('outlook-more-dismiss');

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

        await chooseFromMore('outlook-more-dismiss');

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

        await chooseFromMore('outlook-more-restore');

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

        await chooseFromMore('outlook-more-dismiss');

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

        await chooseFromMore('outlook-more-dismiss');

        const remaining = ghostElements();
        expect(remaining).toHaveLength(1);
        expect(document.activeElement).toBe(remaining[0]);
    });
});

// Hover card and detail panel against the context menu and calendar interactions (UX-03 / UX-04,
// D-05 / D-06). The layer is mounted inside a stand-in calendar root (.fc) with the optional props
// the core day-overlay slot passes from 03.1-04.
describe('OutlookGhostLayer close and suppress rules', () => {
    let wrapper: VueWrapper | null = null;

    function mountGated(
        initial: OutlookMeeting[] = [meeting()],
        extra: { contextMenuOpen?: boolean; interacting?: boolean } = {}
    ) {
        const root = document.createElement('div');
        root.className = 'fc';
        document.body.appendChild(root);
        const context = {
            canAct: ref(true),
            includeDismissed: ref(false),
            dismiss: vi.fn(),
            restore: vi.fn(),
        } as unknown as OutlookMeetingsContext;
        wrapper = mount(OutlookGhostLayer, {
            attachTo: root,
            props: {
                meetings: initial,
                labels: { ...labels, hover_hint: 'Click for details' },
                dayStr: DAY,
                isDayView: false,
                minutesToPixels,
                settings,
                ...extra,
            },
            global: {
                provide: {
                    [OUTLOOK_MEETINGS_KEY as symbol]: context,
                    organization: computed(() => ({ time_format: '24-hours' })),
                },
            },
        });
        passMountTime();
        return wrapper;
    }

    function block(id = 'm-1'): HTMLElement {
        return document.body.querySelector<HTMLElement>(`[data-ghost-id="${id}"]`)!;
    }

    function card(): HTMLElement | null {
        return document.body.querySelector('[data-testid="outlook-hover-card"]');
    }

    function panel(): HTMLElement | null {
        return document.body.querySelector('[data-testid="outlook-ghost-detail"]');
    }

    function hover(el: Element) {
        el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, pointerType: 'mouse' }));
    }

    // reka handles a trigger leave on the next task, so let it run before the pointer comes back
    async function unhover(el: Element) {
        el.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, pointerType: 'mouse' }));
        await advance(200);
    }

    async function advance(ms: number) {
        await vi.advanceTimersByTimeAsync(ms);
        await nextTick();
    }

    async function openCard(id = 'm-1') {
        hover(block(id));
        await advance(400);
        expect(card()).not.toBeNull();
    }

    async function openPanel(id = 'm-1') {
        block(id).click();
        await advance(20);
        expect(panel()).not.toBeNull();
    }

    const second = () =>
        meeting({
            id: 'b',
            subject: 'Second',
            start: '2026-10-20T10:00:00Z',
            end: '2026-10-20T11:00:00Z',
        });

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

    it('closes the panel and the card when contextMenuOpen turns true', async () => {
        const w = mountGated([meeting({ id: 'a', subject: 'First' }), second()]);

        await openPanel('a');
        await w.setProps({ contextMenuOpen: true });
        await advance(0);
        expect(panel()).toBeNull();
        expect(block('a').hasAttribute('data-panel-open')).toBe(false);

        await w.setProps({ contextMenuOpen: false });
        await openCard('b');
        await w.setProps({ contextMenuOpen: true });
        await advance(0);
        expect(card()).toBeNull();
    });

    it('a contextmenu event on a block closes the open panel and card before the menu opens', async () => {
        mountGated();

        await openPanel();
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        block().dispatchEvent(event);
        // Closed synchronously in the capture phase, before reka's menu handler (which waits a tick)
        await nextTick();
        expect(block().hasAttribute('data-panel-open')).toBe(false);
        expect(block().getAttribute('aria-expanded')).toBe('false');
        expect(event.defaultPrevented).toBe(false);
        await advance(0);
        expect(panel()).toBeNull();

        await unhover(block());
        await openCard();
        block().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await nextTick();
        expect(card()?.getAttribute('data-state') ?? 'closed').toBe('closed');
        await advance(0);
        expect(card()).toBeNull();
    });

    it('opens neither a card nor a panel while contextMenuOpen is true', async () => {
        const w = mountGated([meeting()], { contextMenuOpen: true });

        hover(block());
        await advance(1000);
        expect(card()).toBeNull();

        block().click();
        await advance(20);
        expect(panel()).toBeNull();
        expect(block().hasAttribute('data-panel-open')).toBe(false);

        // Once the menu is closed both open again
        await w.setProps({ contextMenuOpen: false });
        await unhover(block());
        await openCard();
        await openPanel();
    });

    it('closes the card and blocks new ones while interacting', async () => {
        const w = mountGated([meeting({ id: 'a', subject: 'First' }), second()]);
        await openCard('a');

        await w.setProps({ interacting: true });
        await advance(0);
        expect(card()).toBeNull();

        await unhover(block('a'));
        hover(block('b'));
        await advance(1000);
        expect(card()).toBeNull();

        await w.setProps({ interacting: false });
        await unhover(block('b'));
        await openCard('b');
    });

    it('closes the card on a zoom step', async () => {
        const w = mountGated();
        await openCard();

        // A zoom step changes the height of an hour
        await w.setProps({ minutesToPixels: (minutes: number) => minutes * 2 });
        await advance(0);

        expect(card()).toBeNull();
    });

    it('closes the card on a wheel inside the calendar', async () => {
        mountGated();
        await openCard();

        // A wheel outside the calendar leaves it alone
        document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 }));
        await advance(0);
        expect(card()).not.toBeNull();

        block().dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 }));
        await advance(0);
        expect(card()).toBeNull();
    });

    it('keeps the panel ring on data-panel-open with the hover trigger on the same element', async () => {
        mountGated();
        await openCard();

        // The hover trigger marks the block open; the panel ring must not follow it
        expect(block().hasAttribute('data-panel-open')).toBe(false);
        expect(block().className).not.toContain('data-[state=open]');

        await openPanel();
        expect(card()).toBeNull();
        expect(block().hasAttribute('data-panel-open')).toBe(true);
        expect(block().className).toContain('data-[panel-open]:ring-2');
        expect(block().getAttribute('aria-expanded')).toBe('true');
    });
});

// Phase 4: the panel's form mode and the context's form channel. The form itself is stubbed (it
// talks to the Outlook context and the query caches, covered by OutlookConvertForm.test.ts).
describe('OutlookGhostLayer conversion form', () => {
    let wrapper: VueWrapper | null = null;

    const FormStub = defineComponent({
        name: 'OutlookConvertForm',
        emits: ['done', 'cancel', 'busy'],
        setup(_props, { emit }) {
            return () =>
                h('div', { 'data-testid': 'outlook-convert-form' }, [
                    h('button', { 'data-testid': 'stub-done', onClick: () => emit('done', []) }),
                    h('button', { 'data-testid': 'stub-cancel', onClick: () => emit('cancel') }),
                ]);
        },
    });

    const formLabels = {
        ...labels,
        hover_hint: 'Click for details',
        create_entry: 'Create time entry',
    } as OutlookCalendarLabels;

    const later = (id: string, hour: number) =>
        meeting({
            id,
            subject: 'Meeting ' + id,
            start: `2026-10-20T${String(hour).padStart(2, '0')}:00:00Z`,
            end: `2026-10-20T${String(hour + 1).padStart(2, '0')}:00:00Z`,
        });

    function mountForms(initial: OutlookMeeting[], canAct = true) {
        const root = document.createElement('div');
        root.className = 'fc';
        document.body.appendChild(root);
        const list = ref(initial);
        const formRequest = ref<{ id: string; seq: number } | null>(null);
        let seq = 0;
        const context = {
            canAct: ref(canAct),
            includeDismissed: ref(false),
            dismiss: vi.fn(),
            restore: vi.fn(),
            formRequest,
        } as unknown as OutlookMeetingsContext;
        const Host = defineComponent({
            setup() {
                return () =>
                    h('div', [
                        h(OutlookGhostLayer, {
                            meetings: list.value,
                            labels: formLabels,
                            dayStr: DAY,
                            isDayView: false,
                            minutesToPixels,
                            settings,
                        }),
                        h('button', { 'data-testid': 'outlook-sync-button' }, 'Sync'),
                    ]);
            },
        });
        wrapper = mount(Host, {
            attachTo: root,
            global: {
                stubs: { OutlookConvertForm: FormStub },
                provide: {
                    [OUTLOOK_MEETINGS_KEY as symbol]: context,
                    organization: computed(() => ({ time_format: '24-hours' })),
                },
            },
        });
        const request = (id: string) => {
            seq += 1;
            formRequest.value = { id, seq };
        };
        passMountTime();
        return { list, request };
    }

    function block(id: string): HTMLElement {
        return document.body.querySelector<HTMLElement>(`[data-ghost-id="${id}"]`)!;
    }

    function panel(): HTMLElement | null {
        return document.body.querySelector('[data-testid="outlook-ghost-detail"]');
    }

    function form(): HTMLElement | null {
        return document.body.querySelector('[data-testid="outlook-convert-form"]');
    }

    function card(): HTMLElement | null {
        return document.body.querySelector('[data-testid="outlook-hover-card"]');
    }

    async function advance(ms: number) {
        await vi.advanceTimersByTimeAsync(ms);
        await nextTick();
    }

    async function openFormOf(id: string) {
        block(id).click();
        await advance(20);
        document.body.querySelector<HTMLElement>('[data-testid="outlook-detail-create"]')!.click();
        await advance(20);
        expect(form()).not.toBeNull();
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

    it('"Create time entry" in an open panel switches that panel to form mode', async () => {
        mountForms([later('a', 8)]);
        block('a').click();
        await advance(20);
        expect(panel()?.getAttribute('data-mode')).toBe('detail');

        document.body.querySelector<HTMLElement>('[data-testid="outlook-detail-create"]')!.click();
        await advance(20);

        expect(panel()?.getAttribute('data-mode')).toBe('form');
        expect(panel()?.className).toContain('w-96');
        expect(form()).not.toBeNull();
        expect(block('a').hasAttribute('data-panel-open')).toBe(true);
    });

    it('offers no create action when the context cannot act', async () => {
        mountForms([later('a', 8)], false);
        block('a').click();
        await advance(20);

        expect(document.body.querySelector('[data-testid="outlook-detail-create"]')).toBeNull();
    });

    it('a formRequest for a meeting of this day opens its panel in form mode and closes its card', async () => {
        const { request } = mountForms([later('a', 8), later('b', 10)]);
        block('b').dispatchEvent(
            new PointerEvent('pointerenter', { bubbles: true, pointerType: 'mouse' })
        );
        await advance(400);
        expect(card()).not.toBeNull();

        request('b');
        await advance(20);

        expect(card()).toBeNull();
        expect(panel()?.getAttribute('data-mode')).toBe('form');
        expect(block('b').hasAttribute('data-panel-open')).toBe(true);
        expect(block('a').hasAttribute('data-panel-open')).toBe(false);
    });

    it('a formRequest for a meeting of another day does nothing here', async () => {
        const { request } = mountForms([later('a', 8)]);

        request('elsewhere');
        await advance(20);

        expect(panel()).toBeNull();
    });

    it('reopening the panel after a close shows the details again', async () => {
        mountForms([later('a', 8)]);
        await openFormOf('a');

        document.body.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        );
        await advance(20);
        expect(panel()).toBeNull();

        block('a').click();
        await advance(20);
        expect(panel()?.getAttribute('data-mode')).toBe('detail');
    });

    it('after converted the panel closes and focus moves to the next meeting of the day', async () => {
        const { list } = mountForms([later('a', 8), later('b', 10), later('c', 12)]);
        await openFormOf('b');

        // The context removes the converted meeting before the form reports done
        list.value = list.value.filter((item) => item.id !== 'b');
        document.body.querySelector<HTMLElement>('[data-testid="stub-done"]')!.click();
        await advance(20);

        expect(panel()).toBeNull();
        expect(block('b')).toBeNull();
        expect(document.activeElement).toBe(block('c'));
    });

    it('a converted meeting that leaves the lane before done still closes the panel; the last one focuses the previous', async () => {
        const { list } = mountForms([later('a', 8), later('b', 10)]);
        await openFormOf('b');

        list.value = list.value.filter((item) => item.id !== 'b');
        await advance(20);

        expect(panel()).toBeNull();
        expect(document.activeElement).toBe(block('a'));
    });

    it('converting the only meeting of the day focuses the Sync button', async () => {
        const { list } = mountForms([later('a', 8)]);
        await openFormOf('a');

        list.value = [];
        document.body.querySelector<HTMLElement>('[data-testid="stub-done"]')?.click();
        await advance(20);

        expect(document.body.querySelector('[data-calendar-overlay]')).toBeNull();
        expect(document.activeElement).toBe(
            document.body.querySelector('[data-testid="outlook-sync-button"]')
        );
    });

    it('after cancel-form the panel closes and focus returns to the block', async () => {
        mountForms([later('a', 8), later('b', 10)]);
        await openFormOf('a');

        document.body.querySelector<HTMLElement>('[data-testid="stub-cancel"]')!.click();
        await advance(20);

        expect(panel()).toBeNull();
        expect(document.activeElement).toBe(block('a'));
    });
});

describe('OutlookGhostLayer multi-select', () => {
    let wrapper: VueWrapper | null = null;

    const selectLabels = {
        ...labels,
        hover_hint: 'Click for details',
        hover_hint_select: 'Click for details. Ctrl+click to select several.',
        hover_hint_select_mac: 'Click for details. ⌘+click to select several.',
        create_entry: 'Create time entry',
        selected_suffix: ', selected',
    } as OutlookCalendarLabels;

    const at = (
        id: string,
        day: string,
        hour: number,
        minutes = 60,
        extra: Partial<OutlookMeeting> = {}
    ) => {
        const start = `${day}T${String(hour).padStart(2, '0')}:00:00Z`;
        const end = new Date(new Date(start).getTime() + minutes * 60_000)
            .toISOString()
            .replace('.000Z', 'Z');
        return meeting({ id, subject: 'Meeting ' + id, start, end, ...extra });
    };

    // Every rendered day gets its own lane inside one calendar root (.fc), all sharing one context
    // whose meeting list may hold meetings of days that are not rendered.
    function mountSelect(all: OutlookMeeting[], days: string[] = [DAY], canAct = true) {
        const root = document.createElement('div');
        root.className = 'fc';
        document.body.appendChild(root);
        const list = ref(all);
        const canActRef = ref(canAct);
        const base = useOutlookSelection();
        // Like the composable: inert while the context cannot act
        const selection: OutlookSelection = {
            ...base,
            toggle: (id) => {
                if (canActRef.value) base.toggle(id);
            },
            selectRange: (id, candidates) => {
                if (canActRef.value) base.selectRange(id, candidates);
            },
        };
        const context = {
            canAct: canActRef,
            includeDismissed: ref(false),
            meetings: list,
            dismiss: vi.fn(),
            restore: vi.fn(),
            openForm: vi.fn(),
            formRequest: ref(null),
            selection,
        } as unknown as OutlookMeetingsContext;
        const Host = defineComponent({
            setup() {
                return () =>
                    h(
                        'div',
                        days.map((day) =>
                            h(OutlookGhostLayer, {
                                key: day,
                                meetings: list.value,
                                labels: selectLabels,
                                dayStr: day,
                                isDayView: false,
                                minutesToPixels,
                                settings,
                            })
                        )
                    );
            },
        });
        wrapper = mount(Host, {
            attachTo: root,
            global: {
                provide: {
                    [OUTLOOK_MEETINGS_KEY as symbol]: context,
                    organization: computed(() => ({ time_format: '24-hours' })),
                },
            },
        });
        passMountTime();
        return { selection, list };
    }

    function block(id: string): HTMLElement {
        return document.body.querySelector<HTMLElement>(`[data-ghost-id="${id}"]`)!;
    }

    function panel(): HTMLElement | null {
        return document.body.querySelector('[data-testid="outlook-ghost-detail"]');
    }

    function card(): HTMLElement | null {
        return document.body.querySelector('[data-testid="outlook-hover-card"]');
    }

    function click(el: Element, init: MouseEventInit = {}) {
        passMountTime();
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
    }

    function enter(el: Element, init: KeyboardEventInit = {}) {
        passMountTime();
        el.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init })
        );
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

    it.each([
        ['ctrlKey', { ctrlKey: true }],
        ['metaKey', { metaKey: true }],
    ])('a %s click toggles the meeting without opening the panel', async (_name, init) => {
        const { selection } = mountSelect([at('a', DAY, 8), at('b', DAY, 10)]);

        click(block('a'), init);
        await advance(20);

        expect(selection.selectedIds.value).toEqual(['a']);
        expect(selection.anchorId.value).toBe('a');
        expect(block('a').hasAttribute('data-selected')).toBe(true);
        expect(block('b').hasAttribute('data-selected')).toBe(false);
        expect(panel()).toBeNull();
        expect(block('a').hasAttribute('data-panel-open')).toBe(false);

        click(block('a'), init);
        await advance(20);

        expect(selection.selectedIds.value).toEqual([]);
        expect(block('a').hasAttribute('data-selected')).toBe(false);
        expect(panel()).toBeNull();
    });

    it('a shift-click adds every rendered meeting between the anchor and the clicked one', async () => {
        const later = '2026-10-22';
        const hidden = '2026-10-21';
        const { selection } = mountSelect(
            [
                at('a', DAY, 8),
                at('b', DAY, 10),
                at('h', hidden, 9),
                at('c', later, 8),
                at('d', later, 10),
            ],
            [DAY, later]
        );
        expect(document.body.querySelector('[data-ghost-id="h"]')).toBeNull();

        click(block('b'), { ctrlKey: true });
        await advance(20);
        click(block('c'), { shiftKey: true });
        await advance(20);

        expect([...selection.selectedIds.value].sort()).toEqual(['b', 'c']);
        expect(block('b').hasAttribute('data-selected')).toBe(true);
        expect(block('c').hasAttribute('data-selected')).toBe(true);
        expect(block('a').hasAttribute('data-selected')).toBe(false);
        expect(block('d').hasAttribute('data-selected')).toBe(false);
        expect(panel()).toBeNull();
    });

    it('Ctrl+Enter toggles, Shift+Enter adds the range, plain Enter opens the panel', async () => {
        const { selection } = mountSelect([at('a', DAY, 8), at('b', DAY, 10), at('c', DAY, 12)]);

        enter(block('a'), { ctrlKey: true });
        await advance(20);
        expect(selection.selectedIds.value).toEqual(['a']);
        expect(panel()).toBeNull();

        enter(block('a'), { metaKey: true });
        await advance(20);
        expect(selection.selectedIds.value).toEqual([]);

        enter(block('a'), { ctrlKey: true });
        enter(block('c'), { shiftKey: true });
        await advance(20);
        expect(selection.selectedIds.value).toEqual(['a', 'b', 'c']);
        expect(panel()).toBeNull();

        enter(block('b'));
        await advance(20);
        expect(panel()).not.toBeNull();
        expect(block('b').hasAttribute('data-panel-open')).toBe(true);
        // A panel and a selection never coexist
        expect(selection.selectedIds.value).toEqual([]);
    });

    it('a modifier click closes an open panel; a plain click clears the selection and opens the panel', async () => {
        const { selection } = mountSelect([at('a', DAY, 8), at('b', DAY, 10)]);

        click(block('a'));
        await advance(20);
        expect(panel()).not.toBeNull();

        click(block('b'), { ctrlKey: true });
        await advance(20);
        expect(panel()).toBeNull();
        expect(block('a').hasAttribute('data-panel-open')).toBe(false);
        expect(selection.selectedIds.value).toEqual(['b']);

        click(block('a'));
        await advance(20);
        expect(selection.selectedIds.value).toEqual([]);
        expect(block('b').hasAttribute('data-selected')).toBe(false);
        expect(panel()).not.toBeNull();
        expect(block('a').hasAttribute('data-panel-open')).toBe(true);
    });

    it('marks selected blocks with aria-pressed, the label suffix, the ring and a badge by tier', async () => {
        mountSelect([at('a', DAY, 8, 40), at('b', DAY, 10, 20), at('c', DAY, 12)]);

        // No selection: no aria-pressed at all, no badge
        expect(block('a').hasAttribute('aria-pressed')).toBe(false);
        expect(block('c').hasAttribute('aria-pressed')).toBe(false);
        expect(document.body.querySelector('[data-ghost-badge]')).toBeNull();

        click(block('a'), { ctrlKey: true });
        click(block('b'), { ctrlKey: true });
        await advance(20);

        expect(block('a').getAttribute('aria-pressed')).toBe('true');
        expect(block('b').getAttribute('aria-pressed')).toBe('true');
        expect(block('c').getAttribute('aria-pressed')).toBe('false');
        expect(block('a').getAttribute('aria-label')).toMatch(/, selected$/);
        expect(block('c').getAttribute('aria-label')).not.toContain('selected');

        expect(block('a').className).toContain('m365-meeting--selected');
        expect(block('a').className).toContain('ring-2');
        expect(block('a').className).toContain('ring-accent-700');
        expect(block('a').className).toContain('dark:ring-accent-200');
        expect(block('c').className).not.toContain('m365-meeting--selected');

        // 40px block (tier 3): 16px badge; 20px block (tier 2): 12px badge; both aria-hidden
        const badgeA = block('a').querySelector('[data-ghost-badge]');
        const badgeB = block('b').querySelector('[data-ghost-badge]');
        expect(block('a').querySelector('[data-ghost-tier]')?.getAttribute('data-ghost-tier')).toBe(
            '3'
        );
        expect(block('b').querySelector('[data-ghost-tier]')?.getAttribute('data-ghost-tier')).toBe(
            '2'
        );
        expect(badgeA?.getAttribute('class')).toContain('size-4');
        expect(badgeA?.getAttribute('aria-hidden')).toBe('true');
        expect(badgeA?.querySelector('svg')?.getAttribute('class')).toContain('size-3');
        expect(badgeB?.getAttribute('class')).toContain('size-3');
        expect(badgeB?.getAttribute('aria-hidden')).toBe('true');
        expect(badgeB?.querySelector('svg')?.getAttribute('class')).toContain('size-2');
        expect(block('c').querySelector('[data-ghost-badge]')).toBeNull();
    });

    it('a selected dismissed meeting keeps its dotted variant', async () => {
        mountSelect([at('a', DAY, 8, 60, { dismissed: true })]);

        click(block('a'), { ctrlKey: true });
        await advance(20);

        expect(block('a').className).toContain('m365-meeting--dismissed');
        expect(block('a').hasAttribute('data-selected')).toBe(true);
        expect(block('a').getAttribute('aria-label')).toMatch(/, dismissed, selected$/);
    });

    it('without canAct a ctrl-click opens the panel and selects nothing', async () => {
        // The link gives the read-only panel a focusable element: in happy-dom a popover without one
        // loses focus to the page and closes again at once.
        const { selection } = mountSelect(
            [at('a', DAY, 8, 60, { web_link: 'https://outlook.example.test/a' })],
            [DAY],
            false
        );

        click(block('a'), { ctrlKey: true });
        await advance(20);

        expect(selection.selectedIds.value).toEqual([]);
        expect(block('a').hasAttribute('data-selected')).toBe(false);
        expect(block('a').hasAttribute('aria-pressed')).toBe(false);
        expect(panel()).not.toBeNull();
    });

    it('refuses a hover card while a selection exists and a modifier is held', async () => {
        mountSelect([at('a', DAY, 8), at('b', DAY, 10), at('c', DAY, 12)]);
        const hover = (el: Element, init: PointerEventInit = {}) =>
            el.dispatchEvent(
                new PointerEvent('pointerenter', { bubbles: true, pointerType: 'mouse', ...init })
            );
        const unhover = async (el: Element) => {
            el.dispatchEvent(
                new PointerEvent('pointerleave', { bubbles: true, pointerType: 'mouse' })
            );
            await advance(200);
        };

        // Without a selection a held modifier changes nothing
        hover(block('c'), { ctrlKey: true });
        await advance(400);
        expect(card()?.textContent).toContain('Meeting c');

        // A modifier click closes the card and selects
        click(block('a'), { ctrlKey: true });
        await advance(20);
        expect(card()).toBeNull();
        await unhover(block('c'));

        for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
            hover(block('b'), init);
            await advance(1000);
            expect(card()).toBeNull();
            await unhover(block('b'));
        }

        // Modifiers released: the card opens again
        document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true }));
        hover(block('b'));
        await advance(400);
        expect(card()?.textContent).toContain('Meeting b');
    });
});

// Phase 5: the pre-assigned panel (Confirm, Edit) against an injected context that mirrors the
// composable: confirmOne marks the meeting pending, settles with the queued answer and removes a
// created or existing meeting from the list.
describe('OutlookGhostLayer pre-assigned meetings (Phase 5)', () => {
    let wrapper: VueWrapper | null = null;

    const FormStub = defineComponent({
        name: 'OutlookConvertForm',
        emits: ['done', 'cancel', 'busy'],
        setup() {
            return () => h('div', { 'data-testid': 'outlook-convert-form' });
        },
    });

    const at = (id: string, hour: number, overrides: Partial<OutlookMeeting> = {}) =>
        meeting({
            id,
            subject: 'Meeting ' + id,
            start: `2026-10-20T${String(hour).padStart(2, '0')}:00:00Z`,
            end: `2026-10-20T${String(hour + 1).padStart(2, '0')}:00:00Z`,
            ...overrides,
        });

    const preassigned = (id: string, hour: number, overrides: Partial<OutlookMeeting> = {}) =>
        at(id, hour, { series_key: 'series-' + id, assignment, ...overrides });

    function created(id: string): OutlookConversionResult {
        return { meeting_id: id, status: 'created', time_entry_id: 'te-' + id, error: null };
    }

    function failed(id: string, message: string): OutlookConversionResult {
        return {
            meeting_id: id,
            status: 'failed',
            time_entry_id: null,
            error: message ? { key: 'project_archived', message } : null,
        };
    }

    function mountPhase5(
        initial: OutlookMeeting[],
        options: { canAct?: boolean; includeDismissed?: boolean; selected?: string[] } = {}
    ) {
        const includeDismissed = options.includeDismissed ?? false;
        const root = document.createElement('div');
        root.className = 'fc';
        document.body.appendChild(root);
        const list = ref(initial);
        const pending = ref<string[]>([]);
        let settleConfirm: (result: OutlookConversionResult | null) => void = () => undefined;
        const confirmOne = vi.fn(async (id: string) => {
            pending.value = [...pending.value, id];
            const result = await new Promise<OutlookConversionResult | null>((resolve) => {
                settleConfirm = resolve;
            });
            pending.value = pending.value.filter((item) => item !== id);
            if (result && (result.status === 'created' || result.status === 'existing')) {
                list.value = list.value.filter((item) => item.id !== id);
            }
            return result;
        });
        // Mirror the composable's optimistic series actions over the occurrences of the series
        const seriesOf = (id: string) => list.value.find((item) => item.id === id)?.series_key;
        const ignoreSeries = vi.fn(async (id: string) => {
            const key = seriesOf(id);
            list.value = includeDismissed
                ? list.value.map((item) =>
                      item.series_key === key ? { ...item, series_ignored: true } : item
                  )
                : list.value.filter((item) => item.series_key !== key);
        });
        const unignoreSeries = vi.fn(async (id: string) => {
            const key = seriesOf(id);
            list.value = list.value.map((item) =>
                item.series_key === key ? { ...item, series_ignored: false } : item
            );
        });
        const forgetSeries = vi.fn(async (id: string) => {
            const key = seriesOf(id);
            list.value = list.value.map((item) =>
                item.series_key === key ? { ...item, assignment: null } : item
            );
        });
        const selectedIds = ref<string[]>(options.selected ?? []);
        const context = {
            canAct: ref(options.canAct ?? true),
            includeDismissed: ref(includeDismissed),
            dismiss: vi.fn(),
            restore: vi.fn(),
            formRequest: ref(null),
            confirmOne,
            isConfirmPending: (id: string) => pending.value.includes(id),
            ignoreSeries,
            unignoreSeries,
            forgetSeries,
            selection: {
                selectedIds,
                isSelected: (id: string) => selectedIds.value.includes(id),
                clear: () => (selectedIds.value = []),
                toggle: vi.fn(),
                selectRange: vi.fn(),
            },
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
        wrapper = mount(Host, {
            attachTo: root,
            global: {
                stubs: { OutlookConvertForm: FormStub },
                provide: {
                    [OUTLOOK_MEETINGS_KEY as symbol]: context,
                    organization: computed(() => ({ time_format: '24-hours' })),
                },
            },
        });
        passMountTime();
        return {
            list,
            context,
            confirmOne,
            pending,
            ignoreSeries,
            unignoreSeries,
            forgetSeries,
            answer: async (result: OutlookConversionResult | null) => {
                settleConfirm(result);
                await advance(20);
            },
        };
    }

    function block(id: string): HTMLElement {
        return document.body.querySelector<HTMLElement>(`[data-ghost-id="${id}"]`)!;
    }

    function panel(): HTMLElement | null {
        return document.body.querySelector('[data-testid="outlook-ghost-detail"]');
    }

    function byTestId(id: string): HTMLElement | null {
        return document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    }

    async function advance(ms: number) {
        await vi.advanceTimersByTimeAsync(ms);
        await nextTick();
    }

    async function openPanel(id: string) {
        block(id).click();
        await advance(20);
        expect(panel()).not.toBeNull();
    }

    beforeEach(() => {
        vi.useFakeTimers();
        resetHoverCardDelay();
        vi.mocked(window.getTimezoneSetting).mockReturnValue('Europe/Madrid');
    });

    afterEach(() => {
        wrapper?.unmount();
        wrapper = null;
        document.body.innerHTML = '';
        resetHoverCardDelay();
        vi.useRealTimers();
        vi.mocked(window.getTimezoneSetting).mockReturnValue('UTC');
    });

    describe('panel Confirm', () => {
        it('the panel of a pre-assigned meeting shows the full pre-assignment, Edit and Confirm', async () => {
            mountPhase5([preassigned('a', 8)]);
            await openPanel('a');

            expect(byTestId('outlook-detail-preassignment')).not.toBeNull();
            expect(byTestId('outlook-detail-why')).not.toBeNull();
            expect(byTestId('outlook-detail-edit')).not.toBeNull();
            expect(byTestId('outlook-detail-confirm')).not.toBeNull();
        });

        it('calls confirmOne once; created closes the panel and focuses the next meeting', async () => {
            const mounted = mountPhase5([preassigned('a', 8), at('b', 10)]);
            await openPanel('a');

            byTestId('outlook-detail-confirm')!.click();
            await advance(20);
            expect(mounted.confirmOne).toHaveBeenCalledTimes(1);
            expect(mounted.confirmOne).toHaveBeenCalledWith('a');
            // Pessimistic: the panel stays open with the spinner while the request runs
            expect(panel()).not.toBeNull();
            expect((byTestId('outlook-detail-confirm') as HTMLButtonElement).disabled).toBe(true);
            byTestId('outlook-detail-confirm')!.click();
            expect(mounted.confirmOne).toHaveBeenCalledTimes(1);

            await mounted.answer(created('a'));

            expect(panel()).toBeNull();
            expect(document.body.querySelector('[data-ghost-id="a"]')).toBeNull();
            expect(document.activeElement).toBe(block('b'));
        });

        it('confirming the last meeting of the day focuses the Sync button', async () => {
            const mounted = mountPhase5([preassigned('a', 8)]);
            await openPanel('a');

            byTestId('outlook-detail-confirm')!.click();
            await advance(20);
            await mounted.answer({ ...created('a'), status: 'existing' });

            expect(panel()).toBeNull();
            expect(document.activeElement).toBe(byTestId('outlook-sync-button'));
        });

        it('a failure keeps the panel open with the reason as an inline alert', async () => {
            const mounted = mountPhase5([preassigned('a', 8)]);
            await openPanel('a');

            byTestId('outlook-detail-confirm')!.click();
            await advance(20);
            await mounted.answer(failed('a', 'This project is archived.'));

            expect(panel()).not.toBeNull();
            const alert = panel()!.querySelector('[role="alert"]');
            expect(alert?.textContent?.trim()).toBe('This project is archived.');
            expect((byTestId('outlook-detail-confirm') as HTMLButtonElement).disabled).toBe(false);
            expect(block('a').hasAttribute('data-preassigned')).toBe(true);
        });

        it('a failure without a message shows "Could not confirm this meeting"', async () => {
            const mounted = mountPhase5([preassigned('a', 8)]);
            await openPanel('a');

            byTestId('outlook-detail-confirm')!.click();
            await advance(20);
            await mounted.answer(failed('a', ''));

            expect(panel()!.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
                'Could not confirm this meeting'
            );
        });

        it('the inline reason is gone after the panel closes and opens again', async () => {
            const mounted = mountPhase5([preassigned('a', 8)]);
            await openPanel('a');
            byTestId('outlook-detail-confirm')!.click();
            await advance(20);
            await mounted.answer(failed('a', 'This project is archived.'));
            expect(panel()!.querySelector('[role="alert"]')).not.toBeNull();

            keydown(document.body, 'Escape');
            await advance(20);
            expect(panel()).toBeNull();
            passMountTime();
            await openPanel('a');

            expect(panel()!.querySelector('[role="alert"]')).toBeNull();
        });

        it('nothing sent (null answer) leaves the panel as it was', async () => {
            const mounted = mountPhase5([preassigned('a', 8)]);
            await openPanel('a');

            byTestId('outlook-detail-confirm')!.click();
            await advance(20);
            await mounted.answer(null);

            expect(panel()).not.toBeNull();
            expect(panel()!.querySelector('[role="alert"]')).toBeNull();
        });

        it('Edit switches the panel to the form (the existing create path)', async () => {
            const mounted = mountPhase5([preassigned('a', 8)]);
            await openPanel('a');

            byTestId('outlook-detail-edit')!.click();
            await advance(20);

            expect(panel()?.getAttribute('data-mode')).toBe('form');
            expect(byTestId('outlook-convert-form')).not.toBeNull();
            expect(mounted.confirmOne).not.toHaveBeenCalled();
        });

        it('without canAct: the line shows, but no pre-assignment block, Edit or Confirm', async () => {
            mountPhase5([preassigned('a', 8)], { canAct: false });

            expect(
                block('a').querySelector('[data-testid="outlook-preassigned-line"]')
            ).not.toBeNull();
            // Read on the render that opens the panel: in happy-dom a panel without any focusable
            // content closes again on the next focus pass (pre-existing, any meeting).
            block('a').click();
            await nextTick();
            expect(panel()).not.toBeNull();
            expect(byTestId('outlook-detail-preassignment')).toBeNull();
            expect(byTestId('outlook-detail-edit')).toBeNull();
            expect(byTestId('outlook-detail-confirm')).toBeNull();
        });
    });

    describe('panel focus and pending block', () => {
        function spinnerOf(id: string): Element | null {
            return block(id).querySelector('[data-testid="outlook-preassigned-spinner"]');
        }

        function dotOf(id: string): Element | null {
            return block(id).querySelector('[data-testid="outlook-project-dot"]');
        }

        it('Enter on a pre-assigned block opens the panel with focus on Confirm', async () => {
            mountPhase5([preassigned('a', 8)]);
            block('a').focus();

            keydown(block('a'), 'Enter');
            await advance(20);

            expect(panel()).not.toBeNull();
            expect(document.activeElement).toBe(byTestId('outlook-detail-confirm'));
        });

        it('the panel is w-96 for every meeting', async () => {
            mountPhase5([at('a', 8)]);
            await openPanel('a');

            expect(panel()!.className).toContain('w-96');
            expect(panel()!.className).not.toContain('w-80');
        });

        it('while the confirm runs the dot becomes a 12px spinner, aria-busy and cursor-progress', async () => {
            const mounted = mountPhase5([preassigned('a', 8)]);
            expect(dotOf('a')).not.toBeNull();
            expect(block('a').hasAttribute('aria-busy')).toBe(false);
            expect(block('a').classList.contains('cursor-pointer')).toBe(true);
            await openPanel('a');

            byTestId('outlook-detail-confirm')!.click();
            await advance(20);

            const spinner = spinnerOf('a');
            expect(spinner).not.toBeNull();
            expect(spinner!.getAttribute('class')).toContain('h-3');
            expect(spinner!.getAttribute('class')).toContain('w-3');
            expect(dotOf('a')).toBeNull();
            expect(block('a').getAttribute('aria-busy')).toBe('true');
            expect(block('a').classList.contains('cursor-progress')).toBe(true);
            expect(block('a').classList.contains('cursor-pointer')).toBe(false);
            // No opacity change on the text (the spinner's own arcs are not text)
            expect(block('a').className).not.toMatch(/\bopacity-/);
            expect(block('a').querySelector('[data-ghost-subject]')!.className).not.toMatch(
                /\bopacity-/
            );
            expect(
                block('a').querySelector('[data-testid="outlook-preassigned-line"]')!.className
            ).not.toMatch(/\bopacity-/);

            await mounted.answer(failed('a', 'This project is archived.'));

            expect(spinnerOf('a')).toBeNull();
            expect(dotOf('a')).not.toBeNull();
            expect(block('a').hasAttribute('aria-busy')).toBe(false);
            expect(block('a').classList.contains('cursor-pointer')).toBe(true);
        });

        it('a confirm running from another surface (context pending) shows the same state', async () => {
            const mounted = mountPhase5([preassigned('a', 8), preassigned('b', 10)]);

            mounted.pending.value = ['b'];
            await nextTick();

            expect(block('b').getAttribute('aria-busy')).toBe('true');
            expect(spinnerOf('b')).not.toBeNull();
            expect(block('a').hasAttribute('aria-busy')).toBe(false);
            expect(spinnerOf('a')).toBeNull();
        });

        it('on one-line tiers the spinner replaces the dot before the subject', async () => {
            const mounted = mountPhase5([
                preassigned('a', 8, {
                    end: '2026-10-20T08:20:00Z',
                }),
            ]);
            expect(
                block('a').querySelector('[data-ghost-tier]')!.getAttribute('data-ghost-tier')
            ).toBe('2');

            mounted.pending.value = ['a'];
            await nextTick();

            const html = block('a').innerHTML;
            expect(html.indexOf('outlook-preassigned-spinner')).toBeGreaterThan(-1);
            expect(html.indexOf('outlook-preassigned-spinner')).toBeLessThan(
                html.indexOf('data-ghost-subject')
            );
            expect(dotOf('a')).toBeNull();
        });

        it('a plain meeting never shows the spinner', async () => {
            const mounted = mountPhase5([at('a', 8)]);

            mounted.pending.value = ['a'];
            await nextTick();

            expect(spinnerOf('a')).toBeNull();
        });
    });

    describe('ignored series and series actions', () => {
        async function pickFromMenu(id: string, item: string) {
            await openPanel(id);
            byTestId('outlook-detail-more')!.click();
            await advance(20);
            expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
            byTestId(item)!.click();
            await advance(20);
        }

        it('an occurrence of an ignored series uses the dismissed variant, no project line', () => {
            mountPhase5([preassigned('a', 8, { series_ignored: true }), preassigned('b', 10)], {
                includeDismissed: true,
            });

            const ignored = block('a');
            expect(ignored.classList.contains('m365-meeting--dismissed')).toBe(true);
            expect(ignored.hasAttribute('data-preassigned')).toBe(false);
            expect(ignored.querySelector('[data-testid="outlook-preassigned-line"]')).toBeNull();
            expect(ignored.querySelector('[data-testid="outlook-project-dot"]')).toBeNull();
            expect(ignored.querySelector('svg.lucide-eye-off')).not.toBeNull();
            expect(
                ignored.querySelector('[data-ghost-subject]')!.classList.contains('font-semibold')
            ).toBe(false);
            expect(ignored.getAttribute('aria-label')).toBe(
                'Meeting a, 10:00 to 11:00, Outlook meeting suggestion, series ignored'
            );

            expect(block('b').classList.contains('m365-meeting--dismissed')).toBe(false);
            expect(block('b').hasAttribute('data-preassigned')).toBe(true);
        });

        it('an ignored occurrence that is also dismissed reads as series ignored only', () => {
            mountPhase5([at('a', 8, { series_key: 's', series_ignored: true, dismissed: true })], {
                includeDismissed: true,
            });

            const label = block('a').getAttribute('aria-label')!;
            expect(label).toMatch(/, series ignored$/);
            expect(label).not.toContain('dismissed');
        });

        it('its panel shows the series-ignored eyebrow', async () => {
            mountPhase5([at('a', 8, { series_key: 's', series_ignored: true })], {
                includeDismissed: true,
            });
            await openPanel('a');

            expect(panel()!.textContent).toContain('Outlook meeting · Series ignored');
        });

        it('a selected pre-assigned block keeps its ring, badge and project line', () => {
            mountPhase5([preassigned('a', 8)], { selected: ['a'] });

            const selected = block('a');
            expect(selected.classList.contains('m365-meeting--selected')).toBe(true);
            expect(selected.querySelector('[data-ghost-badge]')).not.toBeNull();
            expect(
                selected.querySelector('[data-testid="outlook-preassigned-line"]')
            ).not.toBeNull();
            expect(selected.getAttribute('aria-label')).toBe(
                'Meeting a, 10:00 to 11:00, Outlook meeting suggestion, pre-assigned to Acme Website, selected'
            );
        });

        it('Always ignore calls ignoreSeries, closes the panel and focuses the next meeting outside the series', async () => {
            const mounted = mountPhase5([
                preassigned('a', 8, { series_key: 'weekly' }),
                preassigned('b', 10, { series_key: 'weekly' }),
                at('c', 12),
            ]);

            await pickFromMenu('a', 'outlook-more-ignore-series');

            expect(mounted.ignoreSeries).toHaveBeenCalledWith('a');
            expect(panel()).toBeNull();
            expect(document.body.querySelector('[data-ghost-id="a"]')).toBeNull();
            expect(document.body.querySelector('[data-ghost-id="b"]')).toBeNull();
            expect(document.activeElement).toBe(block('c'));
        });

        it('Always ignore on the only series of the day focuses the Sync button', async () => {
            mountPhase5([at('a', 8, { series_key: 'weekly' })]);

            await pickFromMenu('a', 'outlook-more-ignore-series');

            expect(document.activeElement).toBe(byTestId('outlook-sync-button'));
        });

        it('Always ignore while dismissed meetings are shown keeps focus on the same, faded block', async () => {
            const mounted = mountPhase5([preassigned('a', 8), at('b', 10)], {
                includeDismissed: true,
            });

            await pickFromMenu('a', 'outlook-more-ignore-series');

            expect(mounted.ignoreSeries).toHaveBeenCalledWith('a');
            expect(panel()).toBeNull();
            expect(block('a').classList.contains('m365-meeting--dismissed')).toBe(true);
            expect(document.activeElement).toBe(block('a'));
        });

        it('Stop ignoring calls unignoreSeries and keeps focus on the same block', async () => {
            const mounted = mountPhase5(
                [preassigned('a', 8, { series_ignored: true }), at('b', 10)],
                { includeDismissed: true }
            );

            await pickFromMenu('a', 'outlook-more-unignore-series');

            expect(mounted.unignoreSeries).toHaveBeenCalledWith('a');
            expect(panel()).toBeNull();
            expect(block('a').classList.contains('m365-meeting--dismissed')).toBe(false);
            expect(block('a').hasAttribute('data-preassigned')).toBe(true);
            expect(document.activeElement).toBe(block('a'));
        });

        it('Forget calls forgetSeries, the block turns plain and keeps focus', async () => {
            const mounted = mountPhase5([preassigned('a', 8), at('b', 10)]);

            await pickFromMenu('a', 'outlook-more-forget-series');

            expect(mounted.forgetSeries).toHaveBeenCalledWith('a');
            expect(panel()).toBeNull();
            expect(block('a').hasAttribute('data-preassigned')).toBe(false);
            expect(block('a').querySelector('[data-testid="outlook-preassigned-line"]')).toBeNull();
            expect(document.activeElement).toBe(block('a'));
        });

        it('Dismiss from the More actions menu follows the Dismiss rule', async () => {
            const mounted = mountPhase5([preassigned('a', 8), at('b', 10)]);

            await pickFromMenu('a', 'outlook-more-dismiss');

            expect(mounted.context.dismiss).toHaveBeenCalledWith('a');
            expect(panel()).toBeNull();
        });
    });
});

// Phase 6 (D-03, UI-SPEC section 4): a meeting Outlook moved after it started. The context is a
// stand-in for the composable: moveEntry marks the meeting pending, settles with the queued answer
// and, on ok, removes the meeting from the list (it is linked now). A logged entry block with
// [data-event-id] stands in for the core calendar entry.
describe('OutlookGhostLayer moved meeting (Phase 6, D-03)', () => {
    let wrapper: VueWrapper | null = null;

    const movedFrom = {
        time_entry_id: 'te-old',
        entry_start: '2026-10-19T08:00:00Z',
        entry_end: '2026-10-19T09:00:00Z',
    };

    const at = (id: string, hour: number, overrides: Partial<OutlookMeeting> = {}) =>
        meeting({
            id,
            subject: 'Meeting ' + id,
            start: `2026-10-20T${String(hour).padStart(2, '0')}:00:00Z`,
            end: `2026-10-20T${String(hour + 1).padStart(2, '0')}:00:00Z`,
            ...overrides,
        });

    const moved = (id: string, hour: number, overrides: Partial<OutlookMeeting> = {}) =>
        at(id, hour, { moved_from: movedFrom, ...overrides });

    function mountMoved(
        initial: OutlookMeeting[],
        options: { canAct?: boolean; withEntry?: boolean } = {}
    ) {
        const root = document.createElement('div');
        root.className = 'fc';
        document.body.appendChild(root);
        const list = ref(initial);
        const movePending = ref<string[]>([]);
        const confirmPending = ref<string[]>([]);
        let settleMove: (result: OutlookFlagActionResult) => void = () => undefined;
        const moveEntry = vi.fn(async (id: string) => {
            movePending.value = [...movePending.value, id];
            const result = await new Promise<OutlookFlagActionResult>((resolve) => {
                settleMove = resolve;
            });
            movePending.value = movePending.value.filter((item) => item !== id);
            if (result.status === 'ok') list.value = list.value.filter((item) => item.id !== id);
            return result;
        });
        const selectedIds = ref<string[]>([]);
        const context = {
            canAct: ref(options.canAct ?? true),
            includeDismissed: ref(false),
            dismiss: vi.fn(),
            restore: vi.fn(),
            formRequest: ref(null),
            confirmOne: vi.fn(),
            isConfirmPending: (id: string) => confirmPending.value.includes(id),
            moveEntry,
            isMovePending: (id: string) => movePending.value.includes(id),
            selection: {
                selectedIds,
                isSelected: (id: string) => selectedIds.value.includes(id),
                clear: () => (selectedIds.value = []),
                toggle: vi.fn(),
                selectRange: vi.fn(),
            },
        } as unknown as OutlookMeetingsContext;
        const Host = defineComponent({
            setup() {
                return () =>
                    h('div', [
                        options.withEntry === false
                            ? null
                            : h('div', { 'data-event-id': 'te-old', tabindex: 0 }, 'Logged entry'),
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
        wrapper = mount(Host, {
            attachTo: root,
            global: {
                provide: {
                    [OUTLOOK_MEETINGS_KEY as symbol]: context,
                    organization: computed(() => ({ time_format: '24-hours' })),
                },
            },
        });
        passMountTime();
        return {
            list,
            context,
            moveEntry,
            movePending,
            confirmPending,
            answer: async (result: OutlookFlagActionResult) => {
                settleMove(result);
                await advance(20);
            },
        };
    }

    function block(id: string): HTMLElement {
        return document.body.querySelector<HTMLElement>(`[data-ghost-id="${id}"]`)!;
    }

    function panel(): HTMLElement | null {
        return document.body.querySelector('[data-testid="outlook-ghost-detail"]');
    }

    function byTestId(id: string): HTMLElement | null {
        return document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    }

    async function advance(ms: number) {
        await vi.advanceTimersByTimeAsync(ms);
        await nextTick();
    }

    async function openPanel(id: string) {
        block(id).click();
        await advance(20);
        expect(panel()).not.toBeNull();
    }

    async function pressMove() {
        byTestId('outlook-detail-move-entry')!.click();
        await advance(20);
    }

    beforeEach(() => {
        vi.useFakeTimers();
        resetHoverCardDelay();
        vi.mocked(window.getTimezoneSetting).mockReturnValue('UTC');
    });

    afterEach(() => {
        wrapper?.unmount();
        wrapper = null;
        document.body.innerHTML = '';
        resetHoverCardDelay();
        vi.useRealTimers();
        vi.mocked(window.getTimezoneSetting).mockReturnValue('UTC');
    });

    describe('Move my entry here from the panel', () => {
        it('the panel of a moved meeting shows the moved block and keeps Create time entry', async () => {
            mountMoved([moved('a', 8)]);
            await openPanel('a');

            expect(byTestId('outlook-moved-block')).not.toBeNull();
            expect(byTestId('outlook-moved-body')?.textContent?.trim()).toBe(
                'You logged it on Mon, Oct 19 · 08:00 – 09:00. Create a new entry for this session, or move that one here.'
            );
            expect(byTestId('outlook-detail-create')).not.toBeNull();
        });

        it('a meeting without moved_from has no moved block', async () => {
            mountMoved([at('a', 8)]);
            await openPanel('a');

            expect(byTestId('outlook-moved-block')).toBeNull();
            expect(byTestId('outlook-detail-move-entry')).toBeNull();
        });

        it('calls moveEntry once with the meeting id', async () => {
            const mounted = mountMoved([moved('a', 8)]);
            await openPanel('a');

            await pressMove();
            await pressMove();

            expect(mounted.moveEntry).toHaveBeenCalledTimes(1);
            expect(mounted.moveEntry).toHaveBeenCalledWith('a');
        });

        it('while the move runs: button loading, Create and More disabled, panel not dismissable', async () => {
            mountMoved([moved('a', 8)]);
            await openPanel('a');

            await pressMove();

            const move = byTestId('outlook-detail-move-entry') as HTMLButtonElement;
            expect(move.disabled).toBe(true);
            expect(move.querySelector('svg.animate-spin')).not.toBeNull();
            expect((byTestId('outlook-detail-create') as HTMLButtonElement).disabled).toBe(true);
            expect((byTestId('outlook-detail-more') as HTMLButtonElement).disabled).toBe(true);

            document.body.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
            );
            await advance(20);
            expect(panel()).not.toBeNull();
        });

        it('ok: the meeting leaves the lane, the panel closes, focus goes to the moved entry', async () => {
            const mounted = mountMoved([moved('a', 8), at('b', 10)]);
            await openPanel('a');
            await pressMove();

            await mounted.answer({ status: 'ok' });

            expect(panel()).toBeNull();
            expect(block('a')).toBeNull();
            expect(document.activeElement).toBe(
                document.body.querySelector('[data-event-id="te-old"]')
            );
        });

        it('ok without a rendered entry block: focus follows the removal rule', async () => {
            const mounted = mountMoved([moved('a', 8), at('b', 10)], { withEntry: false });
            await openPanel('a');
            await pressMove();

            await mounted.answer({ status: 'ok' });

            expect(panel()).toBeNull();
            expect(document.activeElement).toBe(block('b'));
        });

        it('ok on the last meeting without an entry block: focus goes to the Sync button', async () => {
            const mounted = mountMoved([moved('a', 8)], { withEntry: false });
            await openPanel('a');
            await pressMove();

            await mounted.answer({ status: 'ok' });

            expect(document.activeElement).toBe(byTestId('outlook-sync-button'));
        });

        it('failed: the panel stays open with the alert and focus returns to the button', async () => {
            const mounted = mountMoved([moved('a', 8)]);
            await openPanel('a');
            await pressMove();

            await mounted.answer({ status: 'failed', message: 'This project is archived.' });

            expect(panel()).not.toBeNull();
            const alert = byTestId('outlook-detail-alert');
            expect(alert?.getAttribute('role')).toBe('alert');
            expect(alert?.textContent?.trim()).toBe('This project is archived.');
            const move = byTestId('outlook-detail-move-entry') as HTMLButtonElement;
            expect(move.disabled).toBe(false);
            expect(document.activeElement).toBe(move);
            expect(block('a')).not.toBeNull();
        });

        it('failed without a message falls back to the move failure copy', async () => {
            const mounted = mountMoved([moved('a', 8)]);
            await openPanel('a');
            await pressMove();

            await mounted.answer({ status: 'failed', message: '' });

            expect(byTestId('outlook-detail-alert')?.textContent?.trim()).toBe(
                'Could not move the time entry'
            );
        });

        it('a new move clears the previous failure', async () => {
            const mounted = mountMoved([moved('a', 8)]);
            await openPanel('a');
            await pressMove();
            await mounted.answer({ status: 'failed', message: 'Try again.' });
            expect(byTestId('outlook-detail-alert')).not.toBeNull();

            await pressMove();

            expect(byTestId('outlook-detail-alert')).toBeNull();
        });

        it('stale: the panel closes and focus stays on the meeting', async () => {
            const mounted = mountMoved([moved('a', 8), at('b', 10)]);
            await openPanel('a');
            await pressMove();

            await mounted.answer({ status: 'stale' });

            expect(panel()).toBeNull();
            expect(document.activeElement).toBe(block('a'));
        });

        it('without canAct there is no move button and nothing is called', async () => {
            const mounted = mountMoved([moved('a', 8)], { canAct: false });
            // Read on the render that opens the panel: in happy-dom a panel without any focusable
            // content closes again on the next focus pass (pre-existing, any meeting).
            block('a').click();
            await nextTick();

            expect(panel()).not.toBeNull();
            expect(byTestId('outlook-moved-block')).toBeNull();
            expect(byTestId('outlook-detail-move-entry')).toBeNull();
            expect(mounted.moveEntry).not.toHaveBeenCalled();
        });
    });

    describe('moved block: label, attribute and pending state', () => {
        function moveSpinnerOf(id: string): Element | null {
            return block(id).querySelector('[data-testid="outlook-move-spinner"]');
        }

        it('the aria-label ends with the already-logged suffix and the block carries data-moved-from', () => {
            mountMoved([moved('a', 8), at('b', 10)]);

            expect(block('a').getAttribute('aria-label')).toBe(
                'Meeting a, 08:00 to 09:00, Outlook meeting suggestion, already logged on Mon, Oct 19'
            );
            expect(block('a').hasAttribute('data-moved-from')).toBe(true);
            expect(block('b').getAttribute('aria-label')).toBe(
                'Meeting b, 10:00 to 11:00, Outlook meeting suggestion'
            );
            expect(block('b').hasAttribute('data-moved-from')).toBe(false);
        });

        it('the suffix comes after the pre-assigned one and before dismissed and selected', async () => {
            mountMoved([
                moved('a', 8, { series_key: 'series-a', assignment }),
                moved('b', 10, { dismissed: true }),
            ]);

            expect(block('a').getAttribute('aria-label')).toBe(
                'Meeting a, 08:00 to 09:00, Outlook meeting suggestion, pre-assigned to Acme Website, already logged on Mon, Oct 19'
            );
            expect(block('b').getAttribute('aria-label')).toMatch(
                /, already logged on Mon, Oct 19, dismissed$/
            );
        });

        it('the suffix comes before the selected suffix', async () => {
            const mounted = mountMoved([moved('a', 8), at('b', 10)]);
            const selection = mounted.context.selection as unknown as {
                selectedIds: Ref<string[]>;
            };
            selection.selectedIds.value = ['a'];
            await nextTick();

            expect(block('a').getAttribute('aria-label')).toMatch(
                /, already logged on Mon, Oct 19, selected$/
            );
        });

        it('the suffix uses the local date of the logged entry', () => {
            vi.mocked(window.getTimezoneSetting).mockReturnValue('Pacific/Auckland');
            mountMoved([
                at('a', 8, {
                    moved_from: {
                        time_entry_id: 'te-old',
                        entry_start: '2026-10-19T12:00:00Z',
                        entry_end: '2026-10-19T13:00:00Z',
                    },
                }),
            ]);

            expect(block('a').getAttribute('aria-label')).toMatch(
                /, already logged on Tue, Oct 20$/
            );
        });

        it('without canAct the label still says already logged and nothing else changes', async () => {
            const mounted = mountMoved([moved('a', 8)], { canAct: false });

            expect(block('a').getAttribute('aria-label')).toMatch(
                /, already logged on Mon, Oct 19$/
            );
            expect(block('a').hasAttribute('aria-busy')).toBe(false);
            expect(moveSpinnerOf('a')).toBeNull();
            expect(mounted.moveEntry).not.toHaveBeenCalled();
        });

        it('a move started elsewhere (menu) shows the block pending: aria-busy, cursor, 12px spinner', async () => {
            const mounted = mountMoved([moved('a', 8), at('b', 10)]);
            expect(block('a').hasAttribute('aria-busy')).toBe(false);
            expect(block('a').classList.contains('cursor-pointer')).toBe(true);
            expect(moveSpinnerOf('a')).toBeNull();

            mounted.movePending.value = ['a'];
            await nextTick();

            expect(block('a').getAttribute('aria-busy')).toBe('true');
            expect(block('a').classList.contains('cursor-progress')).toBe(true);
            expect(block('a').classList.contains('cursor-pointer')).toBe(false);
            const spinner = moveSpinnerOf('a');
            expect(spinner).not.toBeNull();
            expect(spinner!.getAttribute('class')).toContain('h-3');
            expect(spinner!.getAttribute('class')).toContain('w-3');
            // The calendar icon of the time line gives way to the spinner
            expect(
                block('a').querySelector('[data-ghost-time] svg.lucide-calendar-days')
            ).toBeNull();
            expect(block('b').hasAttribute('aria-busy')).toBe(false);
            expect(moveSpinnerOf('b')).toBeNull();

            mounted.movePending.value = [];
            await nextTick();

            expect(block('a').hasAttribute('aria-busy')).toBe(false);
            expect(moveSpinnerOf('a')).toBeNull();
            expect(
                block('a').querySelector('[data-ghost-time] svg.lucide-calendar-days')
            ).not.toBeNull();
        });

        it('on one-line tiers the move spinner sits before the subject', async () => {
            const mounted = mountMoved([moved('a', 8, { end: '2026-10-20T08:20:00Z' })]);
            expect(
                block('a').querySelector('[data-ghost-tier]')!.getAttribute('data-ghost-tier')
            ).toBe('2');

            mounted.movePending.value = ['a'];
            await nextTick();

            const html = block('a').innerHTML;
            expect(html.indexOf('outlook-move-spinner')).toBeGreaterThan(-1);
            expect(html.indexOf('outlook-move-spinner')).toBeLessThan(
                html.indexOf('data-ghost-subject')
            );
        });

        it('a pre-assigned moved meeting uses the pre-assigned spinner in place of its dot', async () => {
            const mounted = mountMoved([moved('a', 8, { series_key: 'series-a', assignment })]);

            mounted.movePending.value = ['a'];
            await nextTick();

            expect(block('a').getAttribute('aria-busy')).toBe('true');
            expect(
                block('a').querySelector('[data-testid="outlook-preassigned-spinner"]')
            ).not.toBeNull();
            expect(block('a').querySelector('[data-testid="outlook-project-dot"]')).toBeNull();
            expect(moveSpinnerOf('a')).toBeNull();
        });

        it('a confirm pending on a plain meeting still shows no move spinner', async () => {
            const mounted = mountMoved([at('a', 8)]);

            mounted.confirmPending.value = ['a'];
            await nextTick();

            expect(block('a').getAttribute('aria-busy')).toBe('true');
            expect(moveSpinnerOf('a')).toBeNull();
        });

        it('a panel move shows the block pending too', async () => {
            mountMoved([moved('a', 8)]);
            await openPanel('a');

            await pressMove();

            expect(block('a').getAttribute('aria-busy')).toBe('true');
            expect(moveSpinnerOf('a')).not.toBeNull();
        });
    });
});
