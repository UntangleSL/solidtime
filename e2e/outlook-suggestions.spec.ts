import { PLAYWRIGHT_BASE_URL } from '../playwright/config';
import { test } from '../playwright/fixtures';
import type { TestContext } from '../playwright/fixtures';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { createProjectWithClientViaApi } from './utils/api';
import { showCalendarWeekends } from './utils/calendar';

// Phase 5 browser proof: pre-assigned meetings, bulk confirm, the learned prefill and the series
// controls (RULE-01..05).
//
// The CI Playwright environment sets no SOLIDTIME_MICROSOFT_* variables, so the integration is off:
// meetings are injected through window.__TEST_SET_OUTLOOK_MEETINGS__ with { actions: true,
// convertUrl, seriesUrl } and carry the Phase 5 fields (series_key, series_ignored, assignment,
// suggestions) the server would send. The real fork endpoints answer 404 while the integration is
// off, so page.route() answers them instead: the convert route creates the real time entry through
// the core API (with the meeting's own series assignment when the body asks for it), and the series
// routes record the request and answer 204. Server behaviour is covered by PHPUnit (05-01, 05-05,
// 05-06, 05-09). Test users run in the UTC timezone.

// Weekends are hidden by default; most tests work on "today", so show them (CI may run on a
// weekend). The bulk-confirm test writes its own settings with weekends hidden.
test.beforeEach(async ({ page }) => {
    await showCalendarWeekends(page);
});

interface Assignment {
    project_id: string;
    project_name: string;
    project_color: string;
    client_name: string | null;
    task_id: string | null;
    task_name: string | null;
    tags: string[];
    billable: boolean;
    converted_at: string;
}

interface Suggestion {
    project_id: string;
    project_name: string;
    project_color: string;
    client_name: string | null;
    confident: boolean;
    reason: {
        kind: 'domain' | 'person' | 'organizer' | 'subject';
        count: number;
        value: string | null;
    };
}

interface InjectedMeeting {
    id: string;
    subject: string;
    start: string;
    end: string;
    web_link?: string | null;
    organizer_name?: string | null;
    series_key?: string | null;
    series_ignored?: boolean;
    assignment?: Assignment | null;
    suggestions?: Suggestion[];
}

interface ConvertBody {
    meeting_ids: string[];
    use_series_assignment?: boolean;
    project_id?: string | null;
    task_id?: string | null;
    tags?: string[];
    billable?: boolean;
    description?: string | null;
    start?: string;
    end?: string;
    prefill_source?: string | null;
    prefill_project_id?: string | null;
}

interface ConvertResult {
    meeting_id: string;
    status: 'created' | 'existing' | 'failed';
    time_entry_id: string | null;
    error: { key: string; message: string } | null;
}

interface CreatedEntry {
    meeting_id: string;
    id: string;
    start: string;
    project_id: string | null;
}

// English copy of microsoft365.calendar.* that the Outlook layer, its panel, the hover card, the
// context menu, the form, the bulk confirm and the toasts read (Phase 3.1 / 4 subset plus the
// Phase 5 keys, lang/en/microsoft365.php).
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
    dismiss_failed: 'Could not dismiss this meeting',
    restore_failed: 'Could not restore this meeting',
    retry_body: 'Try again in a moment.',
    dismissed_announcement: 'Meeting dismissed',
    restored_announcement: 'Meeting restored',
    settings_heading: 'Outlook meetings',
    show_dismissed: 'Show dismissed meetings',
    show_dismissed_help:
        'Dismissed meetings and ignored series appear faded so you can restore them.',
    lane_caption_time: 'My time',
    lane_caption_outlook: 'Outlook',
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
    // Phase 5: series pre-assignment and suggestions
    preassigned_suffix: ', pre-assigned to :project',
    preassigned_eyebrow: 'Pre-assigned · Same series',
    why_series: 'You logged this series to :project on :date.',
    confirm: 'Confirm',
    edit: 'Edit',
    more_actions: 'More actions',
    confirm_failed: 'Could not confirm this meeting',
    ignore_series: 'Always ignore this series',
    unignore_series: 'Stop ignoring this series',
    forget_series: 'Forget this series',
    series_ignored: 'Series ignored',
    series_ignored_help: 'Its meetings are hidden. Turn on Show dismissed meetings to undo.',
    series_unignored: 'Series no longer ignored',
    series_forgotten: 'Series forgotten',
    series_forgotten_help:
        'Its meetings are no longer pre-assigned. Your time entries are unchanged.',
    series_action_failed: 'Could not update this series',
    eyebrow_series_ignored: 'Outlook meeting · Series ignored',
    series_ignored_suffix: ', series ignored',
    reason_series: 'Same series',
    reason_last_used: 'Last used',
    reason_domain_one: 'Like 1 meeting with @:domain',
    reason_domain_many: 'Like :count meetings with @:domain',
    reason_person_one: 'Like 1 meeting with :name',
    reason_person_many: 'Like :count meetings with :name',
    reason_organizer_one: 'Like 1 meeting organized by :name',
    reason_organizer_many: 'Like :count meetings organized by :name',
    reason_subject_one: 'Like 1 meeting with a similar subject',
    reason_subject_many: 'Like :count meetings with a similar subject',
    reason_batch: 'Suggested for :count of :total meetings',
    other_suggestions: 'Other suggestions',
    use_suggestion: 'Use :project',
    series_note_new: 'Other meetings in this series will come pre-assigned to this project.',
    series_note_change:
        'This series will use the new project from now on. Entries already created stay as they are.',
    batch_series_note:
        'Recurring meetings here will use this project for their series from now on.',
    confirm_all_short: 'Confirm :count',
    confirm_all_long: 'Confirm :count pre-assigned',
    confirm_all_tooltip: 'Review and confirm the pre-assigned meetings in view',
    confirm_all_title_one: 'Confirm 1 pre-assigned meeting',
    confirm_all_title_many: 'Confirm :count pre-assigned meetings',
    confirm_all_note:
        "Each meeting keeps its own time and becomes a time entry with its series' project, task, tags and billable.",
    confirm_submit_one: 'Confirm 1 meeting',
    confirm_submit_many: 'Confirm :count meetings',
    confirm_none_selected: 'Select at least one meeting.',
    include_meeting: 'Include :subject',
    row_upcoming: 'Upcoming',
    error_no_assignment: 'This meeting has no series assignment any more.',
};

