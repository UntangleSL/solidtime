import type { CalendarSettings } from './calendarSettings';
import { SLOT_HEIGHT } from './calendarTypes';

/**
 * Calendar zoom is the Grid Scale ladder (slotMinutes) with a constant SLOT_HEIGHT, ordered from
 * zoomed out to zoomed in: 25, 50, 100 (default), 150 and 300 px per hour. Keeping SLOT_HEIGHT fixed
 * means drag, resize and slot selection snap exactly at every level, and the settings popover's
 * Grid Scale select always shows the current zoom.
 */
export const ZOOM_SLOT_MINUTES = [60, 30, 15, 10, 5] as const;

/** 1 = zoom in (smaller slots, taller hours), -1 = zoom out. */
export type ZoomDirection = 1 | -1;

const PERCENT_BASE_SLOT_MINUTES = 15;

/** Zoom level shown to the user: 100% = the default 15-minute grid scale (100 px per hour). */
export function zoomPercent(slotMinutes: number): number {
    return Math.round((PERCENT_BASE_SLOT_MINUTES * 100) / slotMinutes);
}

function nearestLadderIndex(slotMinutes: number): number {
    let index = 0;
    for (let i = 1; i < ZOOM_SLOT_MINUTES.length; i++) {
        if (
            Math.abs(ZOOM_SLOT_MINUTES[i]! - slotMinutes) <
            Math.abs(ZOOM_SLOT_MINUTES[index]! - slotMinutes)
        ) {
            index = i;
        }
    }
    return index;
}

/**
 * The next slotMinutes one step in `direction`. An off-ladder value (e.g. written by another tab,
 * whose storage event is not sanitised) snaps to the nearest step first; the ends clamp.
 */
export function nextZoomSlotMinutes(current: number, direction: ZoomDirection): number {
    const next = Math.min(
        ZOOM_SLOT_MINUTES.length - 1,
        Math.max(0, nearestLadderIndex(current) + direction)
    );
    return ZOOM_SLOT_MINUTES[next]!;
}

export function canZoom(current: number, direction: ZoomDirection): boolean {
    return nextZoomSlotMinutes(current, direction) !== current;
}

const LINE_HEIGHT_PX = 40;
const PAGE_HEIGHT_PX = 800;

/** Wheel deltaY in pixels, whatever unit the browser reported (0 = px, 1 = lines, 2 = pages). */
export function normalizeWheelDelta(event: { deltaY: number; deltaMode: number }): number {
    if (event.deltaMode === 1) return event.deltaY * LINE_HEIGHT_PX;
    if (event.deltaMode === 2) return event.deltaY * PAGE_HEIGHT_PX;
    return event.deltaY;
}

export interface WheelZoomAccumulatorOptions {
    /** Accumulated |delta| (px) that makes one step; a mouse notch (about 100) is one step. */
    threshold?: number;
    /** At most one step per this many ms, so a fast pinch does not race through the ladder. */
    minStepIntervalMs?: number;
    /** The accumulator forgets after this much idle time between events. */
    idleResetMs?: number;
}

export interface WheelZoomAccumulator {
    /** Feeds one normalised delta; returns 1 (zoom in), -1 (zoom out) or 0 (no step yet). */
    push(delta: number, timeStamp: number): ZoomDirection | 0;
    reset(): void;
}

/**
 * Turns a stream of ctrl-wheel deltas (mouse notches or many small pinch deltas) into discrete zoom
 * steps. Negative delta (wheel up, pinch out) zooms in. Resets on idle and on a direction change.
 */
export function createWheelZoomAccumulator(
    options: WheelZoomAccumulatorOptions = {}
): WheelZoomAccumulator {
    const threshold = options.threshold ?? 48;
    const minStepIntervalMs = options.minStepIntervalMs ?? 100;
    const idleResetMs = options.idleResetMs ?? 150;

    let accumulated = 0;
    let lastEventTime: number | null = null;
    let lastStepTime: number | null = null;

    function reset(): void {
        accumulated = 0;
        lastEventTime = null;
    }

    function push(delta: number, timeStamp: number): ZoomDirection | 0 {
        if (lastEventTime !== null && timeStamp - lastEventTime > idleResetMs) {
            accumulated = 0;
        }
        if (accumulated !== 0 && delta !== 0 && Math.sign(delta) !== Math.sign(accumulated)) {
            accumulated = 0;
        }
        lastEventTime = timeStamp;
        accumulated += delta;

        if (Math.abs(accumulated) < threshold) return 0;

        if (lastStepTime !== null && timeStamp - lastStepTime < minStepIntervalMs) {
            // Rate limited: keep one step's worth so the next allowed event steps at once,
            // but never bank several steps
            accumulated = Math.sign(accumulated) * threshold;
            return 0;
        }

        const direction: ZoomDirection = accumulated < 0 ? 1 : -1;
        accumulated = 0;
        lastStepTime = timeStamp;
        return direction;
    }

    return { push, reset };
}

/**
 * scrollTop that puts `anchorMinutesFromMidnight` back at `pointerOffset` px below the scroller's
 * top after the grid scale changed to `slotMinutesAfter`. Never negative.
 */
export function anchoredScrollTop(
    anchorMinutesFromMidnight: number,
    startHour: number,
    slotMinutesAfter: number,
    pointerOffset: number
): number {
    const anchorPx =
        ((anchorMinutesFromMidnight - startHour * 60) / slotMinutesAfter) * SLOT_HEIGHT;
    return Math.max(0, anchorPx - pointerOffset);
}

/**
 * Every setting that changes the visible range or the day set, i.e. everything except
 * slotMinutes. The calendar watches this instead of the whole object so a zoom step never
 * emits dates-change (no time-entry refetch per wheel notch).
 */
export function datesAffectingSettingsKey(settings: CalendarSettings): string {
    return [
        settings.snapMinutes,
        settings.startHour,
        settings.endHour,
        settings.showWeekends === true,
    ].join('|');
}
