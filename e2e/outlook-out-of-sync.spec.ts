import { PLAYWRIGHT_BASE_URL } from '../playwright/config';
import { test } from '../playwright/fixtures';
import type { TestContext } from '../playwright/fixtures';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
    createProjectViaApi,
    createTimeEntryWithTimestampsViaApi,
    getTimeEntriesViaApi,
    updateOrganizationSettingViaApi,
} from './utils/api';
import { showCalendarWeekends } from './utils/calendar';

// Phase 6 browser proof: time entries out of sync with their Outlook meeting (OSYNC-01..03).
//
// The CI Playwright environment sets no SOLIDTIME_MICROSOFT_* variables, so the integration is off:
// flags (and D-03 meetings) are injected through window.__TEST_SET_OUTLOOK_MEETINGS__ with
// { actions: true, outOfSync, outOfSyncUrl, moveEntryUrl, convertUrl } on real time entries created
// through the core API. The real fork endpoints answer 404 while the integration is off, so
// page.route() answers them instead: "Adjust to Outlook" and "Move my entry here" perform the real
// core PUT on the entry, "Keep as is" records the request, and "Create time entry" creates the real
// entry through the core API. "Delete entry" is never routed: it goes through the real core
// DELETE /api/v1/organizations/{org}/time-entries/{id}. Server behaviour is covered by PHPUnit
// (06-01, 06-05, 06-06, 06-08, 06-09, 06-10, 06-15). Test users run in the UTC timezone.

// Weekends are hidden by default; these tests work on "today" and on next week, so show them (CI
// may run on a weekend)
test.beforeEach(async ({ page }) => {
    await showCalendarWeekends(page);
});

type FlagKind = 'moved' | 'cancelled' | 'removed';

interface OutOfSyncItem {
    time_entry_id: string;
    kind: FlagKind;
    meeting_start: string;
    meeting_end: string;
    new_start: string | null;
    new_end: string | null;
    all_day: boolean;
    entry_start: string;
    entry_end: string | null;
    description: string;
}

interface InjectedMeeting {
    id: string;
    subject: string;
    start: string;
    end: string;
    moved_from?: { time_entry_id: string; entry_start: string; entry_end: string } | null;
}

interface InjectOptions {
    outOfSync?: OutOfSyncItem[];
    outOfSyncUrl?: string;
    moveEntryUrl?: string;
    convertUrl?: string;
    linkedTimeEntryIds?: string[];
}