const HOVER_CARD = '[data-testid="outlook-hover-card"]';
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
        series_key: null,
        series_ignored: false,
        assignment: null,
        suggestions: [],
        ...meeting,
    };
}

function assignmentFor(project: { id: string; name: string; color: string }, client?: string) {
    return {
        project_id: project.id,
        project_name: project.name,
        project_color: project.color,
        client_name: client ?? null,
        task_id: null,
        task_name: null,
        tags: [],
        billable: false,
        converted_at: '2026-01-05T10:00:00Z',
    } satisfies Assignment;
}

interface InjectOptions {
    convertUrl?: string;
    seriesUrl?: string;
    labels?: Record<string, string>;
}

// Inject meetings. With a convert or series URL the hook runs with actions enabled (canAct true);
// without them the meetings stay display only, as in e2e/outlook-ghosts.spec.ts.
async function injectMeetings(page: Page, meetings: InjectedMeeting[], options: InjectOptions) {
    const actions = options.convertUrl !== undefined || options.seriesUrl !== undefined;
    await page.evaluate(
        ({ list, labels, hookOptions }) => {
            const setter = (
                window as unknown as {
                    __TEST_SET_OUTLOOK_MEETINGS__?: (
                        meetings: unknown[],
                        labels?: Record<string, string>,
                        options?: {
                            actions?: boolean;
                            convertUrl?: string;
                            seriesUrl?: string;
                        }
                    ) => void;
                }
            ).__TEST_SET_OUTLOOK_MEETINGS__;
            if (!setter) throw new Error('__TEST_SET_OUTLOOK_MEETINGS__ is not installed');
            if (hookOptions) setter(list, labels, hookOptions);
            else setter(list, labels);
        },
        {
            list: meetings.map(withDefaults),
            labels: options.labels ?? LABELS,
            hookOptions: actions
                ? {
                      actions: true,
                      ...(options.convertUrl ? { convertUrl: options.convertUrl } : {}),
                      ...(options.seriesUrl ? { seriesUrl: options.seriesUrl } : {}),
                  }
                : null,
        }
    );
}

interface ConversionRoute {
    // Every convert request body, in order
    bodies: ConvertBody[];
    // The real entries created through the core API
    created: CreatedEntry[];
    // While set, every convert request waits for it before being answered
    hold: Promise<void> | null;
}

