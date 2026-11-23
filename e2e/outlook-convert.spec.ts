import { PLAYWRIGHT_BASE_URL } from '../playwright/config';
import { test } from '../playwright/fixtures';
import type { TestContext } from '../playwright/fixtures';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { createProjectViaApi, createTagViaApi } from './utils/api';
import { showCalendarWeekends } from './utils/calendar';

// Phase 4 browser proof: turning Outlook meetings into time entries.
//
// The CI Playwright environment sets no SOLIDTIME_MICROSOFT_* variables, so the integration is off:
// meetings are injected through window.__TEST_SET_OUTLOOK_MEETINGS__ with { actions: true }, which
// lets them be selected and converted. The real convert endpoint answers 404 while the integration
// is off, so page.route() answers the convert request instead: for every meeting it creates the real
// time entry through the core API (or answers a scripted failure) and returns { results } exactly
// like the server contract. Test users run in the UTC timezone.

// Weekends are hidden by default; these tests work on "today", so show them (CI may run on a weekend)
test.beforeEach(async ({ page }) => {
    await showCalendarWeekends(page);
});

interface InjectedMeeting {
    id: string;
    subject: string;
    start: string;
    end: string;
    web_link?: string | null;
    is_online_meeting?: boolean;
    organizer_name?: string | null;
}

interface ConvertBody {
    meeting_ids: string[];
    project_id: string | null;
    task_id: string | null;
    tags: string[];
    billable: boolean;
    description?: string;
    start?: string;
    end?: string;
}

interface ConvertResult {
    meeting_id: string;
    status: 'created' | 'existing' | 'failed';
    time_entry_id: string | null;
    error: { key: string; message: string } | null;
}

// English copy of microsoft365.calendar.* that the Outlook layer, its panel, the form, the selection
// bar and the batch results read (the 3.1 subset plus the Phase 4 keys).
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
    hover_hint: 'Click for details',
    // Phase 4: assigning meetings to projects
    create_entry: 'Create time entry',
    create_submit: 'Create entry',
    form_context: 'From Outlook · :when',
    field_description: 'Description',
    field_project: 'Project',
    field_start: 'Start',
    field_end: 'End',
    error_project_required: 'Choose a project.',
    error_end_before_start: 'End time must be after start time.',
    hover_hint_select: 'Click for details. Ctrl+click to select several.',
    hover_hint_select_mac: 'Click for details. ⌘+click to select several.',
    select: 'Select meeting',
    deselect: 'Deselect meeting',
    selected_suffix: ', selected',
    selection_label: 'Meeting selection',
    selected_one: '1 meeting selected',
    selected_many: ':count meetings selected',
    selection_cleared: 'Selection cleared',
    clear_selection: 'Clear selection',
    assign_one: 'Assign 1 meeting',
    assign_many: 'Assign :count meetings',
    batch_note: 'Each meeting keeps its own time, and its subject becomes the description.',
    batch_submit_one: 'Create 1 time entry',
    batch_submit_many: 'Create :count time entries',
    batch_summary: ':done of :total time entries created',
    batch_none: 'No time entries created',
    batch_success_many: ':count time entries created successfully',
    retry_failed: 'Retry :count failed',
    close: 'Close',
    row_created: 'Created',
    row_existing: 'Already had a time entry',
    created_announcement: 'Time entry created',
    from_meeting: 'Created from an Outlook meeting',
    error_forbidden_project: "You can't add time to this project.",
    error_meeting_gone: 'This meeting is no longer in your Outlook calendar. Sync to refresh.',
    error_generic: 'Could not create the time entry. Try again in a moment.',
    cancel: 'Cancel',
    description_placeholder: 'What did you work on?',
    tags: 'Tags',
    tags_one: '1 Tag',
    tags_many: ':count Tags',
    billable: 'Billable',
    non_billable: 'Non-Billable',
    created_success: 'Time entry created successfully',
};

const FORBIDDEN_MESSAGE = "You can't add time to this project.";

