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
    dismiss: 'Dismiss meeting',
    restore: 'Restore meeting',
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

const DETAIL_PANEL = '[data-testid="outlook-ghost-detail"]';
const CONVERT_FORM = '[data-testid="outlook-convert-form"]';
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
});
