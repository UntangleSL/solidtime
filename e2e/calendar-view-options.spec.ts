import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { PLAYWRIGHT_BASE_URL } from '../playwright/config';
import { test } from '../playwright/fixtures';

// Calendar view options (fork, Phase 3.1): weekend visibility; zoom tests are appended by 03.1-06.
// Test users run in UTC with a monday week start. No test depends on today's weekday.

const SETTINGS_KEY = 'solidtime:calendar-settings';

async function goToCalendar(page: Page, query = '') {
    await page.goto(PLAYWRIGHT_BASE_URL + '/calendar' + query);
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });
}

async function openSettingsPopover(page: Page) {
    await page.getByRole('button', { name: 'Calendar settings' }).click();
    await expect(page.getByText('Calendar Settings')).toBeVisible();
}

async function clearCalendarSettings(page: Page) {
    await page.evaluate((key) => localStorage.removeItem(key), SETTINGS_KEY);
}

/** Writes the raw settings object to localStorage (on the app origin) and reloads the calendar. */
async function setCalendarSettings(page: Page, settings: Record<string, unknown>) {
    await goToCalendar(page);
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [
        SETTINGS_KEY,
        JSON.stringify(settings),
    ] as const);
    await page.reload();
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });
}

async function readStoredSettings(page: Page): Promise<Record<string, unknown>> {
    return await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) || '{}') as Record<string, unknown>,
        SETTINGS_KEY
    );
}

/** The `data-date` (YYYY-MM-DD) of every rendered day header, in order. */
async function headerDates(page: Page): Promise<string[]> {
    return await page
        .locator('.fc-col-header-cell')
        .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-date') ?? ''));
}

function utcWeekday(date: string): number {
    return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** The next date (strictly after today, UTC) that falls on the given weekday, as YYYY-MM-DD. */
function comingWeekday(weekday: number): string {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    const offset = (weekday - date.getUTCDay() + 7) % 7 || 7;
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
}

function weekendSwitch(page: Page) {
    return page.getByTestId('calendar-weekends-switch');
}

test.describe('Calendar view options: weekends', () => {
    test.beforeEach(async ({ page }) => {
        await clearCalendarSettings(page);
    });

    test('weekends can be hidden and the choice persists across reload', async ({ page }) => {
        await goToCalendar(page);
        await expect(page.locator('.fc-col-header-cell')).toHaveCount(7);

        await openSettingsPopover(page);
        await expect(weekendSwitch(page)).toHaveAttribute('aria-checked', 'true');
        await weekendSwitch(page).click();
        await expect(weekendSwitch(page)).toHaveAttribute('aria-checked', 'false');
        await page.keyboard.press('Escape');

        await expect(page.locator('.fc-col-header-cell')).toHaveCount(5);
        const hidden = await headerDates(page);
        expect(hidden.filter((d) => [0, 6].includes(utcWeekday(d)))).toEqual([]);

        expect((await readStoredSettings(page)).showWeekends).toBe(false);

        await page.reload();
        await expect(page.locator('.fc')).toBeVisible();
        await expect(page.locator('.fc-col-header-cell')).toHaveCount(5);

        await openSettingsPopover(page);
        await expect(weekendSwitch(page)).toHaveAttribute('aria-checked', 'false');
        await weekendSwitch(page).click();
        await page.keyboard.press('Escape');

        await expect(page.locator('.fc-col-header-cell')).toHaveCount(7);
        expect((await readStoredSettings(page)).showWeekends).toBe(true);
    });

    test('an old stored object without the key still shows weekends', async ({ page }) => {
        await setCalendarSettings(page, {
            snapMinutes: 15,
            startHour: 0,
            endHour: 24,
            slotMinutes: 15,
        });

        await expect(page.locator('.fc-col-header-cell')).toHaveCount(7);
        await openSettingsPopover(page);
        await expect(weekendSwitch(page)).toHaveAttribute('aria-checked', 'true');
    });

    test('tampered settings fall back to defaults', async ({ page }) => {
        await goToCalendar(page);
        const lanes = page.locator('.fc-timegrid-slot-lane');
        await expect(lanes.first()).toBeAttached();
        const defaultLaneCount = await lanes.count();

        await setCalendarSettings(page, {
            slotMinutes: 'abc',
            snapMinutes: 0,
            startHour: 30,
            endHour: -1,
            showWeekends: 'no',
        });

        await expect(page.locator('.fc-col-header-cell')).toHaveCount(7);
        await expect(page.locator('.fc-timegrid-slot-lane[data-time="00:00:00"]')).toHaveCount(1);
        await expect(lanes).toHaveCount(defaultLaneCount);
    });

    test('a deep link to a hidden weekend day opens it in day view', async ({ page }) => {
        await setCalendarSettings(page, { showWeekends: false });
        const saturday = comingWeekday(6);

        await goToCalendar(page, `?date=${saturday}`);

        await expect(page.locator('.fc-col-header-cell')).toHaveCount(1);
        expect(await headerDates(page)).toEqual([saturday]);
    });

    test('day view keeps one-day navigation with weekends hidden', async ({ page }) => {
        await setCalendarSettings(page, { showWeekends: false });
        const friday = comingWeekday(5);

        await goToCalendar(page, `?date=${friday}`);
        await expect(page.locator('.fc-col-header-cell')).toHaveCount(5);
        expect(await headerDates(page)).toContain(friday);

        await page.getByRole('tab', { name: 'day', exact: true }).click();
        await expect(page.locator('.fc-col-header-cell')).toHaveCount(1);
        expect(await headerDates(page)).toEqual([friday]);

        await page.getByRole('button', { name: 'Next', exact: true }).click();
        await expect(page.locator('.fc-col-header-cell')).toHaveCount(1);
        const saturday = new Date(`${friday}T00:00:00Z`);
        saturday.setUTCDate(saturday.getUTCDate() + 1);
        await expect(page.locator('.fc-col-header-cell')).toHaveAttribute(
            'data-date',
            saturday.toISOString().slice(0, 10)
        );
    });
});
