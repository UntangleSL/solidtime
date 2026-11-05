import { PLAYWRIGHT_BASE_URL } from '../playwright/config';
import { test } from '../playwright/fixtures';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createBareTimeEntryViaApi } from './utils/api';

// The CI Playwright environment sets no SOLIDTIME_MICROSOFT_* variables, so the integration is off
// and there is no Graph. Ghosts are injected through window.__TEST_SET_OUTLOOK_MEETINGS__, the same
// way the activity-period tests inject data. Test users run in the UTC timezone.

interface InjectedMeeting {
    id: string;
    subject: string;
    start: string;
    end: string;
}

// Subset of the English copy that the ghost layer reads (microsoft365.calendar.*)
const LABELS = {
    no_subject: '(No subject)',
    ghost_label: ':subject, :start to :end, Outlook meeting suggestion',
    layer_label: 'Outlook meetings, :day',
    dismissed_suffix: ', dismissed',
};

async function goToCalendar(page: Page) {
    await page.goto(PLAYWRIGHT_BASE_URL + '/calendar');
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });
    // Wait for FullCalendar to fully render its time grid
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

async function injectMeetings(page: Page, meetings: InjectedMeeting[]) {
    await page.evaluate(
        ({ list, labels }) => {
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
                list.map((meeting) => ({
                    ...meeting,
                    organizer_name: 'Test Organizer',
                    is_organizer: false,
                    is_online_meeting: false,
                    web_link: null,
                    dismissed: false,
                })),
                labels
            );
        },
        { list: meetings, labels: LABELS }
    );
}

async function headerTexts(page: Page): Promise<string[]> {
    return page.locator('.fc-col-header-cell').allInnerTexts();
}

test.describe('Outlook ghosts', () => {
    test('ghosts render from injected meetings and leave entries and totals unchanged', async ({
        page,
        ctx,
    }) => {
        await createBareTimeEntryViaApi(ctx, 'Totals entry', '1h');
        await goToCalendar(page);
        await scrollCalendarToTime(page, '14:00:00');
        await expect(page.locator('.fc-event').filter({ hasText: 'Totals entry' })).toBeVisible();
        const eventCountBefore = await page.locator('.fc-event').count();
        const headersBefore = await headerTexts(page);
        expect(headersBefore.length).toBeGreaterThan(0);

        await injectMeetings(page, [
            {
                id: 'm-1',
                subject: 'Standup',
                start: todayAt('14:00:00'),
                end: todayAt('14:30:00'),
            },
            {
                id: 'm-2',
                subject: 'Planning',
                start: todayAt('14:30:00'),
                end: todayAt('15:00:00'),
            },
        ]);

        await expect(page.locator('.m365-ghost')).toHaveCount(2);
        expect(await page.locator('.fc-event').count()).toBe(eventCountBefore);
        expect(await headerTexts(page)).toEqual(headersBefore);
        await expect(
            page.getByRole('button', {
                name: `Standup, 14:00 to 14:30, Outlook meeting suggestion`,
            })
        ).toBeVisible();
    });

    test('clicking a ghost opens no create-time-entry dialog', async ({ page }) => {
        await goToCalendar(page);
        await scrollCalendarToTime(page, '14:00:00');
        await injectMeetings(page, [
            {
                id: 'm-click',
                subject: 'Click target',
                start: todayAt('14:00:00'),
                end: todayAt('15:00:00'),
            },
        ]);
        const ghost = page.locator('.m365-ghost');
        await expect(ghost).toHaveCount(1);

        await ghost.click();
        await page.waitForTimeout(500);

        await expect(page.getByRole('dialog')).toHaveCount(0);
        // A second pointer path: press and release on the ghost, then a short drag across it
        const box = await ghost.boundingBox();
        await page.mouse.move(box!.x + box!.width / 2, box!.y + 4);
        await page.mouse.down();
        await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height - 4, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(500);
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    test('a ghost exactly overlapping a time entry stays visible and clickable and the entry stays editable', async ({
        page,
        ctx,
    }) => {
        const entry = await createBareTimeEntryViaApi(ctx, 'Overlap entry', '1h');
        await goToCalendar(page);
        const entryBlock = page.locator('.fc-event').filter({ hasText: 'Overlap entry' }).first();
        await entryBlock.scrollIntoViewIfNeeded();
        await expect(entryBlock).toBeVisible();

        await injectMeetings(page, [
            { id: 'm-overlap', subject: 'Exact overlap', start: entry.start, end: entry.end },
        ]);
        const ghost = page.locator('.m365-ghost');
        await expect(ghost).toHaveCount(1);
        await expect(ghost).toBeVisible();
        await expect(entryBlock).toBeVisible();

        // The ghost sits in its own lane: no horizontal overlap with the entry block
        const entryBox = await entryBlock.boundingBox();
        const ghostBox = await ghost.boundingBox();
        expect(entryBox).not.toBeNull();
        expect(ghostBox).not.toBeNull();
        expect(ghostBox!.x).toBeGreaterThanOrEqual(entryBox!.x + entryBox!.width - 1);

        // The ghost receives the pointer (nothing covers it) ...
        await ghost.click({ trial: true });
        // ... and the entry still opens its edit dialog
        await entryBlock.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Update Time Entry' })).toBeVisible();
    });

    test('five overlapping ghosts stay reachable', async ({ page }) => {
        await goToCalendar(page);
        await scrollCalendarToTime(page, '14:00:00');
        const meetings: InjectedMeeting[] = [1, 2, 3, 4, 5].map((n) => ({
            id: `m-lane-${n}`,
            subject: `Parallel ${n}`,
            start: todayAt('14:00:00'),
            end: todayAt('15:00:00'),
        }));

        await injectMeetings(page, meetings);

        const ghosts = page.locator('.m365-ghost');
        await expect(ghosts).toHaveCount(5);
        await ghosts.first().focus();
        const reached = new Set<string>();
        for (let i = 0; i < 5; i++) {
            const focused = page.locator('.m365-ghost:focus');
            await expect(focused).toHaveCount(1);
            reached.add((await focused.getAttribute('aria-label')) ?? '');
            if (i < 4) await page.keyboard.press('Tab');
        }
        expect(reached.size).toBe(5);
    });

    test('without the integration nothing Outlook-related renders', async ({ page }) => {
        const outlookRequests: string[] = [];
        page.on('request', (request) => {
            if (request.url().includes('/m365/')) outlookRequests.push(request.url());
        });

        await goToCalendar(page);
        await page.waitForTimeout(1500);

        await expect(page.locator('.m365-ghost')).toHaveCount(0);
        await expect(page.locator('[data-testid="outlook-calendar-controls"]')).toHaveCount(0);
        expect(outlookRequests).toEqual([]);
    });
});
