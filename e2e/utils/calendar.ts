import type { Page } from '@playwright/test';

export const CALENDAR_SETTINGS_KEY = 'solidtime:calendar-settings';
export const WEEKENDS_HIDDEN_DEFAULT_MIGRATION_KEY = 'solidtime:calendar-weekends-hidden-default';

/** The app defaults with weekends shown (the app itself hides them by default). */
const SETTINGS_WITH_WEEKENDS = {
    snapMinutes: 15,
    startHour: 0,
    endHour: 24,
    slotMinutes: 15,
    showWeekends: true,
};

/**
 * Weekends are hidden in the week view by default, so a spec that places entries or meetings on
 * "today" would fail whenever CI runs on a Saturday or Sunday. Call this before the first
 * navigation: on every page load it seeds the calendar settings with weekends shown, but only
 * when nothing is stored yet, so a test that writes its own settings (or removes them and
 * reloads) still gets the stored value or this seed, never a hidden "today". It also marks the
 * one-time weekends migration as done so the app does not reset the seeded value.
 */
export async function showCalendarWeekends(page: Page): Promise<void> {
    await page.addInitScript(
        ([settingsKey, migrationKey, settings]) => {
            try {
                if (window.localStorage.getItem(migrationKey) === null) {
                    window.localStorage.setItem(migrationKey, '1');
                }
                if (window.localStorage.getItem(settingsKey) === null) {
                    window.localStorage.setItem(settingsKey, settings);
                }
            } catch {
                // about:blank and other opaque origins have no localStorage
            }
        },
        [
            CALENDAR_SETTINGS_KEY,
            WEEKENDS_HIDDEN_DEFAULT_MIGRATION_KEY,
            JSON.stringify(SETTINGS_WITH_WEEKENDS),
        ] as const
    );
}
