import { PLAYWRIGHT_BASE_URL } from '../playwright/config';
import { test } from '../playwright/fixtures';
import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { createProjectViaApi, createTimeEntryWithTimestampsViaApi } from './utils/api';
import { showCalendarWeekends } from './utils/calendar';

// Weekends are hidden by default; these tests work on "today", so show them (CI may run on a weekend)
test.beforeEach(async ({ page }) => {
    await showCalendarWeekends(page);
});

// Phase 3.1 meeting look (UX-02, D-02, D-04). The CI Playwright environment has no Microsoft
// integration, so meetings are injected through window.__TEST_SET_OUTLOOK_MEETINGS__ like in
// outlook-ghosts.spec.ts. Test users run in the UTC timezone.

interface InjectedMeeting {
    id: string;
    subject: string;
    start: string;
    end: string;
}

// Subset of the English copy that the meeting layer and its detail panel read
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
    dismiss: 'Dismiss',
    restore: 'Restore',
};

// The project colour that collides with the default sky accent (UI-SPEC 3.1 "Known collision")
const SKY_BLUE = '#0ea5e9';

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

// Swaps the light/dark class on <html> (resources/js/utils/theme.ts) without a reload
async function setTheme(page: Page, theme: 'light' | 'dark') {
    await page.evaluate((next) => {
        const root = document.documentElement;
        root.classList.remove('light', 'dark');
        root.classList.add(next);
    }, theme);
    await page.waitForTimeout(150);
}

async function attachScreenshot(
    page: Page,
    testInfo: TestInfo,
    name: string,
    box: { x: number; y: number; width: number; height: number }
) {
    const viewport = page.viewportSize();
    const x = Math.max(0, Math.floor(box.x - 8));
    const y = Math.max(0, Math.floor(box.y - 8));
    const width = Math.min(Math.ceil(box.width + 16), (viewport?.width ?? 1280) - x);
    const height = Math.min(Math.ceil(box.height + 16), (viewport?.height ?? 720) - y);
    await testInfo.attach(name, {
        body: await page.screenshot({ clip: { x, y, width, height } }),
        contentType: 'image/png',
    });
}

interface MeetingLook {
    meetingFill: [number, number, number, number];
    entryFill: [number, number, number, number];
    borderLeftWidth: string;
    meetingShadow: string;
    entryShadow: string;
    subjectContrast: number;
}

