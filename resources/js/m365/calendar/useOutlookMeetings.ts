import {
    computed,
    nextTick,
    onMounted,
    onUnmounted,
    provide,
    ref,
    watch,
    type InjectionKey,
    type Ref,
} from 'vue';
import { usePage } from '@inertiajs/vue3';
import { useLocalStorage } from '@vueuse/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { Dayjs } from 'dayjs';
import {
    getLocalizedDayJs,
    getLocalizedDayJsFromMinutes,
    localDateToUtc,
    type TimeFormat,
} from '@/packages/ui/src/utils/time';
import { getWeekStartDayNumber } from '@/packages/ui/src/utils/settings';
import { api } from '@/packages/api/src';
import { useNotificationsStore } from '@/utils/notification';
import { getCurrentOrganizationId } from '@/utils/useUser';
import type {
    MicrosoftSharedProps,
    OutlookAutoAdjusted,
    OutlookCalendarLabels,
    OutlookCalendarProps,
    OutlookConnectionState,
    OutlookConversionFields,
    OutlookConversionResult,
    OutlookFlagPanelRequest,
    OutlookMeeting,
    OutlookMeetingsResponse,
    OutlookOutOfSyncItem,
    OutlookSyncResponse,
} from '@/m365/types';
import { dismissMeeting, fetchMeetings, postSync, restoreMeeting } from './meetingsApi';
import {
    conversionErrorMessage,
    adjustFlag as postAdjustFlag,
    failedResults,
    flagActionFailure,
    forgetSeries as deleteSeriesAssignment,
    ignoreSeries as postSeriesIgnore,
    keepFlag as postKeepFlag,
    moveEntry as postMoveEntry,
    postConversion,
    unignoreSeries as deleteSeriesIgnore,
    type OutlookConversionBody,
    type OutlookFlagActionResult,
} from './conversionApi';
import { useOutlookSelection, type OutlookSelection } from './useOutlookSelection';
import { ghostLaneWidth } from './ghostLayout';
import { isFaded, isPreassigned, isRecurring } from './suggestions';
import { firstFlag, formatRange } from './syncFlagReason';
import { fillLabel } from './labels';

export interface WeekBucket {
    start: string;
    end: string;
    key: string;
}

// Debounce of range-change syncs and the age under which an automatic sync is skipped (the server
// reuses a sync of the same window younger than 60 s as well; this saves the round trip).
const SYNC_DEBOUNCE_MS = 400;
const AUTO_SYNC_FRESH_MS = 60_000;
const MEETINGS_QUERY_KEY = ['m365', 'meetings'] as const;
// View preference (per browser, not a server setting): show dismissed meetings and restore them.
const SHOW_DISMISSED_STORAGE_KEY = 'solidtime:m365-show-dismissed';
// The Sync button stays unavailable this long after a settled manual sync (a throttled or
// unavailable answer with a larger retry_after wins). Automatic syncs never start it (D-08).
const SYNC_COOLDOWN_MS = 10_000;
// Delay of the meetings refresh that follows time-entry refetches (bursts collapse into one read).
const ENTRIES_REFRESH_DEBOUNCE_MS = 500;
// Meetings per confirm request: mirrors MeetingConversionRequest::MAX_MEETINGS on the server (a
// longer list is sent as several requests, one after the other).
export const MAX_CONFIRM_BATCH = 50;

// Why the Sync button is cooling down: right after a manual sync, or a back-off the server asked for.
export type OutlookCooldownKind = 'manual' | 'backoff';