interface FlagRequest {
    action: 'keep' | 'adjust';
    timeEntryId: string;
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

// English copy of microsoft365.calendar.* (lang/en/microsoft365.php), the labels the Outlook layer,
// the review popover, the counter, the entry menu, the meeting panel and the form read. In CI the
// calendar prop is absent, so these injected labels are the only copy the components get.
const LABELS: Record<string, string> = {
    no_subject: '(No subject)',
    ghost_label: ':subject, :start to :end, Outlook meeting suggestion',
    layer_label: 'Outlook meetings, :day',
    dismissed_suffix: ', dismissed',
    sync: 'Sync Outlook',
    sync_aria: 'Sync Outlook meetings',
    syncing: 'Syncing Outlook…',
    last_synced: 'Last synced :time',
    empty: 'No Outlook meetings in this range',
    empty_hint: 'Press Sync Outlook to check again.',
    unavailable: 'Outlook unavailable, retry later',
    unavailable_cached_hint:
        'Your time entries are not affected. Showing meetings from your last sync.',
    no_mailbox: 'No Outlook calendar for this account',
    connect: 'Connect Microsoft 365',
    connect_hint: 'Show your Outlook meetings in the calendar',
    reconnect: 'Reconnect Microsoft',
    reconnect_hint: 'Your Microsoft access expired. Reconnect to see your Outlook meetings.',
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
    sync_in: 'Sync in :seconds',
    sync_cooldown_hint: 'Just synced. You can sync again in :seconds.',
    sync_backoff_hint: 'Outlook asked us to wait. You can sync again in :seconds.',
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
    // Phase 6: out-of-sync flags and D-03
    osync_reason_moved: 'Meeting moved in Outlook: :from → :to',
    osync_reason_cancelled: 'Meeting cancelled in Outlook',
    osync_reason_removed: 'Meeting removed from Outlook',
    osync_click_hint: 'Click to review',
    osync_described: 'Out of sync with Outlook. :reason.',
    osync_review: 'Review Outlook change',
    osync_title_moved: 'Meeting moved in Outlook',
    osync_title_cancelled: 'Meeting cancelled in Outlook',
    osync_title_removed: 'Meeting removed from Outlook',
    osync_row_before: 'Before',
    osync_row_now: 'Now',
    osync_row_entry: 'Your entry',
    osync_row_meeting: 'Meeting',
    osync_note_moved: "You changed this entry's time, so it was not moved automatically.",
    osync_note_gone: 'Nothing is deleted unless you choose to.',
    osync_not_in_view: 'This entry is outside the days or hours shown.',
    osync_adjust: 'Adjust to Outlook',
    osync_keep: 'Keep as is',
    osync_delete: 'Delete entry',
    osync_delete_question: "Delete this time entry? This can't be undone.",
    osync_delete_confirm: 'Delete entry',
    osync_adjusted: 'Time entry adjusted to Outlook',
    osync_kept: 'Kept as is',
    osync_deleted_announcement: 'Time entry deleted',
    osync_adjust_failed: 'Could not adjust the time entry',
    osync_keep_failed: 'Could not save your choice',
    osync_delete_failed: 'Could not delete the time entry',
    osync_stale: 'This entry changed in the meantime',
    osync_stale_body: 'The calendar was refreshed.',
    osync_error_forbidden: "You can't edit this time entry.",
    osync_count_one: '1 out of sync',
    osync_count_many: ':count out of sync',
    osync_count_aria_one: '1 time entry out of sync with Outlook. Show it.',
    osync_count_aria_many: ':count time entries out of sync with Outlook. Show the first one.',
    osync_count_tooltip: 'Show the first entry that changed in Outlook',
    moved_eyebrow: 'Moved in Outlook · Already logged',
    moved_body:
        'You logged it on :when. Create a new entry for this session, or move that one here.',
    moved_hover_note: 'Moved in Outlook. You logged it on :date.',
    moved_suffix: ', already logged on :date',
    move_entry_here: 'Move my entry here',
    move_entry_success: 'Time entry moved here',
    move_entry_from: 'From :when',
    move_entry_announcement: 'Time entry moved',
    move_entry_failed: 'Could not move the time entry',
    auto_adjusted_note: 'Updated from Outlook: :from → :to',
    auto_adjusted_one: '1 time entry updated from Outlook',
    auto_adjusted_many: ':count time entries updated from Outlook',
};

const FLAG_PANEL = '[data-testid="outlook-sync-flag-panel"]';
const MARKER = '[data-testid="outlook-sync-flag-marker"]';
const COUNTER = '[data-testid="outlook-out-of-sync"]';
const OUT_OF_SYNC_ROUTE = '**/m365/out-of-sync/**';
const DETAIL_PANEL = '[data-testid="outlook-ghost-detail"]';
const CONVERT_FORM = '[data-testid="outlook-convert-form"]';
const CONVERT_ROUTE = '**/m365/organizations/*/meetings/time-entries';
const MOVE_ROUTE = '**/m365/organizations/*/meetings/*/move-entry';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

// The UTC calendar day `offset` days from today ('YYYY-MM-DD').
function utcDay(offset = 0): string {
    return new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function at(day: string, time: string): string {
    return `${day}T${time}Z`;
}

function outOfSyncUrl(): string {
    return `${PLAYWRIGHT_BASE_URL}/m365/out-of-sync`;
}

function timeEntryUrl(ctx: TestContext, id: string): string {
    return `${PLAYWRIGHT_BASE_URL}/api/v1/organizations/${ctx.orgId}/time-entries/${id}`;
}

function convertUrl(ctx: TestContext): string {
    return `${PLAYWRIGHT_BASE_URL}/m365/organizations/${ctx.orgId}/meetings/time-entries`;
}

function moveEntryUrl(ctx: TestContext): string {
    return `${PLAYWRIGHT_BASE_URL}/m365/organizations/${ctx.orgId}/meetings`;
}

// The UI's short day ('ddd, MMM D' in the user's UTC timezone), e.g. 'Mon, Nov 23'.
function shortDay(day: string): string {
    const date = new Date(`${day}T00:00:00Z`);
    return `${WEEKDAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function withDefaults(meeting: InjectedMeeting) {
    return {
        organizer_name: 'Test Organizer',
        is_organizer: false,
        is_online_meeting: false,
        web_link: null,
        dismissed: false,
        moved_from: null,
        ...meeting,
    };
}

// A flag on a real entry, with the entry's own times and description.
function flagFor(
    entry: { id: string; start: string; end: string; description: string },
    kind: FlagKind,
    meeting: { start: string; end: string },
    moved?: { start: string; end: string }
): OutOfSyncItem {
    return {
        time_entry_id: entry.id,
        kind,
        meeting_start: meeting.start,
        meeting_end: meeting.end,
        new_start: moved?.start ?? null,
        new_end: moved?.end ?? null,
        all_day: false,
        entry_start: entry.start,
        entry_end: entry.end,
        description: entry.description,
    };
}

// Injects meetings and flags with actions enabled (canAct true): every flagged entry is linked,
// like a converted meeting's entry.
async function injectFlags(page: Page, meetings: InjectedMeeting[], options: InjectOptions) {
    const linked = [
        ...(options.linkedTimeEntryIds ?? []),
        ...(options.outOfSync ?? []).map((item) => item.time_entry_id),
    ];
    await page.evaluate(
        ({ list, labels, hookOptions }) => {
            const setter = (
                window as unknown as {
                    __TEST_SET_OUTLOOK_MEETINGS__?: (
                        meetings: unknown[],
                        labels?: Record<string, string>,
                        options?: Record<string, unknown>
                    ) => void;
                }
            ).__TEST_SET_OUTLOOK_MEETINGS__;
            if (!setter) throw new Error('__TEST_SET_OUTLOOK_MEETINGS__ is not installed');
            setter(list, labels, hookOptions);
        },
        {
            list: meetings.map(withDefaults),
            labels: LABELS,
            hookOptions: { ...options, actions: true, linkedTimeEntryIds: linked },
        }
    );
}

// Answers "Keep as is" and "Adjust to Outlook" in place of the (disabled) fork routes. Adjust moves
// the real entry to the flag's new times through the core API, exactly like the server; keep only
// records the answer (the server clears the flag, which the injected list mirrors).
async function routeFlagActions(
    page: Page,
    ctx: TestContext,
    flags: OutOfSyncItem[]
): Promise<FlagRequest[]> {
    const byId = new Map(flags.map((flag) => [flag.time_entry_id, flag]));
    const requests: FlagRequest[] = [];

    await page.route(OUT_OF_SYNC_ROUTE, async (route) => {
        const request = route.request();
        const match = /\/m365\/out-of-sync\/([^/]+)\/(keep|adjust)$/.exec(
            new URL(request.url()).pathname
        );
        if (request.method() !== 'POST' || !match) {
            await route.fallback();
            return;
        }
        const timeEntryId = decodeURIComponent(match[1]!);
        const action = match[2] as FlagRequest['action'];
        requests.push({ action, timeEntryId });

        if (action === 'keep') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ status: 'kept' }),
            });
            return;
        }
        const flag = byId.get(timeEntryId);
        if (!flag || flag.new_start === null || flag.new_end === null) {
            await route.fulfill({
                status: 404,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'Not found' }),
            });
            return;
        }
        const response = await ctx.request.put(timeEntryUrl(ctx, timeEntryId), {
            data: { start: flag.new_start, end: flag.new_end },
        });
        await route.fulfill({
            status: response.status() === 200 ? 200 : 500,
            contentType: 'application/json',
            body: JSON.stringify(
                response.status() === 200 ? { status: 'adjusted' } : { message: 'Server error' }
            ),
        });
    });

    return requests;
}

function entryBlock(page: Page, id: string): Locator {
    return page.locator(`.fc .fc-event[data-event-id="${id}"]`);
}

async function entryById(ctx: TestContext, id: string) {
    return (await getTimeEntriesViaApi(ctx)).find((entry) => entry.id === id) ?? null;
}

// Vertical distance between the block and the slot row of `time` (both in the same scroller).
async function offsetFromSlot(page: Page, block: Locator, time: string): Promise<number> {
    const blockBox = await block.boundingBox();
    const slotBox = await page
        .locator(`.fc-timegrid-slot-lane[data-time="${time}"]`)
        .first()
        .boundingBox();
    if (!blockBox || !slotBox) return Number.POSITIVE_INFINITY;
    return Math.abs(blockBox.y - slotBox.y);
}

// The core edit modal of a time entry (its submit button only exists there).
function coreEditButton(page: Page): Locator {
    return page.getByRole('button', { name: 'Update Time Entry' });
}

function ghost(page: Page, id: string): Locator {
    return page.locator(`.m365-ghost[data-ghost-id="${id}"]`);
}

// Answers "Move my entry here" in place of the (disabled) fork route: the meeting's logged entry
// (moved_from) moves to the meeting's new slot through the core API, exactly like the server.
// Returns the meeting ids of every move request, in order.
async function routeMoves(
    page: Page,
    ctx: TestContext,
    meetings: InjectedMeeting[]
): Promise<string[]> {
    const byId = new Map(meetings.map((meeting) => [meeting.id, meeting]));
    const requests: string[] = [];

    await page.route(MOVE_ROUTE, async (route) => {
        const request = route.request();
        const match = /\/meetings\/([^/]+)\/move-entry$/.exec(new URL(request.url()).pathname);
        if (request.method() !== 'POST' || !match) {
            await route.fallback();
            return;
        }
        const meetingId = decodeURIComponent(match[1]!);
        requests.push(meetingId);
        const meeting = byId.get(meetingId);
        const entryId = meeting?.moved_from?.time_entry_id;
        if (!meeting || !entryId) {
            await route.fulfill({
                status: 404,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'Not found' }),
            });
            return;
        }
        const response = await ctx.request.put(timeEntryUrl(ctx, entryId), {
            data: { start: meeting.start, end: meeting.end },
        });
        await route.fulfill({
            status: response.status() === 200 ? 200 : 500,
            contentType: 'application/json',
            body: JSON.stringify(
                response.status() === 200
                    ? { status: 'moved', time_entry_id: entryId }
                    : { message: 'Server error' }
            ),
        });
    });

    return requests;
}

// Answers the convert request in place of the (disabled) fork route (the 04-08 handler): each
// meeting becomes a real time entry through the core API with the form's values.
async function routeConversions(
    page: Page,
    ctx: TestContext,
    meetings: InjectedMeeting[]
): Promise<ConvertBody[]> {
    const byId = new Map(meetings.map((meeting) => [meeting.id, meeting]));
    const bodies: ConvertBody[] = [];

    await page.route(CONVERT_ROUTE, async (route) => {
        const body = route.request().postDataJSON() as ConvertBody;
        bodies.push(body);
        const results: ConvertResult[] = [];
        for (const id of body.meeting_ids) {
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
                    error: { key: 'request_failed', message: LABELS.error_generic! },
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

    return bodies;
}

// Opens the project picker inside `scope` and picks the project.
async function pickProject(page: Page, scope: Locator, projectName: string) {
    await scope.locator('[data-testid="outlook-convert-project"] button').first().click();
    await page.getByRole('option', { name: projectName }).click();
    await expect(scope.locator('[data-testid="outlook-convert-project"]')).toContainText(
        projectName
    );
}

// A meeting Outlook moved to today 15:00-16:00 after it started, whose entry is logged yesterday.
function movedMeeting(
    id: string,
    entry: { id: string; start: string; end: string },
    today: string
): InjectedMeeting {
    return {
        id,
        subject: 'Design review',
        start: at(today, '15:00:00'),
        end: at(today, '16:00:00'),
        moved_from: { time_entry_id: entry.id, entry_start: entry.start, entry_end: entry.end },
    };
}

test.describe('Outlook out-of-sync review', () => {
    test('reviews a moved flag from its marker and adjusts the entry to Outlook', async ({
        page,
        ctx,
    }) => {
        await updateOrganizationSettingViaApi(ctx, { time_format: '24-hours' });
        const today = utcDay();
        const entry = await createTimeEntryWithTimestampsViaApi(ctx, {
            description: 'Moved standup',
            start: at(today, '10:15:00'),
            end: at(today, '11:00:00'),
        });
        const flag = flagFor(
            entry,
            'moved',
            { start: at(today, '10:00:00'), end: at(today, '11:00:00') },
            { start: at(today, '13:00:00'), end: at(today, '14:00:00') }
        );

        await goToCalendar(page);
        await scrollCalendarToTime(page, '10:00:00');
        const requests = await routeFlagActions(page, ctx, [flag]);
        await injectFlags(page, [], { outOfSync: [flag], outOfSyncUrl: outOfSyncUrl() });

        const block = entryBlock(page, entry.id);
        await expect(block).toBeVisible();
        const marker = block.locator(MARKER);
        await expect(marker).toHaveCount(1);
        await expect(marker).toHaveAttribute('data-flag-kind', 'moved');

        // The marker opens the review popover, never the core edit modal (and no drag)
        await marker.click();
        const panel = page.locator(FLAG_PANEL);
        await expect(panel).toBeVisible();
        await expect(panel).toHaveAttribute('data-kind', 'moved');
        await expect(panel).toHaveAttribute('data-anchor', 'entry');
        await expect(coreEditButton(page)).toHaveCount(0);
        await expect(panel.locator('[data-testid="outlook-sync-flag-title"]')).toHaveText(
            'Meeting moved in Outlook'
        );
        await expect(panel.locator('[data-testid="outlook-sync-flag-description"]')).toHaveText(
            'Moved standup'
        );
        await expect(panel).toContainText('Before');
        await expect(panel).toContainText('Now');
        await expect(panel).toContainText('Your entry');
        await expect(panel.locator('[data-testid="outlook-sync-flag-before"]')).toContainText(
            '10:00 – 11:00'
        );
        await expect(panel.locator('[data-testid="outlook-sync-flag-now"]')).toContainText(
            '13:00 – 14:00'
        );
        await expect(panel.locator('[data-testid="outlook-sync-flag-entry"]')).toContainText(
            '10:15 – 11:00'
        );
        // Moved: Keep and Adjust, no Delete
        await expect(panel.locator('[data-testid="outlook-sync-flag-keep"]')).toBeVisible();
        await expect(panel.locator('[data-testid="outlook-sync-flag-delete"]')).toHaveCount(0);
        expect((await entryById(ctx, entry.id))?.start).toBe(at(today, '10:15:00'));

        await panel.locator('[data-testid="outlook-sync-flag-adjust"]').click();

        // The routed adjust moved the real entry; the popover closes and the marker is gone
        await expect(page.locator(FLAG_PANEL)).toHaveCount(0);
        await expect(block.locator(MARKER)).toHaveCount(0);
        expect(requests).toEqual([{ action: 'adjust', timeEntryId: entry.id }]);
        await expect(page.getByText('Time entry adjusted to Outlook').first()).toBeVisible();
        const moved = await entryById(ctx, entry.id);
        expect(moved?.start).toBe(at(today, '13:00:00'));
        expect(moved?.end).toBe(at(today, '14:00:00'));
        // The refetched block sits at 13:00
        await expect.poll(() => offsetFromSlot(page, block, '13:00:00')).toBeLessThan(4);

        // A click on the entry body still opens the core edit modal
        await scrollCalendarToTime(page, '13:00:00');
        await block.click();
        await expect(coreEditButton(page)).toBeVisible();
        await expect(
            page.getByRole('dialog').getByPlaceholder('What did you work on?')
        ).toHaveValue('Moved standup');
    });

    test('keeps a moved flag as it is', async ({ page, ctx }) => {
        const today = utcDay();
        const entry = await createTimeEntryWithTimestampsViaApi(ctx, {
            description: 'Kept review',
            start: at(today, '11:00:00'),
            end: at(today, '12:00:00'),
        });
        const flag = flagFor(
            entry,
            'moved',
            { start: at(today, '11:00:00'), end: at(today, '12:00:00') },
            { start: at(today, '16:00:00'), end: at(today, '17:00:00') }
        );

        await goToCalendar(page);
        await scrollCalendarToTime(page, '11:00:00');
        const requests = await routeFlagActions(page, ctx, [flag]);
        await injectFlags(page, [], { outOfSync: [flag], outOfSyncUrl: outOfSyncUrl() });
        await expect(page.locator(COUNTER)).toHaveAttribute('data-count', '1');

        const block = entryBlock(page, entry.id);
        await block.locator(MARKER).click();
        const panel = page.locator(FLAG_PANEL);
        await expect(panel).toBeVisible();
        await panel.locator('[data-testid="outlook-sync-flag-keep"]').click();

        // The routed keep answered; the popover, the marker and the counter are gone
        await expect(page.locator(FLAG_PANEL)).toHaveCount(0);
        await expect(block.locator(MARKER)).toHaveCount(0);
        await expect(page.locator(COUNTER)).toHaveCount(0);
        expect(requests).toEqual([{ action: 'keep', timeEntryId: entry.id }]);

        // The entry keeps its times (nothing moved it), and no failure or adjust toast was shown.
        // "Kept as is" is announced only (no toast); the live region lives in the connected
        // toolbar, which the CI calendar (integration off) does not render.
        const kept = await entryById(ctx, entry.id);
        expect(kept?.start).toBe(at(today, '11:00:00'));
        expect(kept?.end).toBe(at(today, '12:00:00'));
        await expect.poll(() => offsetFromSlot(page, block, '11:00:00')).toBeLessThan(4);
        await expect(page.getByText(LABELS.osync_keep_failed!)).toHaveCount(0);
        await expect(page.getByText(LABELS.osync_adjusted!)).toHaveCount(0);
    });

    test('deletes a cancelled flagged entry only after confirming', async ({ page, ctx }) => {
        const today = utcDay();
        const cancelledEntry = await createTimeEntryWithTimestampsViaApi(ctx, {
            description: 'Cancelled sync',
            start: at(today, '09:00:00'),
            end: at(today, '10:00:00'),
        });
        const removedEntry = await createTimeEntryWithTimestampsViaApi(ctx, {
            description: 'Removed planning',
            start: at(today, '11:00:00'),
            end: at(today, '12:00:00'),
        });
        const cancelled = flagFor(cancelledEntry, 'cancelled', {
            start: cancelledEntry.start,
            end: cancelledEntry.end,
        });
        const removed = flagFor(removedEntry, 'removed', {
            start: removedEntry.start,
            end: removedEntry.end,
        });

        await goToCalendar(page);
        await scrollCalendarToTime(page, '09:00:00');
        const requests = await routeFlagActions(page, ctx, [cancelled, removed]);
        await injectFlags(page, [], {
            outOfSync: [cancelled, removed],
            outOfSyncUrl: outOfSyncUrl(),
        });

        const counter = page.locator(COUNTER);
        await expect(counter).toHaveAttribute('data-count', '2');
        await expect(counter.locator('[data-testid="outlook-out-of-sync-count"]')).toHaveText('2');
        await expect(counter).toHaveAttribute(
            'aria-label',
            '2 time entries out of sync with Outlook. Show the first one.'
        );
        const cancelledBlock = entryBlock(page, cancelledEntry.id);
        await expect(cancelledBlock.locator(MARKER)).toHaveAttribute('data-flag-kind', 'cancelled');
        await expect(entryBlock(page, removedEntry.id).locator(MARKER)).toHaveAttribute(
            'data-flag-kind',
            'removed'
        );

        await cancelledBlock.locator(MARKER).click();
        const panel = page.locator(FLAG_PANEL);
        await expect(panel).toBeVisible();
        await expect(panel).toHaveAttribute('data-kind', 'cancelled');
        await expect(panel.locator('[data-testid="outlook-sync-flag-title"]')).toHaveText(
            'Meeting cancelled in Outlook'
        );
        // Cancelled: Keep and Delete, never Adjust
        await expect(panel.locator('[data-testid="outlook-sync-flag-adjust"]')).toHaveCount(0);

        // First step, then Cancel: nothing is deleted
        await panel.locator('[data-testid="outlook-sync-flag-delete"]').click();
        const question = panel.locator('[data-testid="outlook-sync-flag-delete-question"]');
        await expect(question).toHaveText("Delete this time entry? This can't be undone.");
        await panel.locator('[data-testid="outlook-sync-flag-delete-cancel"]').click();
        await expect(question).toHaveCount(0);
        await expect(panel).toBeVisible();
        await expect(panel.locator('[data-testid="outlook-sync-flag-delete"]')).toBeVisible();
        expect(await entryById(ctx, cancelledEntry.id)).not.toBeNull();
        await expect(cancelledBlock).toBeVisible();
        await expect(counter).toHaveAttribute('data-count', '2');

        // Delete entry, then Delete: the real core DELETE removes it
        await panel.locator('[data-testid="outlook-sync-flag-delete"]').click();
        await Promise.all([
            page.waitForResponse(
                (response) =>
                    response.url().includes(`/time-entries/${cancelledEntry.id}`) &&
                    response.request().method() === 'DELETE' &&
                    response.status() === 204
            ),
            panel.locator('[data-testid="outlook-sync-flag-delete-confirm"]').click(),
        ]);

        await expect(page.locator(FLAG_PANEL)).toHaveCount(0);
        await expect(cancelledBlock).toHaveCount(0);
        await expect(counter).toHaveAttribute('data-count', '1');
        await expect(page.getByText('Time entry deleted successfully').first()).toBeVisible();
        expect(await entryById(ctx, cancelledEntry.id)).toBeNull();

        // The second flag resolved with Keep: the counter disappears at 0
        const removedBlock = entryBlock(page, removedEntry.id);
        await removedBlock.locator(MARKER).click();
        await expect(panel).toBeVisible();
        await expect(panel).toHaveAttribute('data-kind', 'removed');
        await panel.locator('[data-testid="outlook-sync-flag-keep"]').click();

        await expect(page.locator(FLAG_PANEL)).toHaveCount(0);
        await expect(counter).toHaveCount(0);
        await expect(removedBlock.locator(MARKER)).toHaveCount(0);
        expect(requests).toEqual([{ action: 'keep', timeEntryId: removedEntry.id }]);
        expect(await entryById(ctx, removedEntry.id)).not.toBeNull();
    });

    test('jumps to the first flagged entry in another week without reloading', async ({
        page,
        ctx,
    }) => {
        const nextWeek = utcDay(7);
        const entry = await createTimeEntryWithTimestampsViaApi(ctx, {
            description: 'Next week review',
            start: at(nextWeek, '10:00:00'),
            end: at(nextWeek, '11:00:00'),
        });
        const flag = flagFor(
            entry,
            'moved',
            { start: at(nextWeek, '10:00:00'), end: at(nextWeek, '11:00:00') },
            { start: at(nextWeek, '12:00:00'), end: at(nextWeek, '13:00:00') }
        );

        await goToCalendar(page);
        await injectFlags(page, [], { outOfSync: [flag], outOfSyncUrl: outOfSyncUrl() });

        // The flagged entry is not in the week on screen
        const nextWeekHeader = page.locator(`.fc-col-header-cell[data-date="${nextWeek}"]`);
        await expect(nextWeekHeader).toHaveCount(0);
        await expect(entryBlock(page, entry.id)).toHaveCount(0);

        // A value on window survives only without a page reload; focus moves are recorded (the
        // popover takes focus from the entry right after the jump focused it).
        await page.evaluate(() => {
            const w = window as unknown as { __osyncPageMark?: string; __osyncFocused?: string[] };
            w.__osyncPageMark = 'same page';
            w.__osyncFocused = [];
            document.addEventListener('focusin', (event) => {
                const id = (event.target as HTMLElement | null)?.dataset?.eventId;
                if (id) w.__osyncFocused?.push(id);
            });
        });

        const counter = page.locator(COUNTER);
        await expect(counter).toHaveAttribute('data-count', '1');
        await counter.click();

        await expect(nextWeekHeader).toHaveCount(1);
        const panel = page.locator(FLAG_PANEL);
        await expect(panel).toBeVisible({ timeout: 10000 });
        await expect(panel).toHaveAttribute('data-anchor', 'entry');
        await expect(panel.locator('[data-testid="outlook-sync-flag-description"]')).toHaveText(
            'Next week review'
        );
        await expect(panel.locator('[data-testid="outlook-sync-flag-not-in-view"]')).toHaveCount(0);
        await expect(entryBlock(page, entry.id)).toBeVisible();
        await expect
            .poll(() =>
                page.evaluate(
                    () => (window as unknown as { __osyncFocused?: string[] }).__osyncFocused ?? []
                )
            )
            .toContain(entry.id);
        expect(
            await page.evaluate(
                () => (window as unknown as { __osyncPageMark?: string }).__osyncPageMark
            )
        ).toBe('same page');
    });

    test('opens the review from the entry context menu', async ({ page, ctx }) => {
        const today = utcDay();
        const entry = await createTimeEntryWithTimestampsViaApi(ctx, {
            description: 'Menu review',
            start: at(today, '14:00:00'),
            end: at(today, '15:00:00'),
        });
        const flag = flagFor(entry, 'cancelled', { start: entry.start, end: entry.end });

        await goToCalendar(page);
        await scrollCalendarToTime(page, '14:00:00');
        await injectFlags(page, [], { outOfSync: [flag], outOfSyncUrl: outOfSyncUrl() });

        const block = entryBlock(page, entry.id);
        await expect(block.locator(MARKER)).toHaveCount(1);
        await block.click({ button: 'right' });
        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible();

        // "Review Outlook change" is the first item, above the core Edit
        const review = menu.locator('[data-testid="outlook-entry-menu-review"]');
        await expect(review).toHaveText('Review Outlook change');
        await expect(menu.getByRole('menuitem').first()).toHaveText('Review Outlook change');
        const edit = menu.getByRole('menuitem', { name: 'Edit', exact: true });
        await expect(edit).toBeVisible();
        const reviewBox = await review.boundingBox();
        const editBox = await edit.boundingBox();
        expect(reviewBox).not.toBeNull();
        expect(editBox).not.toBeNull();
        expect(reviewBox!.y).toBeLessThan(editBox!.y);

        await review.click();
        await expect(page.getByRole('menu')).toHaveCount(0);
        const panel = page.locator(FLAG_PANEL);
        await expect(panel).toBeVisible();
        await expect(panel).toHaveAttribute('data-anchor', 'entry');
        await expect(panel).toHaveAttribute('data-kind', 'cancelled');
        await expect(coreEditButton(page)).toHaveCount(0);
    });
});

test.describe('Outlook meeting moved after it started (D-03)', () => {
    test('moves my logged entry to a meeting that moved after it started', async ({
        page,
        ctx,
    }) => {
        const today = utcDay();
        const yesterday = utcDay(-1);
        const entry = await createTimeEntryWithTimestampsViaApi(ctx, {
            description: 'Design review',
            start: at(yesterday, '10:00:00'),
            end: at(yesterday, '11:00:00'),
        });
        const meeting = movedMeeting('m-moved-here', entry, today);

        await goToCalendar(page);
        await scrollCalendarToTime(page, '15:00:00');
        const moves = await routeMoves(page, ctx, [meeting]);
        await injectFlags(page, [meeting], {
            moveEntryUrl: moveEntryUrl(ctx),
            convertUrl: convertUrl(ctx),
            linkedTimeEntryIds: [entry.id],
        });

        const block = ghost(page, 'm-moved-here');
        await expect(block).toHaveCount(1);
        await expect(block).toHaveAttribute('data-moved-from', '');
        await expect(block).toHaveAttribute(
            'aria-label',
            new RegExp(`, already logged on ${escapeRegExp(shortDay(yesterday))}$`)
        );

        await block.click();
        const panel = page.locator(DETAIL_PANEL);
        await expect(panel).toBeVisible();
        const movedBlock = panel.locator('[data-testid="outlook-moved-block"]');
        await expect(movedBlock).toBeVisible();
        await expect(movedBlock.locator('[data-testid="outlook-moved-eyebrow"]')).toHaveText(
            'Moved in Outlook · Already logged'
        );
        const moveButton = movedBlock.locator('[data-testid="outlook-detail-move-entry"]');
        await expect(moveButton).toHaveText('Move my entry here');
        await moveButton.click();

        // The routed move put the real entry on the meeting's new slot; the meeting leaves the lane
        await expect(block).toHaveCount(0);
        await expect(page.locator(DETAIL_PANEL)).toHaveCount(0);
        expect(moves).toEqual(['m-moved-here']);
        await expect(page.getByText('Time entry moved here').first()).toBeVisible();
        const moved = await entryById(ctx, entry.id);
        expect(moved?.start).toBe(at(today, '15:00:00'));
        expect(moved?.end).toBe(at(today, '16:00:00'));
        // Moved, not copied: still one entry
        const designReviews = (await getTimeEntriesViaApi(ctx)).filter(
            (item) => item.description === 'Design review'
        );
        expect(designReviews.map((item) => item.id)).toEqual([entry.id]);
        await expect(entryBlock(page, entry.id)).toBeVisible();
    });

    test('creates a second entry for a meeting that moved after it started', async ({
        page,
        ctx,
    }) => {
        const projectName = 'Moved Meeting Project ' + Math.floor(1 + Math.random() * 10000);
        const project = await createProjectViaApi(ctx, { name: projectName });
        const today = utcDay();
        const yesterday = utcDay(-1);
        const entry = await createTimeEntryWithTimestampsViaApi(ctx, {
            description: 'Design review',
            start: at(yesterday, '10:00:00'),
            end: at(yesterday, '11:00:00'),
        });
        const meeting = movedMeeting('m-moved-create', entry, today);

        await goToCalendar(page);
        await scrollCalendarToTime(page, '15:00:00');
        const moves = await routeMoves(page, ctx, [meeting]);
        const conversions = await routeConversions(page, ctx, [meeting]);
        await injectFlags(page, [meeting], {
            moveEntryUrl: moveEntryUrl(ctx),
            convertUrl: convertUrl(ctx),
            linkedTimeEntryIds: [entry.id],
        });

        const block = ghost(page, 'm-moved-create');
        await expect(block).toHaveAttribute('data-moved-from', '');
        await block.click();
        const panel = page.locator(DETAIL_PANEL);
        await expect(panel.locator('[data-testid="outlook-moved-block"]')).toBeVisible();
        await panel.locator('[data-testid="outlook-detail-create"]').click();

        const form = panel.locator(CONVERT_FORM);
        await expect(form).toBeVisible();
        await expect(form.locator('[data-testid="outlook-convert-description"]')).toHaveValue(
            'Design review'
        );
        await expect(form.locator('[data-testid="outlook-convert-start"]')).toHaveValue('15:00');
        await expect(form.locator('[data-testid="outlook-convert-end"]')).toHaveValue('16:00');
        await pickProject(page, form, projectName);
        await form.locator('[data-testid="outlook-convert-submit"]').click();

        // Let the intercepted conversion finish: the meeting leaves the lane
        await expect(block).toHaveCount(0);
        expect(conversions).toHaveLength(1);
        expect(conversions[0]!.meeting_ids).toEqual(['m-moved-create']);
        expect(conversions[0]!.project_id).toBe(project.id);
        expect(moves).toEqual([]);

        // A second, new entry at the meeting's slot; the logged one is untouched
        const entries = (await getTimeEntriesViaApi(ctx)).filter(
            (item) => item.description === 'Design review'
        );
        expect(entries).toHaveLength(2);
        const old = entries.find((item) => item.id === entry.id);
        expect(old?.start).toBe(at(yesterday, '10:00:00'));
        expect(old?.end).toBe(at(yesterday, '11:00:00'));
        const created = entries.find((item) => item.id !== entry.id);
        expect(created?.start).toBe(at(today, '15:00:00'));
        expect(created?.end).toBe(at(today, '16:00:00'));
        expect(created?.description).toBe('Design review');
        expect(created?.project_id).toBe(project.id);
        await expect(entryBlock(page, created!.id)).toBeVisible();
    });
});