const MEETING_MENU = '[data-testid="outlook-meeting-menu"]';
const HOVER_CARD = '[data-testid="outlook-hover-card"]';
const DETAIL_PANEL = '[data-testid="outlook-ghost-detail"]';
const CONVERT_FORM = '[data-testid="outlook-convert-form"]';
const SELECTION_BAR = '[data-testid="outlook-selection-bar"]';
const BATCH_POPOVER = '[data-testid="outlook-batch-popover"]';
const CONVERT_ROUTE = '**/m365/organizations/*/meetings/time-entries';

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

function convertUrl(ctx: TestContext): string {
    return `${PLAYWRIGHT_BASE_URL}/m365/organizations/${ctx.orgId}/meetings/time-entries`;
}

function withDefaults(meeting: InjectedMeeting) {
    return {
        organizer_name: 'Test Organizer',
        is_organizer: false,
        is_online_meeting: false,
        web_link: null,
        dismissed: false,
        ...meeting,
    };
}

// Inject meetings. With a convert URL the hook runs with actions enabled (canAct true); without it
// the meetings stay display only, as in e2e/outlook-ghosts.spec.ts.
async function injectMeetings(page: Page, meetings: InjectedMeeting[], url?: string) {
    await page.evaluate(
        ({ list, labels, options }) => {
            const setter = (
                window as unknown as {
                    __TEST_SET_OUTLOOK_MEETINGS__?: (
                        meetings: unknown[],
                        labels?: Record<string, string>,
                        options?: { actions?: boolean; convertUrl?: string }
                    ) => void;
                }
            ).__TEST_SET_OUTLOOK_MEETINGS__;
            if (!setter) throw new Error('__TEST_SET_OUTLOOK_MEETINGS__ is not installed');
            if (options) setter(list, labels, options);
            else setter(list, labels);
        },
        {
            list: meetings.map(withDefaults),
            labels: LABELS,
            options: url ? { actions: true, convertUrl: url } : null,
        }
    );
}

interface ConversionRoute {
    // Every convert request body, in order
    bodies: ConvertBody[];
    // Meeting ids answered with the scripted "forbidden" failure once (then they succeed)
    failOnce: Set<string>;
}

// Answers the convert request in place of the (disabled) fork route. Created entries are real: they
// go through the core time-entry API with the body's values (single form: its description, start
// and end; batch: the meeting's subject and times).
async function routeConversions(
    page: Page,
    ctx: TestContext,
    meetings: InjectedMeeting[]
): Promise<ConversionRoute> {
    const byId = new Map(meetings.map((meeting) => [meeting.id, meeting]));
    const state: ConversionRoute = { bodies: [], failOnce: new Set() };

    await page.route(CONVERT_ROUTE, async (route) => {
        const body = route.request().postDataJSON() as ConvertBody;
        state.bodies.push(body);
        const results: ConvertResult[] = [];
        for (const id of body.meeting_ids) {
            if (state.failOnce.has(id)) {
                state.failOnce.delete(id);
                results.push({
                    meeting_id: id,
                    status: 'failed',
                    time_entry_id: null,
                    error: { key: 'forbidden', message: FORBIDDEN_MESSAGE },
                });
                continue;
            }
            const meeting = byId.get(id);
            const response = meeting
                ? await ctx.request.post(
                      `${PLAYWRIGHT_BASE_URL}/api/v1/organizations/${ctx.orgId}/time-entries`,
                      {
                          data: {
                              member_id: ctx.memberId,
                              start: body.start ?? meeting.start,
                              end: body.end ?? meeting.end,
                              description: body.description ?? meeting.subject,
                              project_id: body.project_id,
                              task_id: body.task_id,
                              tags: body.tags,
                              billable: body.billable,
                              type: 'work',
                          },
                      }
                  )
                : null;
            if (!response || response.status() !== 201) {
                results.push({
                    meeting_id: id,
                    status: 'failed',
                    time_entry_id: null,
                    error: { key: 'request_failed', message: LABELS.error_generic },
                });
                continue;
            }
            const created = (await response.json()).data as { id: string };
            results.push({
                meeting_id: id,
                status: 'created',
                time_entry_id: created.id,
                error: null,
            });
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ results }),
        });
    });

    return state;
}

