import type { OutlookMeeting } from '@/m365/types';
import { getLocalizedDayJs, getLocalizedDayJsFromMinutes } from '@/packages/ui/src/utils/time';

// UI-SPEC: a ghost never gets shorter than 16px so a 5 minute meeting stays clickable.
export const GHOST_MIN_HEIGHT = 16;
export const GHOST_MAX_LANES = 3;

export interface GhostBox {
    meeting: OutlookMeeting;
    top: number;
    height: number;
    lane: number;
    lanes: number;
    isClippedStart: boolean;
    isClippedEnd: boolean;
}

export interface GhostVisibleSettings {
    startHour: number;
    endHour: number;
}

// Layout decision D-23: width of the reserved right-hand Outlook lane of a day column.
export function ghostLaneWidth(isDayView: boolean): string {
    return isDayView ? 'min(240px, 25%)' : 'max(16px, 30%)';
}

// Clips every meeting to one calendar day in the user's timezone (like useActivityBoxes does for
// activity periods) and to the visible hours. Positions come from wall-clock minutes, so they stay
// correct on DST transition days.
export function layoutGhostsForDay(
    meetings: OutlookMeeting[],
    dayStr: string,
    settings: GhostVisibleSettings,
    minutesToPixels: (minutes: number) => number
): GhostBox[] {
    const dayStart = getLocalizedDayJsFromMinutes(dayStr, 0);
    const dayEnd = getLocalizedDayJsFromMinutes(dayStr, 1440);
    const visibleStart = settings.startHour * 60;
    const visibleEnd = settings.endHour * 60;
    const boxes: GhostBox[] = [];

    for (const meeting of meetings) {
        const start = getLocalizedDayJs(meeting.start);
        const end = getLocalizedDayJs(meeting.end);

        // Half-open overlap with the day: [start, end) against [dayStart, dayEnd)
        if (!start.isBefore(dayEnd) || end.isBefore(dayStart) || end.isSame(dayStart)) continue;

        const isClippedStart = start.isBefore(dayStart);
        const isClippedEnd = !end.isBefore(dayEnd);
        const startMinutes = isClippedStart ? 0 : start.hour() * 60 + start.minute();
        const endMinutes = isClippedEnd ? 1440 : end.hour() * 60 + end.minute();

        const clampedStart = Math.max(startMinutes, visibleStart);
        const clampedEnd = Math.min(endMinutes, visibleEnd);
        if (clampedEnd <= clampedStart) continue;

        boxes.push({
            meeting,
            top: minutesToPixels(clampedStart - visibleStart),
            height: Math.max(GHOST_MIN_HEIGHT, minutesToPixels(clampedEnd - clampedStart)),
            lane: 0,
            lanes: 1,
            isClippedStart,
            isClippedEnd,
        });
    }

    return boxes;
}
