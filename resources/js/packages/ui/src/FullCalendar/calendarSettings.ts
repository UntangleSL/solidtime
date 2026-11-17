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

/**
 * Turns any stored value into a valid settings object: fields with the wrong type fall back to
 * the defaults, unknown keys are dropped.
 */
export function sanitizeCalendarSettings(raw: unknown): Required<CalendarSettings> {
    const defaults = DEFAULT_CALENDAR_SETTINGS;
    if (!isPlainObject(raw)) {
        return { ...defaults };
    }
    const pickNumber = (key: 'snapMinutes' | 'startHour' | 'endHour' | 'slotMinutes') => {
        const value = raw[key];
        return typeof value === 'number' && Number.isFinite(value) ? value : defaults[key];
    };
    return {
        snapMinutes: pickNumber('snapMinutes'),
        startHour: pickNumber('startHour'),
        endHour: pickNumber('endHour'),
        slotMinutes: pickNumber('slotMinutes'),
        showWeekends:
            typeof raw.showWeekends === 'boolean' ? raw.showWeekends : defaults.showWeekends,
    };
}
