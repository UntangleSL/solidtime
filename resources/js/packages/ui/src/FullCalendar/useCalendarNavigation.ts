import { computed, ref } from 'vue';
import type { Dayjs } from 'dayjs';
import { getLocalizedDayJs } from '../utils/time';
import { getWeekStartDayNumber } from '../utils/settings';
import { getDateRangeLabel } from '../utils/dateRange';

export function useCalendarNavigation(callbacks: {
    onDatesChange: (payload: { start: Dayjs; end: Dayjs }) => void;
    scrollToCurrentTime: () => void;
    initialDate?: Dayjs | null;
    // Fork (UX-01): week view hides Saturday and Sunday when this returns false. Missing means shown.
    showWeekends?: () => boolean;
}) {
    function weekendsHidden(): boolean {
        return callbacks.showWeekends?.() === false;
    }

    function isWeekend(day: Dayjs): boolean {
        return day.day() === 0 || day.day() === 6;
    }

    // A deep link to a hidden weekend day would open a week without that day: open it in day view.
    const initialView =
        callbacks.initialDate && isWeekend(callbacks.initialDate) && weekendsHidden()
            ? 'timeGridDay'
            : 'timeGridWeek';
    const activeView = ref(initialView);
    const currentDate = ref(callbacks.initialDate ?? getLocalizedDayJs());

    function getFirstDay(): number {
        return getWeekStartDayNumber();
    }

    // Every day of the current week (or the single day in day view); drives the fetched range.
    const weekDays = computed<Dayjs[]>(() => {
        const numDays = activeView.value === 'timeGridWeek' ? 7 : 1;

        if (numDays === 1) {
            return [currentDate.value.startOf('day')];
        }

        const firstDay = getFirstDay();
        const today = currentDate.value.startOf('day');
        const offset = (today.day() - firstDay + 7) % 7;
        const weekStart = today.subtract(offset, 'day');

        const days: Dayjs[] = [];
        for (let i = 0; i < numDays; i++) {
            days.push(weekStart.add(i, 'day'));
        }
        return days;
    });

    // The rendered days: the week without Saturday and Sunday when weekends are hidden.
    const viewDays = computed<Dayjs[]>(() => {
        if (activeView.value !== 'timeGridWeek' || !weekendsHidden()) {
            return weekDays.value;
        }
        return weekDays.value.filter((day) => !isWeekend(day));
    });

    const rangeLabel = computed(() => {
        const days = viewDays.value;
        if (days.length === 0) return '';
        return getDateRangeLabel(days[0]!, days[days.length - 1]!);
    });

    function emitDatesChange() {
        // Always the whole week, so entries and meetings of hidden days still load.
        const days = weekDays.value;
        if (days.length === 0) return;

        const start = days[0]!;
        const end = days[days.length - 1]!.add(1, 'day');
        callbacks.onDatesChange({ start, end });
    }

    function handlePrev() {
        if (activeView.value === 'timeGridWeek') {
            currentDate.value = currentDate.value.subtract(7, 'day');
        } else {
            currentDate.value = currentDate.value.subtract(1, 'day');
        }
        emitDatesChange();
        callbacks.scrollToCurrentTime();
    }

    function handleNext() {
        if (activeView.value === 'timeGridWeek') {
            currentDate.value = currentDate.value.add(7, 'day');
        } else {
            currentDate.value = currentDate.value.add(1, 'day');
        }
        emitDatesChange();
        callbacks.scrollToCurrentTime();
    }

    function handleToday() {
        currentDate.value = getLocalizedDayJs();
        emitDatesChange();
        callbacks.scrollToCurrentTime();
    }

    function handleChangeView(view: string) {
        activeView.value = view;
        emitDatesChange();
        callbacks.scrollToCurrentTime();
    }

    return {
        activeView,
        currentDate,
        viewDays,
        rangeLabel,
        emitDatesChange,
        handlePrev,
        handleNext,
        handleToday,
        handleChangeView,
    };
}
