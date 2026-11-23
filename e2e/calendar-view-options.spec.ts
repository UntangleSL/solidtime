import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { PLAYWRIGHT_BASE_URL } from '../playwright/config';
import { test } from '../playwright/fixtures';
import {
    CALENDAR_SETTINGS_KEY as SETTINGS_KEY,
    WEEKENDS_HIDDEN_DEFAULT_MIGRATION_KEY,
    showCalendarWeekends,
} from './utils/calendar';

// Calendar view options (fork, Phase 3.1): weekend visibility; zoom tests are appended by 03.1-06.
// Test users run in UTC with a monday week start. No test depends on today's weekday.
// Weekends are hidden by default (owner UAT, 2026-11-17); the switch turns them on.

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

    test('weekends are hidden by default, can be shown, and the choice persists across reload', async ({
        page,
    }) => {
        await goToCalendar(page);
        await expect(page.locator('.fc-col-header-cell')).toHaveCount(5);
        const hidden = await headerDates(page);
        expect(hidden.filter((d) => [0, 6].includes(utcWeekday(d)))).toEqual([]);

        await openSettingsPopover(page);
        await expect(weekendSwitch(page)).toHaveAttribute('aria-checked', 'false');
        await weekendSwitch(page).click();
        await expect(weekendSwitch(page)).toHaveAttribute('aria-checked', 'true');
        await page.keyboard.press('Escape');

        await expect(page.locator('.fc-col-header-cell')).toHaveCount(7);
        const shown = await headerDates(page);
        expect(shown.filter((d) => [0, 6].includes(utcWeekday(d)))).toHaveLength(2);

        expect((await readStoredSettings(page)).showWeekends).toBe(true);

        await page.reload();
        await expect(page.locator('.fc')).toBeVisible();
        await expect(page.locator('.fc-col-header-cell')).toHaveCount(7);

        await openSettingsPopover(page);
        await expect(weekendSwitch(page)).toHaveAttribute('aria-checked', 'true');
        await weekendSwitch(page).click();
        await page.keyboard.press('Escape');

        await expect(page.locator('.fc-col-header-cell')).toHaveCount(5);
        expect((await readStoredSettings(page)).showWeekends).toBe(false);
    });

    test('an old stored object without the key hides weekends', async ({ page }) => {
        await setCalendarSettings(page, {
            snapMinutes: 15,
            startHour: 0,
            endHour: 24,
            slotMinutes: 15,
        });

        await expect(page.locator('.fc-col-header-cell')).toHaveCount(5);
        await openSettingsPopover(page);
        await expect(weekendSwitch(page)).toHaveAttribute('aria-checked', 'false');
    });

    test('the stored pre-change default is reset once, then a new choice sticks', async ({
        page,
    }) => {
        // A browser from before the change: the old default stored, the migration not yet run
        await goToCalendar(page);
        await page.evaluate(
            ([settingsKey, migrationKey]) => {
                localStorage.removeItem(migrationKey);
                localStorage.setItem(
                    settingsKey,
                    JSON.stringify({
                        snapMinutes: 30,
                        startHour: 0,
                        endHour: 24,
                        slotMinutes: 15,
                        showWeekends: true,
                    })
                );
            },
            [SETTINGS_KEY, WEEKENDS_HIDDEN_DEFAULT_MIGRATION_KEY] as const
        );
        await page.reload();
        await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

        await expect(page.locator('.fc-col-header-cell')).toHaveCount(5);
        const migrated = await readStoredSettings(page);
        expect(migrated.showWeekends).toBe(false);
        expect(migrated.snapMinutes).toBe(30);

        await openSettingsPopover(page);
        await weekendSwitch(page).click();
        await page.keyboard.press('Escape');
        await expect(page.locator('.fc-col-header-cell')).toHaveCount(7);

        await page.reload();
        await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('.fc-col-header-cell')).toHaveCount(7);
        expect((await readStoredSettings(page)).showWeekends).toBe(true);
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
            showWeekends: 'yes',
        });

        await expect(page.locator('.fc-col-header-cell')).toHaveCount(5);
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

    test('with the default settings a weekend deep link opens in day view', async ({ page }) => {
        const sunday = comingWeekday(0);

        await goToCalendar(page, `?date=${sunday}`);

        await expect(page.locator('.fc-col-header-cell')).toHaveCount(1);
        expect(await headerDates(page)).toEqual([sunday]);
    });

    test('a weekend deep link stays in week view when weekends are shown', async ({ page }) => {
        await setCalendarSettings(page, { showWeekends: true });
        const saturday = comingWeekday(6);

        await goToCalendar(page, `?date=${saturday}`);

        await expect(page.locator('.fc-col-header-cell')).toHaveCount(7);
        expect(await headerDates(page)).toContain(saturday);
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

// ---------------------------------------------------------------------------------------------
// Zoom (03.1-06, UX-05 / D-07): zoom is the Grid Scale ladder 60/30/15/10/5 min with a constant
// 25 px slot, i.e. 25/50/100/150/300 px per hour.

/** Pixel distance between the 10:00 and 11:00 grid rows. */
async function hourHeight(page: Page): Promise<number> {
    const ten = await page.locator('.fc-timegrid-slot-lane[data-time="10:00:00"]').boundingBox();
    const eleven = await page.locator('.fc-timegrid-slot-lane[data-time="11:00:00"]').boundingBox();
    expect(ten).not.toBeNull();
    expect(eleven).not.toBeNull();
    return Math.round(eleven!.y - ten!.y);
}

async function expectHourHeight(page: Page, px: number) {
    await expect.poll(() => hourHeight(page)).toBe(px);
}

/** Centre of the scrollable grid (right of the time axis), in viewport coordinates. */
async function gridCentre(page: Page): Promise<{ x: number; y: number }> {
    const box = await page.locator('.fc-scroller').boundingBox();
    expect(box).not.toBeNull();
    return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

/**
 * Dispatches a cancelable Ctrl + wheel at the element under (x, y) and returns whether the
 * calendar prevented it (which is what stops the browser from zooming the page). Deterministic in
 * Chromium and Firefox, unlike a real pinch.
 */
async function ctrlWheel(page: Page, x: number, y: number, deltaY: number): Promise<boolean> {
    return await page.evaluate(
        ({ px, py, dy }) => {
            const target = document.elementFromPoint(px, py);
            if (!target) throw new Error('nothing under the pointer');
            const event = new WheelEvent('wheel', {
                deltaY: dy,
                deltaMode: 0,
                ctrlKey: true,
                clientX: px,
                clientY: py,
                bubbles: true,
                cancelable: true,
            });
            target.dispatchEvent(event);
            return event.defaultPrevented;
        },
        { px: x, py: y, dy: deltaY }
    );
}

/** Zoom input is rate limited to one step per 100 ms: leave room between scripted steps. */
async function betweenSteps(page: Page) {
    await page.waitForTimeout(200);
}

/** Minutes from midnight of the grid row under (x, y). */
async function timeUnderPointer(page: Page, x: number, y: number): Promise<number> {
    const time = await page.evaluate(
        ({ px, py }) => {
            const lane = document
                .elementsFromPoint(px, py)
                .find((element) => element.classList.contains('fc-timegrid-slot-lane'));
            return lane?.getAttribute('data-time') ?? null;
        },
        { px: x, py: y }
    );
    expect(time).not.toBeNull();
    const [hours, minutes] = time!.split(':').map(Number);
    return hours! * 60 + minutes!;
}

function zoomIndicator(page: Page) {
    return page.getByTestId('calendar-zoom-indicator');
}

test.describe('Calendar view options: zoom', () => {
    test.beforeEach(async ({ page }) => {
        // Weekends shown: a test below places a meeting on "today" (CI may run on a weekend)
        await showCalendarWeekends(page);
        await clearCalendarSettings(page);
    });

    test('Ctrl + wheel over the grid zooms in one step without zooming the page', async ({
        page,
    }) => {
        await goToCalendar(page);
        await expectHourHeight(page, 100);

        const { x, y } = await gridCentre(page);
        expect(await ctrlWheel(page, x, y, -100)).toBe(true);

        await expectHourHeight(page, 150);
        expect((await readStoredSettings(page)).slotMinutes).toBe(10);
        expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
        await expect(zoomIndicator(page)).toHaveText('Zoom 150%');
    });

    test('a real Control + mouse wheel zooms (Chromium)', async ({ page, browserName }) => {
        test.skip(
            browserName === 'firefox',
            'the real Control + wheel path is exercised in Chromium only'
        );
        await goToCalendar(page);
        await expectHourHeight(page, 100);

        const { x, y } = await gridCentre(page);
        await page.mouse.move(x, y);
        await page.keyboard.down('Control');
        await page.mouse.wheel(0, -100);
        await page.keyboard.up('Control');

        await expectHourHeight(page, 150);
    });

    test('the time under the pointer stays anchored', async ({ page }) => {
        await goToCalendar(page);

        // Put the middle of the 14:00 row at the vertical centre of the scroller
        await page.evaluate(() => {
            const scroller = document.querySelector<HTMLElement>('.fc-scroller')!;
            const lane = document.querySelector<HTMLElement>(
                '.fc-timegrid-slot-lane[data-time="14:00:00"]'
            )!;
            const scrollerRect = scroller.getBoundingClientRect();
            const laneRect = lane.getBoundingClientRect();
            scroller.scrollTop +=
                laneRect.top + laneRect.height / 2 - (scrollerRect.top + scrollerRect.height / 2);
        });
        const { x, y } = await gridCentre(page);
        expect(await timeUnderPointer(page, x, y)).toBe(14 * 60);

        // In once (10-minute rows), then out twice (15, then 30-minute rows)
        for (const [deltaY, slotMinutes] of [
            [-100, 10],
            [100, 15],
            [100, 30],
        ] as const) {
            await betweenSteps(page);
            expect(await ctrlWheel(page, x, y, deltaY)).toBe(true);
            await expect
                .poll(async () => (await readStoredSettings(page)).slotMinutes)
                .toBe(slotMinutes);
            await page.waitForTimeout(100);
            const minutes = await timeUnderPointer(page, x, y);
            expect(Math.abs(minutes - 14 * 60)).toBeLessThanOrEqual(slotMinutes);
        }
    });

    test('plain wheel scrolls and does not zoom', async ({ page }) => {
        await goToCalendar(page);
        const scroller = page.locator('.fc-scroller');
        await scroller.evaluate((element) => {
            element.scrollTop = 0;
        });

        const { x, y } = await gridCentre(page);
        await page.mouse.move(x, y);
        await page.mouse.wheel(0, 400);

        await expect
            .poll(() => scroller.evaluate((element) => element.scrollTop))
            .toBeGreaterThan(0);
        await expectHourHeight(page, 100);
        expect((await readStoredSettings(page)).slotMinutes ?? 15).toBe(15);
    });

    test('zoom buttons step through the ladder and stop at the ends', async ({ page }) => {
        await goToCalendar(page);
        const zoomIn = page.getByTestId('calendar-zoom-in');
        const zoomOut = page.getByTestId('calendar-zoom-out');
        await expect(zoomIn).toHaveAttribute('aria-label', 'Zoom in');
        await expect(zoomOut).toHaveAttribute('aria-label', 'Zoom out');

        await zoomIn.click();
        await expectHourHeight(page, 150);
        await zoomIn.click();
        await expectHourHeight(page, 300);
        await expect(zoomIndicator(page)).toHaveText('Zoom 300%');
        await expect(zoomIn).toHaveAttribute('aria-disabled', 'true');

        // aria-disabled keeps the button focusable; force past Playwright's enabled check
        await zoomIn.click({ force: true });
        await page.waitForTimeout(200);
        expect(await hourHeight(page)).toBe(300);
        expect((await readStoredSettings(page)).slotMinutes).toBe(5);

        for (const expected of [150, 100, 50, 25]) {
            await zoomOut.click();
            await expectHourHeight(page, expected);
        }
        await expect(zoomOut).toHaveAttribute('aria-disabled', 'true');
        await expect(zoomIn).not.toHaveAttribute('aria-disabled', 'true');
        await expect(zoomIndicator(page)).toHaveText('Zoom 25%');

        await openSettingsPopover(page);
        await expect(page.getByLabel('Grid Scale')).toContainText('1 hour');
    });

    test('zooming never refetches time entries', async ({ page }) => {
        await goToCalendar(page);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);

        let timeEntryRequests = 0;
        page.on('request', (request) => {
            if (request.url().includes('/time-entries')) timeEntryRequests++;
        });

        await page.getByTestId('calendar-zoom-in').click();
        await expectHourHeight(page, 150);
        await betweenSteps(page);
        const { x, y } = await gridCentre(page);
        expect(await ctrlWheel(page, x, y, -100)).toBe(true);
        await expectHourHeight(page, 300);
        await page.getByTestId('calendar-zoom-out').click();
        await expectHourHeight(page, 150);

        await page.waitForTimeout(1000);
        expect(timeEntryRequests).toBe(0);
    });

    test('selection still snaps after zooming', async ({ page }) => {
        await goToCalendar(page);
        await page.getByTestId('calendar-zoom-in').click();
        await page.getByTestId('calendar-zoom-in').click();
        await expectHourHeight(page, 300);

        await page.evaluate(() => {
            document
                .querySelector('.fc-timegrid-slot-lane[data-time="09:45:00"]')
                ?.scrollIntoView({ block: 'start' });
        });
        await page.waitForTimeout(300);

        // From just inside 10:00 to just inside 10:30 (5-minute rows of 25 px), snap 15 minutes
        const start = await page
            .locator('.fc-timegrid-slot-lane[data-time="10:00:00"]')
            .first()
            .boundingBox();
        const end = await page
            .locator('.fc-timegrid-slot-lane[data-time="10:30:00"]')
            .first()
            .boundingBox();
        expect(start).not.toBeNull();
        expect(end).not.toBeNull();
        const x = start!.x + start!.width / 2;

        await page.mouse.move(x, start!.y + 3);
        await page.mouse.down();
        await page.mouse.move(x, end!.y + 3, { steps: 10 });
        await page.mouse.up();

        await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
        const [createResponse] = await Promise.all([
            page.waitForResponse(
                (response) =>
                    response.url().includes('/time-entries') &&
                    response.request().method() === 'POST' &&
                    response.status() === 201
            ),
            page.getByRole('button', { name: 'Create Time Entry' }).click(),
        ]);

        // Test users run in UTC
        const body = await createResponse.json();
        const startDate = new Date(body.data.start);
        const endDate = new Date(body.data.end);
        expect(startDate.getUTCHours()).toBe(10);
        expect(startDate.getUTCMinutes()).toBe(0);
        expect(endDate.getUTCMinutes() % 15).toBe(0);
        expect(endDate.getTime()).toBeGreaterThan(startDate.getTime());
    });

    test('a zoom step closes an open hover card', async ({ page }) => {
        await goToCalendar(page);
        await page.evaluate(() => {
            document
                .querySelector('.fc-timegrid-slot-lane[data-time="13:00:00"]')
                ?.scrollIntoView({ block: 'start' });
        });
        await page.waitForTimeout(300);

        const today = new Date().toISOString().slice(0, 10);
        await page.evaluate(
            ({ day }) => {
                const setter = (
                    window as unknown as {
                        __TEST_SET_OUTLOOK_MEETINGS__?: (
                            meetings: unknown[],
                            labels?: Record<string, string>
                        ) => void;
                    }
                ).__TEST_SET_OUTLOOK_MEETINGS__;
                if (!setter) throw new Error('__TEST_SET_OUTLOOK_MEETINGS__ is not installed');
                setter(
                    [
                        {
                            id: 'm-zoom',
                            subject: 'Zoom review',
                            start: `${day}T14:00:00Z`,
                            end: `${day}T15:00:00Z`,
                            organizer_name: 'Test Organizer',
                            is_organizer: false,
                            is_online_meeting: false,
                            web_link: null,
                            dismissed: false,
                        },
                    ],
                    {
                        no_subject: '(No subject)',
                        ghost_label: ':subject, :start to :end, Outlook meeting suggestion',
                        layer_label: 'Outlook meetings, :day',
                        dismissed_suffix: ', dismissed',
                        eyebrow: 'Outlook meeting',
                        eyebrow_dismissed: 'Outlook meeting · Dismissed',
                        organized_by: 'Organized by :name',
                        you_organize: 'You are the organizer',
                        online: 'Online meeting',
                        open_in_outlook: 'Open in Outlook',
                        opens_new_tab: '(opens in a new tab)',
                        dismiss: 'Dismiss',
                        restore: 'Restore',
                        hover_hint: 'Click for details',
                    }
                );
            },
            { day: today }
        );

        const ghost = page.locator('.m365-ghost').first();
        await expect(ghost).toBeVisible();
        await ghost.hover();
        await expect(page.getByTestId('outlook-hover-card')).toBeVisible({ timeout: 3000 });

        const { x, y } = await gridCentre(page);
        expect(await ctrlWheel(page, x, y, -100)).toBe(true);
        await expect(page.getByTestId('outlook-hover-card')).toHaveCount(0);
    });
});
