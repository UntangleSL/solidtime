import dayjs from 'dayjs';
import type { OutlookCalendarLabels, OutlookFlagKind, OutlookOutOfSyncItem } from '@/m365/types';
import type { TimeFormat } from '@/packages/ui/src/utils/time';
import { formatTime, getLocalizedDayJs } from '@/packages/ui/src/utils/time';
import { getWeekStartDayNumber } from '@/packages/ui/src/utils/settings';
import { fillLabel } from './labels';

// Pure text helpers of the Phase 6 out-of-sync UI (06-UI-SPEC sections 1, 3, 4, 5). Every text is
// built from UTC times and server-side copy only (no markup), shown in the user's time zone and the
// organization's 12/24-hour format. Dates use the panel's format ('Tue, Nov 24').

const FULL_DAY = 'ddd, MMM D';
const SHORT_DAY = 'ddd';

export interface RangeOptions {
    // true: "Tue, Nov 24 · 10:00 – 11:00"; false: "Tue 10:00 – 11:00".
    full: boolean;
    timeFormat: TimeFormat;
    // An all-day meeting shows its day(s) only; its end is exclusive (midnight after the last day).
    allDay?: boolean;
}

export interface TimeRange {
    start: string;
    end: string | null;
}

// One range in the user's time zone. A range that crosses local midnight names both days; a
// running entry (end null) shows its start only.
export function formatRange(start: string, end: string | null, options: RangeOptions): string {
    const dayFormat = options.full ? FULL_DAY : SHORT_DAY;
    const separator = options.full ? ' · ' : ' ';
    const from = getLocalizedDayJs(start);

    if (options.allDay === true) {
        const lastDay = end === null ? from : getLocalizedDayJs(end).subtract(1, 'minute');
        return lastDay.isAfter(from, 'day')
            ? `${from.format(dayFormat)} – ${lastDay.format(dayFormat)}`
            : from.format(dayFormat);
    }

    const startTime = formatTime(start, options.timeFormat);
    if (end === null) return `${from.format(dayFormat)}${separator}${startTime}`;

    const to = getLocalizedDayJs(end);
    const endTime = formatTime(end, options.timeFormat);
    return from.isSame(to, 'day')
        ? `${from.format(dayFormat)}${separator}${startTime} – ${endTime}`
        : `${from.format(dayFormat)}${separator}${startTime} – ${to.format(dayFormat)}${separator}${endTime}`;
}

// First local day of the week that contains `value`, following the user's week start (the same
// rule as weekBucket in useOutlookMeetings).
function weekKey(value: string): string {
    const localDate = dayjs.utc(getLocalizedDayJs(value).format('YYYY-MM-DD'));
    const offset = (localDate.day() - getWeekStartDayNumber() + 7) % 7;
    return localDate.subtract(offset, 'day').format('YYYY-MM-DD');
}

// The "from → to" pair of a moved meeting or entry: the weekday only when both starts fall in the
// same week, otherwise the full date on both sides (UI-SPEC section 1).
export function rangePair(
    from: TimeRange,
    to: TimeRange,
    timeFormat: TimeFormat,
    allDay = false
): { from: string; to: string } {
    const full = weekKey(from.start) !== weekKey(to.start);
    const options: RangeOptions = { full, timeFormat, allDay };
    return {
        from: formatRange(from.start, from.end, options),
        to: formatRange(to.start, to.end, options),
    };
}

export function flagTitle(kind: OutlookFlagKind, labels: OutlookCalendarLabels): string {
    switch (kind) {
        case 'moved':
            return labels.osync_title_moved;
        case 'cancelled':
            return labels.osync_title_cancelled;
        case 'removed':
            return labels.osync_title_removed;
    }
}

// First line of the marker's hover text: why the entry is out of sync. A moved flag names the
// recorded meeting range and the new one; without the new times it falls back to the title.
export function flagReason(
    item: OutlookOutOfSyncItem,
    labels: OutlookCalendarLabels,
    timeFormat: TimeFormat
): string {
    switch (item.kind) {
        case 'moved': {
            if (item.new_start === null || item.new_end === null) return labels.osync_title_moved;
            const pair = rangePair(
                { start: item.meeting_start, end: item.meeting_end },
                { start: item.new_start, end: item.new_end },
                timeFormat,
                item.all_day
            );
            return fillLabel(labels.osync_reason_moved, pair);
        }
        case 'cancelled':
            return labels.osync_reason_cancelled;
        case 'removed':
            return labels.osync_reason_removed;
    }
}

// Hidden description of a flagged block: "Out of sync with Outlook. <reason>." The copy adds the
// final period, so a reason that already ends with one loses it.
export function flagDescribed(
    item: OutlookOutOfSyncItem,
    labels: OutlookCalendarLabels,
    timeFormat: TimeFormat
): string {
    const reason = flagReason(item, labels, timeFormat).replace(/\.+\s*$/, '');
    return fillLabel(labels.osync_described, { reason });
}
