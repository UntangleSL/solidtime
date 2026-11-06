import {
    computed,
    onMounted,
    onUnmounted,
    provide,
    ref,
    watch,
    type InjectionKey,
    type Ref,
} from 'vue';
import { usePage } from '@inertiajs/vue3';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { Dayjs } from 'dayjs';
import {
    getLocalizedDayJs,
    getLocalizedDayJsFromMinutes,
    localDateToUtc,
} from '@/packages/ui/src/utils/time';
import { getWeekStartDayNumber } from '@/packages/ui/src/utils/settings';
import { useNotificationsStore } from '@/utils/notification';
import type {
    MicrosoftSharedProps,
    OutlookCalendarLabels,
    OutlookCalendarProps,
    OutlookConnectionState,
    OutlookMeeting,
    OutlookMeetingsResponse,
    OutlookSyncResponse,
} from '@/m365/types';
import { fetchMeetings, postSync } from './meetingsApi';
import { ghostLaneWidth } from './ghostLayout';

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
// The Sync button stays disabled this long after every settled sync (a throttled or unavailable
// answer with a larger retry_after wins).
const SYNC_COOLDOWN_MS = 10_000;

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
    // Meetings overlapping the visible range, dismissed ones excluded.
    visibleCount: Readonly<Ref<number>>;
    // False while syncing, during the cooldown / retry_after window, or without a connection.
    canSync: Readonly<Ref<boolean>>;
    cooldownUntil: Readonly<Ref<number>>;
    requestSync: (force?: boolean) => void;
    dayOverlayLane: (dayStr: string, isDayView: boolean) => string | null;
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

type TestHook = (meetings: OutlookMeeting[], labels?: Partial<OutlookCalendarLabels>) => void;

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

    const testMeetings = ref<OutlookMeeting[] | null>(null);
    const testLabels = ref<Partial<OutlookCalendarLabels> | null>(null);

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
    const now = ref(Date.now());
    let cooldownTimer: ReturnType<typeof setTimeout> | undefined;
    let unmounted = false;

    function cooldownTick(): void {
        cooldownTimer = undefined;
        now.value = Date.now();
        if (!unmounted && now.value < cooldownUntil.value) {
            cooldownTimer = setTimeout(cooldownTick, cooldownUntil.value - now.value);
        }
    }

    function extendCooldown(ms: number): void {
        if (unmounted) return;
        const until = Date.now() + ms;
        if (until > cooldownUntil.value) cooldownUntil.value = until;
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
        queryKey: computed(() => [...MEETINGS_QUERY_KEY, bucket.value?.start ?? null]),
        enabled: computed(
            () =>
                calendar.value !== null &&
                connectionState.value !== 'not_connected' &&
                bucket.value !== null
        ),
        queryFn: () =>
            fetchMeetings(calendar.value!.urls.meetings, {
                start: bucket.value!.start,
                end: bucket.value!.end,
            }),
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

    const meetings = computed<OutlookMeeting[]>(
        () => testMeetings.value ?? meetingsQuery.data.value?.data ?? []
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

    // Overlap with the visible range [start, end) of the calendar (the week or the day), dismissed
    // meetings excluded; the status line shows "no meetings" from this count.
    const visibleCount = computed(() => {
        const start = calendarStart.value;
        const end = calendarEnd.value;
        if (!start || !end) return 0;
        return meetings.value.filter((meeting) => {
            if (meeting.dismissed) return false;
            const from = getLocalizedDayJs(meeting.start);
            const to = getLocalizedDayJs(meeting.end);
            return to.isAfter(from)
                ? from.isBefore(end) && to.isAfter(start)
                : !from.isBefore(start) && from.isBefore(end);
        }).length;
    });

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
                extendCooldown(retry * 1000);
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
        const cached = queryClient.getQueryData<OutlookMeetingsResponse>([
            ...MEETINGS_QUERY_KEY,
            target.start,
        ]);
        const syncedAt = cached?.sync?.last_synced_at;
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

        // Every settled sync starts the cooldown, including the synthetic unavailable answer of a
        // rejected request; a back-off the server (or a 429 Retry-After header) asked for wins.
        const settled = lastSync.value;
        const backoff =
            settled && (settled.status === 'throttled' || settled.status === 'unavailable')
                ? (settled.retry_after ?? 0) * 1000
                : 0;
        extendCooldown(Math.max(SYNC_COOLDOWN_MS, backoff));

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
            injectedLabels
        ) => {
            testMeetings.value = injected;
            testLabels.value = injectedLabels ?? null;
        };
    });

    onUnmounted(() => {
        unmounted = true;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        if (cooldownTimer !== undefined) clearTimeout(cooldownTimer);
        cooldownTimer = undefined;
        pending = null;
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
        visibleCount,
        canSync,
        cooldownUntil,
        requestSync,
        dayOverlayLane,
    };

    // The toolbar controls are rendered through core slots and inject this instead of taking props.
    provide(OUTLOOK_MEETINGS_KEY, context);

    return context;
}