// Records whether the core "Create Time Entry" dialog ever mounts (it must never open from a meeting).
async function watchCoreCreateDialog(page: Page) {
    await page.evaluate(() => {
        const w = window as unknown as { __coreCreateSeen?: boolean };
        w.__coreCreateSeen = false;
        const check = () => {
            const buttons = Array.from(document.querySelectorAll('button'));
            if (buttons.some((button) => button.textContent?.trim() === 'Create Time Entry')) {
                w.__coreCreateSeen = true;
            }
        };
        new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
    });
}

async function coreCreateDialogSeen(page: Page): Promise<boolean> {
    return page.evaluate(
        () => (window as unknown as { __coreCreateSeen?: boolean }).__coreCreateSeen === true
    );
}

function ghost(page: Page, id: string): Locator {
    return page.locator(`.m365-ghost[data-ghost-id="${id}"]`);
}

// Opens the project picker inside `scope` (the panel or the batch popover) and picks the project.
async function pickProject(page: Page, scope: Locator, projectName: string) {
    await scope.locator('[data-testid="outlook-convert-project"] button').first().click();
    await page.getByRole('option', { name: projectName }).click();
    await expect(scope.locator('[data-testid="outlook-convert-project"]')).toContainText(
        projectName
    );
}

test.describe('Outlook meeting conversion', () => {
    test('converts a meeting from its panel into a real entry with the Outlook icon', async ({
        page,
        ctx,
    }) => {
        const projectName = 'Meetings Project ' + Math.floor(1 + Math.random() * 10000);
        const tagName = 'Meeting Tag ' + Math.floor(1 + Math.random() * 10000);
        const project = await createProjectViaApi(ctx, { name: projectName });
        const tag = await createTagViaApi(ctx, { name: tagName });
        const meetings: InjectedMeeting[] = [
            {
                id: 'm-single',
                subject: 'Weekly sync',
                start: todayAt('10:00:00'),
                end: todayAt('11:00:00'),
            },
        ];

        await goToCalendar(page);
        await scrollCalendarToTime(page, '10:00:00');
        const conversions = await routeConversions(page, ctx, meetings);
        await watchCoreCreateDialog(page);
        await injectMeetings(page, meetings, convertUrl(ctx));

        const block = ghost(page, 'm-single');
        await expect(block).toHaveCount(1);
        await block.click();
        const panel = page.locator(DETAIL_PANEL);
        await expect(panel).toBeVisible();
        await panel.locator('[data-testid="outlook-detail-create"]').click();

        const form = panel.locator(CONVERT_FORM);
        await expect(form).toBeVisible();
        const description = form.locator('[data-testid="outlook-convert-description"]');
        await expect(description).toHaveValue('Weekly sync');
        await expect(form.locator('[data-testid="outlook-convert-start"]')).toHaveValue('10:00');
        await expect(form.locator('[data-testid="outlook-convert-end"]')).toHaveValue('11:00');

        // Project (nested listbox): the form stays open and keeps the description
        await pickProject(page, form, projectName);
        await expect(form).toBeVisible();
        await expect(description).toHaveValue('Weekly sync');

        // Tag (nested dropdown), closed by a click on the form's own title
        await form.locator('[data-testid="outlook-convert-tags"]').click();
        await page.getByTestId('tag_dropdown_entries').filter({ hasText: tagName }).click();
        await form.locator('h3').first().click();
        await expect(page.getByTestId('tag_dropdown_search')).toHaveCount(0);
        await expect(form).toBeVisible();
        await expect(form.locator('[data-testid="outlook-convert-tags"]')).toHaveText('1 Tag');
        await expect(form.locator('[data-testid="outlook-convert-project"]')).toContainText(
            projectName
        );
        await expect(description).toHaveValue('Weekly sync');

        // Billable (nested select)
        const billable = form.locator('[data-testid="outlook-convert-billable"]');
        await expect(billable).toContainText('Non-Billable');
        await billable.click();
        await page.getByRole('option', { name: 'Billable', exact: true }).click();
        await expect(form).toBeVisible();
        await expect(billable).not.toContainText('Non-Billable');
        await expect(billable).toContainText('Billable');
        await expect(form.locator('[data-testid="outlook-convert-tags"]')).toHaveText('1 Tag');
        await expect(form.locator('[data-testid="outlook-convert-project"]')).toContainText(
            projectName
        );

        // Start time
        const start = form.locator('[data-testid="outlook-convert-start"]');
        await start.fill('10:15');
        await start.press('Tab');
        await expect(start).toHaveValue('10:15');
        await expect(form).toBeVisible();
        await expect(description).toHaveValue('Weekly sync');
        await expect(billable).not.toContainText('Non-Billable');
        await expect(form.locator('[data-testid="outlook-convert-tags"]')).toHaveText('1 Tag');
        await expect(form.locator('[data-testid="outlook-convert-project"]')).toContainText(
            projectName
        );

        await form.locator('[data-testid="outlook-convert-submit"]').click();

        await expect.poll(() => conversions.bodies.length).toBe(1);
        const body = conversions.bodies[0]!;
        expect(body.meeting_ids).toEqual(['m-single']);
        expect(body.project_id).toBe(project.id);
        expect(body.tags).toEqual([tag.id]);
        expect(body.billable).toBe(true);
        expect(body.description).toBe('Weekly sync');
        expect(body.start).toMatch(/T10:15:00Z$/);
        expect(body.end).toMatch(/T11:00:00Z$/);

        // The meeting leaves the lane and the real entry shows the Outlook icon
        await expect(block).toHaveCount(0);
        await expect(page.locator(DETAIL_PANEL)).toHaveCount(0);
        const entry = page.locator('.fc-event').filter({ hasText: 'Weekly sync' }).first();
        await expect(entry).toBeVisible();
        await expect(entry.locator('[data-testid="outlook-entry-badge"]')).toHaveCount(1);

        // The core create dialog never opened along the way
        expect(await coreCreateDialogSeen(page)).toBe(false);
        await expect(
            page.getByRole('button', { name: 'Create Time Entry', exact: true })
        ).toHaveCount(0);
    });

    test('Create time entry from the context menu opens the form', async ({ page, ctx }) => {
        await goToCalendar(page);
        await scrollCalendarToTime(page, '14:00:00');
        await injectMeetings(
            page,
            [
                {
                    id: 'm-menu',
                    subject: 'Menu meeting',
                    start: todayAt('14:00:00'),
                    end: todayAt('15:00:00'),
                },
            ],
            convertUrl(ctx)
        );
        const block = ghost(page, 'm-menu');
        await expect(block).toHaveCount(1);

        await block.click({ button: 'right' });
        const menu = page.locator(MEETING_MENU);
        await expect(menu).toBeVisible();
        await menu.locator('[data-testid="outlook-menu-create"]').click();

        await expect(page.locator(MEETING_MENU)).toHaveCount(0);
        const form = page.locator(DETAIL_PANEL).locator(CONVERT_FORM);
        await expect(form).toBeVisible();
        await expect(form.locator('[data-testid="outlook-convert-description"]')).toHaveValue(
            'Menu meeting'
        );
    });

    test('Create time entry from the hover card opens the form', async ({ page, ctx }) => {
        await goToCalendar(page);
        await scrollCalendarToTime(page, '14:00:00');
        await injectMeetings(
            page,
            [
                {
                    id: 'm-hover',
                    subject: 'Hover meeting',
                    start: todayAt('14:00:00'),
                    end: todayAt('15:00:00'),
                },
            ],
            convertUrl(ctx)
        );
        const block = ghost(page, 'm-hover');
        await expect(block).toHaveCount(1);

        await block.hover();
        const card = page.locator(HOVER_CARD);
        await expect(card).toBeVisible();
        await expect(card).toContainText(LABELS.hover_hint_select);
        await card.locator('[data-testid="outlook-hover-create"]').click();

        await expect(page.locator(HOVER_CARD)).toHaveCount(0);
        const form = page.locator(DETAIL_PANEL).locator(CONVERT_FORM);
        await expect(form).toBeVisible();
        await expect(form.locator('[data-testid="outlook-convert-description"]')).toHaveValue(
            'Hover meeting'
        );
    });

    test('assigns two selected meetings, reports a failure and retries it', async ({
        page,
        ctx,
    }) => {
        const projectName = 'Batch Project ' + Math.floor(1 + Math.random() * 10000);
        const project = await createProjectViaApi(ctx, { name: projectName });
        const meetings: InjectedMeeting[] = [
            {
                id: 'm-alpha',
                subject: 'Alpha review',
                start: todayAt('09:00:00'),
                end: todayAt('09:30:00'),
            },
            {
                id: 'm-beta',
                subject: 'Beta planning',
                start: todayAt('10:00:00'),
                end: todayAt('10:30:00'),
            },
            {
                id: 'm-gamma',
                subject: 'Gamma retro',
                start: todayAt('11:00:00'),
                end: todayAt('11:30:00'),
            },
        ];

        await goToCalendar(page);
        await scrollCalendarToTime(page, '09:00:00');
        const conversions = await routeConversions(page, ctx, meetings);
        await injectMeetings(page, meetings, convertUrl(ctx));
        await expect(page.locator('.m365-ghost')).toHaveCount(3);

        await ghost(page, 'm-alpha').click({ modifiers: ['Control'] });
        await ghost(page, 'm-beta').click({ modifiers: ['Control'] });

        await expect(ghost(page, 'm-alpha')).toHaveAttribute('data-selected', '');
        await expect(ghost(page, 'm-beta')).toHaveAttribute('data-selected', '');
        await expect(ghost(page, 'm-gamma')).not.toHaveAttribute('data-selected');
        await expect(page.locator(DETAIL_PANEL)).toHaveCount(0);
        const bar = page.locator(SELECTION_BAR);
        await expect(bar).toBeVisible();
        await expect(bar.locator('[data-testid="outlook-selection-count"]')).toHaveText(
            '2 meetings selected'
        );

        await bar.locator('[data-testid="outlook-selection-assign"]').click();
        const popover = page.locator(BATCH_POPOVER);
        const form = popover.locator('[data-testid="outlook-batch-form"]');
        await expect(form).toBeVisible();
        const rows = form.locator('[data-testid="outlook-batch-row"]');
        await expect(rows).toHaveCount(2);
        // No status before the first submit
        await expect(rows.first()).not.toHaveAttribute('data-status');

        await pickProject(page, form, projectName);
        // The selection survives the nested picker
        await expect(ghost(page, 'm-beta')).toHaveAttribute('data-selected', '');

        conversions.failOnce.add('m-beta');
        await form.locator('[data-testid="outlook-batch-submit"]').click();

        const alphaRow = rows.filter({ hasText: 'Alpha review' });
        const betaRow = rows.filter({ hasText: 'Beta planning' });
        await expect(alphaRow).toHaveAttribute('data-status', 'created');
        await expect(betaRow).toHaveAttribute('data-status', 'failed');
        await expect(betaRow.locator('[data-testid="outlook-batch-row-reason"]')).toHaveText(
            FORBIDDEN_MESSAGE
        );
        await expect(form.locator('[data-testid="outlook-batch-summary"]')).toHaveText(
            '1 of 2 time entries created'
        );
        expect(conversions.bodies[0]!.meeting_ids).toEqual(['m-alpha', 'm-beta']);
        expect(conversions.bodies[0]!.project_id).toBe(project.id);
        expect(conversions.bodies[0]!.start).toBeUndefined();

        // The created meeting left the lane, the failed one is still selected
        await expect(ghost(page, 'm-alpha')).toHaveCount(0);
        await expect(ghost(page, 'm-beta')).toHaveAttribute('data-selected', '');
        await expect(ghost(page, 'm-gamma')).toHaveCount(1);

        const retry = form.locator('[data-testid="outlook-batch-retry"]');
        await expect(retry).toHaveText('Retry 1 failed');
        await retry.click();

        await expect(page.locator(BATCH_POPOVER)).toHaveCount(0);
        await expect(page.locator(SELECTION_BAR)).toHaveCount(0);
        await expect(ghost(page, 'm-beta')).toHaveCount(0);
        expect(conversions.bodies).toHaveLength(2);
        expect(conversions.bodies[1]!.meeting_ids).toEqual(['m-beta']);

        // Both entries are real and carry the Outlook icon
        for (const subject of ['Alpha review', 'Beta planning']) {
            const entry = page.locator('.fc-event').filter({ hasText: subject }).first();
            await expect(entry).toBeVisible();
            await expect(entry.locator('[data-testid="outlook-entry-badge"]')).toHaveCount(1);
        }
    });

    test('shift-click selects a range and Escape clears it', async ({ page, ctx }) => {
        await goToCalendar(page);
        await scrollCalendarToTime(page, '09:00:00');
        await injectMeetings(
            page,
            [
                {
                    id: 'm-r1',
                    subject: 'Range one',
                    start: todayAt('09:00:00'),
                    end: todayAt('09:30:00'),
                },
                {
                    id: 'm-r2',
                    subject: 'Range two',
                    start: todayAt('10:00:00'),
                    end: todayAt('10:30:00'),
                },
                {
                    id: 'm-r3',
                    subject: 'Range three',
                    start: todayAt('11:00:00'),
                    end: todayAt('11:30:00'),
                },
            ],
            convertUrl(ctx)
        );
        await expect(page.locator('.m365-ghost')).toHaveCount(3);

        await ghost(page, 'm-r1').click({ modifiers: ['Control'] });
        await ghost(page, 'm-r3').click({ modifiers: ['Shift'] });

        await expect(page.locator('.m365-ghost[data-selected]')).toHaveCount(3);
        await expect(page.locator(DETAIL_PANEL)).toHaveCount(0);
        await expect(
            page.locator(SELECTION_BAR).locator('[data-testid="outlook-selection-count"]')
        ).toHaveText('3 meetings selected');

        await page.keyboard.press('Escape');

        await expect(page.locator('.m365-ghost[data-selected]')).toHaveCount(0);
        await expect(page.locator(SELECTION_BAR)).toHaveCount(0);
    });

    test('a plain click clears the selection and opens the panel', async ({ page, ctx }) => {
        await goToCalendar(page);
        await scrollCalendarToTime(page, '09:00:00');
        await injectMeetings(
            page,
            [
                {
                    id: 'm-p1',
                    subject: 'Plain one',
                    start: todayAt('09:00:00'),
                    end: todayAt('09:30:00'),
                },
                {
                    id: 'm-p2',
                    subject: 'Plain two',
                    start: todayAt('10:00:00'),
                    end: todayAt('10:30:00'),
                },
            ],
            convertUrl(ctx)
        );
        await expect(page.locator('.m365-ghost')).toHaveCount(2);

        await ghost(page, 'm-p1').click({ modifiers: ['Control'] });
        await expect(ghost(page, 'm-p1')).toHaveAttribute('data-selected', '');
        await expect(page.locator(SELECTION_BAR)).toBeVisible();

        await ghost(page, 'm-p2').click();

        await expect(page.locator('.m365-ghost[data-selected]')).toHaveCount(0);
        await expect(page.locator(SELECTION_BAR)).toHaveCount(0);
        const panel = page.locator(DETAIL_PANEL);
        await expect(panel).toBeVisible();
        await expect(panel).toContainText('Plain two');
    });

    test('creates a project with a new client from the form picker and selects it', async ({
        page,
        ctx,
    }) => {
        const projectName = 'Picker Project ' + Math.floor(1 + Math.random() * 10000);
        const clientName = 'Picker Client ' + Math.floor(1 + Math.random() * 10000);
        const meetings: InjectedMeeting[] = [
            {
                id: 'm-newproj',
                subject: 'Kick-off',
                start: todayAt('10:00:00'),
                end: todayAt('11:00:00'),
            },
        ];

        await goToCalendar(page);
        await scrollCalendarToTime(page, '10:00:00');
        const conversions = await routeConversions(page, ctx, meetings);
        await injectMeetings(page, meetings, convertUrl(ctx));

        await ghost(page, 'm-newproj').click();
        const panel = page.locator(DETAIL_PANEL);
        await panel.locator('[data-testid="outlook-detail-create"]').click();
        const form = panel.locator(CONVERT_FORM);
        await expect(form).toBeVisible();

        // Typing a name that does not exist offers "Create new Project", prefilled with it
        await form.locator('[data-testid="outlook-convert-project"] button').first().click();
        await page.getByTestId('client_dropdown_search').fill(projectName);
        await page.getByText('Create new Project').click();
        const dialog = page.getByRole('dialog').filter({ has: page.getByLabel('Project name') });
        await expect(dialog.getByLabel('Project name')).toHaveValue(projectName);
        await expect(form).toBeVisible();

        // A client that does not exist yet is created from the modal's client picker
        await dialog.getByRole('button', { name: 'No Client' }).click();
        await page.getByPlaceholder('Search for a client...').fill(clientName);
        await Promise.all([
            page.waitForResponse(
                (response) =>
                    response.url().includes('/clients') &&
                    response.request().method() === 'POST' &&
                    response.status() === 201
            ),
            page.getByText(`Add "${clientName}" as a new Client`).click(),
        ]);
        await expect(dialog.getByRole('button', { name: clientName })).toBeVisible();

        await Promise.all([
            page.waitForResponse(
                (response) =>
                    response.url().includes('/projects') &&
                    response.request().method() === 'POST' &&
                    response.status() === 201
            ),
            dialog.getByRole('button', { name: 'Create Project' }).click(),
        ]);

        // The modal closes, the meeting form is still open and has the new project selected
        await expect(page.getByLabel('Project name')).toHaveCount(0);
        await expect(form).toBeVisible();
        await expect(form.locator('[data-testid="outlook-convert-project"]')).toContainText(
            projectName
        );
        await expect(form.locator('[data-testid="outlook-convert-description"]')).toHaveValue(
            'Kick-off'
        );

        await form.locator('[data-testid="outlook-convert-submit"]').click();
        await expect.poll(() => conversions.bodies.length).toBe(1);
        expect(conversions.bodies[0]!.meeting_ids).toEqual(['m-newproj']);
        expect(conversions.bodies[0]!.project_id).toBeTruthy();
    });

    test('without actions the panel stays read-only', async ({ page }) => {
        await goToCalendar(page);
        await scrollCalendarToTime(page, '14:00:00');
        // No third argument: display only (canAct false). Neither meeting has an Outlook link, so
        // the read-only panel has no focusable content of its own.
        await injectMeetings(page, [
            {
                id: 'm-ro1',
                subject: 'Read-only one',
                start: todayAt('14:00:00'),
                end: todayAt('14:30:00'),
            },
            {
                id: 'm-ro2',
                subject: 'Read-only two',
                start: todayAt('15:00:00'),
                end: todayAt('15:30:00'),
            },
        ]);
        await expect(page.locator('.m365-ghost')).toHaveCount(2);

        await ghost(page, 'm-ro1').click();
        const panel = page.locator(DETAIL_PANEL);
        await expect(panel).toBeVisible();
        await expect(panel).toContainText('Read-only one');
        // 04-04 observation: in happy-dom a read-only panel without a link closes in the same tick.
        // In the browser it must stay open.
        await page.waitForTimeout(500);
        await expect(panel).toBeVisible();
        await expect(panel.locator('[data-testid="outlook-detail-create"]')).toHaveCount(0);
        await expect(panel.locator('[data-testid="outlook-detail-action"]')).toHaveCount(0);

        await page.keyboard.press('Escape');
        await expect(page.locator(DETAIL_PANEL)).toHaveCount(0);

        // Ctrl-click selects nothing and opens the panel like a plain click
        await ghost(page, 'm-ro2').click({ modifiers: ['Control'] });
        await expect(page.locator(DETAIL_PANEL)).toBeVisible();
        await expect(page.locator(DETAIL_PANEL)).toContainText('Read-only two');
        await expect(page.locator('.m365-ghost[data-selected]')).toHaveCount(0);
        await expect(page.locator(SELECTION_BAR)).toHaveCount(0);
    });
});

