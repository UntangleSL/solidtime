import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import { usePage } from '@inertiajs/vue3';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { Dayjs } from 'dayjs';
import {
    getLocalizedDayJs,
    getLocalizedDayJsFromMinutes,
    localDateToUtc,
} from '@/packages/ui/src/utils/time';
import { getWeekStartDayNumber } from '@/packages/ui/src/utils/settings';
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
) {
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

    // A sync that answers reconnect or not_connected is authoritative; a transport or session
    // failure (unavailable) never changes the connection state.
    const connectionState = computed<OutlookConnectionState | null>(() => {
        if (!calendar.value) return null;
        if (lastSync.value?.status === 'reconnect') return 'reconnect';
        if (lastSync.value?.status === 'not_connected') return 'not_connected';
        return calendar.value.state;
    });

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

    // Debounced, single-flight sync. Only the latest desired bucket is remembered; while a sync is
    // in flight a newer request waits and runs once after it settles (latest wins).
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: SyncRequest | null = null;
    let inFlight = false;
    let unmounted = false;

    // Reads `pending` through a function: TypeScript does not track the assignments other calls make
    // while a sync is awaited.
    function queuedRequest(): SyncRequest | null {
        return pending;
    }

    function canSync(): boolean {
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
        if (!canSync()) return;
        if (!target.force && isBucketFresh(target.bucket)) return;

        inFlight = true;
        isSyncing.value = true;
        try {
            lastSync.value = await syncMutation.mutateAsync(target);
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
        if (unmounted || !bucket.value || !canSync()) return;

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
        pending = null;
        delete (window as unknown as TestWindow).__TEST_SET_OUTLOOK_MEETINGS__;
    });

    return {
        calendar,
        labels,
        bucket,
        meetings,
        connectionState,
        isSyncing,
        lastSync,
        readFailed,
        requestSync,
        dayOverlayLane,
    };
}