// What the toolbar controls (injected through a core slot, so not props of the calendar) read.
export interface OutlookMeetingsContext {
    calendar: Readonly<Ref<OutlookCalendarProps | null>>;
    labels: Readonly<Ref<OutlookCalendarLabels | null>>;
    bucket: Readonly<Ref<WeekBucket | null>>;
    meetings: Readonly<Ref<OutlookMeeting[]>>;
    connectionState: Readonly<Ref<OutlookConnectionState | null>>;
    isSyncing: Readonly<Ref<boolean>>;
    lastSync: Readonly<Ref<OutlookSyncResponse | null>>;
    readFailed: Readonly<Ref<boolean>>;
    // Last known last_synced_at of the visible week (read response or latest sync answer).
    syncedAt: Readonly<Ref<string | null>>;
    // "Show dismissed meetings" (remembered in localStorage). Toggling refetches the read with
    // include_dismissed and never triggers a sync.
    includeDismissed: Ref<boolean>;
    // Meetings overlapping the visible range, dismissed ones and occurrences of an ignored series
    // excluded unless they are shown.
    visibleCount: Readonly<Ref<number>>;
    // False while syncing, during the cooldown / retry_after window, or without a connection.
    canSync: Readonly<Ref<boolean>>;
    cooldownUntil: Readonly<Ref<number>>;
    // When the current cooldown started (ms timestamp) and why; the kind is null when none runs.
    cooldownStartedAt: Readonly<Ref<number>>;
    cooldownKind: Readonly<Ref<OutlookCooldownKind | null>>;
    requestSync: (force?: boolean) => void;
    // False in test-hook mode (injected meetings are not server rows): the panel then offers no action.
    // Browser tests opt in with the hook's third argument ({ actions: true }).
    canAct: Readonly<Ref<boolean>>;
    // Ids of the user's time entries created from a meeting (the Outlook icon on entries, D-04): the
    // linked_time_entry_ids of the current read, or the injected list plus the ids converted since
    // in test-hook mode. Empty when absent.
    linkedTimeEntryIds: Readonly<Ref<string[]>>;
    // Optimistic: the meeting leaves the cache at once (or turns into the dismissed variant while
    // dismissed meetings are shown), the request follows.
    dismiss: (id: string) => Promise<void>;
    // Optimistic: the dismissed meeting becomes a regular ghost again at once.
    restore: (id: string) => Promise<void>;
    // Polite live region text of the toolbar controls ("Meeting dismissed").
    announcement: Readonly<Ref<string>>;
    // Says `text` in that live region (cleared first, so the same text is read again).
    announce: (text: string) => void;
    // Converts meetings into time entries (Phase 4). Pessimistic: the meetings leave the cache only
    // after the server answered created or existing for them. Never rejects: a failed request comes
    // back as one failed result per id.
    // An id already in flight makes the call return [] without a request (double activation).
    convert: (ids: string[], fields: OutlookConversionFields) => Promise<OutlookConversionResult[]>;
    // Confirms pre-assigned meetings with their own series assignment (Phase 5, D-03 / D-04):
    // {meeting_ids, use_series_assignment: true}, chunks of MAX_CONFIRM_BATCH sent in order, results
    // merged in request order. Same cache rules as convert; never rejects. Returns [] without a
    // request while the context cannot act or when one of the ids is already in flight.
    confirmPreassigned: (ids: string[]) => Promise<OutlookConversionResult[]>;
    // One-click Confirm of one meeting (hover card, panel, menu): confirmPreassigned plus the
    // feedback (success toast and announcement, or the "Could not confirm" toast with the reason).
    // null when nothing was sent (cannot act, or already pending).
    confirmOne: (id: string) => Promise<OutlookConversionResult | null>;
    // True while a confirm of meeting `id` runs (the block's pending state, the button spinner).
    isConfirmPending: (id: string) => boolean;
    // Pre-assigned meetings overlapping the visible range, not faded (dismissed / series ignored)
    // and not pending, in start order (the "Confirm N" toolbar count and its list, D-04).
    preassignedInRange: Readonly<Ref<OutlookMeeting[]>>;
    // Series actions keyed by any occurrence (D-10, D-11, RULE-04 / RULE-05). Optimistic over every
    // cached occurrence with the same series_key: ignore hides them (or fades them while dismissed
    // meetings are shown), stop ignoring un-fades them, forget drops their pre-assignment. A failure
    // reverts the occurrences and says "Could not update this series". Nothing is sent for a
    // meeting without a series or while the context cannot act.
    ignoreSeries: (id: string) => Promise<void>;
    unignoreSeries: (id: string) => Promise<void>;
    forgetSeries: (id: string) => Promise<void>;
    // Asks the lane that renders meeting `id` to open its panel in form mode (hover card and context
    // menu actions). Each request gets a new seq so the same id can be asked for twice. Ignored while
    // the context cannot act; clears the selection (a panel and a selection never coexist).
    openForm: (id: string) => void;
    formRequest: Readonly<Ref<{ id: string; seq: number } | null>>;
    // Multi-select (D-07). Empty and inert while the context cannot act; cleared on every range
    // change; meetings that leave the list leave the selection.
    selection: OutlookSelection;
    dayOverlayLane: (dayStr: string, isDayView: boolean) => string | null;
    // --- Phase 6: out-of-sync flags (OSYNC-01..03). Every member below is empty and inert while the
    // context cannot act (impersonation, D-14) or the user is disconnected from Microsoft (D-19).
    // The user's flagged entries over the whole flagged window (future plus the last 60 days,
    // D-10/D-11), not only the visible days: the read's out_of_sync.items, or the injected list in
    // test-hook mode.
    outOfSync: Readonly<Ref<OutlookOutOfSyncItem[]>>;
    // The flag of time entry `timeEntryId` (the marker and the context menu item), null when none.
    flagOf: (timeEntryId: string) => OutlookOutOfSyncItem | null;
    // The flag the toolbar counter jumps to: earliest current entry start (D-09).
    firstOutOfSync: Readonly<Ref<OutlookOutOfSyncItem | null>>;
    // Which resolve popover to open and where (one popover for the whole calendar). Each request
    // gets a new seq, so the same entry can be asked for twice.
    flagPanel: Readonly<Ref<OutlookFlagPanelRequest | null>>;
    // Asks for the resolve popover of a flagged entry (marker click, context menu item). Ignored
    // while the context cannot act or for an entry without a flag. Defaults: anchored to the entry,
    // opened from the entry.
    openFlagPanel: (
        timeEntryId: string,
        options?: { anchor?: 'entry' | 'counter'; origin?: 'entry' | 'counter' }
    ) => void;
    closeFlagPanel: () => void;
    // "Keep as is" (D-04, D-16). Pessimistic: the flag leaves the list only after the server
    // answered. ok: invalidations and the "Kept as is" announcement, no toast. failed: the
    // osync_keep_failed toast, the message is for the inline alert. stale (404 / 409): the
    // osync_stale toast, the panel closes and the calendar refreshes. Never rejects.
    keepFlag: (timeEntryId: string) => Promise<OutlookFlagActionResult>;
    // True while a resolve action of entry `timeEntryId` runs (spinner, aria-busy on the block).
    isFlagPending: (timeEntryId: string) => boolean;
    // "Adjust to Outlook" (moved flags). Same rules as keepFlag; ok adds the success toast "Time
    // entry adjusted to Outlook" with the new range and the same announcement; failed toasts
    // osync_adjust_failed with the server's message (overlap included), else forbidden / retry.
    adjustFlag: (timeEntryId: string) => Promise<OutlookFlagActionResult>;
    // "Delete entry", confirmed in the popover (D-05: the only way a flagged entry is deleted).
    // Deletes through the core API, so the meeting link cascades; core's success toast and the
    // "Time entry deleted" announcement. An entry no longer flagged is not deleted (stale).
    deleteFlaggedEntry: (timeEntryId: string) => Promise<OutlookFlagActionResult>;
    // The silent adjust of time entry `timeEntryId` in the last 7 days (D-04, D-12; the origin icon
    // tooltip), null when none.
    autoAdjustedOf: (timeEntryId: string) => OutlookAutoAdjusted | null;
    // "Move my entry here" of a meeting with moved_from (D-03). Pessimistic like the resolve
    // actions: ok removes the meeting from the lane (the moved entry shows at the new slot after
    // the refresh), toasts "Time entry moved here" with the old range and announces "Time entry
    // moved"; failed toasts move_entry_failed; stale toasts osync_stale and refreshes. A call for a
    // meeting whose move runs sends nothing.
    moveEntry: (meetingId: string) => Promise<OutlookFlagActionResult>;
    // True while the move of meeting `meetingId` runs (the block's pending state).
    isMovePending: (meetingId: string) => boolean;
}

export const OUTLOOK_MEETINGS_KEY: InjectionKey<OutlookMeetingsContext> =
    Symbol('outlook-meetings');

// The calendar is read and synced one whole week at a time, so day-to-day navigation inside a week
// causes no extra request. The week starts on the user's week start day (local midnight) and runs
// for 7 days; the strings are UTC instants like the ones the time-entry query sends.
export function weekBucket(start: Dayjs, firstDay: number): WeekBucket {
    const offset = (start.day() - firstDay + 7) % 7;
    const weekStart = start.subtract(offset, 'day').startOf('day');
    const weekEnd = weekStart.add(7, 'day');
    const startUtc = localDateToUtc(weekStart);

    return { start: startUtc, end: localDateToUtc(weekEnd), key: startUtc };
}

interface SyncRequest {
    bucket: WeekBucket;
    force: boolean;
}

// Third argument of the test hook. Without it (or with actions false) the injected meetings are
// display only, as before. With actions true they can be selected and converted: conversions post to
// convertUrl (the hook itself never contacts the server, and the endpoint stays authenticated), a
// converted meeting leaves the injected list and its entry id joins linkedTimeEntryIds. Series
// actions (Phase 5) request `${seriesUrl}/{id}/series/...` and update the injected list; without
// seriesUrl they send nothing.
// Phase 6: outOfSync and autoAdjusted play the read's flags and silent adjusts. Keep and adjust
// post to `${outOfSyncUrl}/{entryId}/keep|adjust`, the move to `${moveEntryUrl}/{id}/move-entry`
// (each sends nothing without its url); delete uses the core API. A successful keep, adjust or
// delete removes the flag from the injected list, a successful move removes the meeting.
export interface OutlookTestHookOptions {
    actions?: boolean;
    convertUrl?: string;
    seriesUrl?: string;
    linkedTimeEntryIds?: string[];
    outOfSync?: OutlookOutOfSyncItem[];
    autoAdjusted?: OutlookAutoAdjusted[];
    outOfSyncUrl?: string;
    moveEntryUrl?: string;
}

type TestHook = (
    meetings: OutlookMeeting[],
    labels?: Partial<OutlookCalendarLabels>,
    options?: OutlookTestHookOptions
) => void;

// Test hook on window while the composable is mounted (same contract as
// __TEST_SET_ACTIVITY_PERIODS__): a no-op in production unless test code calls it.
interface TestWindow {
    __TEST_SET_OUTLOOK_MEETINGS__?: TestHook;
}

function parseRetryAfterHeader(error: unknown): number | null {
    const headers = (error as { response?: { headers?: Record<string, unknown> } } | null)?.response
        ?.headers;
    const raw = headers?.['retry-after'];
    if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
        return Number(raw.trim());
    }
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
        return raw;
    }
    return null;
}

