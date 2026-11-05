import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import axios from 'axios';
import type { Dayjs } from 'dayjs';
import { getLocalizedDayJs } from '@/packages/ui/src/utils/time';
import type {
    OutlookCalendarLabels,
    OutlookCalendarProps,
    OutlookConnectionState,
    OutlookMeeting,
    OutlookMeetingsResponse,
    OutlookSyncResponse,
} from '@/m365/types';
import { useOutlookMeetings, weekBucket } from './useOutlookMeetings';

const { pageProps } = vi.hoisted(() => ({ pageProps: {} as Record<string, unknown> }));

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => ({ props: pageProps }),
}));

vi.mock('axios', () => ({
    default: { get: vi.fn(), post: vi.fn() },
}));

const axiosGet = vi.mocked(axios.get);
const axiosPost = vi.mocked(axios.post);

const MEETINGS_URL = 'https://app.example.test/m365/meetings';
const SYNC_URL = 'https://app.example.test/m365/meetings/sync';

// Mondays (the test setup uses week start monday and timezone UTC)
const WEEK_A = '2026-11-02T00:00:00Z';
const WEEK_B = '2026-11-09T00:00:00Z';
const WEEK_C = '2026-11-16T00:00:00Z';

function meeting(id: string, start: string, end: string): OutlookMeeting {
    return {
        id,
        subject: `Meeting ${id}`,
        start,
        end,
        organizer_name: 'Org',
        is_organizer: false,
        is_online_meeting: false,
        web_link: null,
        dismissed: false,
    };
}

function calendarProps(state: OutlookConnectionState): OutlookCalendarProps {
    return {
        state,
        urls: { meetings: MEETINGS_URL, sync: SYNC_URL },
        labels: { no_subject: '(No subject)', last_synced: 'Last synced :time' } as never,
    };
}

function setPage(state: OutlookConnectionState | null): void {
    pageProps.microsoft =
        state === null
            ? undefined
            : {
                  enabled: true,
                  login_url: 'https://app.example.test/auth/microsoft/redirect',
                  labels: { sign_in: 'Sign in', sign_in_hint: 'Hint' },
                  calendar: calendarProps(state),
              };
}

function readResponse(
    meetings: OutlookMeeting[] = [],
    lastSyncedAt: string | null = null
): { data: OutlookMeetingsResponse } {
    return { data: { data: meetings, sync: { last_synced_at: lastSyncedAt, retry_after: null } } };
}

function syncResponse(overrides: Partial<OutlookSyncResponse> = {}): { data: OutlookSyncResponse } {
    return {
        data: {
            status: 'ok',
            retry_after: null,
            last_synced_at: '2026-11-05T10:00:00Z',
            truncated: false,
            ...overrides,
        },
    };
}

function httpError(status: number, headers: Record<string, string> = {}): Error {
    return Object.assign(new Error(`HTTP ${status}`), { response: { status, headers } });
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

type Api = ReturnType<typeof useOutlookMeetings>;

interface Mounted {
    api: Api;
    start: Ref<Dayjs | undefined>;
    end: Ref<Dayjs | undefined>;
    wrapper: VueWrapper;
    queryClient: QueryClient;
}

function weekStartOf(isoMonday: string): Dayjs {
    return getLocalizedDayJs(isoMonday);
}

function mountComposable(initialStart: string | null = WEEK_A): Mounted {
    const start = ref<Dayjs | undefined>(initialStart ? weekStartOf(initialStart) : undefined);
    const end = ref<Dayjs | undefined>(
        initialStart ? weekStartOf(initialStart).add(7, 'day') : undefined
    );
    const queryClient = new QueryClient();
    let api!: Api;
    const Harness = defineComponent({
        setup() {
            api = useOutlookMeetings(start, end);
            return () => h('div');
        },
    });
    const wrapper = mount(Harness, {
        global: { plugins: [[VueQueryPlugin, { queryClient }]] },
    });
    return { api, start, end, wrapper, queryClient };
}

async function advance(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
}

async function goTo(mounted: Mounted, isoMonday: string): Promise<void> {
    mounted.start.value = weekStartOf(isoMonday);
    mounted.end.value = weekStartOf(isoMonday).add(7, 'day');
    await nextTick();
}

function postStarts(): string[] {
    return axiosPost.mock.calls.map((call) => (call[1] as { start: string }).start);
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
    axiosGet.mockReset();
    axiosPost.mockReset();
    axiosGet.mockResolvedValue(readResponse());
    axiosPost.mockResolvedValue(syncResponse());
    setPage('connected');
});

afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as Record<string, unknown>).__TEST_SET_OUTLOOK_MEETINGS__;
});

describe('weekBucket', () => {
    it('quantizes any day to the containing week (monday start)', () => {
        const bucket = weekBucket(getLocalizedDayJs('2026-11-05T15:30:00Z'), 1);

        expect(bucket).toEqual({ start: WEEK_A, end: WEEK_B, key: WEEK_A });
    });

    it('honours a sunday week start and maps day view to its week', () => {
        const week = weekBucket(getLocalizedDayJs('2026-11-01T00:00:00Z'), 0);
        const wednesday = weekBucket(getLocalizedDayJs('2026-11-04T00:00:00Z'), 0);

        expect(week.start).toBe('2026-11-01T00:00:00Z');
        expect(week.end).toBe('2026-11-08T00:00:00Z');
        expect(wednesday).toEqual(week);
    });

    it('keeps local midnights across the DST change in Europe/Madrid', () => {
        vi.mocked(window.getTimezoneSetting).mockReturnValue('Europe/Madrid');
        try {
            // Week of Mon 2026-10-19 to Mon 2026-10-26 spans the 25 October change
            const bucket = weekBucket(getLocalizedDayJs('2026-10-21T10:00:00Z'), 1);

            expect(bucket.start).toBe('2026-10-18T22:00:00Z');
            expect(bucket.end).toBe('2026-10-25T23:00:00Z');
        } finally {
            vi.mocked(window.getTimezoneSetting).mockReturnValue('UTC');
        }
    });
});

