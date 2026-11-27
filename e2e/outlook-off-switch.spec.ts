import { PLAYWRIGHT_BASE_URL } from '../playwright/config';
import { test } from '../playwright/fixtures';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createTimeEntryWithTimestampsViaApi } from './utils/api';
import { showCalendarWeekends } from './utils/calendar';

// Phase 7 browser proof of the off switch (OPS-02) on the calendar.
//
// The CI Playwright environment sets no SOLIDTIME_MICROSOFT_* variables (e2e/microsoft-signin.spec.ts
// proves it: no Microsoft button on the login page), so the integration is off here. Nothing is
// injected: the point is what the calendar renders on its own. The user's time entries must show
// as upstream shows them, no Outlook element may render, and the browser must not call any fork
// endpoint (/m365/... or /auth/microsoft/...). Test users run in the UTC timezone.

// Weekends are hidden by default; this test works on "today", so show them (CI may run on a weekend)
test.beforeEach(async ({ page }) => {
    await showCalendarWeekends(page);
});

const OUTLOOK_TEST_IDS = [
    'outlook-calendar-controls',
    'outlook-lane',
    'outlook-entry-badge',
    'outlook-selection-bar',
    'outlook-out-of-sync',
    'outlook-sync-button',
];

async function goToCalendar(page: Page) {
    await page.goto(PLAYWRIGHT_BASE_URL + '/calendar');
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });
    // Wait for the time grid to fully render
    await page.waitForTimeout(1000);
}

async function scrollCalendarToTime(page: Page, time: string) {
    await page.evaluate((t) => {
        const slot = document.querySelector(`.fc-timegrid-slot-lane[data-time="${t}"]`);
        if (slot) slot.scrollIntoView({ block: 'start' });
    }, time);
    await page.waitForTimeout(300);
}

function todayUtc(): string {
    return new Date().toISOString().slice(0, 10);
}

function todayAt(time: string): string {
    return `${todayUtc()}T${time}Z`;
}

function isForkEndpoint(url: string): boolean {
    const path = new URL(url).pathname;
    return path.includes('/m365/') || path.includes('/auth/microsoft/');
}

test('calendar shows time entries and nothing from Outlook when the integration is off', async ({
    page,
    ctx,
}) => {
    const forkRequests: string[] = [];
    page.on('request', (request) => {
        if (isForkEndpoint(request.url())) {
            forkRequests.push(`${request.method()} ${request.url()}`);
        }
    });

    const description = 'Off switch entry ' + Math.floor(1 + Math.random() * 100000);
    await createTimeEntryWithTimestampsViaApi(ctx, {
        description,
        start: todayAt('09:00:00'),
        end: todayAt('10:00:00'),
    });

    await goToCalendar(page);
    await scrollCalendarToTime(page, '08:00:00');

    // The core calendar works: the entry renders as upstream renders it
    await expect(page.locator('.fc-event').filter({ hasText: description }).first()).toBeVisible();

    // Nothing from Outlook renders: no controls, lane, entry badge, selection bar,
    // out-of-sync marker or Sync button
    for (const testId of OUTLOOK_TEST_IDS) {
        await expect(page.getByTestId(testId), testId).toHaveCount(0);
    }

    // Give late queries (the meetings query starts on mount when enabled) a moment, then check
    // that no fork endpoint was ever called
    await page.waitForTimeout(1000);
    expect(forkRequests).toEqual([]);
});