test.describe('Outlook conversion layout at 1366x768', () => {
    test.use({ viewport: { width: 1366, height: 768 } });

    test('the form popover on the last visible day at the last hour stays inside the viewport', async ({
        page,
        ctx,
    }) => {
        await goToCalendar(page);
        const lastDay = await page.locator('.fc-col-header-cell').last().getAttribute('data-date');
        expect(lastDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        await injectMeetings(
            page,
            [
                {
                    id: 'm-edge',
                    subject: 'Late meeting',
                    start: `${lastDay}T22:00:00Z`,
                    end: `${lastDay}T23:00:00Z`,
                },
            ],
            convertUrl(ctx)
        );
        await scrollCalendarToTime(page, '22:00:00');
        const block = ghost(page, 'm-edge');
        await expect(block).toHaveCount(1);

        await block.click();
        const panel = page.locator(DETAIL_PANEL);
        await expect(panel).toBeVisible();
        await panel.locator('[data-testid="outlook-detail-create"]').click();
        await expect(panel.locator(CONVERT_FORM)).toBeVisible();
        // Let the popper settle after the content grew
        await page.waitForTimeout(300);

        const box = await panel.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(1366);
        expect(box!.y + box!.height).toBeLessThanOrEqual(768);
    });

    test('the selection bar is 48px tall and covers at most 64px of the visible grid', async ({
        page,
        ctx,
    }) => {
        await goToCalendar(page);
        await scrollCalendarToTime(page, '14:00:00');
        await injectMeetings(
            page,
            [
                {
                    id: 'm-bar',
                    subject: 'Bar meeting',
                    start: todayAt('14:00:00'),
                    end: todayAt('15:00:00'),
                },
            ],
            convertUrl(ctx)
        );
        await ghost(page, 'm-bar').click({ modifiers: ['Control'] });
        const bar = page.locator(SELECTION_BAR);
        await expect(bar).toBeVisible();

        // Polled: the bar slides in
        const measure = () =>
            page.evaluate((selector) => {
                const barEl = document.querySelector(selector);
                const grid = document.querySelector('.fc');
                if (!barEl || !grid) return null;
                const barRect = barEl.getBoundingClientRect();
                const gridBottom = Math.min(
                    window.innerHeight,
                    grid.getBoundingClientRect().bottom
                );
                return {
                    height: Math.round(barRect.height),
                    covered: Math.round(gridBottom - barRect.top),
                };
            }, SELECTION_BAR);
        await expect.poll(async () => (await measure())?.height).toBe(48);
        await expect.poll(async () => (await measure())?.covered ?? 999).toBeLessThanOrEqual(64);
    });

    test('converting the last meeting of a day removes its lane', async ({
        page,
        ctx,
    }, testInfo) => {
        const projectName = 'Lane Project ' + Math.floor(1 + Math.random() * 10000);
        await createProjectViaApi(ctx, { name: projectName });
        const meetings: InjectedMeeting[] = [
            {
                id: 'm-lane-last',
                subject: 'Only meeting',
                start: todayAt('14:00:00'),
                end: todayAt('15:00:00'),
            },
        ];

        await goToCalendar(page);
        await scrollCalendarToTime(page, '13:00:00');
        await routeConversions(page, ctx, meetings);
        await injectMeetings(page, meetings, convertUrl(ctx));
        const day = page.locator(`.fc [data-date="${todayUtc()}"]`).filter({
            has: page.locator('[data-testid="outlook-lane"]'),
        });
        await expect(day).toHaveCount(1);
        await testInfo.attach('before-conversion', {
            body: await page.screenshot(),
            contentType: 'image/png',
        });

        await ghost(page, 'm-lane-last').click();
        const panel = page.locator(DETAIL_PANEL);
        await panel.locator('[data-testid="outlook-detail-create"]').click();
        const form = panel.locator(CONVERT_FORM);
        await expect(form).toBeVisible();
        await pickProject(page, form, projectName);
        await form.locator('[data-testid="outlook-convert-submit"]').click();

        await expect(ghost(page, 'm-lane-last')).toHaveCount(0);
        await expect(page.locator('[data-testid="outlook-lane"]')).toHaveCount(0);
        await expect(page.locator('.fc-event').filter({ hasText: 'Only meeting' })).toBeVisible();
        await testInfo.attach('after-conversion', {
            body: await page.screenshot(),
            contentType: 'image/png',
        });
    });
});
