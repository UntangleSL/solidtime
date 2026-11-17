export interface CalendarSettings {
    snapMinutes: number;
    startHour: number;
    endHour: number;
    slotMinutes: number;
    // Week view shows Saturday and Sunday only when this is true; undefined means hidden (the
    // default since the owner UAT of Phase 3.1). Optional so existing typed settings objects stay
    // valid.
    showWeekends?: boolean;
}

export const SNAP_MINUTE_OPTIONS = [1, 5, 10, 15, 30, 60] as const;
export const SLOT_MINUTE_OPTIONS = [5, 10, 15, 30, 60] as const;

export const DEFAULT_CALENDAR_SETTINGS: Required<CalendarSettings> = {
    snapMinutes: 15,
    startHour: 0,
    endHour: 24,
    slotMinutes: 15,
    showWeekends: false,
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

export const CALENDAR_SETTINGS_STORAGE_KEY = 'solidtime:calendar-settings';
export const WEEKENDS_HIDDEN_DEFAULT_MIGRATION_KEY = 'solidtime:calendar-weekends-hidden-default';

/**
 * Weekends used to be shown by default, and useLocalStorage writes the defaults on first read,
 * so every browser that opened the calendar before the change stores `showWeekends: true`
 * without anyone having chosen it. Runs once per browser (guarded by its own key): resets that
 * stored true to false so the new default reaches existing users; a choice made afterwards sticks.
 */
export function migrateWeekendsHiddenDefault(
    getStorage: () => Pick<Storage, 'getItem' | 'setItem'>
): void {
    try {
        // Inside the try: reading window.localStorage itself throws when storage is blocked
        const storage = getStorage();
        if (storage.getItem(WEEKENDS_HIDDEN_DEFAULT_MIGRATION_KEY) !== null) {
            return;
        }
        const raw = storage.getItem(CALENDAR_SETTINGS_STORAGE_KEY);
        if (raw !== null) {
            let stored: unknown = null;
            try {
                stored = JSON.parse(raw);
            } catch {
                // Corrupted value: sanitizeCalendarSettings falls back to the defaults on read
            }
            if (isPlainObject(stored) && stored.showWeekends === true) {
                storage.setItem(
                    CALENDAR_SETTINGS_STORAGE_KEY,
                    JSON.stringify({ ...stored, showWeekends: false })
                );
            }
        }
        storage.setItem(WEEKENDS_HIDDEN_DEFAULT_MIGRATION_KEY, '1');
    } catch {
        // Storage unavailable (private mode, quota): the calendar still works on the defaults
    }
}