test.describe('Outlook meeting look', () => {
    test('a sky-blue project entry and a meeting stay distinguishable in light and dark', async ({
        page,
        ctx,
    }, testInfo) => {
        const project = await createProjectViaApi(ctx, { name: 'Sky project', color: SKY_BLUE });
        await createTimeEntryWithTimestampsViaApi(ctx, {
            description: 'Sky entry',
            start: todayAt('14:00:00'),
            end: todayAt('15:00:00'),
            projectId: project.id,
        });
        await goToCalendar(page);
        await scrollCalendarToTime(page, '13:00:00');
        const entry = page.locator('.fc-event').filter({ hasText: 'Sky entry' }).first();
        await expect(entry).toBeVisible();

        await injectMeetings(page, [
            {
                id: 'm-sky',
                subject: 'Sky meeting',
                start: todayAt('14:00:00'),
                end: todayAt('15:00:00'),
            },
        ]);
        const meeting = page.locator('.m365-meeting');
        await expect(meeting).toHaveCount(1);
        const lane = page.getByTestId('outlook-lane');
        await expect(lane).toHaveCount(1);

        for (const theme of ['light', 'dark'] as const) {
            await setTheme(page, theme);

            // Disjoint zones: the entry ends before the Outlook lane starts
            const entryBox = await entry.boundingBox();
            const laneBox = await lane.boundingBox();
            const meetingBox = await meeting.boundingBox();
            expect(entryBox).not.toBeNull();
            expect(laneBox).not.toBeNull();
            expect(meetingBox).not.toBeNull();
            expect(entryBox!.x + entryBox!.width).toBeLessThanOrEqual(laneBox!.x + 0.5);
            expect(meetingBox!.x).toBeGreaterThanOrEqual(laneBox!.x);

            const entryHandle = await entry.elementHandle();
            const look: MeetingLook = await meeting.evaluate((block, entryEl) => {
                type Rgba = [number, number, number, number];
                const alphaOf = (value?: string) =>
                    value === undefined
                        ? 1
                        : value.endsWith('%')
                          ? parseFloat(value) / 100
                          : parseFloat(value);
                // Computed colours come as rgb()/rgba() or color(srgb ...); anything else (the
                // oklch tokens of the dark theme) is converted to sRGB through a 1px canvas.
                const toRgba = (color: string): Rgba => {
                    const rgb = color.match(
                        /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/
                    );
                    if (rgb) {
                        return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alphaOf(rgb[4])];
                    }
                    const srgb = color.match(
                        /^color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/
                    );
                    if (srgb) {
                        return [
                            Number(srgb[1]) * 255,
                            Number(srgb[2]) * 255,
                            Number(srgb[3]) * 255,
                            alphaOf(srgb[4]),
                        ];
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = 1;
                    canvas.height = 1;
                    const context = canvas.getContext('2d')!;
                    context.clearRect(0, 0, 1, 1);
                    context.fillStyle = color;
                    context.fillRect(0, 0, 1, 1);
                    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
                    return [r!, g!, b!, a! / 255];
                };
                const luminance = ([r, g, b]: Rgba) => {
                    const channel = (value: number) => {
                        const c = Math.min(255, Math.max(0, value)) / 255;
                        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
                    };
                    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
                };
                const over = (top: Rgba, base: Rgba): Rgba => [
                    top[0] * top[3] + base[0] * (1 - top[3]),
                    top[1] * top[3] + base[1] * (1 - top[3]),
                    top[2] * top[3] + base[2] * (1 - top[3]),
                    1,
                ];

                const blockStyle = getComputedStyle(block);
                const entryStyle = getComputedStyle(entryEl as Element);
                const subject = block.querySelector('[data-ghost-subject]') ?? block;
                const fill = toRgba(blockStyle.backgroundColor);
                const text = over(toRgba(getComputedStyle(subject).color), fill);
                const lighter = Math.max(luminance(text), luminance(fill));
                const darker = Math.min(luminance(text), luminance(fill));

                return {
                    meetingFill: fill,
                    entryFill: toRgba(entryStyle.backgroundColor),
                    borderLeftWidth: blockStyle.borderLeftWidth,
                    meetingShadow: blockStyle.boxShadow,
                    entryShadow: entryStyle.boxShadow,
                    subjectContrast: (lighter + 0.05) / (darker + 0.05),
                };
            }, entryHandle);

            testInfo.annotations.push({
                type: `meeting-look-${theme}`,
                description: JSON.stringify(look),
            });

            // Opaque solid fill (D-02) that differs from the project-coloured entry
            expect(look.meetingFill[3]).toBe(1);
            const fillDistance = Math.hypot(
                look.meetingFill[0] - look.entryFill[0],
                look.meetingFill[1] - look.entryFill[1],
                look.meetingFill[2] - look.entryFill[2]
            );
            expect(fillDistance).toBeGreaterThan(10);
            // 3px bar, flat meeting vs elevated entry
            expect(look.borderLeftWidth).toBe('3px');
            expect(look.meetingShadow).toBe('none');
            expect(look.entryShadow).not.toBe('none');
            // Subject readable on the fill (WCAG AA)
            expect(look.subjectContrast).toBeGreaterThanOrEqual(4.5);

            await attachScreenshot(page, testInfo, `sky-blue-entry-and-meeting-${theme}.png`, {
                x: Math.min(entryBox!.x, laneBox!.x),
                y: Math.min(entryBox!.y, meetingBox!.y),
                width:
                    Math.max(laneBox!.x + laneBox!.width, entryBox!.x + entryBox!.width) -
                    Math.min(entryBox!.x, laneBox!.x),
                height: Math.max(entryBox!.height, meetingBox!.height),
            });
        }
    });

    const LAYOUTS = [
        { label: 'narrow week', width: 1366, height: 900, dayView: false },
        { label: 'wider week', width: 1800, height: 1000, dayView: false },
        { label: 'day view', width: 1500, height: 900, dayView: true },
    ];

    test('six overlapping meetings stay reachable at narrow, wider and day-view lane widths', async ({
        page,
    }, testInfo) => {
        // Staggered starts, one shared end: all six overlap and the start order is unambiguous
        const meetings: InjectedMeeting[] = [0, 1, 2, 3, 4, 5].map((n) => ({
            id: `m-six-${n + 1}`,
            subject: `Parallel ${n + 1}`,
            start: todayAt(`14:${String(n * 5).padStart(2, '0')}:00`),
            end: todayAt('15:00:00'),
        }));
        const expectedLabels = meetings.map(
            (meeting) =>
                `${meeting.subject}, ${meeting.start.slice(11, 16)} to 15:00, Outlook meeting suggestion`
        );

        for (const layout of LAYOUTS) {
            await page.setViewportSize({ width: layout.width, height: layout.height });
            await goToCalendar(page);
            if (layout.dayView) {
                await page.getByRole('tab', { name: 'day', exact: true }).click();
                await expect(page.locator('.fc-col-header-cell')).toHaveCount(1);
            }
            await scrollCalendarToTime(page, '13:00:00');
            await injectMeetings(page, meetings);

            const blocks = page.locator('.m365-meeting');
            await expect(blocks).toHaveCount(6);
            const lane = page.getByTestId('outlook-lane');
            await expect(lane).toHaveCount(1);

            // Side-by-side columns follow the measured lane width: floor(width / 56px),
            // clamped to 1..3 in week view and 1..4 in day view
            const laneWidth = await lane.evaluate((el) => el.getBoundingClientRect().width);
            const cap = layout.dayView ? 4 : 3;
            const expectedColumns = Math.min(cap, Math.max(1, Math.floor(laneWidth / 56)));
            testInfo.annotations.push({
                type: 'outlook-lane-width',
                description: `${layout.label} ${layout.width}x${layout.height}: lane ${laneWidth.toFixed(1)}px, ${expectedColumns} column(s)`,
            });
            await expect
                .poll(async () =>
                    page
                        .locator('.m365-meeting:not(.m365-meeting--cascaded)')
                        .evaluateAll(
                            (els) =>
                                new Set(
                                    els.map((el) => Math.round(el.getBoundingClientRect().left))
                                ).size
                        )
                )
                .toBe(expectedColumns);

            // Keyboard: Tab from the first block reaches all six, in start order
            await blocks.first().focus();
            const reached: string[] = [];
            for (let i = 0; i < 6; i++) {
                const focused = page.locator('.m365-meeting:focus');
                await expect(focused).toHaveCount(1);
                reached.push((await focused.getAttribute('aria-label')) ?? '');
                if (i < 5) await page.keyboard.press('Tab');
            }
            expect(reached).toEqual(expectedLabels);
            // Drop the focus so no block is raised (focus:z-[1]) during the hit tests
            await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

            // Pointer: every block with a unique (column, cascade depth) position, i.e. a unique
            // left edge, is hit 1px inside its left edge at its vertical centre
            const hits = await blocks.evaluateAll((els) => {
                const lefts = els.map((el) => Math.round(el.getBoundingClientRect().left));
                return els.map((el, index) => {
                    const rect = el.getBoundingClientRect();
                    const left = lefts[index]!;
                    const unique = lefts.filter((value) => value === left).length === 1;
                    const hit = document.elementFromPoint(
                        rect.left + 1,
                        rect.top + rect.height / 2
                    );
                    return {
                        id: el.getAttribute('data-ghost-id'),
                        unique,
                        reached: hit !== null && (hit === el || el.contains(hit)),
                    };
                });
            });
            const uniqueHits = hits.filter((hit) => hit.unique);
            expect(uniqueHits.length).toBeGreaterThanOrEqual(Math.min(expectedColumns + 1, 6));
            for (const hit of uniqueHits) {
                expect(hit, `block ${hit.id} is hit-testable`).toMatchObject({ reached: true });
            }

            const laneBox = await lane.boundingBox();
            expect(laneBox).not.toBeNull();
            const firstBox = await blocks.first().boundingBox();
            await attachScreenshot(
                page,
                testInfo,
                `six-overlap-${layout.label.replace(/\s+/g, '-')}.png`,
                {
                    x: laneBox!.x,
                    y: firstBox!.y,
                    width: laneBox!.width,
                    height: firstBox!.height,
                }
            );
        }
    });
});
