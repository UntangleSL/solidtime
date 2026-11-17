export interface CalendarSettings {
    snapMinutes: number;
    startHour: number;
    endHour: number;
    slotMinutes: number;
    // Week view shows Saturday and Sunday unless this is false; undefined means shown (the default).
    // Optional so existing typed settings objects stay valid.
    showWeekends?: boolean;
}

export const SNAP_MINUTE_OPTIONS = [1, 5, 10, 15, 30, 60] as const;
export const SLOT_MINUTE_OPTIONS = [5, 10, 15, 30, 60] as const;

export const DEFAULT_CALENDAR_SETTINGS: Required<CalendarSettings> = {
    snapMinutes: 15,
    startHour: 0,
    endHour: 24,
    slotMinutes: 15,
    showWeekends: true,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickOption(value: unknown, options: readonly number[], fallback: number): number {
    return typeof value === 'number' && options.includes(value) ? value : fallback;
}

function pickHour(value: unknown, min: number, max: number, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
        ? value
        : fallback;
}

/**
 * Turns any stored value into a valid settings object, so a corrupted or hand-edited
 * `solidtime:calendar-settings` can never reach the grid maths: non-objects give the defaults,
 * snap and grid scale must be one of their options, hours must be integers in range with
 * start < end, showWeekends must be a boolean, and unknown keys are dropped.
 */
export function sanitizeCalendarSettings(raw: unknown): Required<CalendarSettings> {
    const defaults = DEFAULT_CALENDAR_SETTINGS;
    if (!isPlainObject(raw)) {
        return { ...defaults };
    }

    let startHour = pickHour(raw.startHour, 0, 23, defaults.startHour);
    let endHour = pickHour(raw.endHour, 1, 24, defaults.endHour);
    if (startHour >= endHour) {
        startHour = defaults.startHour;
        endHour = defaults.endHour;
    }

    return {
        snapMinutes: pickOption(raw.snapMinutes, SNAP_MINUTE_OPTIONS, defaults.snapMinutes),
        startHour,
        endHour,
        slotMinutes: pickOption(raw.slotMinutes, SLOT_MINUTE_OPTIONS, defaults.slotMinutes),
        showWeekends:
            typeof raw.showWeekends === 'boolean' ? raw.showWeekends : defaults.showWeekends,
    };
}