describe('useOutlookMeetings', () => {
    it('reads first and syncs 400 ms later', async () => {
        const mounted = mountComposable();

        await advance(0);
        expect(axiosGet).toHaveBeenCalledTimes(1);
        expect(axiosGet).toHaveBeenCalledWith(MEETINGS_URL, {
            params: { start: WEEK_A, end: WEEK_B },
        });
        expect(axiosPost).not.toHaveBeenCalled();

        await advance(399);
        expect(axiosPost).not.toHaveBeenCalled();

        await advance(1);
        expect(axiosPost).toHaveBeenCalledTimes(1);
        expect(axiosPost).toHaveBeenCalledWith(SYNC_URL, {
            start: WEEK_A,
            end: WEEK_B,
            force: false,
        });
        mounted.wrapper.unmount();
    });

    it('debounces rapid bucket changes', async () => {
        const mounted = mountComposable();

        await advance(100);
        await goTo(mounted, WEEK_B);
        await advance(100);
        await goTo(mounted, WEEK_C);
        await advance(399);
        expect(axiosPost).not.toHaveBeenCalled();
        await advance(1);

        expect(postStarts()).toEqual([WEEK_C]);
        mounted.wrapper.unmount();
    });

    it('queues only the latest bucket while a sync is in flight', async () => {
        const first = deferred<{ data: OutlookSyncResponse }>();
        axiosPost.mockReturnValueOnce(first.promise);
        const mounted = mountComposable();

        await advance(400);
        expect(postStarts()).toEqual([WEEK_A]);
        expect(mounted.api.isSyncing.value).toBe(true);

        await goTo(mounted, WEEK_B);
        await advance(100);
        await goTo(mounted, WEEK_C);
        await advance(500);
        expect(postStarts()).toEqual([WEEK_A]);

        first.resolve(syncResponse());
        await advance(0);
        await advance(0);

        expect(postStarts()).toEqual([WEEK_A, WEEK_C]);
        expect(postStarts()).not.toContain(WEEK_B);
        mounted.wrapper.unmount();
    });

    it('never refetches on focus and never retries', async () => {
        const mounted = mountComposable();
        await advance(400);
        await advance(0);
        const getsAfterSync = axiosGet.mock.calls.length;
        const postsAfterSync = axiosPost.mock.calls.length;

        // Past the 30 s staleTime, so a focus refetch would fire if it were enabled
        await advance(31_000);
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('visibilitychange'));
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
        await advance(5000);

        expect(axiosGet).toHaveBeenCalledTimes(getsAfterSync);
        expect(axiosPost).toHaveBeenCalledTimes(postsAfterSync);
        mounted.wrapper.unmount();

        // A failing read is attempted once, never retried
        setPage('reconnect');
        axiosGet.mockReset();
        axiosGet.mockRejectedValue(httpError(500));
        const failing = mountComposable();
        await advance(10000);

        expect(axiosGet).toHaveBeenCalledTimes(1);
        expect(failing.api.readFailed.value).toBe(true);
        failing.wrapper.unmount();
    });

    it('respects the connection state', async () => {
        setPage('not_connected');
        const notConnected = mountComposable();
        await advance(2000);

        expect(axiosGet).not.toHaveBeenCalled();
        expect(axiosPost).not.toHaveBeenCalled();
        notConnected.wrapper.unmount();

        setPage('reconnect');
        const reconnect = mountComposable();
        await advance(2000);

        expect(axiosGet).toHaveBeenCalledTimes(1);
        expect(axiosPost).not.toHaveBeenCalled();
        reconnect.wrapper.unmount();
    });

    it('does nothing without the calendar prop', async () => {
        setPage(null);
        const mounted = mountComposable();
        await advance(2000);

        expect(axiosGet).not.toHaveBeenCalled();
        expect(axiosPost).not.toHaveBeenCalled();
        expect(mounted.api.calendar.value).toBeNull();
        expect(mounted.api.labels.value).toBeNull();
        expect(mounted.api.meetings.value).toEqual([]);
        mounted.wrapper.unmount();
    });

    it('invalidates the read after a sync', async () => {
        const mounted = mountComposable();
        await advance(0);
        expect(axiosGet).toHaveBeenCalledTimes(1);

        await advance(400);
        await advance(0);

        expect(axiosPost).toHaveBeenCalledTimes(1);
        expect(axiosGet).toHaveBeenCalledTimes(2);
        mounted.wrapper.unmount();
    });

    it('skips an auto sync for a fresh bucket', async () => {
        axiosGet.mockResolvedValue(readResponse([], new Date(Date.now() - 10_000).toISOString()));
        const mounted = mountComposable();

        await advance(2000);

        expect(axiosGet).toHaveBeenCalledTimes(1);
        expect(axiosPost).not.toHaveBeenCalled();
        mounted.wrapper.unmount();
    });

    it('syncs a stale bucket and a forced request even when fresh', async () => {
        axiosGet.mockResolvedValue(readResponse([], new Date(Date.now() - 90_000).toISOString()));
        const stale = mountComposable();
        await advance(400);
        expect(axiosPost).toHaveBeenCalledTimes(1);
        stale.wrapper.unmount();

        axiosPost.mockClear();
        axiosGet.mockResolvedValue(readResponse([], new Date(Date.now() - 5_000).toISOString()));
        const fresh = mountComposable();
        await advance(400);
        expect(axiosPost).not.toHaveBeenCalled();

        fresh.api.requestSync(true);
        await advance(0);

        expect(axiosPost).toHaveBeenCalledTimes(1);
        expect(axiosPost).toHaveBeenCalledWith(SYNC_URL, {
            start: WEEK_A,
            end: WEEK_B,
            force: true,
        });
        fresh.wrapper.unmount();
    });

    it('test hook injects meetings and labels', async () => {
        setPage(null);
        const mounted = mountComposable();
        await advance(0);
        const hook = (window as unknown as Record<string, unknown>)
            .__TEST_SET_OUTLOOK_MEETINGS__ as (
            meetings: OutlookMeeting[],
            labels?: Partial<OutlookCalendarLabels>
        ) => void;
        expect(typeof hook).toBe('function');
        const injected = [meeting('t1', '2026-11-05T09:00:00Z', '2026-11-05T10:00:00Z')];

        hook(injected, { no_subject: '(No subject)', layer_label: 'Outlook meetings, :day' });
        await nextTick();

        expect(mounted.api.meetings.value).toEqual(injected);
        expect(mounted.api.labels.value?.no_subject).toBe('(No subject)');
        expect(mounted.api.labels.value?.layer_label).toBe('Outlook meetings, :day');
        expect(mounted.api.dayOverlayLane('2026-11-05', false)).toBe('max(16px, 30%)');
        expect(mounted.api.dayOverlayLane('2026-11-05', true)).toBe('min(240px, 25%)');
        expect(mounted.api.dayOverlayLane('2026-11-06', false)).toBeNull();
        expect(axiosGet).not.toHaveBeenCalled();

        mounted.wrapper.unmount();

        expect(
            (window as unknown as Record<string, unknown>).__TEST_SET_OUTLOOK_MEETINGS__
        ).toBeUndefined();
    });

    it('gives only days with a meeting the lane (overnight meetings cover both days)', async () => {
        setPage(null);
        const mounted = mountComposable();
        await advance(0);
        const hook = (window as unknown as Record<string, unknown>)
            .__TEST_SET_OUTLOOK_MEETINGS__ as (meetings: OutlookMeeting[]) => void;

        hook([
            meeting('night', '2026-11-04T23:00:00Z', '2026-11-05T01:00:00Z'),
            meeting('point', '2026-11-07T12:00:00Z', '2026-11-07T12:00:00Z'),
        ]);
        await nextTick();
        const lane = (day: string) => mounted.api.dayOverlayLane(day, false);

        expect(lane('2026-11-03')).toBeNull();
        expect(lane('2026-11-04')).not.toBeNull();
        expect(lane('2026-11-05')).not.toBeNull();
        expect(lane('2026-11-06')).toBeNull();
        expect(lane('2026-11-07')).not.toBeNull();
        mounted.wrapper.unmount();
    });

    it('treats a missing retry_after as null', async () => {
        axiosPost.mockResolvedValue({
            data: { status: 'ok', last_synced_at: '2026-11-05T10:00:00Z', truncated: false },
        });
        const mounted = mountComposable();

        await advance(400);
        await advance(0);

        expect(mounted.api.lastSync.value?.status).toBe('ok');
        expect(mounted.api.lastSync.value?.retry_after).toBeNull();
        mounted.wrapper.unmount();
    });

    it('maps transport and app failures to unavailable', async () => {
        const failures: { error: Error; retryAfter: number | null }[] = [
            { error: new Error('Network Error'), retryAfter: null },
            { error: httpError(500), retryAfter: null },
            { error: httpError(401), retryAfter: null },
            { error: httpError(419), retryAfter: null },
            { error: httpError(429, { 'retry-after': '12' }), retryAfter: 12 },
        ];

        for (const { error, retryAfter } of failures) {
            axiosGet.mockReset();
            axiosPost.mockReset();
            const cached = [meeting('cached', '2026-11-03T09:00:00Z', '2026-11-03T10:00:00Z')];
            // The first read serves the cache; the read after the failed sync fails as well
            axiosGet
                .mockResolvedValueOnce(readResponse(cached, '2026-11-05T09:00:00Z'))
                .mockRejectedValue(httpError(500));
            axiosPost.mockRejectedValue(error);
            const mounted = mountComposable();

            await advance(0);
            expect(mounted.api.meetings.value).toEqual(cached);
            await advance(400);
            await advance(0);
            await advance(5000);

            expect(axiosPost).toHaveBeenCalledTimes(1);
            expect(mounted.api.lastSync.value).toEqual({
                status: 'unavailable',
                retry_after: retryAfter,
                last_synced_at: '2026-11-05T09:00:00Z',
                truncated: false,
            });
            expect(mounted.api.isSyncing.value).toBe(false);
            expect(mounted.api.meetings.value).toEqual(cached);
            expect(mounted.api.readFailed.value).toBe(true);
            expect(mounted.api.connectionState.value).toBe('connected');
            expect(axiosGet).toHaveBeenCalledTimes(2);
            mounted.wrapper.unmount();
        }
    });

    it('lets a sync answer reconnect switch the state and stops further syncs', async () => {
        axiosPost.mockResolvedValue(syncResponse({ status: 'reconnect' }));
        const mounted = mountComposable();

        await advance(400);
        await advance(0);
        expect(mounted.api.connectionState.value).toBe('reconnect');

        await goTo(mounted, WEEK_B);
        await advance(1000);

        expect(axiosPost).toHaveBeenCalledTimes(1);
        mounted.wrapper.unmount();
    });

    it('stops the pending timer on unmount', async () => {
        const mounted = mountComposable();
        await advance(100);

        mounted.wrapper.unmount();
        await advance(2000);

        expect(axiosPost).not.toHaveBeenCalled();
    });
});