// Answers the convert request in place of the (disabled) fork route. Created entries are real: they
// go through the core time-entry API. A body with use_series_assignment takes the project, task,
// tags and billable of the meeting's own series assignment (from the injected list) and the
// meeting's subject and times, like the server's confirm mode; a form body uses its own values.
async function routeConversions(
    page: Page,
    ctx: TestContext,
    meetings: InjectedMeeting[]
): Promise<ConversionRoute> {
    const byId = new Map(meetings.map((meeting) => [meeting.id, meeting]));
    const state: ConversionRoute = { bodies: [], created: [], hold: null };

    await page.route(CONVERT_ROUTE, async (route) => {
        const body = route.request().postDataJSON() as ConvertBody;
        state.bodies.push(body);
        if (state.hold) await state.hold;
        const results: ConvertResult[] = [];
        for (const id of body.meeting_ids) {
            const meeting = byId.get(id);
            const assignment = meeting?.assignment ?? null;
            const fields =
                body.use_series_assignment === true
                    ? assignment
                        ? {
                              project_id: assignment.project_id,
                              task_id: assignment.task_id,
                              tags: assignment.tags,
                              billable: assignment.billable,
                          }
                        : null
                    : {
                          project_id: body.project_id ?? null,
                          task_id: body.task_id ?? null,
                          tags: body.tags ?? [],
                          billable: body.billable ?? false,
                      };
            const response =
                meeting && fields
                    ? await ctx.request.post(
                          `${PLAYWRIGHT_BASE_URL}/api/v1/organizations/${ctx.orgId}/time-entries`,
                          {
                              data: {
                                  member_id: ctx.memberId,
                                  start: body.start ?? meeting.start,
                                  end: body.end ?? meeting.end,
                                  description: body.description ?? meeting.subject,
                                  ...fields,
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
            const entry = (await response.json()).data as {
                id: string;
                start: string;
                project_id: string | null;
            };
            state.created.push({
                meeting_id: id,
                id: entry.id,
                start: entry.start,
                project_id: entry.project_id,
            });
            results.push({
                meeting_id: id,
                status: 'created',
                time_entry_id: entry.id,
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

function ghost(page: Page, id: string): Locator {
    return page.locator(`.m365-ghost[data-ghost-id="${id}"]`);
}

test.describe('Outlook meeting suggestions', () => {
    test('confirms a pre-assigned meeting from its hover card into a real entry', async ({
        page,
        ctx,
    }) => {
        const { project } = await createProjectWithClientViaApi(ctx, 'Acme Website', 'Acme');
        const meetings: InjectedMeeting[] = [
            {
                id: 'm-pre',
                subject: 'Acme weekly',
                start: todayAt('10:00:00'),
                end: todayAt('10:30:00'),
                series_key: 's-1',
                assignment: assignmentFor(project, 'Acme'),
            },
            {
                id: 'm-plain',
                subject: 'Plain catch-up',
                start: todayAt('11:00:00'),
                end: todayAt('11:30:00'),
            },
        ];

        await goToCalendar(page);
        await scrollCalendarToTime(page, '09:00:00');
        const conversions = await routeConversions(page, ctx, meetings);
        await injectMeetings(page, meetings, { convertUrl: convertUrl(ctx) });

        const pre = ghost(page, 'm-pre');
        const plain = ghost(page, 'm-plain');
        await expect(pre).toHaveCount(1);
        await expect(plain).toHaveCount(1);

        // The lane shows the series project on the pre-assigned block only
        await expect(pre).toHaveAttribute('data-preassigned', '');
        await expect(pre.locator('[data-testid="outlook-preassigned-line"]')).toHaveText(
            'Acme Website'
        );
        await expect(pre).toHaveAttribute('aria-label', /, pre-assigned to Acme Website$/);
        await expect(plain).not.toHaveAttribute('data-preassigned');

        await pre.hover();
        const card = page.locator(HOVER_CARD);
        await expect(card).toBeVisible();
        await expect(card.locator('[data-testid="outlook-hover-edit"]')).toHaveText(LABELS.edit);
        await expect(card.locator('[data-testid="outlook-hover-create"]')).toHaveCount(0);
        const confirm = card.locator('[data-testid="outlook-hover-confirm"]');
        await expect(confirm).toHaveText(LABELS.confirm);
        await confirm.click();

        // One click sends the meeting alone, in confirm mode (the server uses the series values)
        await expect.poll(() => conversions.bodies.length).toBe(1);
        expect(conversions.bodies[0]).toEqual({
            meeting_ids: ['m-pre'],
            use_series_assignment: true,
        });
        await expect.poll(() => conversions.created.length).toBe(1);
        const created = conversions.created[0]!;
        expect(created.project_id).toBe(project.id);
        expect(created.start).toMatch(/T10:00:00Z$/);

        // The meeting leaves the lane, the other one stays, the real entry carries the Outlook icon
        await expect(pre).toHaveCount(0);
        await expect(plain).toHaveCount(1);
        await expect(page.getByText(LABELS.created_success).first()).toBeVisible();
        const entry = page.locator('.fc-event').filter({ hasText: 'Acme weekly' }).first();
        await expect(entry).toBeVisible();
        await expect(entry).toContainText('Acme Website');
        await expect(entry.locator('[data-testid="outlook-entry-badge"]')).toHaveCount(1);
    });
});
