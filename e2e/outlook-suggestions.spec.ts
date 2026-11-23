import { PLAYWRIGHT_BASE_URL } from '../playwright/config';
import { test } from '../playwright/fixtures';
import type { TestContext } from '../playwright/fixtures';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { createProjectViaApi, createProjectWithClientViaApi } from './utils/api';
import {
    CALENDAR_SETTINGS_KEY,
    WEEKENDS_HIDDEN_DEFAULT_MIGRATION_KEY,
    showCalendarWeekends,
} from './utils/calendar';

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
    dismiss: 'Dismiss',
    restore: 'Restore',
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

// Spanish copy (lang/es/microsoft365.php) of what the panel and the hover card show, for the
// footer-fit check at w-96 / w-72.
const LABELS_ES = {
    ...LABELS,
    no_subject: '(Sin asunto)',
    ghost_label: ':subject, de :start a :end, sugerencia de reunión de Outlook',
    eyebrow: 'Reunión de Outlook',
    organized_by: 'Organizada por :name',
    you_organize: 'Eres el organizador',
    online: 'Reunión en línea',
    open_in_outlook: 'Abrir en Outlook',
    dismiss: 'Descartar',
    restore: 'Restaurar',
    hover_hint: 'Haz clic para ver los detalles',
    hover_hint_select: 'Haz clic para ver los detalles. Ctrl+clic para seleccionar varias.',
    hover_hint_select_mac: 'Haz clic para ver los detalles. ⌘+clic para seleccionar varias.',
    create_entry: 'Crear registro',
    preassigned_suffix: ', preasignada a :project',
    preassigned_eyebrow: 'Preasignada · Misma serie',
    why_series: 'Registraste esta serie en :project el :date.',
    confirm: 'Confirmar',
    edit: 'Editar',
    more_actions: 'Más acciones',
    reason_series: 'Misma serie',
};

const MEETING_MENU = '[data-testid="outlook-meeting-menu"]';
const HOVER_CARD = '[data-testid="outlook-hover-card"]';
const DETAIL_PANEL = '[data-testid="outlook-ghost-detail"]';
const CONVERT_FORM = '[data-testid="outlook-convert-form"]';
const CONFIRM_ALL = '[data-testid="outlook-confirm-all"]';
const CONFIRM_POPOVER = '[data-testid="outlook-confirm-all-popover"]';
const CONVERT_ROUTE = '**/m365/organizations/*/meetings/time-entries';
const SERIES_ROUTE = '**/m365/organizations/*/meetings/*/series/*';

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

