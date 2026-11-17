import { ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Dayjs } from 'dayjs';
import { getLocalizedDayJsFromMinutes } from '../utils/time';
import { getDateRangeLabel } from '../utils/dateRange';
import { useCalendarNavigation } from './useCalendarNavigation';

// Wednesday 2026-11-18; Saturday 2026-11-21. Fixed dates so no test depends on "today".
const WEDNESDAY = '2026-11-18';
const SATURDAY = '2026-11-21';

function day(dateStr: string): Dayjs {
    return getLocalizedDayJsFromMinutes(dateStr, 0);
}

function format(days: Dayjs[]): string[] {
    return days.map((d) => d.format('YYYY-MM-DD'));
}

function setup(options: { initialDate?: string; showWeekends?: () => boolean } = {}) {
    const onDatesChange = vi.fn<(payload: { start: Dayjs; end: Dayjs }) => void>();
    const nav = useCalendarNavigation({
        onDatesChange,
        scrollToCurrentTime: vi.fn(),
        initialDate: day(options.initialDate ?? WEDNESDAY),
        showWeekends: options.showWeekends,
    });
    return { nav, onDatesChange };
}

function emittedRange(onDatesChange: ReturnType<typeof setup>['onDatesChange']) {
    const payload = onDatesChange.mock.calls.at(-1)![0];
    return [payload.start.format('YYYY-MM-DD'), payload.end.format('YYYY-MM-DD')];
}

function mockWeekStart(value: string) {
    vi.mocked(window.getWeekStartSetting).mockReturnValue(value);
}

describe('useCalendarNavigation weekend hiding', () => {
    afterEach(() => {
        mockWeekStart('monday');
    });

    it('hides Saturday and Sunday for a monday week start', () => {
        const { nav, onDatesChange } = setup({ showWeekends: () => false });

        expect(format(nav.viewDays.value)).toEqual([
            '2026-11-16',
            '2026-11-17',
            '2026-11-18',
            '2026-11-19',
            '2026-11-20',
        ]);
        expect(nav.viewDays.value.some((d) => d.day() === 0 || d.day() === 6)).toBe(false);

        nav.emitDatesChange();
        expect(emittedRange(onDatesChange)).toEqual(['2026-11-16', '2026-11-23']);
    });

    it('hides the weekend for sunday, saturday and wednesday week starts', () => {
        const cases: Array<{ start: string; days: string[]; range: string[] }> = [
            {
                start: 'sunday',
                days: ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'],
                range: ['2026-11-15', '2026-11-22'],
            },
            {
                start: 'saturday',
                days: ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'],
                range: ['2026-11-14', '2026-11-21'],
            },
            {
                start: 'wednesday',
                days: ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24'],
                range: ['2026-11-18', '2026-11-25'],
            },
        ];

        for (const testCase of cases) {
            mockWeekStart(testCase.start);
            const { nav, onDatesChange } = setup({ showWeekends: () => false });

            expect(format(nav.viewDays.value)).toEqual(testCase.days);
            expect(nav.viewDays.value.some((d) => d.day() === 0 || d.day() === 6)).toBe(false);

            nav.emitDatesChange();
            const [start, end] = emittedRange(onDatesChange);
            expect([start, end]).toEqual(testCase.range);
            expect(day(end!).diff(day(start!), 'day')).toBe(7);
        }
    });

    it('shows seven days when the getter is missing or true', () => {
        const withoutGetter = setup();
        expect(withoutGetter.nav.viewDays.value).toHaveLength(7);
        expect(format(withoutGetter.nav.viewDays.value)[0]).toBe('2026-11-16');
        expect(format(withoutGetter.nav.viewDays.value)[6]).toBe('2026-11-22');

        const withTrue = setup({ showWeekends: () => true });
        expect(withTrue.nav.viewDays.value).toHaveLength(7);
    });

    it('reacts when the setting flips', () => {
        const show = ref(true);
        const { nav } = setup({ showWeekends: () => show.value });
        expect(nav.viewDays.value).toHaveLength(7);

        show.value = false;
        expect(nav.viewDays.value).toHaveLength(5);

        show.value = true;
        expect(nav.viewDays.value).toHaveLength(7);
    });

    it('leaves day view alone', () => {
        const { nav, onDatesChange } = setup({
            initialDate: '2026-11-20',
            showWeekends: () => false,
        });
        nav.handleChangeView('timeGridDay');
        nav.handleNext();
        expect(format(nav.viewDays.value)).toEqual([SATURDAY]);
        expect(emittedRange(onDatesChange)).toEqual([SATURDAY, '2026-11-22']);

        nav.handleNext();
        expect(format(nav.viewDays.value)).toEqual(['2026-11-22']);

        nav.handlePrev();
        expect(format(nav.viewDays.value)).toEqual([SATURDAY]);
    });

    it('opens a hidden weekend deep link in day view', () => {
        const hidden = setup({ initialDate: SATURDAY, showWeekends: () => false });
        expect(hidden.nav.activeView.value).toBe('timeGridDay');
        expect(format(hidden.nav.viewDays.value)).toEqual([SATURDAY]);

        const shown = setup({ initialDate: SATURDAY, showWeekends: () => true });
        expect(shown.nav.activeView.value).toBe('timeGridWeek');
        expect(shown.nav.viewDays.value).toHaveLength(7);

        const weekday = setup({ initialDate: WEDNESDAY, showWeekends: () => false });
        expect(weekday.nav.activeView.value).toBe('timeGridWeek');
    });

    it('builds the range label from the visible days', () => {
        const { nav } = setup({ showWeekends: () => false });
        expect(nav.rangeLabel.value).toBe(getDateRangeLabel(day('2026-11-16'), day('2026-11-20')));

        const shown = setup({ showWeekends: () => true });
        expect(shown.nav.rangeLabel.value).toBe(
            getDateRangeLabel(day('2026-11-16'), day('2026-11-22'))
        );
    });
});
