import { PLAYWRIGHT_BASE_URL } from '../playwright/config';
import { test } from '../playwright/fixtures';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createBareTimeEntryViaApi } from './utils/api';
import { showCalendarWeekends } from './utils/calendar';

// Weekends are hidden by default; these tests work on "today", so show them (CI may run on a weekend)
test.beforeEach(async ({ page }) => {
    await showCalendarWeekends(page);
});

// The CI Playwright environment sets no SOLIDTIME_MICROSOFT_* variables, so the integration is off
// and there is no Graph. Ghosts are injected through window.__TEST_SET_OUTLOOK_MEETINGS__, the same
// way the activity-period tests inject data. Test users run in the UTC timezone.

interface InjectedMeeting {
    id: string;
    subject: string;
    start: string;
    end: string;
    web_link?: string | null;
    is_online_meeting?: boolean;
    organizer_name?: string | null;
}

// Hint line under the hover card details (English copy)
const HOVER_HINT = 'Click for details';

// Subset of the English copy that the ghost layer and its detail panel read (microsoft365.calendar.*)
const LABELS = {
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
    dismiss: 'Dismiss meeting',
    restore: 'Restore meeting',
    hover_hint: HOVER_HINT,
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
                    organizer_name: 'Test Organizer',
                    is_organizer: false,
                    is_online_meeting: false,
                    web_link: null,
                    dismissed: false,
                    ...meeting,
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

const MEETING_MENU = '[data-testid="outlook-meeting-menu"]';
const HOVER_CARD = '[data-testid="outlook-hover-card"]';
const DETAIL_PANEL = '[data-testid="outlook-ghost-detail"]';

// UI-SPEC 3.1 section 4 layering acceptance: the element the browser hit-tests at the centre of the
// meeting menu belongs to that menu, so no hover card, panel or other layer sits above it.
async function menuCentreHitsMenu(page: Page): Promise<boolean> {
    const box = await page.locator(MEETING_MENU).boundingBox();
    if (!box) return false;
    return page.evaluate(
        ({ x, y, selector }) => {
            const menu = document.querySelector(selector);
            const hit = document.elementFromPoint(x, y);
            if (!menu || !hit) return false;
            const content = hit.closest('[role="menu"]');
            return content !== null && content.contains(menu);
        },
        { x: box.x + box.width / 2, y: box.y + box.height / 2, selector: MEETING_MENU }
    );
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

    test('clicking a ghost opens the Outlook detail panel and never the create dialog', async ({
        page,
    }) => {
        await goToCalendar(page);
        await scrollCalendarToTime(page, '14:00:00');
        await injectMeetings(page, [
            {
                id: 'm-click',
                subject: 'Weekly sync',
                start: todayAt('14:00:00'),
                end: todayAt('15:00:00'),
            },
        ]);
        const ghost = page.locator('.m365-ghost');
        await expect(ghost).toHaveCount(1);

        await ghost.click();

        const dialog = page.getByRole('dialog');
        await expect(dialog).toHaveCount(1);
        await expect(dialog).toContainText('Weekly sync');
        await expect(page.getByRole('button', { name: 'No Project' })).toHaveCount(0);

        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);

        // A second pointer path: press, short drag across the ghost and release. It may open the
        // Outlook panel, but never the create-time-entry dialog.
        const box = await ghost.boundingBox();
        await page.mouse.move(box!.x + box!.width / 2, box!.y + 4);
        await page.mouse.down();
        await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height - 4, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(500);
        await expect(page.getByRole('button', { name: 'No Project' })).toHaveCount(0);
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

test.describe('Outlook meeting hover card and context menu', () => {
    test('right-click over an open hover card closes it and opens the meeting menu on top', async ({
        page,
    }) => {
        await goToCalendar(page);
        await scrollCalendarToTime(page, '14:00:00');
        await injectMeetings(page, [
            {
                id: 'm-layer',
                subject: 'Layering review',
                start: todayAt('14:00:00'),
                end: todayAt('15:00:00'),
                web_link: 'https://outlook.example.test/meeting-1',
            },
        ]);
        const ghost = page.locator('.m365-ghost');
        await expect(ghost).toHaveCount(1);

        await ghost.hover();
        const card = page.locator(HOVER_CARD);
        await expect(card).toBeVisible();
        await expect(card).toContainText('Layering review');
        await expect(card).toContainText(HOVER_HINT);

        await ghost.click({ button: 'right' });

        await expect(page.locator(HOVER_CARD)).toHaveCount(0);
        const menu = page.locator(MEETING_MENU);
        await expect(menu).toBeVisible();
        await expect(menu.locator('[data-testid="outlook-menu-label"]')).toHaveText(
            'Layering review'
        );
        await expect(menu.locator('[data-testid="outlook-menu-open"]')).toContainText(
            LABELS.open_in_outlook
        );
        // A meeting never gets the empty-slot menu, and test-hook mode cannot dismiss
        await expect(page.getByRole('menuitem', { name: 'Create Time Entry' })).toHaveCount(0);
        await expect(page.locator('[data-testid="outlook-menu-dismiss"]')).toHaveCount(0);
        await expect(page.getByText(LABELS.dismiss)).toHaveCount(0);

        expect(await menuCentreHitsMenu(page)).toBe(true);

        await page.keyboard.press('Escape');
        await expect(page.locator(MEETING_MENU)).toHaveCount(0);
    });

    test('hovering shows the details; clicking swaps the card for the panel', async ({ page }) => {
        await goToCalendar(page);
        await scrollCalendarToTime(page, '14:00:00');
        await injectMeetings(page, [
            {
                id: 'm-hover',
                subject: 'Design review',
                start: todayAt('14:00:00'),
                end: todayAt('15:00:00'),
                is_online_meeting: true,
            },
        ]);
        const ghost = page.locator('.m365-ghost');
        await expect(ghost).toHaveCount(1);

        await ghost.hover();
        const card = page.locator(HOVER_CARD);
        await expect(card).toBeVisible();
        await expect(card).toContainText(LABELS.eyebrow);
        await expect(card.locator('[data-testid="outlook-hover-subject"]')).toHaveText(
            'Design review'
        );
        await expect(card.locator('[data-testid="outlook-hover-time"]')).toContainText('14:00');
        await expect(card.locator('[data-testid="outlook-hover-online"]')).toHaveText(
            LABELS.online
        );
        await expect(card).toContainText(HOVER_HINT);

        await ghost.click();

        await expect(page.locator(HOVER_CARD)).toHaveCount(0);
        await expect(page.locator(DETAIL_PANEL)).toBeVisible();
        await expect(page.locator(DETAIL_PANEL)).toContainText('Design review');
    });

    test('with the panel open, a right-click closes it and Open in Outlook is usable', async ({
        page,
    }) => {
        // The Outlook link never leaves the test: the new tab gets a local stand-in page
        await page
            .context()
            .route('https://outlook.example.test/**', (route) =>
                route.fulfill({ status: 200, contentType: 'text/plain', body: 'Outlook stand-in' })
            );
        await goToCalendar(page);
        await scrollCalendarToTime(page, '14:00:00');
        await injectMeetings(page, [
            {
                id: 'm-panel',
                subject: 'Customer call',
                start: todayAt('14:00:00'),
                end: todayAt('15:00:00'),
                web_link: 'https://outlook.example.test/meeting-1',
            },
        ]);
        const ghost = page.locator('.m365-ghost');
        await expect(ghost).toHaveCount(1);

        await ghost.click();
        await expect(page.locator(DETAIL_PANEL)).toBeVisible();

        await ghost.click({ button: 'right' });

        await expect(page.locator(DETAIL_PANEL)).toHaveCount(0);
        await expect(page.locator(MEETING_MENU)).toBeVisible();
        expect(await menuCentreHitsMenu(page)).toBe(true);

        // Playwright hit-tests the item before clicking it, so nothing may cover it
        const popupPromise = page.context().waitForEvent('page');
        await page.locator('[data-testid="outlook-menu-open"]').click();
        const popup = await popupPromise;
        await expect(popup).toHaveURL(/^https:\/\/outlook\.example\.test\/meeting-1/);
        // noopener: the Outlook tab cannot reach back into the app (reverse tabnabbing, T-03.1-16)
        expect(await popup.evaluate(() => window.opener)).toBeNull();
        await popup.close();
        await expect(page.locator(MEETING_MENU)).toHaveCount(0);
    });

    test('right-click on empty lane space opens the empty-slot menu', async ({ page }) => {
        await goToCalendar(page);
        await scrollCalendarToTime(page, '14:00:00');
        await injectMeetings(page, [
            {
                id: 'm-lane',
                subject: 'Short sync',
                start: todayAt('14:00:00'),
                end: todayAt('14:30:00'),
            },
        ]);
        await expect(page.locator('.m365-ghost')).toHaveCount(1);
        const lane = page.locator('[data-testid="outlook-lane"]');
        await expect(lane).toHaveCount(1);

        // A point in the Outlook lane well after the meeting: the lane itself lets the pointer through
        await page.evaluate(() => {
            document
                .querySelector('.fc-timegrid-slot-lane[data-time="16:00:00"]')
                ?.scrollIntoView({ block: 'center' });
        });
        await page.waitForTimeout(300);
        const laneBox = await lane.boundingBox();
        const rowBox = await page
            .locator('.fc-timegrid-slot-lane[data-time="16:00:00"]')
            .first()
            .boundingBox();
        expect(laneBox).not.toBeNull();
        expect(rowBox).not.toBeNull();
        const x = laneBox!.x + laneBox!.width / 2;
        const y = rowBox!.y + rowBox!.height / 2;
        const onMeeting = await page.evaluate(
            ({ px, py }) => document.elementFromPoint(px, py)?.closest('.m365-ghost') != null,
            { px: x, py: y }
        );
        expect(onMeeting).toBe(false);

        await page.mouse.click(x, y, { button: 'right' });

        await expect(page.getByRole('menuitem', { name: 'Create Time Entry' })).toBeVisible();
        await expect(page.locator(MEETING_MENU)).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu')).toHaveCount(0);
    });

    test('right-click on an entry still opens the entry menu', async ({ page, ctx }) => {
        const entry = await createBareTimeEntryViaApi(ctx, 'Menu entry', '1h');
        await goToCalendar(page);
        const entryBlock = page.locator('.fc-event').filter({ hasText: 'Menu entry' }).first();
        await entryBlock.scrollIntoViewIfNeeded();
        await expect(entryBlock).toBeVisible();
        // A meeting at the same time, so the Outlook layer and its menu slot are active
        await injectMeetings(page, [
            { id: 'm-entry', subject: 'Beside the entry', start: entry.start, end: entry.end },
        ]);
        await expect(page.locator('.m365-ghost')).toHaveCount(1);

        await entryBlock.click({ button: 'right' });

        await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
        await expect(page.locator(MEETING_MENU)).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu')).toHaveCount(0);
    });

    test('no hover card opens while the menu is open', async ({ page }) => {
        await goToCalendar(page);
        await scrollCalendarToTime(page, '14:00:00');
        await injectMeetings(page, [
            {
                id: 'm-first',
                subject: 'First meeting',
                start: todayAt('14:00:00'),
                end: todayAt('14:30:00'),
            },
            {
                id: 'm-second',
                subject: 'Second meeting',
                start: todayAt('15:00:00'),
                end: todayAt('15:30:00'),
            },
        ]);
        await expect(page.locator('.m365-ghost')).toHaveCount(2);
        const first = page.locator('.m365-ghost[data-ghost-id="m-first"]');
        const second = page.locator('.m365-ghost[data-ghost-id="m-second"]');
        const secondBox = await second.boundingBox();
        expect(secondBox).not.toBeNull();

        await first.click({ button: 'right' });
        await expect(page.locator(MEETING_MENU)).toBeVisible();

        // Left part of the second block: the menu opens to the right of the first block's centre
        await page.mouse.move(
            secondBox!.x + secondBox!.width / 4,
            secondBox!.y + secondBox!.height / 2,
            { steps: 5 }
        );
        await page.waitForTimeout(700);

        await expect(page.locator(HOVER_CARD)).toHaveCount(0);
        await expect(page.locator(MEETING_MENU)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator(MEETING_MENU)).toHaveCount(0);
    });
});

test.describe('Outlook meetings on touch', () => {
    test.use({ hasTouch: true });
    test.skip(
        ({ browserName }) => browserName === 'firefox',
        'touch emulation is Chromium-only in this suite'
    );

    test('a tap opens the panel and never the hover card', async ({ page }) => {
        await goToCalendar(page);
        await scrollCalendarToTime(page, '14:00:00');
        await injectMeetings(page, [
            {
                id: 'm-touch',
                subject: 'Tap meeting',
                start: todayAt('14:00:00'),
                end: todayAt('15:00:00'),
            },
        ]);
        const ghost = page.locator('.m365-ghost');
        await expect(ghost).toHaveCount(1);

        await ghost.tap();

        await expect(page.locator(DETAIL_PANEL)).toBeVisible();
        await page.waitForTimeout(700);
        await expect(page.locator(HOVER_CARD)).toHaveCount(0);
    });
});