// Base of the series actions: `${seriesUrl}/{id}/series/ignore` and `.../series/assignment`.
function seriesUrl(ctx: TestContext): string {
    return `${PLAYWRIGHT_BASE_URL}/m365/organizations/${ctx.orgId}/meetings`;
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

interface SeriesRequest {
    method: string;
    path: string;
}

// Answers the series actions (ignore, stop ignoring, forget) with 204 and records them.
async function routeSeries(page: Page): Promise<SeriesRequest[]> {
    const requests: SeriesRequest[] = [];
    await page.route(SERIES_ROUTE, async (route) => {
        const request = route.request();
        requests.push({ method: request.method(), path: new URL(request.url()).pathname });
        await route.fulfill({ status: 204, body: '' });
    });
    return requests;
}

function seriesPath(ctx: TestContext, id: string, action: 'ignore' | 'assignment'): string {
    return `/m365/organizations/${ctx.orgId}/meetings/${id}/series/${action}`;
}

function ghost(page: Page, id: string): Locator {
    return page.locator(`.m365-ghost[data-ghost-id="${id}"]`);
}

// "Show dismissed meetings" is a per-browser view preference (localStorage, read through VueUse's
// useLocalStorage). Its switch lives in the calendar settings popover, which Calendar.vue only
// mounts with the integration on, so the test sets the stored value and dispatches the same
// storage event VueUse listens to: the injected list (and its client-side series state) stays.
async function setShowDismissed(page: Page, value: boolean) {
    await page.evaluate((show) => {
        const key = 'solidtime:m365-show-dismissed';
        const newValue = JSON.stringify(show);
        window.localStorage.setItem(key, newValue);
        window.dispatchEvent(
            new StorageEvent('storage', { key, newValue, storageArea: window.localStorage })
        );
    }, value);
}

// Every footer button of the panel keeps its label on one line and stays inside the panel.
async function footerOverflow(panel: Locator, testIds: string[]) {
    return panel.evaluate((el, ids) => {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const contentRight =
            box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
        return ids.map((id) => {
            const button = el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
            if (!button) return { id, missing: true, clipped: false, outside: 0 };
            const rect = button.getBoundingClientRect();
            return {
                id,
                missing: false,
                clipped:
                    button.scrollWidth > button.clientWidth + 1 ||
                    button.scrollHeight > button.clientHeight + 1,
                outside: Math.max(0, Math.round(rect.right - contentRight)),
            };
        });
    }, testIds);
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

    test('bulk-confirms the pre-assigned meetings in view, skipping unticked ones and hidden weekends', async ({
        page,
        ctx,
    }) => {
        // Weekends hidden: written on every load after the beforeEach seed, so it always wins
        await page.addInitScript(
            ([settingsKey, migrationKey, settings]) => {
                try {
                    window.localStorage.setItem(migrationKey, '1');
                    window.localStorage.setItem(settingsKey, settings);
                } catch {
                    // about:blank and other opaque origins have no localStorage
                }
            },
            [
                CALENDAR_SETTINGS_KEY,
                WEEKENDS_HIDDEN_DEFAULT_MIGRATION_KEY,
                JSON.stringify({
                    snapMinutes: 15,
                    startHour: 0,
                    endHour: 24,
                    slotMinutes: 15,
                    showWeekends: false,
                }),
            ] as const
        );
        const project = await createProjectViaApi(ctx, { name: 'Retainer Project' });
        const other = await createProjectViaApi(ctx, { name: 'Suggested Project' });

        await goToCalendar(page);
        const headerDates = await page
            .locator('.fc-col-header-cell[data-date]')
            .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-date') ?? ''));
        // The current week without Saturday and Sunday
        expect(headerDates).toHaveLength(5);
        for (const date of headerDates) {
            expect([0, 6]).not.toContain(new Date(`${date}T00:00:00Z`).getUTCDay());
        }
        // The Saturday of the same week (Monday + 5, whatever the week start is)
        const saturday = new Date(`${headerDates[0]}T00:00:00Z`);
        while (saturday.getUTCDay() !== 6) saturday.setUTCDate(saturday.getUTCDate() + 1);
        const saturdayDate = saturday.toISOString().slice(0, 10);
        expect(headerDates).not.toContain(saturdayDate);

        const [day1, day2, day3] = headerDates as [string, string, string];
        const assignment = assignmentFor(project);
        const meetings: InjectedMeeting[] = [
            {
                id: 'm-b1',
                subject: 'Retainer one',
                start: `${day1}T09:00:00Z`,
                end: `${day1}T09:30:00Z`,
                series_key: 's-b1',
                assignment,
            },
            {
                id: 'm-b2',
                subject: 'Retainer two',
                start: `${day2}T10:00:00Z`,
                end: `${day2}T10:30:00Z`,
                series_key: 's-b2',
                assignment,
            },
            {
                id: 'm-b3',
                subject: 'Retainer three',
                start: `${day3}T11:00:00Z`,
                end: `${day3}T11:30:00Z`,
                series_key: 's-b3',
                assignment,
            },
            {
                id: 'm-sat',
                subject: 'Weekend retainer',
                start: `${saturdayDate}T10:00:00Z`,
                end: `${saturdayDate}T10:30:00Z`,
                series_key: 's-sat',
                assignment,
            },
            {
                id: 'm-suggested',
                subject: 'Suggested only',
                start: `${day1}T14:00:00Z`,
                end: `${day1}T14:30:00Z`,
                suggestions: [
                    {
                        project_id: other.id,
                        project_name: other.name,
                        project_color: other.color,
                        client_name: null,
                        confident: true,
                        reason: { kind: 'domain', count: 3, value: 'client.com' },
                    },
                ],
            },
        ];

        await scrollCalendarToTime(page, '09:00:00');
        const conversions = await routeConversions(page, ctx, meetings);
        await injectMeetings(page, meetings, { convertUrl: convertUrl(ctx) });
        await expect(page.locator('.m365-ghost')).toHaveCount(4);
        await expect(ghost(page, 'm-sat')).toHaveCount(0);

        // Only the three rendered pre-assigned meetings count
        const button = page.locator(CONFIRM_ALL);
        await expect(button).toBeVisible();
        await expect(button).toHaveAttribute('aria-label', 'Confirm 3 pre-assigned meetings');
        await button.click();

        const popover = page.locator(CONFIRM_POPOVER);
        await expect(popover).toBeVisible();
        await expect(popover.locator('[data-testid="outlook-confirm-title"]')).toHaveText(
            'Confirm 3 pre-assigned meetings'
        );
        const rows = popover.locator('[data-testid="outlook-confirm-row"]');
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(0)).toContainText('Retainer one');
        await expect(rows.nth(1)).toContainText('Retainer two');
        await expect(rows.nth(2)).toContainText('Retainer three');
        await expect(popover).not.toContainText('Weekend retainer');
        await expect(popover).not.toContainText('Suggested only');
        await expect(rows.first().locator('[data-testid="outlook-batch-row-project"]')).toHaveText(
            /Retainer Project/
        );

        const two = rows.filter({ hasText: 'Retainer two' });
        await two.locator('[data-testid="outlook-include-checkbox"]').uncheck();
        const submit = popover.locator('[data-testid="outlook-confirm-submit"]');
        await expect(submit).toHaveText('Confirm 2 meetings');

        // Hold the answer to see the per-row state while the request runs
        let release: () => void = () => {};
        conversions.hold = new Promise<void>((resolve) => {
            release = resolve;
        });
        await submit.click();

        await expect.poll(() => conversions.bodies.length).toBe(1);
        expect(conversions.bodies[0]).toEqual({
            meeting_ids: ['m-b1', 'm-b3'],
            use_series_assignment: true,
        });
        await expect(rows.filter({ hasText: 'Retainer one' })).toHaveAttribute(
            'data-status',
            'pending'
        );
        await expect(rows.filter({ hasText: 'Retainer three' })).toHaveAttribute(
            'data-status',
            'pending'
        );
        await expect(two).not.toHaveAttribute('data-status');
        release();

        // Everything sent was created: one toast for the whole confirm and the popover closes
        await expect(page.getByText('2 time entries created successfully').first()).toBeVisible();
        await expect(page.locator(CONFIRM_POPOVER)).toHaveCount(0);
        expect(conversions.created.map((entry) => entry.meeting_id)).toEqual(['m-b1', 'm-b3']);
        expect(conversions.created.every((entry) => entry.project_id === project.id)).toBe(true);
        expect(conversions.bodies).toHaveLength(1);

        await expect(ghost(page, 'm-b1')).toHaveCount(0);
        await expect(ghost(page, 'm-b3')).toHaveCount(0);
        await expect(ghost(page, 'm-b2')).toHaveCount(1);
        await expect(ghost(page, 'm-suggested')).toHaveCount(1);
        await expect(button).toHaveAttribute('aria-label', 'Confirm 1 pre-assigned meeting');

        for (const subject of ['Retainer one', 'Retainer three']) {
            const entry = page.locator('.fc-event').filter({ hasText: subject }).first();
            await expect(entry).toBeVisible();
            await expect(entry.locator('[data-testid="outlook-entry-badge"]')).toHaveCount(1);
        }
    });

    test('opens the form with a confident suggestion and switches project with a quick pick', async ({
        page,
        ctx,
    }) => {
        const portal = await createProjectViaApi(ctx, { name: 'Client Portal' });
        const internal = await createProjectViaApi(ctx, { name: 'Internal' });
        const meetings: InjectedMeeting[] = [
            {
                id: 'm-suggest',
                subject: 'Portal kickoff',
                start: todayAt('14:00:00'),
                end: todayAt('15:00:00'),
                suggestions: [
                    {
                        project_id: portal.id,
                        project_name: portal.name,
                        project_color: portal.color,
                        client_name: null,
                        confident: true,
                        reason: { kind: 'domain', count: 4, value: 'client.com' },
                    },
                    {
                        project_id: internal.id,
                        project_name: internal.name,
                        project_color: internal.color,
                        client_name: null,
                        confident: false,
                        reason: { kind: 'subject', count: 2, value: null },
                    },
                ],
            },
        ];

        await goToCalendar(page);
        await scrollCalendarToTime(page, '13:00:00');
        const conversions = await routeConversions(page, ctx, meetings);
        await injectMeetings(page, meetings, { convertUrl: convertUrl(ctx) });

        const block = ghost(page, 'm-suggest');
        await expect(block).toHaveCount(1);
        // A suggestion is not a pre-assignment: no project line in the lane
        await expect(block).not.toHaveAttribute('data-preassigned');
        await block.click();
        const panel = page.locator(DETAIL_PANEL);
        await expect(panel).toBeVisible();
        await panel.locator('[data-testid="outlook-detail-create"]').click();

        const form = panel.locator(CONVERT_FORM);
        await expect(form).toBeVisible();
        const projectField = form.locator('[data-testid="outlook-convert-project"]');
        await expect(projectField).toContainText('Client Portal');
        await expect(form.locator('[data-testid="outlook-suggestion-reason"]')).toHaveText(
            'Like 4 meetings with @client.com'
        );
        const picks = form.locator('[data-testid="outlook-suggestion-pick"]');
        await expect(picks).toHaveCount(1);
        await expect(picks.first()).toHaveText('Internal');
        await expect(picks.first()).toHaveAttribute('data-project-id', internal.id);
        await expect(picks.first()).toHaveAttribute('aria-label', 'Use Internal');

        await picks.first().click();
        await expect(projectField).toContainText('Internal');
        await expect(projectField).not.toContainText('Client Portal');
        // The reason follows the picked candidate, and the other one becomes the chip
        await expect(form.locator('[data-testid="outlook-suggestion-reason"]')).toHaveText(
            'Like 2 meetings with a similar subject'
        );
        await expect(picks).toHaveCount(1);
        await expect(picks.first()).toHaveAttribute('data-project-id', portal.id);

        await form.locator('[data-testid="outlook-convert-submit"]').click();

        await expect.poll(() => conversions.bodies.length).toBe(1);
        const body = conversions.bodies[0]!;
        expect(body.meeting_ids).toEqual(['m-suggest']);
        expect(body.use_series_assignment).toBeUndefined();
        expect(body.project_id).toBe(internal.id);
        expect(body.prefill_source).toBe('suggestion');
        expect(body.prefill_project_id).toBe(portal.id);

        await expect(block).toHaveCount(0);
        const entry = page.locator('.fc-event').filter({ hasText: 'Portal kickoff' }).first();
        await expect(entry).toBeVisible();
        await expect(entry).toContainText('Internal');
    });

    test('ignores a series from the context menu and brings it back from show dismissed', async ({
        page,
        ctx,
    }) => {
        const meetings: InjectedMeeting[] = [
            {
                id: 'm-s9-a',
                subject: 'Vendor standup',
                start: todayAt('09:00:00'),
                end: todayAt('09:30:00'),
                series_key: 's-9',
            },
            {
                id: 'm-s9-b',
                subject: 'Vendor standup',
                start: todayAt('13:00:00'),
                end: todayAt('13:30:00'),
                series_key: 's-9',
            },
            {
                id: 'm-single',
                subject: 'One-off review',
                start: todayAt('11:00:00'),
                end: todayAt('11:30:00'),
            },
        ];

        await goToCalendar(page);
        await scrollCalendarToTime(page, '09:00:00');
        const series = await routeSeries(page);
        await injectMeetings(page, meetings, {
            convertUrl: convertUrl(ctx),
            seriesUrl: seriesUrl(ctx),
        });
        await expect(page.locator('.m365-ghost')).toHaveCount(3);

        await ghost(page, 'm-s9-a').click({ button: 'right' });
        const menu = page.locator(MEETING_MENU);
        await expect(menu).toBeVisible();
        // A one-off meeting has no series items; this one cannot be forgotten (no assignment)
        await expect(menu.locator('[data-testid="outlook-menu-forget-series"]')).toHaveCount(0);
        await menu.locator('[data-testid="outlook-menu-ignore-series"]').click();

        await expect.poll(() => series.length).toBe(1);
        expect(series[0]).toEqual({ method: 'POST', path: seriesPath(ctx, 'm-s9-a', 'ignore') });

        // Every occurrence leaves the lane, the single meeting stays
        await expect(ghost(page, 'm-s9-a')).toHaveCount(0);
        await expect(ghost(page, 'm-s9-b')).toHaveCount(0);
        await expect(ghost(page, 'm-single')).toHaveCount(1);
        await expect(page.getByText(LABELS.series_ignored, { exact: true }).first()).toBeVisible();

        // Show dismissed meetings: both occurrences are back, faded, read as "series ignored"
        await setShowDismissed(page, true);
        for (const id of ['m-s9-a', 'm-s9-b']) {
            const block = ghost(page, id);
            await expect(block).toHaveCount(1);
            await expect(block).toHaveClass(/m365-meeting--dismissed/);
            await expect(block).toHaveAttribute('aria-label', /, series ignored$/);
            await expect(block).not.toHaveAttribute('data-preassigned');
        }
        await expect(ghost(page, 'm-single')).not.toHaveClass(/m365-meeting--dismissed/);

        await ghost(page, 'm-s9-b').click({ button: 'right' });
        await expect(menu).toBeVisible();
        await expect(menu.locator('[data-testid="outlook-menu-ignore-series"]')).toHaveCount(0);
        await menu.locator('[data-testid="outlook-menu-unignore-series"]').click();

        await expect.poll(() => series.length).toBe(2);
        expect(series[1]).toEqual({ method: 'DELETE', path: seriesPath(ctx, 'm-s9-b', 'ignore') });
        for (const id of ['m-s9-a', 'm-s9-b']) {
            const block = ghost(page, id);
            await expect(block).not.toHaveClass(/m365-meeting--dismissed/);
            await expect(block).not.toHaveAttribute('aria-label', /, series ignored$/);
        }

        // With dismissed meetings hidden again, the series stays in the lane
        await setShowDismissed(page, false);
        await expect(page.locator('.m365-ghost')).toHaveCount(3);
    });

    test('forgets a series from the panel', async ({ page, ctx }) => {
        const project = await createProjectViaApi(ctx, { name: 'Steering Project' });
        const assignment = assignmentFor(project);
        const meetings: InjectedMeeting[] = [
            {
                id: 'm-s7-a',
                subject: 'Steering committee',
                start: todayAt('09:00:00'),
                end: todayAt('10:00:00'),
                series_key: 's-7',
                assignment,
            },
            {
                id: 'm-s7-b',
                subject: 'Steering committee',
                start: todayAt('15:00:00'),
                end: todayAt('16:00:00'),
                series_key: 's-7',
                assignment,
            },
        ];

        await goToCalendar(page);
        await scrollCalendarToTime(page, '09:00:00');
        const series = await routeSeries(page);
        const conversions = await routeConversions(page, ctx, meetings);
        await injectMeetings(page, meetings, {
            convertUrl: convertUrl(ctx),
            seriesUrl: seriesUrl(ctx),
        });
        await expect(ghost(page, 'm-s7-a')).toHaveAttribute('data-preassigned', '');
        await expect(ghost(page, 'm-s7-b')).toHaveAttribute('data-preassigned', '');

        await ghost(page, 'm-s7-a').click();
        const panel = page.locator(DETAIL_PANEL);
        await expect(panel).toBeVisible();
        await expect(panel.locator('[data-testid="outlook-detail-confirm"]')).toBeVisible();
        await panel.locator('[data-testid="outlook-detail-more"]').click();
        const more = page.locator('[data-testid="outlook-detail-more-menu"]');
        await expect(more).toBeVisible();
        await more.locator('[data-testid="outlook-more-forget-series"]').click();

        await expect.poll(() => series.length).toBe(1);
        expect(series[0]).toEqual({
            method: 'DELETE',
            path: seriesPath(ctx, 'm-s7-a', 'assignment'),
        });

        // Neither occurrence is pre-assigned any more; both stay in the lane as plain meetings
        for (const id of ['m-s7-a', 'm-s7-b']) {
            const block = ghost(page, id);
            await expect(block).toHaveCount(1);
            await expect(block).not.toHaveAttribute('data-preassigned');
            await expect(block.locator('[data-testid="outlook-preassigned-line"]')).toHaveCount(0);
        }
        await expect(
            page.getByText(LABELS.series_forgotten, { exact: true }).first()
        ).toBeVisible();
        await expect(page.getByText(LABELS.series_forgotten_help).first()).toBeVisible();
        // Nothing was converted and no time entry was touched
        expect(conversions.bodies).toHaveLength(0);
        await expect(page.locator(CONFIRM_ALL)).toHaveCount(0);
    });
});