export function useOutlookMeetings(
    calendarStart: Ref<Dayjs | undefined>,
    calendarEnd: Ref<Dayjs | undefined>
): OutlookMeetingsContext {
    const page = usePage<{ microsoft?: MicrosoftSharedProps }>();
    const queryClient = useQueryClient();

    const calendar = computed<OutlookCalendarProps | null>(() => {
        const microsoft = page.props.microsoft;
        if (!microsoft || microsoft.enabled !== true) return null;
        return microsoft.calendar ?? null;
    });

    const includeDismissed = useLocalStorage(SHOW_DISMISSED_STORAGE_KEY, false);

    // The flag is part of the key, so a toggle reads the other variant without touching the sync.
    function meetingsKey(start: string | null, include: boolean) {
        return [...MEETINGS_QUERY_KEY, start, include] as const;
    }

    const testMeetings = ref<OutlookMeeting[] | null>(null);
    const testLabels = ref<Partial<OutlookCalendarLabels> | null>(null);
    const testActions = ref(false);
    const testConvertUrl = ref<string | null>(null);
    const testSeriesUrl = ref<string | null>(null);
    const testLinkedIds = ref<string[]>([]);
    // Phase 6 hook state: the injected flags (null outside test-hook mode) and the action urls.
    const testOutOfSync = ref<OutlookOutOfSyncItem[] | null>(null);
    const testOutOfSyncUrl = ref<string | null>(null);
    const testAutoAdjusted = ref<OutlookAutoAdjusted[]>([]);
    const testMoveEntryUrl = ref<string | null>(null);

    const lastSync = ref<OutlookSyncResponse | null>(null);
    const isSyncing = ref(false);

    // A sync that answers reconnect or not_connected is authoritative and sticks for the rest of the
    // page life (so the Sync control disappears without a reload); a transport or session failure
    // (unavailable) never changes the connection state.
    const stickyState = ref<OutlookConnectionState | null>(null);
    const connectionState = computed<OutlookConnectionState | null>(() => {
        if (!calendar.value) return null;
        return stickyState.value ?? calendar.value.state;
    });

    // last_synced_at of the latest sync answer, tied to the bucket it was for.
    const syncAnswerAt = ref<{ key: string; at: string } | null>(null);

    // Cooldown of the manual Sync (ms timestamp). `now` is advanced by a single timeout so that
    // canSync re-evaluates exactly when the cooldown ends.
    const cooldownUntil = ref(0);
    const cooldownStartedAt = ref(0);
    const cooldownKind = ref<OutlookCooldownKind | null>(null);
    const now = ref(Date.now());
    let cooldownTimer: ReturnType<typeof setTimeout> | undefined;
    let unmounted = false;

    function cooldownTick(): void {
        cooldownTimer = undefined;
        now.value = Date.now();
        if (now.value >= cooldownUntil.value) {
            cooldownKind.value = null;
            return;
        }
        if (!unmounted) {
            cooldownTimer = setTimeout(cooldownTick, cooldownUntil.value - now.value);
        }
    }

    // Start and kind only change when the cooldown actually moves forward, so a shorter request
    // during a running cooldown neither restarts the ring nor relabels it.
    function extendCooldown(ms: number, kind: OutlookCooldownKind): void {
        if (unmounted) return;
        const startedAt = Date.now();
        const until = startedAt + ms;
        if (until > cooldownUntil.value) {
            cooldownUntil.value = until;
            cooldownStartedAt.value = startedAt;
            cooldownKind.value = kind;
        }
        now.value = Date.now();
        if (cooldownTimer !== undefined) clearTimeout(cooldownTimer);
        cooldownTimer = setTimeout(cooldownTick, Math.max(0, cooldownUntil.value - now.value));
    }

    // calendarEnd is only used to know that the calendar has reported a range; the bucket itself
    // comes from the start (week or day view both sit inside one bucket).
    const bucket = computed<WeekBucket | null>(() => {
        if (!calendarStart.value || !calendarEnd.value) return null;
        return weekBucket(calendarStart.value, getWeekStartDayNumber());
    });

    const meetingsQuery = useQuery<OutlookMeetingsResponse>({
        queryKey: computed(() => meetingsKey(bucket.value?.start ?? null, includeDismissed.value)),
        enabled: computed(
            () =>
                calendar.value !== null &&
                connectionState.value !== 'not_connected' &&
                bucket.value !== null
        ),
        queryFn: () =>
            fetchMeetings(
                calendar.value!.urls.meetings,
                { start: bucket.value!.start, end: bucket.value!.end },
                { include_dismissed: includeDismissed.value }
            ),
        retry: false,
        refetchOnWindowFocus: false,
        placeholderData: (previousData) => previousData,
        staleTime: 30_000,
    });

    const syncMutation = useMutation({
        mutationFn: (variables: SyncRequest) =>
            postSync(calendar.value!.urls.sync, {
                start: variables.bucket.start,
                end: variables.bucket.end,
                force: variables.force,
            }),
        retry: false,
        onSettled: () => queryClient.invalidateQueries({ queryKey: MEETINGS_QUERY_KEY }),
    });

    // Occurrences of an ignored series are hidden like dismissed meetings unless those are shown (the
    // server leaves them out of a read without include_dismissed; this covers the optimistic window
    // and injected meetings).
    const meetings = computed<OutlookMeeting[]>(() => {
        const list = testMeetings.value ?? meetingsQuery.data.value?.data ?? [];
        if (includeDismissed.value || !list.some((meeting) => meeting.series_ignored === true)) {
            return list;
        }
        return list.filter((meeting) => meeting.series_ignored !== true);
    });

    // Placeholder data of the previous week is kept like the meetings: the ids name entries, so a
    // stale id only matters for an entry that is not on screen.
    const linkedTimeEntryIds = computed<string[]>(() =>
        testMeetings.value !== null
            ? testLinkedIds.value
            : (meetingsQuery.data.value?.linked_time_entry_ids ?? [])
    );

    const labels = computed<OutlookCalendarLabels | null>(() => {
        if (testLabels.value) {
            return { ...calendar.value?.labels, ...testLabels.value } as OutlookCalendarLabels;
        }
        return calendar.value?.labels ?? null;
    });

    // True when the cached read of the bucket failed (meetings keep the last good data).
    const readFailed = computed(() => meetingsQuery.isError.value);

    // A read response of the previous bucket (placeholder data) says nothing about this one.
    const syncedAt = computed<string | null>(() => {
        const fromRead = meetingsQuery.isPlaceholderData.value
            ? null
            : (meetingsQuery.data.value?.sync?.last_synced_at ?? null);
        const answer = syncAnswerAt.value;
        const fromAnswer = answer && answer.key === bucket.value?.key ? answer.at : null;
        if (fromRead && fromAnswer) {
            return new Date(fromAnswer).getTime() >= new Date(fromRead).getTime()
                ? fromAnswer
                : fromRead;
        }
        return fromAnswer ?? fromRead;
    });

    // Overlap with the visible range [start, end) of the calendar (the week or the day); a
    // zero-length meeting counts when it starts inside the range.
    function inVisibleRange(meeting: OutlookMeeting): boolean {
        const start = calendarStart.value;
        const end = calendarEnd.value;
        if (!start || !end) return false;
        const from = getLocalizedDayJs(meeting.start);
        const to = getLocalizedDayJs(meeting.end);
        return to.isAfter(from)
            ? from.isBefore(end) && to.isAfter(start)
            : !from.isBefore(start) && from.isBefore(end);
    }

    // Dismissed meetings and occurrences of an ignored series are excluded unless they are shown;
    // the status line shows "no meetings" from this count.
    const visibleCount = computed(
        () =>
            meetings.value.filter(
                (meeting) =>
                    (includeDismissed.value || !isFaded(meeting)) && inVisibleRange(meeting)
            ).length
    );

    const canSync = computed(
        () =>
            calendar.value !== null &&
            connectionState.value === 'connected' &&
            !isSyncing.value &&
            now.value >= cooldownUntil.value
    );

    // A read that reports a retry_after (the server is backing off) disables Sync until then.
    watch(
        () => meetingsQuery.dataUpdatedAt.value,
        () => {
            const retry = meetingsQuery.data.value?.sync?.retry_after;
            if (!meetingsQuery.isPlaceholderData.value && typeof retry === 'number' && retry > 0) {
                extendCooldown(retry * 1000, 'backoff');
            }
        }
    );

    // Debounced, single-flight sync. Only the latest desired bucket is remembered; while a sync is
    // in flight a newer request waits and runs once after it settles (latest wins).
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: SyncRequest | null = null;
    let inFlight = false;

    // Reads `pending` through a function: TypeScript does not track the assignments other calls make
    // while a sync is awaited.
    function queuedRequest(): SyncRequest | null {
        return pending;
    }

    function syncAllowed(): boolean {
        return calendar.value !== null && connectionState.value === 'connected';
    }

    function isBucketFresh(target: WeekBucket): boolean {
        // Both variants of the read (with and without dismissed meetings) carry the same sync time
        const syncedAt = queryClient
            .getQueriesData<OutlookMeetingsResponse>({
                queryKey: [...MEETINGS_QUERY_KEY, target.start],
            })
            .map(([, data]) => data?.sync?.last_synced_at ?? null)
            .filter((at): at is string => at !== null)
            .sort()
            .pop();
        if (!syncedAt) return false;
        const age = Date.now() - new Date(syncedAt).getTime();
        return age >= 0 && age < AUTO_SYNC_FRESH_MS;
    }

    async function runPending(): Promise<void> {
        timer = undefined;
        if (unmounted || inFlight || !pending) return;

        const target = pending;
        pending = null;
        if (!syncAllowed()) return;
        if (!target.force && isBucketFresh(target.bucket)) return;

        inFlight = true;
        isSyncing.value = true;
        try {
            const answer = await syncMutation.mutateAsync(target);
            lastSync.value = answer;
            if (answer.last_synced_at) {
                syncAnswerAt.value = { key: target.bucket.key, at: answer.last_synced_at };
            }
            if (answer.status === 'reconnect' || answer.status === 'not_connected') {
                stickyState.value = answer.status;
            }
        } catch (error) {
            // Transport, app 5xx, session expiry (401/419) and the route-level 429 all mean "Outlook
            // unavailable": the cached ghosts stay and nothing is retried. A 401/419 is a solidtime
            // session problem, so it is never mapped to a Microsoft reconnect.
            lastSync.value = {
                status: 'unavailable',
                retry_after: parseRetryAfterHeader(error),
                last_synced_at:
                    lastSync.value?.last_synced_at ??
                    meetingsQuery.data.value?.sync?.last_synced_at ??
                    null,
                truncated: false,
            };
        } finally {
            inFlight = false;
            isSyncing.value = false;
        }

        // Only a manual sync (target.force, also when a click was merged into a queued automatic
        // request) or a back-off starts the cooldown; an automatic navigation sync never does, so
        // Sync is available again as soon as it settles (D-08). The back-off is the retry_after of
        // a throttled or unavailable answer, including the synthetic unavailable answer of a 429
        // with a Retry-After header; the longer of the two wins.
        const settled = lastSync.value;
        const backoff =
            settled && (settled.status === 'throttled' || settled.status === 'unavailable')
                ? (settled.retry_after ?? 0) * 1000
                : 0;
        const manual = target.force ? SYNC_COOLDOWN_MS : 0;
        const cooldown = Math.max(manual, backoff);
        if (cooldown > 0) {
            extendCooldown(cooldown, backoff > manual ? 'backoff' : 'manual');
        }

        // Latest wins: run a queued request only if it targets another bucket (or is forced), and
        // leave it to the debounce timer when one is already counting down.
        const queued = queuedRequest();
        if (queued !== null && timer === undefined) {
            if (queued.bucket.key !== target.bucket.key || queued.force) {
                void runPending();
            } else {
                pending = null;
            }
        }
    }

    function requestSync(force = false): void {
        if (unmounted || !bucket.value || !syncAllowed()) return;
        // A manual sync during the cooldown, a back-off or another sync is ignored.
        if (force && !canSync.value) return;

        pending = { bucket: bucket.value, force: force || (pending?.force ?? false) };
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => void runPending(), force ? 0 : SYNC_DEBOUNCE_MS);
    }

    watch(
        () => bucket.value?.key,
        (key) => {
            if (key) requestSync(false);
        },
        { immediate: true }
    );

    // Injected meetings can act only when the test asked for it; the CI calendar has no microsoft
    // calendar prop (integration off), so that case does not depend on it.
    const canAct = computed(() =>
        testMeetings.value !== null ? testActions.value : calendar.value !== null
    );

    // --- Multi-select (D-07): the methods are wrapped so nothing can be selected while !canAct.
    const baseSelection = useOutlookSelection();
    const selection: OutlookSelection = {
        ...baseSelection,
        toggle: (id) => {
            if (canAct.value) baseSelection.toggle(id);
        },
        selectRange: (id, candidates) => {
            if (canAct.value) baseSelection.selectRange(id, candidates);
        },
    };

    watch(canAct, (value) => {
        if (!value) baseSelection.clear();
    });

    // A meeting gone after a sync, a conversion or a dismiss drops out of the selection silently.
    watch(meetings, (list) => {
        const present = new Set(list.map((meeting) => meeting.id));
        baseSelection.remove(baseSelection.selectedIds.value.filter((id) => !present.has(id)));
    });

    // Week or day navigation and view changes clear the selection.
    watch(
        () => [calendarStart.value?.valueOf(), calendarEnd.value?.valueOf()],
        ([start, end], [oldStart, oldEnd]) => {
            if (start !== oldStart || end !== oldEnd) baseSelection.clear();
        }
    );

    // --- Form channel: another surface asks the lane to open a meeting's panel in form mode.
    const formRequest = ref<{ id: string; seq: number } | null>(null);
    let formSeq = 0;

    function openForm(id: string): void {
        if (!canAct.value) return;
        baseSelection.clear();
        formSeq += 1;
        formRequest.value = { id, seq: formSeq };
    }

    // Text of the polite live region in the toolbar controls (screen readers only).
    const announcement = ref('');

    // Clearing first makes the region change even when the same text is announced twice in a row.
    function announce(text: string): void {
        announcement.value = '';
        void nextTick(() => {
            announcement.value = text;
        });
    }

    // Optimistic: the cache changes before the request is sent (synchronously, so the caller can
    // move focus right after a tick). A dismiss removes the meeting, or flags it while dismissed
    // meetings are shown; a restore clears the flag. A failure puts the previous state of that one
    // meeting back and says so through the notification store; a success is silent apart from the
    // screen reader line.
    async function changeDismissal(id: string, dismissed: boolean): Promise<void> {
        const url = calendar.value?.urls.meetings;
        const current = labels.value;
        if (!url || !bucket.value || !current) return;

        const key = meetingsKey(bucket.value.start, includeDismissed.value);
        // Stops an in-flight read of this week from overwriting the optimistic change
        void queryClient.cancelQueries({ queryKey: key });
        const before = queryClient
            .getQueryData<OutlookMeetingsResponse>(key)
            ?.data.find((meeting) => meeting.id === id);
        const keep = !dismissed || includeDismissed.value;
        queryClient.setQueryData<OutlookMeetingsResponse>(key, (old) => {
            if (!old) return old;
            return {
                ...old,
                data: keep
                    ? old.data.map((meeting) =>
                          meeting.id === id ? { ...meeting, dismissed } : meeting
                      )
                    : old.data.filter((meeting) => meeting.id !== id),
            };
        });

        try {
            if (dismissed) {
                await dismissMeeting(url, id);
                announce(current.dismissed_announcement);
            } else {
                await restoreMeeting(url, id);
                announce(current.restored_announcement);
            }
        } catch {
            if (before) {
                queryClient.setQueryData<OutlookMeetingsResponse>(key, (old) => {
                    if (!old) return old;
                    return old.data.some((meeting) => meeting.id === id)
                        ? {
                              ...old,
                              data: old.data.map((meeting) =>
                                  meeting.id === id ? before : meeting
                              ),
                          }
                        : { ...old, data: [...old.data, before] };
                });
            }
            useNotificationsStore().addNotification(
                'error',
                dismissed ? current.dismiss_failed : current.restore_failed,
                current.retry_body
            );
        }
        await queryClient.invalidateQueries({ queryKey: MEETINGS_QUERY_KEY });
    }

    const dismiss = (id: string): Promise<void> => changeDismissal(id, true);
    const restore = (id: string): Promise<void> => changeDismissal(id, false);

    const convertsInFlight = new Set<string>();
    // Ids of the confirms that run (reactive: blocks and buttons show their pending state).
    const pendingConfirmIds = ref<string[]>([]);

    function isConfirmPending(id: string): boolean {
        return pendingConfirmIds.value.includes(id);
    }

    const preassignedInRange = computed<OutlookMeeting[]>(() =>
        meetings.value
            .filter(
                (meeting) =>
                    isPreassigned(meeting) &&
                    !isConfirmPending(meeting.id) &&
                    inVisibleRange(meeting)
            )
            .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    );

    // --- Series actions (Phase 5). The request is keyed by the meeting the user acted on; the
    // optimistic change covers every occurrence with the same series_key in every cached read
    // (each week, with and without dismissed meetings) or in the injected list.
    type SeriesAction = 'ignore' | 'unignore' | 'forget';

    function findMeeting(id: string): OutlookMeeting | null {
        if (testMeetings.value !== null) {
            return testMeetings.value.find((meeting) => meeting.id === id) ?? null;
        }
        for (const [, data] of queryClient.getQueriesData<OutlookMeetingsResponse>({
            queryKey: MEETINGS_QUERY_KEY,
        })) {
            const found = data?.data?.find((meeting) => meeting.id === id);
            if (found) return found;
        }
        return null;
    }

    // `include` is whether the list is a read with dismissed meetings (an ignored occurrence stays
    // there, flagged; a regular read drops it).
    function applySeriesAction(
        list: OutlookMeeting[],
        seriesKey: string,
        action: SeriesAction,
        include: boolean
    ): OutlookMeeting[] {
        const inSeries = (meeting: OutlookMeeting) => meeting.series_key === seriesKey;
        if (action === 'ignore' && !include) {
            return list.filter((meeting) => !inSeries(meeting));
        }
        return list.map((meeting) => {
            if (!inSeries(meeting)) return meeting;
            if (action === 'forget') return { ...meeting, assignment: null };
            return { ...meeting, series_ignored: action === 'ignore' };
        });
    }

    // Puts the series' occurrences of `before` back into `current`, in their previous order; other
    // meetings keep their current state (a conversion or dismiss meanwhile is not undone).
    function revertSeries(
        current: OutlookMeeting[],
        before: OutlookMeeting[],
        seriesKey: string
    ): OutlookMeeting[] {
        const currentById = new Map(current.map((meeting) => [meeting.id, meeting]));
        const known = new Set(before.map((meeting) => meeting.id));
        const restored = before.flatMap((meeting) => {
            if (meeting.series_key === seriesKey) return [meeting];
            const now = currentById.get(meeting.id);
            return now ? [now] : [];
        });
        return [...restored, ...current.filter((meeting) => !known.has(meeting.id))];
    }

    function isIncludeKey(key: readonly unknown[]): boolean {
        return key[3] === true;
    }

    async function changeSeries(id: string, action: SeriesAction): Promise<void> {
        const current = labels.value;
        if (!canAct.value || !current) return;
        const injected = testMeetings.value !== null;
        const url = injected ? testSeriesUrl.value : (calendar.value?.urls.meetings ?? null);
        const target = findMeeting(id);
        if (!url || !target || !isRecurring(target)) return;
        const seriesKey = target.series_key as string;

        let revert: () => void;
        if (injected) {
            const before = testMeetings.value ?? [];
            testMeetings.value = applySeriesAction(before, seriesKey, action, true);
            revert = () => {
                if (testMeetings.value !== null) {
                    testMeetings.value = revertSeries(testMeetings.value, before, seriesKey);
                }
            };
        } else {
            // Stops in-flight reads from overwriting the optimistic change
            void queryClient.cancelQueries({ queryKey: MEETINGS_QUERY_KEY });
            const snapshot = queryClient.getQueriesData<OutlookMeetingsResponse>({
                queryKey: MEETINGS_QUERY_KEY,
            });
            for (const [key, data] of snapshot) {
                if (!data || !Array.isArray(data.data)) continue;
                queryClient.setQueryData<OutlookMeetingsResponse>(key, {
                    ...data,
                    data: applySeriesAction(data.data, seriesKey, action, isIncludeKey(key)),
                });
            }
            revert = () => {
                for (const [key, before] of snapshot) {
                    if (!before || !Array.isArray(before.data)) continue;
                    queryClient.setQueryData<OutlookMeetingsResponse>(key, (old) =>
                        old && Array.isArray(old.data)
                            ? { ...old, data: revertSeries(old.data, before.data, seriesKey) }
                            : old
                    );
                }
            };
        }

        try {
            if (action === 'ignore') {
                await postSeriesIgnore(url, id);
                useNotificationsStore().addNotification(
                    'success',
                    current.series_ignored,
                    current.series_ignored_help
                );
                announce(current.series_ignored);
            } else if (action === 'unignore') {
                await deleteSeriesIgnore(url, id);
                announce(current.series_unignored);
            } else {
                await deleteSeriesAssignment(url, id);
                useNotificationsStore().addNotification(
                    'success',
                    current.series_forgotten,
                    current.series_forgotten_help
                );
                announce(current.series_forgotten);
            }
        } catch {
            revert();
            useNotificationsStore().addNotification(
                'error',
                current.series_action_failed,
                current.retry_body
            );
        }
        if (!injected) await queryClient.invalidateQueries({ queryKey: MEETINGS_QUERY_KEY });
    }

    const ignoreSeries = (id: string): Promise<void> => changeSeries(id, 'ignore');
    const unignoreSeries = (id: string): Promise<void> => changeSeries(id, 'unignore');
    const forgetSeries = (id: string): Promise<void> => changeSeries(id, 'forget');

    function withLinked(list: string[], entryIds: string[]): string[] {
        const added = entryIds.filter((id) => !list.includes(id));
        return added.length > 0 ? [...list, ...added] : list;
    }

    // Every cached read (each week, with and without dismissed meetings) loses the given meetings
    // and lists the new entry ids as linked (the refetch confirms both).
    function removeFromCache(ids: string[], entryIds: string[]): void {
        if (ids.length === 0) return;
        const gone = new Set(ids);
        queryClient.setQueriesData<OutlookMeetingsResponse>(
            { queryKey: MEETINGS_QUERY_KEY },
            (old) => {
                if (!old || !Array.isArray(old.data)) return old;
                return {
                    ...old,
                    data: old.data.filter((meeting) => !gone.has(meeting.id)),
                    linked_time_entry_ids: withLinked(old.linked_time_entry_ids ?? [], entryIds),
                };
            }
        );
    }

    // Test-hook mode: the injected list plays the cache (the real reads are left alone).
    function removeFromInjected(ids: string[], entryIds: string[]): void {
        const gone = new Set(ids);
        if (testMeetings.value !== null) {
            testMeetings.value = testMeetings.value.filter((meeting) => !gone.has(meeting.id));
        }
        testLinkedIds.value = withLinked(testLinkedIds.value, entryIds);
    }

    // A second activation for a meeting whose conversion still runs sends nothing (ASGN-03 client
    // side; the server's unique link is the real guard).
    function claim(ids: string[]): boolean {
        if (ids.some((id) => convertsInFlight.has(id))) return false;
        ids.forEach((id) => convertsInFlight.add(id));
        return true;
    }

    function release(ids: string[]): void {
        ids.forEach((id) => convertsInFlight.delete(id));
    }

    // Posts one conversion request (the caller claimed the ids). Pessimistic: the meetings leave the
    // cache (or the injected list) only after the server answered created or existing for them.
    async function send(
        url: string,
        body: OutlookConversionBody,
        fallback: string
    ): Promise<{ results: OutlookConversionResult[]; done: string[] }> {
        const injected = testMeetings.value !== null;
        let results: OutlookConversionResult[];
        try {
            results = await postConversion(url, body);
        } catch (error) {
            return {
                results: failedResults(body.meeting_ids, conversionErrorMessage(error, fallback)),
                done: [],
            };
        }

        const succeeded = results.filter(
            (result) => result.status === 'created' || result.status === 'existing'
        );
        const done = succeeded.map((result) => result.meeting_id);
        const entryIds = succeeded
            .map((result) => result.time_entry_id)
            .filter((id): id is string => id !== null);
        if (done.length > 0) {
            if (injected) {
                removeFromInjected(done, entryIds);
            } else {
                void queryClient.cancelQueries({ queryKey: MEETINGS_QUERY_KEY });
                removeFromCache(done, entryIds);
            }
            baseSelection.remove(done);
            void queryClient.invalidateQueries({ queryKey: ['timeEntries'] });
            void queryClient.invalidateQueries({ queryKey: ['goals'] });
            if (!injected) void queryClient.invalidateQueries({ queryKey: MEETINGS_QUERY_KEY });
        }
        return { results, done };
    }

    function convertUrl(): string | null {
        const url =
            testMeetings.value !== null ? testConvertUrl.value : calendar.value?.urls.convert;
        return url ?? null;
    }

    async function convert(
        ids: string[],
        fields: OutlookConversionFields
    ): Promise<OutlookConversionResult[]> {
        const url = convertUrl();
        const current = labels.value;
        const fallback = current?.error_generic ?? '';
        if (!url || !current || ids.length === 0) return failedResults(ids, fallback);
        if (!claim(ids)) return [];

        try {
            const { results, done } = await send(url, { meeting_ids: ids, ...fields }, fallback);
            if (done.length > 0 && ids.length === 1) announce(current.created_announcement);
            return results;
        } finally {
            release(ids);
        }
    }

    async function confirmPreassigned(ids: string[]): Promise<OutlookConversionResult[]> {
        if (!canAct.value || ids.length === 0) return [];
        const url = convertUrl();
        const current = labels.value;
        const fallback = current?.error_generic ?? '';
        if (!url || !current) return failedResults(ids, fallback);
        if (!claim(ids)) return [];

        pendingConfirmIds.value = [...pendingConfirmIds.value, ...ids];
        const results: OutlookConversionResult[] = [];
        for (let index = 0; index < ids.length; index += MAX_CONFIRM_BATCH) {
            const chunk = ids.slice(index, index + MAX_CONFIRM_BATCH);
            try {
                const answer = await send(
                    url,
                    { meeting_ids: chunk, use_series_assignment: true },
                    fallback
                );
                results.push(...answer.results);
            } finally {
                // A chunk's meetings stop being pending as soon as their own request settled.
                release(chunk);
                const settled = new Set(chunk);
                pendingConfirmIds.value = pendingConfirmIds.value.filter((id) => !settled.has(id));
            }
        }
        return results;
    }

    async function confirmOne(id: string): Promise<OutlookConversionResult | null> {
        const current = labels.value;
        if (!canAct.value || !current) return null;
        const [result] = await confirmPreassigned([id]);
        if (!result) return null;

        if (result.status === 'created' || result.status === 'existing') {
            useNotificationsStore().addNotification('success', current.created_success);
            announce(current.created_announcement);
        } else {
            useNotificationsStore().addNotification(
                'error',
                current.confirm_failed,
                result.error?.message || current.error_generic
            );
        }
        return result;
    }

    // Core time-entry mutations (create, edit, move, delete, bulk) only invalidate ['timeEntries'] and
    // ['goals']. Deleting an entry created from a meeting must bring the meeting back without a
    // reload (ASGN-05), so a successful refetch of an already loaded time-entries query refreshes the
    // meetings read once, debounced: drags and bulk edits fire bursts and the read is throttled at
    // 60 per minute. The first load of a week (dataUpdateCount 1, navigation), failed fetches and
    // direct cache writes (setQueryData) never trigger it; injected test meetings are not server rows.
    let entriesRefreshTimer: ReturnType<typeof setTimeout> | undefined;

    function refreshAllowed(): boolean {
        return !unmounted && calendar.value !== null && testMeetings.value === null;
    }

    const unsubscribeEntries = queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'success') return;
        if (event.action.manual === true) return;
        if (event.query.queryKey[0] !== 'timeEntries') return;
        if (event.query.state.dataUpdateCount < 2 || !refreshAllowed()) return;

        if (entriesRefreshTimer !== undefined) clearTimeout(entriesRefreshTimer);
        entriesRefreshTimer = setTimeout(() => {
            entriesRefreshTimer = undefined;
            if (refreshAllowed()) {
                void queryClient.invalidateQueries({ queryKey: MEETINGS_QUERY_KEY });
            }
        }, ENTRIES_REFRESH_DEBOUNCE_MS);
    });

    // Local days that hold at least one meeting get the reserved Outlook lane (D-23). The overlap is
    // half-open like the ghost layout: a zero-length meeting belongs to the day containing it.
    function dayOverlayLane(dayStr: string, isDayView: boolean): string | null {
        const list = meetings.value;
        if (list.length === 0) return null;

        const dayStart = getLocalizedDayJsFromMinutes(dayStr, 0);
        const dayEnd = getLocalizedDayJsFromMinutes(dayStr, 1440);
        for (const meeting of list) {
            const start = getLocalizedDayJs(meeting.start);
            const end = getLocalizedDayJs(meeting.end);
            const overlaps = end.isAfter(start)
                ? start.isBefore(dayEnd) && end.isAfter(dayStart)
                : !start.isBefore(dayStart) && start.isBefore(dayEnd);
            if (overlaps) return ghostLaneWidth(isDayView);
        }
        return null;
    }

    // --- Out-of-sync flags (Phase 6). The flags are owner-only data: hidden and inert while the
    // context cannot act (impersonation, D-14) and while the user is disconnected (D-19); injected
    // flags follow canAct alone (the CI calendar has no connection state).
    const flagsVisible = computed(
        () =>
            canAct.value &&
            (testMeetings.value !== null || connectionState.value !== 'not_connected')
    );

    // Placeholder data of the previous week is kept like the linked ids: the list covers the whole
    // flagged window, so it does not depend on the week anyway.
    const outOfSync = computed<OutlookOutOfSyncItem[]>(() => {
        if (!flagsVisible.value) return [];
        if (testMeetings.value !== null) return testOutOfSync.value ?? [];
        return meetingsQuery.data.value?.out_of_sync?.items ?? [];
    });

    const flagsById = computed(
        () => new Map(outOfSync.value.map((item) => [item.time_entry_id, item]))
    );

    function flagOf(timeEntryId: string): OutlookOutOfSyncItem | null {
        return flagsById.value.get(timeEntryId) ?? null;
    }

    const firstOutOfSync = computed<OutlookOutOfSyncItem | null>(() => firstFlag(outOfSync.value));

    // Silent adjusts of the last 7 days (D-04, D-12), owner-only like the flags.
    const autoAdjustedById = computed(() => {
        if (!flagsVisible.value) return new Map<string, OutlookAutoAdjusted>();
        const list =
            testMeetings.value !== null
                ? testAutoAdjusted.value
                : (meetingsQuery.data.value?.auto_adjusted ?? []);
        return new Map(list.map((item) => [item.time_entry_id, item]));
    });

    function autoAdjustedOf(timeEntryId: string): OutlookAutoAdjusted | null {
        return autoAdjustedById.value.get(timeEntryId) ?? null;
    }

    // --- Resolve popover request: one popover for the whole calendar, opened by the marker, the
    // context menu or the counter jump.
    const flagPanel = ref<OutlookFlagPanelRequest | null>(null);
    let flagPanelSeq = 0;

    function requestFlagPanel(
        timeEntryId: string,
        anchor: OutlookFlagPanelRequest['anchor'],
        origin: OutlookFlagPanelRequest['origin']
    ): void {
        flagPanelSeq += 1;
        flagPanel.value = { timeEntryId, anchor, origin, seq: flagPanelSeq };
    }

    function openFlagPanel(
        timeEntryId: string,
        options: { anchor?: 'entry' | 'counter'; origin?: 'entry' | 'counter' } = {}
    ): void {
        if (!flagsVisible.value || flagOf(timeEntryId) === null) return;
        requestFlagPanel(timeEntryId, options.anchor ?? 'entry', options.origin ?? 'entry');
    }

    function closeFlagPanel(): void {
        flagPanel.value = null;
    }

    // Losing the right to act (or the connection) closes the popover with the flags.
    watch(flagsVisible, (visible) => {
        if (!visible) flagPanel.value = null;
    });

    // --- Resolve actions (keep, adjust, delete). Pessimistic: nothing changes before the answer.
    type FlagAction = 'keep' | 'adjust' | 'delete';

    // Entry ids whose resolve action runs (reactive: buttons and blocks show their pending state).
    const pendingFlagIds = ref<string[]>([]);

    function isFlagPending(timeEntryId: string): boolean {
        return pendingFlagIds.value.includes(timeEntryId);
    }

    function outOfSyncUrl(): string | null {
        const url =
            testMeetings.value !== null ? testOutOfSyncUrl.value : calendar.value?.urls.out_of_sync;
        return url ?? null;
    }

    // After a success the flag leaves every cached read (or the injected list) at once; the
    // invalidated read confirms it.
    function dropFlag(timeEntryId: string): void {
        if (testMeetings.value !== null) {
            if (testOutOfSync.value !== null) {
                testOutOfSync.value = testOutOfSync.value.filter(
                    (item) => item.time_entry_id !== timeEntryId
                );
            }
            return;
        }
        queryClient.setQueriesData<OutlookMeetingsResponse>(
            { queryKey: MEETINGS_QUERY_KEY },
            (old) => {
                const items = old?.out_of_sync?.items;
                if (!old || !Array.isArray(items)) return old;
                return {
                    ...old,
                    out_of_sync: {
                        items: items.filter((item) => item.time_entry_id !== timeEntryId),
                    },
                };
            }
        );
    }

    // Time entries, goals and the meetings read (with its flags and counter) after an entry write
    // or a stale answer. Injected meetings are not server rows: the real read is left alone.
    function refreshAfterEntryWrite(): void {
        void queryClient.invalidateQueries({ queryKey: ['timeEntries'] });
        void queryClient.invalidateQueries({ queryKey: ['goals'] });
        if (testMeetings.value === null) {
            void queryClient.invalidateQueries({ queryKey: MEETINGS_QUERY_KEY });
        }
    }

    // 404 / 409: the flag was resolved, the entry deleted or changed in another tab. The calendar
    // refreshes and the user is told why (UI-SPEC section 2).
    function handleStale(current: OutlookCalendarLabels): void {
        useNotificationsStore().addNotification(
            'error',
            current.osync_stale,
            current.osync_stale_body
        );
        refreshAfterEntryWrite();
    }

    function closePanelOf(timeEntryId: string): void {
        if (flagPanel.value?.timeEntryId === timeEntryId) flagPanel.value = null;
    }

    // The organization's 12/24-hour format for the toast ranges, from the organization query the
    // calendar page already runs (24 hours until it has loaded).
    function currentTimeFormat(organizationId: string | null): TimeFormat {
        if (!organizationId) return '24-hours';
        const cached = queryClient.getQueryData<{ data?: { time_format?: TimeFormat } }>([
            'organization',
            organizationId,
        ]);
        return cached?.data?.time_format ?? '24-hours';
    }

    // The session user's current organization; null when the page carries no user (never thrown:
    // the actions then fail like any other request).
    function currentOrganizationId(): string | null {
        try {
            return getCurrentOrganizationId() ?? null;
        } catch {
            return null;
        }
    }

    // Core delete through the generated client (the core mutation helper swallows failures after
    // its own toast, and this flow needs the status to tell a stale entry from a failure).
    async function deleteCoreEntry(organizationId: string, timeEntryId: string): Promise<void> {
        await api.deleteTimeEntry(undefined, {
            params: { organization: organizationId, timeEntry: timeEntryId },
        });
    }

    const FAILED_TITLE = {
        keep: 'osync_keep_failed',
        adjust: 'osync_adjust_failed',
        delete: 'osync_delete_failed',
    } as const satisfies Record<FlagAction, keyof OutlookCalendarLabels>;

    async function runFlagAction(
        timeEntryId: string,
        action: FlagAction
    ): Promise<OutlookFlagActionResult> {
        const current = labels.value;
        const retry = current?.retry_body ?? '';
        if (!flagsVisible.value || !current) return { status: 'failed', message: retry };
        // A second activation while the first runs sends nothing (an empty message: no alert).
        if (isFlagPending(timeEntryId)) return { status: 'failed', message: '' };
        const url = outOfSyncUrl();
        const organizationId = currentOrganizationId();
        if (action === 'delete' ? !organizationId : !url) {
            return { status: 'failed', message: retry };
        }
        const item = flagOf(timeEntryId);
        // The core delete knows nothing about flags: an entry whose flag is gone (resolved in
        // another tab, cleared by Outlook) is never deleted from here (D-05).
        if (action === 'delete' && item === null) {
            closePanelOf(timeEntryId);
            handleStale(current);
            return { status: 'stale' };
        }

        pendingFlagIds.value = [...pendingFlagIds.value, timeEntryId];
        try {
            if (action === 'keep') await postKeepFlag(url as string, timeEntryId);
            else if (action === 'adjust') await postAdjustFlag(url as string, timeEntryId);
            else await deleteCoreEntry(organizationId as string, timeEntryId);
        } catch (error) {
            const failure = flagActionFailure(error, {
                forbidden: current.osync_error_forbidden,
                retry,
            });
            if (failure.status === 'stale') {
                closePanelOf(timeEntryId);
                handleStale(current);
            } else if (failure.status === 'failed') {
                useNotificationsStore().addNotification(
                    'error',
                    current[FAILED_TITLE[action]],
                    failure.message
                );
            }
            return failure;
        } finally {
            pendingFlagIds.value = pendingFlagIds.value.filter((id) => id !== timeEntryId);
        }

        dropFlag(timeEntryId);
        closePanelOf(timeEntryId);
        refreshAfterEntryWrite();
        const notifications = useNotificationsStore();
        if (action === 'keep') {
            announce(current.osync_kept);
        } else if (action === 'adjust') {
            // The entry now has the meeting's new times: the toast names that range.
            const range =
                item?.new_start && item.new_end
                    ? formatRange(item.new_start, item.new_end, {
                          full: true,
                          timeFormat: currentTimeFormat(organizationId),
                          allDay: item.all_day,
                      })
                    : undefined;
            notifications.addNotification('success', current.osync_adjusted, range);
            announce(current.osync_adjusted);
        } else {
            // Core's own copy, as the core delete shows it.
            notifications.addNotification('success', 'Time entry deleted successfully');
            announce(current.osync_deleted_announcement);
        }
        return { status: 'ok' };
    }

    const keepFlag = (timeEntryId: string): Promise<OutlookFlagActionResult> =>
        runFlagAction(timeEntryId, 'keep');
    const adjustFlag = (timeEntryId: string): Promise<OutlookFlagActionResult> =>
        runFlagAction(timeEntryId, 'adjust');
    const deleteFlaggedEntry = (timeEntryId: string): Promise<OutlookFlagActionResult> =>
        runFlagAction(timeEntryId, 'delete');

    // --- D-03 move: the entry logged for a started meeting's earlier slot moves onto its new slot.
    // Meeting ids whose move runs (the block's pending state, the panel button spinner).
    const pendingMoveIds = ref<string[]>([]);

    function isMovePending(meetingId: string): boolean {
        return pendingMoveIds.value.includes(meetingId);
    }

    function moveEntryUrl(): string | null {
        const url =
            testMeetings.value !== null
                ? testMoveEntryUrl.value
                : calendar.value?.urls.organization_meetings;
        return url ?? null;
    }

    async function moveEntry(meetingId: string): Promise<OutlookFlagActionResult> {
        const current = labels.value;
        const retry = current?.retry_body ?? '';
        if (!canAct.value || !current) return { status: 'failed', message: retry };
        if (isMovePending(meetingId)) return { status: 'failed', message: '' };
        const url = moveEntryUrl();
        if (!url) return { status: 'failed', message: retry };
        const movedFrom = findMeeting(meetingId)?.moved_from ?? null;

        pendingMoveIds.value = [...pendingMoveIds.value, meetingId];
        try {
            await postMoveEntry(url, meetingId);
        } catch (error) {
            const failure = flagActionFailure(error, {
                forbidden: current.osync_error_forbidden,
                retry,
            });
            if (failure.status === 'stale') {
                handleStale(current);
            } else if (failure.status === 'failed') {
                useNotificationsStore().addNotification(
                    'error',
                    current.move_entry_failed,
                    failure.message
                );
            }
            return failure;
        } finally {
            pendingMoveIds.value = pendingMoveIds.value.filter((id) => id !== meetingId);
        }

        // The meeting is linked now: it leaves the lane at once, and the moved entry stays linked.
        const entryIds = movedFrom ? [movedFrom.time_entry_id] : [];
        if (testMeetings.value !== null) {
            removeFromInjected([meetingId], entryIds);
        } else {
            void queryClient.cancelQueries({ queryKey: MEETINGS_QUERY_KEY });
            removeFromCache([meetingId], entryIds);
        }
        baseSelection.remove([meetingId]);
        refreshAfterEntryWrite();
        // The toast names where the entry came from (its old range is no longer on screen).
        const from = movedFrom
            ? fillLabel(current.move_entry_from, {
                  when: formatRange(movedFrom.entry_start, movedFrom.entry_end, {
                      full: true,
                      timeFormat: currentTimeFormat(currentOrganizationId()),
                  }),
              })
            : undefined;
        useNotificationsStore().addNotification('success', current.move_entry_success, from);
        announce(current.move_entry_announcement);
        return { status: 'ok' };
    }

    // The outcome of a Connect / Reconnect that returned to the calendar (flashed by the server, so
    // it is in the props for exactly one page load) goes through the existing notification store.
    // The store is only touched when there is something to say.
    onMounted(() => {
        const notice = calendar.value?.notice;
        if (notice) {
            useNotificationsStore().addNotification(notice.level, notice.message);
        }
    });

    onMounted(() => {
        (window as unknown as TestWindow).__TEST_SET_OUTLOOK_MEETINGS__ = (
            injected,
            injectedLabels,
            options
        ) => {
            testMeetings.value = injected;
            testLabels.value = injectedLabels ?? null;
            testActions.value = options?.actions === true;
            testConvertUrl.value = options?.convertUrl ?? null;
            testSeriesUrl.value = options?.seriesUrl ?? null;
            testLinkedIds.value = [...(options?.linkedTimeEntryIds ?? [])];
            testOutOfSync.value = [...(options?.outOfSync ?? [])];
            testAutoAdjusted.value = [...(options?.autoAdjusted ?? [])];
            testOutOfSyncUrl.value = options?.outOfSyncUrl ?? null;
            testMoveEntryUrl.value = options?.moveEntryUrl ?? null;
        };
    });

    onUnmounted(() => {
        unmounted = true;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        if (cooldownTimer !== undefined) clearTimeout(cooldownTimer);
        cooldownTimer = undefined;
        pending = null;
        unsubscribeEntries();
        if (entriesRefreshTimer !== undefined) clearTimeout(entriesRefreshTimer);
        entriesRefreshTimer = undefined;
        delete (window as unknown as TestWindow).__TEST_SET_OUTLOOK_MEETINGS__;
    });

    const context: OutlookMeetingsContext = {
        calendar,
        labels,
        bucket,
        meetings,
        connectionState,
        isSyncing,
        lastSync,
        readFailed,
        syncedAt,
        includeDismissed,
        visibleCount,
        canSync,
        cooldownUntil,
        cooldownStartedAt,
        cooldownKind,
        requestSync,
        canAct,
        linkedTimeEntryIds,
        dismiss,
        restore,
        announcement,
        announce,
        convert,
        confirmPreassigned,
        confirmOne,
        isConfirmPending,
        preassignedInRange,
        ignoreSeries,
        unignoreSeries,
        forgetSeries,
        openForm,
        formRequest,
        selection,
        dayOverlayLane,
        outOfSync,
        flagOf,
        firstOutOfSync,
        flagPanel,
        openFlagPanel,
        closeFlagPanel,
        keepFlag,
        isFlagPending,
        adjustFlag,
        deleteFlaggedEntry,
        autoAdjustedOf,
        moveEntry,
        isMovePending,
    };

    // The toolbar controls are rendered through core slots and inject this instead of taking props.
    provide(OUTLOOK_MEETINGS_KEY, context);

    return context;
}