// Browser checks the wave-3 plans left open (05-10): the read-only panel in test-hook mode and the
// Spanish footer at w-96.
test.describe('Outlook suggestion panel checks', () => {
    test('a read-only panel of a pre-assigned series stays open without actions', async ({
        page,
    }) => {
        await goToCalendar(page);
        await scrollCalendarToTime(page, '14:00:00');
        // No options: display only (canAct false). No Outlook link, so the panel has no focusable
        // content of its own (05-10: in happy-dom such a panel closes on the next focus pass).
        await injectMeetings(
            page,
            [
                {
                    id: 'm-ro',
                    subject: 'Read-only series',
                    start: todayAt('14:00:00'),
                    end: todayAt('14:30:00'),
                    series_key: 's-ro',
                    assignment: {
                        project_id: 'project-ro',
                        project_name: 'Hidden Project',
                        project_color: '#ef5350',
                        client_name: null,
                        task_id: null,
                        task_name: null,
                        tags: [],
                        billable: false,
                        converted_at: '2026-01-05T10:00:00Z',
                    },
                },
            ],
            {}
        );
        const block = ghost(page, 'm-ro');
        await expect(block).toHaveCount(1);

        await block.click();
        const panel = page.locator(DETAIL_PANEL);
        await expect(panel).toBeVisible();
        await expect(panel).toContainText('Read-only series');
        await page.waitForTimeout(500);
        await expect(panel).toBeVisible();
        for (const id of [
            'outlook-detail-confirm',
            'outlook-detail-edit',
            'outlook-detail-more',
            'outlook-detail-create',
            'outlook-detail-action',
            'outlook-detail-link',
        ]) {
            await expect(panel.locator(`[data-testid="${id}"]`)).toHaveCount(0);
        }

        await page.keyboard.press('Escape');
        await expect(page.locator(DETAIL_PANEL)).toHaveCount(0);
    });

    test('the Spanish footer of a pre-assigned panel and its hover card fit', async ({
        page,
        ctx,
    }, testInfo) => {
        const project = await createProjectViaApi(ctx, { name: 'Proyecto Retainer' });
        await goToCalendar(page);
        await scrollCalendarToTime(page, '09:00:00');
        await injectMeetings(
            page,
            [
                {
                    id: 'm-es-pre',
                    subject: 'Comité de dirección',
                    start: todayAt('09:00:00'),
                    end: todayAt('10:00:00'),
                    series_key: 's-es',
                    assignment: assignmentFor(project, 'Cliente'),
                },
            ],
            { convertUrl: convertUrl(ctx), seriesUrl: seriesUrl(ctx), labels: LABELS_ES }
        );
        const block = ghost(page, 'm-es-pre');
        await expect(block).toHaveCount(1);

        await block.hover();
        const card = page.locator(HOVER_CARD);
        await expect(card).toBeVisible();
        await expect(card.locator('[data-testid="outlook-hover-confirm"]')).toHaveText('Confirmar');
        expect(await footerOverflow(card, ['outlook-hover-edit', 'outlook-hover-confirm'])).toEqual(
            [
                { id: 'outlook-hover-edit', missing: false, clipped: false, outside: 0 },
                { id: 'outlook-hover-confirm', missing: false, clipped: false, outside: 0 },
            ]
        );

        await page.mouse.move(0, 0);
        await expect(page.locator(HOVER_CARD)).toHaveCount(0);
        await block.click();
        const panel = page.locator(DETAIL_PANEL);
        await expect(panel).toBeVisible();
        await expect(panel.locator('[data-testid="outlook-detail-confirm"]')).toHaveText(
            'Confirmar'
        );
        await testInfo.attach('es-preassigned-panel', {
            body: await panel.screenshot(),
            contentType: 'image/png',
        });
        expect(
            await footerOverflow(panel, [
                'outlook-detail-more',
                'outlook-detail-edit',
                'outlook-detail-confirm',
            ])
        ).toEqual([
            { id: 'outlook-detail-more', missing: false, clipped: false, outside: 0 },
            { id: 'outlook-detail-edit', missing: false, clipped: false, outside: 0 },
            { id: 'outlook-detail-confirm', missing: false, clipped: false, outside: 0 },
        ]);
    });

    // A recurring meeting without an assignment shows [More actions] … [Crear registro] (Dismiss
    // lives in the More actions menu since 2026-11-23); the shorter Spanish label (was "Crear registro de tiempo", ~395px in a
    // 350px box) keeps the footer inside the w-96 panel.
    test('the Spanish footer of a recurring meeting without assignment fits', async ({
        page,
        ctx,
    }, testInfo) => {
        await goToCalendar(page);
        await scrollCalendarToTime(page, '09:00:00');
        await injectMeetings(
            page,
            [
                {
                    id: 'm-es-rec',
                    subject: 'Reunión semanal',
                    start: todayAt('09:00:00'),
                    end: todayAt('10:00:00'),
                    series_key: 's-es-rec',
                },
            ],
            { convertUrl: convertUrl(ctx), seriesUrl: seriesUrl(ctx), labels: LABELS_ES }
        );
        await ghost(page, 'm-es-rec').click();
        const panel = page.locator(DETAIL_PANEL);
        await expect(panel).toBeVisible();
        await expect(panel.locator('[data-testid="outlook-detail-create"]')).toHaveText(
            'Crear registro'
        );
        await testInfo.attach('es-recurring-panel', {
            body: await panel.screenshot(),
            contentType: 'image/png',
        });
        expect(
            await footerOverflow(panel, ['outlook-detail-more', 'outlook-detail-create'])
        ).toEqual([
            { id: 'outlook-detail-more', missing: false, clipped: false, outside: 0 },
            { id: 'outlook-detail-create', missing: false, clipped: false, outside: 0 },
        ]);
        await expect(panel.locator('[data-testid="outlook-detail-action"]')).toHaveCount(0);
    });
});
