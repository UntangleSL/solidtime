import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, watch, type Ref } from 'vue';
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
    OutlookOutOfSyncItem,
    OutlookSyncResponse,
} from '@/m365/types';
import { OUTLOOK_MEETINGS_KEY, useOutlookMeetings, weekBucket } from './useOutlookMeetings';
import { ghostLaneWidth } from './ghostLayout';

const { pageProps, addNotification, deleteTimeEntry, organization } = vi.hoisted(() => ({
    pageProps: {} as Record<string, unknown>,
    addNotification: vi.fn(),
    deleteTimeEntry: vi.fn(),
    organization: { id: 'org-1' as string | undefined },
}));

vi.mock('@/utils/notification', () => ({ useNotificationsStore: () => ({ addNotification }) }));

// Core delete (Phase 6): the generated client and the current organization.
vi.mock('@/packages/api/src', () => ({ api: { deleteTimeEntry } }));
vi.mock('@/utils/useUser', () => ({ getCurrentOrganizationId: () => organization.id }));

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => ({ props: pageProps }),
}));

vi.mock('axios', () => ({
    default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const axiosGet = vi.mocked(axios.get);
const axiosPost = vi.mocked(axios.post);
const axiosDelete = vi.mocked(axios.delete);

const MEETINGS_URL = 'https://app.example.test/m365/meetings';
const SYNC_URL = 'https://app.example.test/m365/meetings/sync';
const CONVERT_URL = 'https://app.example.test/m365/organizations/org-1/meetings/time-entries';
const OSYNC_URL = 'https://app.example.test/m365/out-of-sync';
const ORG_MEETINGS_URL = 'https://app.example.test/m365/organizations/org-1/meetings';

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
        urls: {
            meetings: MEETINGS_URL,
            sync: SYNC_URL,
            convert: CONVERT_URL,
            out_of_sync: OSYNC_URL,
            organization_meetings: ORG_MEETINGS_URL,
        },
        connect_url:
            'https://app.example.test/auth/microsoft/redirect?intent=connect&return=calendar',
        notice: null,
        labels: {
            no_subject: '(No subject)',
            last_synced: 'Last synced :time',
            dismiss_failed: 'Could not dismiss this meeting',
            retry_body: 'Try again in a moment.',
            dismissed_announcement: 'Meeting dismissed',
            restore_failed: 'Could not restore this meeting',
            restored_announcement: 'Meeting restored',
            created_announcement: 'Time entry created',
            error_generic: 'Could not create the time entry. Try again in a moment.',
            created_success: 'Time entry created successfully',
            confirm_failed: 'Could not confirm this meeting',
            series_ignored: 'Series ignored',
            series_ignored_help:
                'Its meetings are hidden. Turn on Show dismissed meetings to undo.',
            series_unignored: 'Series no longer ignored',
            series_forgotten: 'Series forgotten',
            series_forgotten_help:
                'Its meetings are no longer pre-assigned. Your time entries are unchanged.',
            series_action_failed: 'Could not update this series',
            osync_kept: 'Kept as is',
            osync_keep_failed: 'Could not save your choice',
            osync_adjusted: 'Time entry adjusted to Outlook',
            osync_adjust_failed: 'Could not adjust the time entry',
            osync_deleted_announcement: 'Time entry deleted',
            osync_delete_failed: 'Could not delete the time entry',
            osync_stale: 'This entry changed in the meantime',
            osync_stale_body: 'The calendar was refreshed.',
            osync_error_forbidden: "You can't edit this time entry.",
            move_entry_success: 'Time entry moved here',
            move_entry_from: 'From :when',
            move_entry_announcement: 'Time entry moved',
            move_entry_failed: 'Could not move the time entry',
            auto_adjusted_one: '1 time entry updated from Outlook',
            auto_adjusted_many: ':count time entries updated from Outlook',
        } as never,
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
    axiosDelete.mockReset();
    addNotification.mockReset();
    deleteTimeEntry.mockReset();
    deleteTimeEntry.mockResolvedValue(undefined);
    organization.id = 'org-1';
    localStorage.clear();
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
        expect(mounted.api.dayOverlayLane('2026-11-05', false)).toBe(ghostLaneWidth(false));
        expect(mounted.api.dayOverlayLane('2026-11-05', true)).toBe(ghostLaneWidth(true));
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

describe('useOutlookMeetings sync control state', () => {
    // A read of the current week that is fresh enough to skip the automatic sync
    function freshRead(retryAfter: number | null = null): { data: OutlookMeetingsResponse } {
        return {
            data: {
                data: [],
                sync: {
                    last_synced_at: new Date(Date.now() - 5_000).toISOString(),
                    retry_after: retryAfter,
                },
            },
        };
    }

    it('provides the context to descendants under OUTLOOK_MEETINGS_KEY', async () => {
        axiosGet.mockResolvedValue(freshRead());
        const mounted = mountComposable();

        // What a descendant's inject(OUTLOOK_MEETINGS_KEY) resolves to
        const provides = (mounted.wrapper.vm as unknown as { $: { provides: object } }).$.provides;
        expect(Reflect.get(provides, OUTLOOK_MEETINGS_KEY)).toBe(mounted.api);
        mounted.wrapper.unmount();
    });

    it('is disabled for 10 s after a settled sync and ignores a forced sync meanwhile', async () => {
        axiosGet.mockResolvedValue(freshRead());
        const mounted = mountComposable();
        await advance(0);
        expect(mounted.api.canSync.value).toBe(true);

        mounted.api.requestSync(true);
        await advance(0);
        await advance(0);
        expect(axiosPost).toHaveBeenCalledTimes(1);
        expect(mounted.api.canSync.value).toBe(false);

        mounted.api.requestSync(true);
        await advance(5_000);
        expect(axiosPost).toHaveBeenCalledTimes(1);

        await advance(5_000);
        expect(mounted.api.canSync.value).toBe(true);
        mounted.wrapper.unmount();
    });

    it('is not available while a sync is in flight', async () => {
        axiosGet.mockResolvedValue(freshRead());
        const first = deferred<{ data: OutlookSyncResponse }>();
        axiosPost.mockReturnValueOnce(first.promise);
        const mounted = mountComposable();
        await advance(0);

        mounted.api.requestSync(true);
        await advance(0);
        expect(mounted.api.isSyncing.value).toBe(true);
        expect(mounted.api.canSync.value).toBe(false);

        mounted.api.requestSync(true);
        await advance(0);
        expect(axiosPost).toHaveBeenCalledTimes(1);

        first.resolve(syncResponse());
        await advance(0);
        mounted.wrapper.unmount();
    });

    it('honours the retry_after of a throttled answer and of a read response', async () => {
        axiosGet.mockResolvedValue(freshRead(15));
        const read = mountComposable();
        await advance(0);
        await advance(0);
        expect(read.api.canSync.value).toBe(false);
        await advance(14_999);
        expect(read.api.canSync.value).toBe(false);
        await advance(1);
        expect(read.api.canSync.value).toBe(true);
        read.wrapper.unmount();

        axiosGet.mockResolvedValue(freshRead());
        axiosPost.mockResolvedValue(syncResponse({ status: 'throttled', retry_after: 20 }));
        const throttled = mountComposable();
        await advance(0);
        throttled.api.requestSync(true);
        await advance(0);
        await advance(0);
        await advance(19_999);
        expect(throttled.api.canSync.value).toBe(false);
        await advance(1);
        expect(throttled.api.canSync.value).toBe(true);
        throttled.wrapper.unmount();
    });

    it('keeps a reconnect answer for the page life', async () => {
        axiosGet.mockResolvedValue(freshRead());
        axiosPost.mockResolvedValueOnce(syncResponse({ status: 'reconnect' }));
        const mounted = mountComposable();
        await advance(0);
        mounted.api.requestSync(true);
        await advance(0);
        await advance(0);
        expect(mounted.api.connectionState.value).toBe('reconnect');
        expect(mounted.api.canSync.value).toBe(false);

        // Navigating on cannot flip it back
        await goTo(mounted, WEEK_B);
        await advance(20_000);
        expect(mounted.api.connectionState.value).toBe('reconnect');
        mounted.wrapper.unmount();
    });

    it('tracks the last synced time per week and counts visible meetings of the range', async () => {
        axiosGet.mockResolvedValue({
            data: {
                data: [
                    meeting('in', '2026-11-03T09:00:00Z', '2026-11-03T10:00:00Z'),
                    {
                        ...meeting('gone', '2026-11-04T09:00:00Z', '2026-11-04T10:00:00Z'),
                        dismissed: true,
                    },
                    meeting('next', '2026-11-10T09:00:00Z', '2026-11-10T10:00:00Z'),
                ],
                sync: { last_synced_at: '2026-11-05T09:00:00Z', retry_after: null },
            },
        });
        axiosPost.mockResolvedValue(syncResponse({ last_synced_at: '2026-11-05T09:59:00Z' }));
        const mounted = mountComposable();
        await advance(0);
        expect(mounted.api.syncedAt.value).toBe('2026-11-05T09:00:00Z');
        // Dismissed and out-of-range meetings do not count
        expect(mounted.api.visibleCount.value).toBe(1);

        mounted.api.requestSync(true);
        await advance(0);
        await advance(0);
        expect(mounted.api.syncedAt.value).toBe('2026-11-05T09:59:00Z');

        // Another week: the answer for week A says nothing about it
        axiosGet.mockResolvedValue(readResponse([], null));
        await goTo(mounted, WEEK_B);
        await advance(0);
        await advance(0);
        expect(mounted.api.syncedAt.value).toBeNull();
        mounted.wrapper.unmount();
    });
});

describe('useOutlookMeetings dismiss', () => {
    const first = meeting('m-1', '2026-11-03T09:00:00Z', '2026-11-03T10:00:00Z');
    const second = meeting('m-2', '2026-11-03T11:00:00Z', '2026-11-03T12:00:00Z');

    function dismissUrl(id: string): string {
        return MEETINGS_URL + '/' + id + '/dismiss';
    }

    async function mountWithMeetings(): Promise<Mounted> {
        axiosGet.mockResolvedValue(readResponse([first, second]));
        const mounted = mountComposable();
        await advance(500);
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-1', 'm-2']);
        axiosPost.mockClear();
        return mounted;
    }

    it('removes the meeting at once, posts to the dismiss url and stays silent on success', async () => {
        const mounted = await mountWithMeetings();
        const request = deferred<{ data: Record<string, never> }>();
        axiosPost.mockReturnValue(request.promise);
        axiosGet.mockResolvedValue(readResponse([second]));

        const done = mounted.api.dismiss('m-1');

        // Optimistic: gone before the request has answered
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-2']);
        expect(axiosPost).toHaveBeenCalledWith(dismissUrl('m-1'));
        request.resolve({ data: {} });
        await done;
        await advance(0);

        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-2']);
        expect(addNotification).not.toHaveBeenCalled();
        mounted.wrapper.unmount();
    });

    it('announces "Meeting dismissed" after a successful dismiss, also the second time', async () => {
        const mounted = await mountWithMeetings();
        axiosPost.mockResolvedValue({ data: {} });
        axiosGet.mockResolvedValue(readResponse([second]));

        await mounted.api.dismiss('m-1');
        await advance(0);
        expect(mounted.api.announcement.value).toBe('Meeting dismissed');

        const changes: string[] = [];
        const stop = watch(mounted.api.announcement, (value) => changes.push(value), {
            flush: 'sync',
        });
        axiosGet.mockResolvedValue(readResponse([]));
        await mounted.api.dismiss('m-2');
        await advance(0);
        stop();

        // Cleared first so that a screen reader reads the same text again
        expect(changes).toEqual(['', 'Meeting dismissed']);
        mounted.wrapper.unmount();
    });

    it('restores the ghost and reports the documented error when the request fails', async () => {
        const mounted = await mountWithMeetings();
        axiosPost.mockRejectedValue(httpError(500));

        await mounted.api.dismiss('m-1');
        await advance(0);

        expect(mounted.api.meetings.value.map((m) => m.id).sort()).toEqual(['m-1', 'm-2']);
        expect(addNotification).toHaveBeenCalledTimes(1);
        expect(addNotification).toHaveBeenCalledWith(
            'error',
            'Could not dismiss this meeting',
            'Try again in a moment.'
        );
        expect(mounted.api.announcement.value).toBe('');
        mounted.wrapper.unmount();
    });

    it('can act on server meetings but not in test-hook mode', async () => {
        const mounted = await mountWithMeetings();
        expect(mounted.api.canAct.value).toBe(true);

        (
            window as unknown as {
                __TEST_SET_OUTLOOK_MEETINGS__: (list: OutlookMeeting[]) => void;
            }
        ).__TEST_SET_OUTLOOK_MEETINGS__([first]);
        await nextTick();

        expect(mounted.api.canAct.value).toBe(false);
        mounted.wrapper.unmount();
    });
});

describe('useOutlookMeetings show dismissed and restore', () => {
    const live = meeting('m-1', '2026-11-03T09:00:00Z', '2026-11-03T10:00:00Z');
    const gone = {
        ...meeting('m-2', '2026-11-03T11:00:00Z', '2026-11-03T12:00:00Z'),
        dismissed: true,
    };

    function dismissalUrl(id: string): string {
        return MEETINGS_URL + '/' + id + '/dismiss';
    }

    // Fresh read so the automatic sync is skipped and the sync POST never mixes into the assertions
    function freshRead(meetings: OutlookMeeting[]): { data: OutlookMeetingsResponse } {
        return {
            data: {
                data: meetings,
                sync: {
                    last_synced_at: new Date(Date.now() - 5_000).toISOString(),
                    retry_after: null,
                },
            },
        };
    }

    async function mountShowing(): Promise<Mounted> {
        localStorage.setItem('solidtime:m365-show-dismissed', 'true');
        axiosGet.mockResolvedValue(freshRead([live, gone]));
        const mounted = mountComposable();
        await advance(500);
        expect(mounted.api.includeDismissed.value).toBe(true);
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-1', 'm-2']);
        axiosPost.mockClear();
        return mounted;
    }

    it('is off by default and the read is sent without include_dismissed', async () => {
        axiosGet.mockResolvedValue(freshRead([live]));
        const mounted = mountComposable();
        await advance(500);

        expect(mounted.api.includeDismissed.value).toBe(false);
        const config = axiosGet.mock.calls[0]![1] as { params: Record<string, unknown> };
        expect(config.params).toEqual({ start: WEEK_A, end: WEEK_B });
        mounted.wrapper.unmount();
    });

    it('toggling refetches with include_dismissed=1, remembers the choice and never syncs', async () => {
        axiosGet.mockResolvedValue(freshRead([live]));
        const mounted = mountComposable();
        await advance(500);
        expect(axiosGet).toHaveBeenCalledTimes(1);
        axiosGet.mockResolvedValue(freshRead([live, gone]));

        mounted.api.includeDismissed.value = true;
        await nextTick();
        await advance(500);

        expect(axiosGet).toHaveBeenCalledTimes(2);
        const config = axiosGet.mock.calls[1]![1] as { params: Record<string, unknown> };
        expect(config.params).toEqual({ start: WEEK_A, end: WEEK_B, include_dismissed: 1 });
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-1', 'm-2']);
        expect(localStorage.getItem('solidtime:m365-show-dismissed')).toBe('true');
        expect(axiosPost).not.toHaveBeenCalled();
        mounted.wrapper.unmount();
    });

    it('counts dismissed meetings as visible only while they are shown', async () => {
        const mounted = await mountShowing();
        expect(mounted.api.visibleCount.value).toBe(2);

        axiosGet.mockResolvedValue(freshRead([live]));
        mounted.api.includeDismissed.value = false;
        await nextTick();
        await advance(500);

        expect(mounted.api.visibleCount.value).toBe(1);
        mounted.wrapper.unmount();
    });

    it('a dismiss with the switch on keeps the meeting and flags it dismissed', async () => {
        const mounted = await mountShowing();
        axiosPost.mockResolvedValue({ data: {} });
        axiosGet.mockResolvedValue(freshRead([{ ...live, dismissed: true }, gone]));

        const done = mounted.api.dismiss('m-1');

        expect(mounted.api.meetings.value.map((m) => [m.id, m.dismissed])).toEqual([
            ['m-1', true],
            ['m-2', true],
        ]);
        await done;
        await advance(0);
        expect(axiosPost).toHaveBeenCalledWith(dismissalUrl('m-1'));
        mounted.wrapper.unmount();
    });

    it('restore flags the meeting at once, deletes the dismissal and announces "Meeting restored"', async () => {
        const mounted = await mountShowing();
        const request = deferred<{ data: Record<string, never> }>();
        axiosDelete.mockReturnValue(request.promise);
        axiosGet.mockResolvedValue(freshRead([live, { ...gone, dismissed: false }]));

        const done = mounted.api.restore('m-2');

        // Optimistic: already a regular ghost before the request has answered
        expect(mounted.api.meetings.value.find((m) => m.id === 'm-2')?.dismissed).toBe(false);
        expect(axiosDelete).toHaveBeenCalledWith(dismissalUrl('m-2'));
        request.resolve({ data: {} });
        await done;
        await advance(0);

        expect(mounted.api.announcement.value).toBe('Meeting restored');
        // No success toast
        expect(addNotification).not.toHaveBeenCalled();
        mounted.wrapper.unmount();
    });

    it('a failed restore puts the ghost back in the dismissed state', async () => {
        const mounted = await mountShowing();
        axiosDelete.mockRejectedValue(httpError(500));

        await mounted.api.restore('m-2');
        await advance(0);

        expect(mounted.api.meetings.value.find((m) => m.id === 'm-2')?.dismissed).toBe(true);
        expect(addNotification).toHaveBeenCalledTimes(1);
        expect(addNotification).toHaveBeenCalledWith(
            'error',
            'Could not restore this meeting',
            'Try again in a moment.'
        );
        expect(mounted.api.announcement.value).toBe('');
        mounted.wrapper.unmount();
    });

    it('a failed dismiss with the switch on puts the ghost back in the regular state', async () => {
        const mounted = await mountShowing();
        axiosPost.mockRejectedValue(httpError(500));

        await mounted.api.dismiss('m-1');
        await advance(0);

        expect(mounted.api.meetings.value.find((m) => m.id === 'm-1')?.dismissed).toBe(false);
        expect(addNotification).toHaveBeenCalledWith(
            'error',
            'Could not dismiss this meeting',
            'Try again in a moment.'
        );
        mounted.wrapper.unmount();
    });
});

describe('useOutlookMeetings convert', () => {
    const first = meeting('m-1', '2026-11-03T09:00:00Z', '2026-11-03T10:00:00Z');
    const second = meeting('m-2', '2026-11-03T11:00:00Z', '2026-11-03T12:00:00Z');
    const fields = { project_id: 'p-1', task_id: null, tags: [], billable: true };

    function result(id: string, status: 'created' | 'existing' | 'failed') {
        return {
            meeting_id: id,
            status,
            time_entry_id: status === 'failed' ? null : 'te-' + id,
            error: status === 'failed' ? { key: 'forbidden', message: 'No access.' } : null,
        };
    }

    function convertCalls() {
        return axiosPost.mock.calls.filter((call) => call[0] === CONVERT_URL);
    }

    async function mountWithMeetings(): Promise<Mounted> {
        axiosGet.mockResolvedValue(readResponse([first, second]));
        const mounted = mountComposable();
        await advance(500);
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-1', 'm-2']);
        axiosPost.mockClear();
        return mounted;
    }

    it('posts the ids and fields to the convert url', async () => {
        const mounted = await mountWithMeetings();
        axiosPost.mockResolvedValue({ data: { results: [result('m-1', 'created')] } });

        await mounted.api.convert(['m-1'], { ...fields, description: 'Weekly' });

        expect(convertCalls()).toHaveLength(1);
        expect(convertCalls()[0]![1]).toEqual({
            meeting_ids: ['m-1'],
            ...fields,
            description: 'Weekly',
        });
        mounted.wrapper.unmount();
    });

    it('removes a created meeting from every cached read and invalidates entries, goals and meetings', async () => {
        const mounted = await mountWithMeetings();
        // Another cached variant (dismissed meetings shown) of the same week
        const otherKey = ['m365', 'meetings', WEEK_A, true];
        mounted.queryClient.setQueryData(otherKey, {
            data: [first, second],
            sync: { last_synced_at: null, retry_after: null },
        });
        const invalidate = vi.spyOn(mounted.queryClient, 'invalidateQueries');
        axiosPost.mockResolvedValue({ data: { results: [result('m-1', 'created')] } });
        // The refetch after the invalidation must not bring the meeting back
        axiosGet.mockResolvedValue(readResponse([second]));

        const results = await mounted.api.convert(['m-1'], fields);

        expect(results).toEqual([result('m-1', 'created')]);
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-2']);
        expect(
            mounted.queryClient
                .getQueryData<OutlookMeetingsResponse>(otherKey)
                ?.data.map((m) => m.id)
        ).toEqual(['m-2']);
        const keys = invalidate.mock.calls.map(
            (call) => (call[0] as { queryKey?: unknown } | undefined)?.queryKey
        );
        expect(keys).toContainEqual(['timeEntries']);
        expect(keys).toContainEqual(['goals']);
        expect(keys).toContainEqual(['m365', 'meetings']);
        await advance(0);
        expect(mounted.api.announcement.value).toBe('Time entry created');
        mounted.wrapper.unmount();
    });

    it('treats an existing result like a created one', async () => {
        const mounted = await mountWithMeetings();
        axiosPost.mockResolvedValue({ data: { results: [result('m-2', 'existing')] } });
        axiosGet.mockResolvedValue(readResponse([first]));

        await mounted.api.convert(['m-2'], fields);

        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-1']);
        mounted.wrapper.unmount();
    });

    it('keeps the meeting and invalidates nothing on a failed result', async () => {
        const mounted = await mountWithMeetings();
        const invalidate = vi.spyOn(mounted.queryClient, 'invalidateQueries');
        axiosPost.mockResolvedValue({ data: { results: [result('m-1', 'failed')] } });

        const results = await mounted.api.convert(['m-1'], fields);

        expect(results[0]?.status).toBe('failed');
        expect(results[0]?.error?.message).toBe('No access.');
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-1', 'm-2']);
        expect(invalidate).not.toHaveBeenCalled();
        await advance(0);
        expect(mounted.api.announcement.value).toBe('');
        mounted.wrapper.unmount();
    });

    it('returns failed results with error_generic for a rejected request and removes nothing', async () => {
        const mounted = await mountWithMeetings();
        axiosPost.mockRejectedValue(httpError(500));

        const results = await mounted.api.convert(['m-1', 'm-2'], fields);

        expect(results.map((r) => [r.meeting_id, r.status, r.error?.message])).toEqual([
            ['m-1', 'failed', 'Could not create the time entry. Try again in a moment.'],
            ['m-2', 'failed', 'Could not create the time entry. Try again in a moment.'],
        ]);
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-1', 'm-2']);
        mounted.wrapper.unmount();
    });

    it('shows the message of a 422 answer', async () => {
        const mounted = await mountWithMeetings();
        axiosPost.mockRejectedValue(
            Object.assign(new Error('HTTP 422'), {
                response: { status: 422, headers: {}, data: { message: 'Bad task.' } },
            })
        );

        const results = await mounted.api.convert(['m-1'], fields);

        expect(results[0]?.error?.message).toBe('Bad task.');
        mounted.wrapper.unmount();
    });

    it('sends nothing without a convert url', async () => {
        const mounted = await mountWithMeetings();
        (pageProps.microsoft as { calendar: OutlookCalendarProps }).calendar.urls.convert = null;
        await nextTick();

        const results = await mounted.api.convert(['m-1'], fields);

        expect(convertCalls()).toHaveLength(0);
        expect(results[0]?.status).toBe('failed');
        mounted.wrapper.unmount();
    });
});

describe('useOutlookMeetings confirm pre-assigned', () => {
    const first = meeting('m-1', '2026-11-03T09:00:00Z', '2026-11-03T10:00:00Z');
    const second = meeting('m-2', '2026-11-03T11:00:00Z', '2026-11-03T12:00:00Z');

    function created(id: string) {
        return { meeting_id: id, status: 'created', time_entry_id: 'te-' + id, error: null };
    }

    function failed(id: string, message = 'No access.') {
        return {
            meeting_id: id,
            status: 'failed',
            time_entry_id: null,
            error: { key: 'forbidden', message },
        };
    }

    function convertCalls() {
        return axiosPost.mock.calls.filter((call) => call[0] === CONVERT_URL);
    }

    async function mountWithMeetings(): Promise<Mounted> {
        axiosGet.mockResolvedValue(readResponse([first, second]));
        const mounted = mountComposable();
        await advance(500);
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-1', 'm-2']);
        axiosPost.mockClear();
        return mounted;
    }

    it('posts the ids with use_series_assignment alone, removes created meetings and invalidates', async () => {
        const mounted = await mountWithMeetings();
        const invalidate = vi.spyOn(mounted.queryClient, 'invalidateQueries');
        axiosPost.mockResolvedValue({ data: { results: [created('m-1')] } });
        axiosGet.mockResolvedValue(readResponse([second]));

        const results = await mounted.api.confirmPreassigned(['m-1']);

        expect(convertCalls()).toHaveLength(1);
        expect(convertCalls()[0]![1]).toEqual({
            meeting_ids: ['m-1'],
            use_series_assignment: true,
        });
        expect(results).toEqual([created('m-1')]);
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-2']);
        const keys = invalidate.mock.calls.map(
            (call) => (call[0] as { queryKey?: unknown } | undefined)?.queryKey
        );
        expect(keys).toContainEqual(['timeEntries']);
        expect(keys).toContainEqual(['goals']);
        expect(keys).toContainEqual(['m365', 'meetings']);
        mounted.wrapper.unmount();
    });

    it('sends 120 ids as requests of 50, 50 and 20 in order and merges the results in order', async () => {
        const mounted = await mountWithMeetings();
        const ids = Array.from({ length: 120 }, (_, index) => `b-${index}`);
        axiosPost.mockImplementation((_url, body) =>
            Promise.resolve({
                data: {
                    results: (body as { meeting_ids: string[] }).meeting_ids.map((id) =>
                        created(id)
                    ),
                },
            })
        );

        const results = await mounted.api.confirmPreassigned(ids);

        const sent = convertCalls().map(
            (call) => (call[1] as { meeting_ids: string[] }).meeting_ids
        );
        expect(sent.map((chunk) => chunk.length)).toEqual([50, 50, 20]);
        expect(sent.flat()).toEqual(ids);
        expect(results.map((result) => result.meeting_id)).toEqual(ids);
        expect(results.every((result) => result.status === 'created')).toBe(true);
        mounted.wrapper.unmount();
    });

    it('a rejected chunk yields failed results for its ids only', async () => {
        const mounted = await mountWithMeetings();
        const ids = Array.from({ length: 120 }, (_, index) => `b-${index}`);
        let call = 0;
        axiosPost.mockImplementation((_url, body) => {
            call += 1;
            if (call === 2) return Promise.reject(httpError(500));
            return Promise.resolve({
                data: {
                    results: (body as { meeting_ids: string[] }).meeting_ids.map((id) =>
                        created(id)
                    ),
                },
            });
        });

        const results = await mounted.api.confirmPreassigned(ids);

        expect(results).toHaveLength(120);
        expect(results.map((result) => result.meeting_id)).toEqual(ids);
        expect(results.slice(0, 50).every((result) => result.status === 'created')).toBe(true);
        expect(results.slice(50, 100).map((result) => result.status)).toEqual(
            Array(50).fill('failed')
        );
        expect(results[50]?.error?.message).toBe(
            'Could not create the time entry. Try again in a moment.'
        );
        expect(results.slice(100).every((result) => result.status === 'created')).toBe(true);
        mounted.wrapper.unmount();
    });

    it('is pending while the request runs and a second confirm of a pending id sends nothing', async () => {
        const mounted = await mountWithMeetings();
        const request = deferred<{ data: { results: unknown[] } }>();
        axiosPost.mockReturnValue(request.promise);

        const done = mounted.api.confirmPreassigned(['m-1']);
        expect(mounted.api.isConfirmPending('m-1')).toBe(true);
        expect(mounted.api.isConfirmPending('m-2')).toBe(false);

        const again = await mounted.api.confirmPreassigned(['m-1']);
        expect(again).toEqual([]);
        expect(await mounted.api.confirmOne('m-1')).toBeNull();
        expect(convertCalls()).toHaveLength(1);

        request.resolve({ data: { results: [failed('m-1')] } });
        await done;

        expect(mounted.api.isConfirmPending('m-1')).toBe(false);
        mounted.wrapper.unmount();
    });

    it('confirmOne notifies success and announces "Time entry created"', async () => {
        const mounted = await mountWithMeetings();
        axiosPost.mockResolvedValue({ data: { results: [created('m-1')] } });
        axiosGet.mockResolvedValue(readResponse([second]));

        const result = await mounted.api.confirmOne('m-1');
        await advance(0);

        expect(result?.status).toBe('created');
        expect(addNotification).toHaveBeenCalledTimes(1);
        expect(addNotification).toHaveBeenCalledWith('success', 'Time entry created successfully');
        expect(mounted.api.announcement.value).toBe('Time entry created');
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-2']);
        mounted.wrapper.unmount();
    });

    it("confirmOne reports a failed result with the server's message and keeps the meeting", async () => {
        const mounted = await mountWithMeetings();
        axiosPost.mockResolvedValue({ data: { results: [failed('m-1', 'No access.')] } });

        const result = await mounted.api.confirmOne('m-1');
        await advance(0);

        expect(result?.status).toBe('failed');
        expect(addNotification).toHaveBeenCalledWith(
            'error',
            'Could not confirm this meeting',
            'No access.'
        );
        expect(mounted.api.announcement.value).toBe('');
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-1', 'm-2']);
        mounted.wrapper.unmount();
    });

    it('confirmOne falls back to error_generic when the failure carries no message', async () => {
        const mounted = await mountWithMeetings();
        axiosPost.mockRejectedValue(httpError(500));

        await mounted.api.confirmOne('m-1');

        expect(addNotification).toHaveBeenCalledWith(
            'error',
            'Could not confirm this meeting',
            'Could not create the time entry. Try again in a moment.'
        );
        mounted.wrapper.unmount();
    });

    it('sends nothing and returns null while it cannot act', async () => {
        const mounted = await mountWithMeetings();
        (
            window as unknown as {
                __TEST_SET_OUTLOOK_MEETINGS__: (list: OutlookMeeting[]) => void;
            }
        ).__TEST_SET_OUTLOOK_MEETINGS__([first]);
        await nextTick();
        expect(mounted.api.canAct.value).toBe(false);

        expect(await mounted.api.confirmOne('m-1')).toBeNull();
        expect(await mounted.api.confirmPreassigned(['m-1'])).toEqual([]);

        expect(axiosPost).not.toHaveBeenCalled();
        expect(addNotification).not.toHaveBeenCalled();
        mounted.wrapper.unmount();
    });
});

describe('useOutlookMeetings selection and form channel', () => {
    const first = meeting('m-1', '2026-11-03T09:00:00Z', '2026-11-03T10:00:00Z');
    const second = meeting('m-2', '2026-11-03T11:00:00Z', '2026-11-03T12:00:00Z');
    const third = meeting('m-3', '2026-11-04T11:00:00Z', '2026-11-04T12:00:00Z');
    const fields = { project_id: 'p-1', task_id: null, tags: [], billable: false };

    function freshRead(meetings: OutlookMeeting[]): { data: OutlookMeetingsResponse } {
        return {
            data: {
                data: meetings,
                sync: {
                    last_synced_at: new Date(Date.now() - 5_000).toISOString(),
                    retry_after: null,
                },
            },
        };
    }

    async function mountWith(list: OutlookMeeting[] = [first, second, third]): Promise<Mounted> {
        axiosGet.mockResolvedValue(freshRead(list));
        const mounted = mountComposable();
        await advance(500);
        expect(mounted.api.meetings.value).toHaveLength(list.length);
        axiosPost.mockClear();
        return mounted;
    }

    function setTestMeetings(list: OutlookMeeting[]): void {
        (
            window as unknown as {
                __TEST_SET_OUTLOOK_MEETINGS__: (meetings: OutlookMeeting[]) => void;
            }
        ).__TEST_SET_OUTLOOK_MEETINGS__(list);
    }

    it('drops selected ids that are no longer in the meetings list', async () => {
        const mounted = await mountWith();
        mounted.api.selection.toggle('m-1');
        mounted.api.selection.toggle('m-2');
        expect(mounted.api.selection.selectedIds.value).toEqual(['m-1', 'm-2']);

        mounted.queryClient.setQueryData(['m365', 'meetings', WEEK_A, false], {
            data: [second, third],
            sync: { last_synced_at: null, retry_after: null },
        });
        await nextTick();

        expect(mounted.api.selection.selectedIds.value).toEqual(['m-2']);
        mounted.wrapper.unmount();
    });

    it('clears the selection when the calendar range changes', async () => {
        const mounted = await mountWith();
        mounted.api.selection.toggle('m-1');

        // Day view inside the same week: same bucket, other range
        mounted.end.value = weekStartOf(WEEK_A).add(1, 'day');
        await nextTick();

        expect(mounted.api.selection.selectedIds.value).toEqual([]);
        expect(mounted.api.selection.anchorId.value).toBeNull();
        mounted.wrapper.unmount();
    });

    it('keeps the selection empty while it cannot act', async () => {
        const mounted = await mountWith();
        mounted.api.selection.toggle('m-1');

        setTestMeetings([first, second]);
        await nextTick();

        expect(mounted.api.canAct.value).toBe(false);
        expect(mounted.api.selection.selectedIds.value).toEqual([]);
        mounted.api.selection.toggle('m-2');
        mounted.api.selection.selectRange('m-2', [first, second]);
        expect(mounted.api.selection.selectedIds.value).toEqual([]);
        mounted.wrapper.unmount();
    });

    it('convert removes created and existing ids from the selection and keeps failed ones', async () => {
        const mounted = await mountWith();
        for (const id of ['m-1', 'm-2', 'm-3']) mounted.api.selection.toggle(id);
        axiosPost.mockResolvedValue({
            data: {
                results: [
                    { meeting_id: 'm-1', status: 'created', time_entry_id: 'te-1', error: null },
                    { meeting_id: 'm-2', status: 'existing', time_entry_id: 'te-2', error: null },
                    {
                        meeting_id: 'm-3',
                        status: 'failed',
                        time_entry_id: null,
                        error: { key: 'forbidden', message: 'No access.' },
                    },
                ],
            },
        });
        axiosGet.mockResolvedValue(freshRead([third]));

        await mounted.api.convert(['m-1', 'm-2', 'm-3'], fields);

        expect(mounted.api.selection.selectedIds.value).toEqual(['m-3']);
        // A multi conversion says nothing here (the batch form announces its own summary)
        await advance(0);
        expect(mounted.api.announcement.value).toBe('');
        mounted.wrapper.unmount();
    });

    it('a second convert for an id still in flight returns [] without a request', async () => {
        const mounted = await mountWith();
        const request = deferred<{ data: unknown }>();
        axiosPost.mockReturnValue(request.promise);

        const firstCall = mounted.api.convert(['m-1'], fields);
        const secondCall = await mounted.api.convert(['m-2', 'm-1'], fields);

        expect(secondCall).toEqual([]);
        expect(axiosPost).toHaveBeenCalledTimes(1);
        request.resolve({
            data: {
                results: [
                    { meeting_id: 'm-1', status: 'created', time_entry_id: 'te-1', error: null },
                ],
            },
        });
        await firstCall;

        // Settled: the next call is sent again
        axiosPost.mockResolvedValue({ data: { results: [] } });
        await mounted.api.convert(['m-1'], fields);
        expect(axiosPost).toHaveBeenCalledTimes(2);
        mounted.wrapper.unmount();
    });

    it('openForm sets formRequest with an increasing seq and clears the selection', async () => {
        const mounted = await mountWith();
        mounted.api.selection.toggle('m-2');
        expect(mounted.api.formRequest.value).toBeNull();

        mounted.api.openForm('m-1');
        const firstRequest = mounted.api.formRequest.value;
        mounted.api.openForm('m-1');
        const secondRequest = mounted.api.formRequest.value;

        expect(firstRequest?.id).toBe('m-1');
        expect(secondRequest?.id).toBe('m-1');
        expect(secondRequest!.seq).toBeGreaterThan(firstRequest!.seq);
        expect(mounted.api.selection.selectedIds.value).toEqual([]);
        mounted.wrapper.unmount();
    });

    it('openForm is ignored while it cannot act', async () => {
        const mounted = await mountWith();
        setTestMeetings([first]);
        await nextTick();

        mounted.api.openForm('m-1');

        expect(mounted.api.formRequest.value).toBeNull();
        mounted.wrapper.unmount();
    });
});

describe('useOutlookMeetings linked entries and the acting test hook', () => {
    const first = meeting('m-1', '2026-11-03T09:00:00Z', '2026-11-03T10:00:00Z');
    const second = meeting('m-2', '2026-11-03T11:00:00Z', '2026-11-03T12:00:00Z');
    const fields = { project_id: 'p-1', task_id: null, tags: [], billable: true };
    const TEST_CONVERT_URL = 'https://example.test/convert';

    type HookOptions = { actions?: boolean; convertUrl?: string; linkedTimeEntryIds?: string[] };

    function hook(
        meetings: OutlookMeeting[],
        labels?: Partial<OutlookCalendarLabels>,
        options?: HookOptions
    ): void {
        (
            window as unknown as {
                __TEST_SET_OUTLOOK_MEETINGS__: (
                    meetings: OutlookMeeting[],
                    labels?: Partial<OutlookCalendarLabels>,
                    options?: HookOptions
                ) => void;
            }
        ).__TEST_SET_OUTLOOK_MEETINGS__(meetings, labels, options);
    }

    function linkedRead(
        meetings: OutlookMeeting[],
        linked: string[]
    ): { data: OutlookMeetingsResponse } {
        return {
            data: {
                data: meetings,
                sync: { last_synced_at: null, retry_after: null },
                linked_time_entry_ids: linked,
            },
        };
    }

    function created(id: string, entryId: string) {
        return { meeting_id: id, status: 'created', time_entry_id: entryId, error: null };
    }

    function failed(id: string) {
        return {
            meeting_id: id,
            status: 'failed',
            time_entry_id: null,
            error: { key: 'forbidden', message: 'No access.' },
        };
    }

    function invalidatedKeys(spy: ReturnType<typeof vi.spyOn>): unknown[] {
        return spy.mock.calls.map(
            (call: unknown[]) => (call[0] as { queryKey?: unknown } | undefined)?.queryKey
        );
    }

    it('follows the linked entry ids of the read for the current week', async () => {
        axiosGet.mockImplementation((_url, config) =>
            Promise.resolve(
                (config as { params: { start: string } }).params.start === WEEK_A
                    ? linkedRead([first], ['te-1'])
                    : linkedRead([], ['te-9'])
            )
        );
        const mounted = mountComposable();
        await advance(500);
        expect(mounted.api.linkedTimeEntryIds.value).toEqual(['te-1']);

        await goTo(mounted, WEEK_B);
        await advance(500);

        expect(mounted.api.linkedTimeEntryIds.value).toEqual(['te-9']);
        mounted.wrapper.unmount();
    });

    it('is empty while there is no read or the read has no ids', async () => {
        const mounted = mountComposable(null);
        expect(mounted.api.linkedTimeEntryIds.value).toEqual([]);
        mounted.wrapper.unmount();

        axiosGet.mockResolvedValue(readResponse([first]));
        const loaded = mountComposable();
        await advance(500);
        expect(loaded.api.linkedTimeEntryIds.value).toEqual([]);
        loaded.wrapper.unmount();
    });

    it('a server conversion adds the new entry ids to the cached reads at once', async () => {
        axiosGet.mockResolvedValue(linkedRead([first, second], ['te-0']));
        const mounted = mountComposable();
        await advance(500);
        axiosPost.mockResolvedValue({ data: { results: [created('m-1', 'te-1')] } });
        // Keep the refetch from settling so the optimistic value is observed
        axiosGet.mockReturnValue(new Promise(() => undefined));

        await mounted.api.convert(['m-1'], fields);

        expect(mounted.api.linkedTimeEntryIds.value).toEqual(['te-0', 'te-1']);
        mounted.wrapper.unmount();
    });

    it('with two arguments the hook still cannot act and has no linked ids', async () => {
        axiosGet.mockResolvedValue(linkedRead([first], ['te-1']));
        const mounted = mountComposable();
        await advance(500);

        hook([first, second]);
        await nextTick();

        expect(mounted.api.canAct.value).toBe(false);
        expect(mounted.api.linkedTimeEntryIds.value).toEqual([]);
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-1', 'm-2']);
        mounted.wrapper.unmount();
    });

    it('with actions it converts through the given url and updates the injected state', async () => {
        const mounted = mountComposable();
        await advance(500);
        hook([first, second], undefined, {
            actions: true,
            convertUrl: TEST_CONVERT_URL,
            linkedTimeEntryIds: ['e1'],
        });
        await nextTick();
        expect(mounted.api.canAct.value).toBe(true);
        expect(mounted.api.linkedTimeEntryIds.value).toEqual(['e1']);

        axiosPost.mockClear();
        const invalidate = vi.spyOn(mounted.queryClient, 'invalidateQueries');
        axiosPost.mockResolvedValue({ data: { results: [created('m-1', 'te-1')] } });

        const results = await mounted.api.convert(['m-1'], fields);

        expect(results[0]?.status).toBe('created');
        expect(axiosPost).toHaveBeenCalledTimes(1);
        expect(axiosPost.mock.calls[0]![0]).toBe(TEST_CONVERT_URL);
        expect(axiosPost.mock.calls[0]![1]).toEqual({ meeting_ids: ['m-1'], ...fields });
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-2']);
        expect(mounted.api.linkedTimeEntryIds.value).toEqual(['e1', 'te-1']);
        const keys = invalidatedKeys(invalidate);
        expect(keys).toContainEqual(['timeEntries']);
        expect(keys).toContainEqual(['goals']);
        // Injected meetings are not server rows: the real read is left alone
        expect(keys).not.toContainEqual(['m365', 'meetings']);
        await advance(0);
        expect(mounted.api.announcement.value).toBe('Time entry created');
        mounted.wrapper.unmount();
    });

    it('with actions a failed result keeps the meeting', async () => {
        const mounted = mountComposable();
        await advance(500);
        hook([first, second], undefined, { actions: true, convertUrl: TEST_CONVERT_URL });
        await nextTick();
        axiosPost.mockResolvedValue({ data: { results: [failed('m-1')] } });

        const results = await mounted.api.convert(['m-1'], fields);

        expect(results[0]?.error?.message).toBe('No access.');
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-1', 'm-2']);
        expect(mounted.api.linkedTimeEntryIds.value).toEqual([]);
        mounted.wrapper.unmount();
    });

    it('with actions selection and openForm work, and converted ids leave the selection', async () => {
        const mounted = mountComposable();
        await advance(500);
        hook([first, second], undefined, { actions: true, convertUrl: TEST_CONVERT_URL });
        await nextTick();

        mounted.api.selection.toggle('m-1');
        mounted.api.selection.toggle('m-2');
        expect(mounted.api.selection.selectedIds.value).toEqual(['m-1', 'm-2']);

        axiosPost.mockResolvedValue({
            data: { results: [created('m-1', 'te-1'), failed('m-2')] },
        });
        await mounted.api.convert(['m-1', 'm-2'], fields);
        expect(mounted.api.selection.selectedIds.value).toEqual(['m-2']);

        mounted.api.openForm('m-2');
        expect(mounted.api.formRequest.value?.id).toBe('m-2');
        expect(mounted.api.selection.selectedIds.value).toEqual([]);
        mounted.wrapper.unmount();
    });

    it('with actions it works without the calendar prop (integration off in CI)', async () => {
        setPage(null);
        const mounted = mountComposable();
        await advance(500);
        hook(
            [first],
            { error_generic: 'Failed.', created_announcement: 'Created.' },
            {
                actions: true,
                convertUrl: TEST_CONVERT_URL,
            }
        );
        await nextTick();
        expect(mounted.api.canAct.value).toBe(true);
        axiosPost.mockResolvedValue({ data: { results: [created('m-1', 'te-1')] } });

        await mounted.api.convert(['m-1'], fields);

        expect(axiosPost.mock.calls[0]![0]).toBe(TEST_CONVERT_URL);
        expect(mounted.api.meetings.value).toEqual([]);
        expect(mounted.api.linkedTimeEntryIds.value).toEqual(['te-1']);
        mounted.wrapper.unmount();
    });

    it('with actions but no convert url it sends nothing', async () => {
        const mounted = mountComposable();
        await advance(500);
        hook([first], undefined, { actions: true });
        await nextTick();
        axiosPost.mockClear();

        const results = await mounted.api.convert(['m-1'], fields);

        expect(axiosPost).not.toHaveBeenCalled();
        expect(results[0]?.status).toBe('failed');
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-1']);
        mounted.wrapper.unmount();
    });
});

describe('useOutlookMeetings refresh after time-entry changes', () => {
    const ENTRIES_KEY = ['timeEntries', 'calendar', { start: WEEK_A, end: WEEK_B }];
    const NEXT_WEEK_KEY = ['timeEntries', 'calendar', { start: WEEK_B, end: WEEK_C }];

    // A fetch of a time-entries query, like the calendar query does on load and after the core
    // mutations invalidate ['timeEntries'] (staleTime 0, so every call fetches again).
    async function fetchEntries(
        queryClient: QueryClient,
        key: readonly unknown[] = ENTRIES_KEY,
        fail = false
    ): Promise<void> {
        await queryClient
            .fetchQuery({
                queryKey: key,
                queryFn: () => (fail ? Promise.reject(new Error('HTTP 500')) : Promise.resolve([])),
                staleTime: 0,
                retry: false,
            })
            .catch(() => undefined);
    }

    function meetingReads(): number {
        return axiosGet.mock.calls.filter((call) => call[0] === MEETINGS_URL).length;
    }

    async function mountSettled(): Promise<Mounted> {
        const mounted = mountComposable();
        await advance(1000);
        axiosGet.mockClear();
        return mounted;
    }

    it('refreshes the meetings read once, 500 ms after a refetch of loaded time entries', async () => {
        const mounted = await mountSettled();
        await fetchEntries(mounted.queryClient);
        await advance(1000);
        expect(meetingReads()).toBe(0);

        // A delete (or any core mutation) invalidates ['timeEntries'] and the calendar refetches
        await fetchEntries(mounted.queryClient);
        await advance(499);
        expect(meetingReads()).toBe(0);
        await advance(1);
        expect(meetingReads()).toBe(1);
        await advance(2000);
        expect(meetingReads()).toBe(1);
        mounted.wrapper.unmount();
    });

    it('debounces a burst of refetches into one meetings read', async () => {
        const mounted = await mountSettled();
        await fetchEntries(mounted.queryClient);

        await fetchEntries(mounted.queryClient);
        await advance(150);
        await fetchEntries(mounted.queryClient);
        await advance(150);
        await fetchEntries(mounted.queryClient);
        await advance(499);
        expect(meetingReads()).toBe(0);
        await advance(1);
        expect(meetingReads()).toBe(1);
        await advance(2000);
        expect(meetingReads()).toBe(1);
        mounted.wrapper.unmount();
    });

    it('ignores the first load of a week (navigation)', async () => {
        const mounted = await mountSettled();
        await fetchEntries(mounted.queryClient, ENTRIES_KEY);
        await fetchEntries(mounted.queryClient, NEXT_WEEK_KEY);
        await advance(2000);

        expect(meetingReads()).toBe(0);
        mounted.wrapper.unmount();
    });

    it('ignores failed fetches, unrelated queries and direct cache writes', async () => {
        const mounted = await mountSettled();
        await fetchEntries(mounted.queryClient);
        await fetchEntries(mounted.queryClient, ENTRIES_KEY, true);
        await fetchEntries(mounted.queryClient, ['projects']);
        await fetchEntries(mounted.queryClient, ['projects']);
        mounted.queryClient.setQueryData(ENTRIES_KEY, []);
        await advance(2000);

        expect(meetingReads()).toBe(0);
        mounted.wrapper.unmount();
    });

    it('does nothing in test-hook mode', async () => {
        const mounted = await mountSettled();
        (
            window as unknown as {
                __TEST_SET_OUTLOOK_MEETINGS__: (meetings: OutlookMeeting[]) => void;
            }
        ).__TEST_SET_OUTLOOK_MEETINGS__([]);
        const invalidate = vi.spyOn(mounted.queryClient, 'invalidateQueries');
        await fetchEntries(mounted.queryClient);
        await fetchEntries(mounted.queryClient);
        await advance(2000);

        expect(invalidate).not.toHaveBeenCalled();
        expect(meetingReads()).toBe(0);
        mounted.wrapper.unmount();
    });

    it('drops a pending refresh and stops listening on unmount', async () => {
        const mounted = await mountSettled();
        const invalidate = vi.spyOn(mounted.queryClient, 'invalidateQueries');
        await fetchEntries(mounted.queryClient);
        await fetchEntries(mounted.queryClient);
        await advance(200);
        mounted.wrapper.unmount();
        await advance(1000);
        await fetchEntries(mounted.queryClient);
        await advance(1000);

        expect(invalidate).not.toHaveBeenCalled();
    });
});

describe('useOutlookMeetings series actions', () => {
    const assignment = {
        project_id: 'p-1',
        project_name: 'Acme Website',
        project_color: '#ef5350',
        client_name: 'Acme',
        task_id: null,
        task_name: null,
        tags: [],
        billable: true,
        converted_at: '2026-10-27T09:00:00Z',
    };
    // Two occurrences of series S this week, one next week, and a one-off meeting
    const occurrenceA: OutlookMeeting = {
        ...meeting('m-a', '2026-11-03T09:00:00Z', '2026-11-03T10:00:00Z'),
        series_key: 'S',
        assignment,
    };
    const occurrenceB: OutlookMeeting = {
        ...meeting('m-b', '2026-11-05T09:00:00Z', '2026-11-05T10:00:00Z'),
        series_key: 'S',
        assignment,
    };
    const nextWeek: OutlookMeeting = {
        ...meeting('m-n', '2026-11-10T09:00:00Z', '2026-11-10T10:00:00Z'),
        series_key: 'S',
        assignment,
    };
    const oneOff = meeting('m-o', '2026-11-04T09:00:00Z', '2026-11-04T10:00:00Z');

    const WEEK_B_KEY = ['m365', 'meetings', WEEK_B, false];
    const INCLUDE_KEY = ['m365', 'meetings', WEEK_A, true];

    function seriesUrl(id: string, kind: 'ignore' | 'assignment'): string {
        return `${MEETINGS_URL}/${id}/series/${kind}`;
    }

    function cached(mounted: Mounted, key: unknown[]): OutlookMeeting[] {
        return mounted.queryClient.getQueryData<OutlookMeetingsResponse>(key)?.data ?? [];
    }

    // The current read plus two inactive cached reads (next week, and this week with dismissed
    // meetings) that the refetch does not touch, so a revert is observable there.
    async function mountWithSeries(): Promise<Mounted> {
        axiosGet.mockResolvedValue(readResponse([occurrenceA, oneOff, occurrenceB]));
        const mounted = mountComposable();
        await advance(500);
        mounted.queryClient.setQueryData(WEEK_B_KEY, {
            data: [nextWeek],
            sync: { last_synced_at: null, retry_after: null },
        });
        mounted.queryClient.setQueryData(INCLUDE_KEY, {
            data: [occurrenceA, oneOff, occurrenceB],
            sync: { last_synced_at: null, retry_after: null },
        });
        axiosPost.mockClear();
        axiosGet.mockClear();
        return mounted;
    }

    it('ignore hides every occurrence at once, posts and reports success', async () => {
        const mounted = await mountWithSeries();
        const request = deferred<{ data: Record<string, never> }>();
        axiosPost.mockReturnValue(request.promise);
        axiosGet.mockResolvedValue(readResponse([oneOff]));

        const done = mounted.api.ignoreSeries('m-b');

        // Optimistic: gone from the regular reads, flagged in the read with dismissed meetings
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-o']);
        expect(cached(mounted, WEEK_B_KEY)).toEqual([]);
        expect(cached(mounted, INCLUDE_KEY).map((m) => [m.id, m.series_ignored])).toEqual([
            ['m-a', true],
            ['m-o', undefined],
            ['m-b', true],
        ]);
        expect(axiosPost).toHaveBeenCalledWith(seriesUrl('m-b', 'ignore'));
        expect(addNotification).not.toHaveBeenCalled();

        request.resolve({ data: {} });
        await done;
        await advance(0);

        expect(addNotification).toHaveBeenCalledTimes(1);
        expect(addNotification).toHaveBeenCalledWith(
            'success',
            'Series ignored',
            'Its meetings are hidden. Turn on Show dismissed meetings to undo.'
        );
        expect(mounted.api.announcement.value).toBe('Series ignored');
        expect(axiosGet).toHaveBeenCalled();
        mounted.wrapper.unmount();
    });

    it('a failed ignore restores every occurrence and reports the series error', async () => {
        const mounted = await mountWithSeries();
        axiosPost.mockRejectedValue(httpError(500));
        axiosGet.mockResolvedValue(readResponse([occurrenceA, oneOff, occurrenceB]));

        await mounted.api.ignoreSeries('m-a');
        await advance(0);

        expect(cached(mounted, WEEK_B_KEY)).toEqual([nextWeek]);
        expect(cached(mounted, INCLUDE_KEY)).toEqual([occurrenceA, oneOff, occurrenceB]);
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-a', 'm-o', 'm-b']);
        expect(addNotification).toHaveBeenCalledTimes(1);
        expect(addNotification).toHaveBeenCalledWith(
            'error',
            'Could not update this series',
            'Try again in a moment.'
        );
        expect(mounted.api.announcement.value).toBe('');
        mounted.wrapper.unmount();
    });

    it('stop ignoring un-fades the occurrences at once and only announces', async () => {
        localStorage.setItem('solidtime:m365-show-dismissed', 'true');
        const ignoredA = { ...occurrenceA, series_ignored: true };
        const ignoredB = { ...occurrenceB, series_ignored: true };
        axiosGet.mockResolvedValue(readResponse([ignoredA, oneOff, ignoredB]));
        const mounted = mountComposable();
        await advance(500);
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-a', 'm-o', 'm-b']);
        const request = deferred<{ data: Record<string, never> }>();
        axiosDelete.mockReturnValue(request.promise);
        axiosGet.mockResolvedValue(readResponse([occurrenceA, oneOff, occurrenceB]));

        const done = mounted.api.unignoreSeries('m-a');

        expect(mounted.api.meetings.value.map((m) => [m.id, m.series_ignored])).toEqual([
            ['m-a', false],
            ['m-o', undefined],
            ['m-b', false],
        ]);
        expect(axiosDelete).toHaveBeenCalledWith(seriesUrl('m-a', 'ignore'));
        request.resolve({ data: {} });
        await done;
        await advance(0);

        expect(mounted.api.announcement.value).toBe('Series no longer ignored');
        expect(addNotification).not.toHaveBeenCalled();
        mounted.wrapper.unmount();
    });

    it('forget clears the assignment of every occurrence at once and reports success', async () => {
        const mounted = await mountWithSeries();
        const request = deferred<{ data: Record<string, never> }>();
        axiosDelete.mockReturnValue(request.promise);
        axiosGet.mockResolvedValue(
            readResponse([
                { ...occurrenceA, assignment: null },
                oneOff,
                { ...occurrenceB, assignment: null },
            ])
        );

        const done = mounted.api.forgetSeries('m-a');

        expect(mounted.api.meetings.value.map((m) => [m.id, m.assignment ?? null])).toEqual([
            ['m-a', null],
            ['m-o', null],
            ['m-b', null],
        ]);
        expect(cached(mounted, WEEK_B_KEY)[0]?.assignment).toBeNull();
        expect(cached(mounted, INCLUDE_KEY).every((m) => (m.assignment ?? null) === null)).toBe(
            true
        );
        expect(axiosDelete).toHaveBeenCalledWith(seriesUrl('m-a', 'assignment'));
        request.resolve({ data: {} });
        await done;
        await advance(0);

        expect(addNotification).toHaveBeenCalledWith(
            'success',
            'Series forgotten',
            'Its meetings are no longer pre-assigned. Your time entries are unchanged.'
        );
        expect(mounted.api.announcement.value).toBe('Series forgotten');
        mounted.wrapper.unmount();
    });

    it('a failed forget restores the assignments and reports the series error', async () => {
        const mounted = await mountWithSeries();
        axiosDelete.mockRejectedValue(httpError(500));
        axiosGet.mockResolvedValue(readResponse([occurrenceA, oneOff, occurrenceB]));

        await mounted.api.forgetSeries('m-b');
        await advance(0);

        expect(cached(mounted, WEEK_B_KEY)).toEqual([nextWeek]);
        expect(cached(mounted, INCLUDE_KEY)).toEqual([occurrenceA, oneOff, occurrenceB]);
        expect(addNotification).toHaveBeenCalledWith(
            'error',
            'Could not update this series',
            'Try again in a moment.'
        );
        mounted.wrapper.unmount();
    });

    it('sends nothing for a meeting without a series', async () => {
        const mounted = await mountWithSeries();

        await mounted.api.ignoreSeries('m-o');
        await mounted.api.unignoreSeries('m-o');
        await mounted.api.forgetSeries('m-o');

        expect(axiosPost).not.toHaveBeenCalled();
        expect(axiosDelete).not.toHaveBeenCalled();
        expect(addNotification).not.toHaveBeenCalled();
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-a', 'm-o', 'm-b']);
        expect(cached(mounted, WEEK_B_KEY)).toEqual([nextWeek]);
        mounted.wrapper.unmount();
    });

    it('hides ignored occurrences and leaves them out of visibleCount unless dismissed meetings are shown', async () => {
        const mounted = mountComposable();
        await advance(500);
        (
            window as unknown as {
                __TEST_SET_OUTLOOK_MEETINGS__: (list: OutlookMeeting[]) => void;
            }
        ).__TEST_SET_OUTLOOK_MEETINGS__([{ ...occurrenceA, series_ignored: true }, oneOff]);
        await nextTick();

        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-o']);
        expect(mounted.api.visibleCount.value).toBe(1);

        mounted.api.includeDismissed.value = true;
        await nextTick();

        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-a', 'm-o']);
        expect(mounted.api.visibleCount.value).toBe(2);
        mounted.wrapper.unmount();
    });

    it('preassignedInRange lists visible, not faded, not pending pre-assigned meetings in start order', async () => {
        const TEST_CONVERT_URL = 'https://example.test/convert';
        const mounted = mountComposable();
        await advance(500);
        const dismissedWithAssignment: OutlookMeeting = {
            ...meeting('m-d', '2026-11-04T07:00:00Z', '2026-11-04T08:00:00Z'),
            series_key: 'D',
            assignment,
            dismissed: true,
        };
        const later: OutlookMeeting = {
            ...meeting('m-l', '2026-11-06T09:00:00Z', '2026-11-06T10:00:00Z'),
            series_key: 'L',
            assignment,
        };
        (
            window as unknown as {
                __TEST_SET_OUTLOOK_MEETINGS__: (
                    list: OutlookMeeting[],
                    labels?: Partial<OutlookCalendarLabels>,
                    options?: { actions?: boolean; convertUrl?: string }
                ) => void;
            }
        ).__TEST_SET_OUTLOOK_MEETINGS__(
            [later, occurrenceB, oneOff, dismissedWithAssignment, occurrenceA, nextWeek],
            undefined,
            { actions: true, convertUrl: TEST_CONVERT_URL }
        );
        mounted.api.includeDismissed.value = true;
        await nextTick();

        expect(mounted.api.preassignedInRange.value.map((m) => m.id)).toEqual([
            'm-a',
            'm-b',
            'm-l',
        ]);

        // A pending confirm leaves the list until it settles
        const request = deferred<{ data: { results: unknown[] } }>();
        axiosPost.mockReturnValue(request.promise);
        const done = mounted.api.confirmPreassigned(['m-b']);
        expect(mounted.api.preassignedInRange.value.map((m) => m.id)).toEqual(['m-a', 'm-l']);
        request.resolve({
            data: {
                results: [
                    { meeting_id: 'm-b', status: 'failed', time_entry_id: null, error: null },
                ],
            },
        });
        await done;
        expect(mounted.api.preassignedInRange.value.map((m) => m.id)).toEqual([
            'm-a',
            'm-b',
            'm-l',
        ]);

        // Day view of Tuesday Nov 3
        mounted.start.value = weekStartOf(WEEK_A).add(1, 'day');
        mounted.end.value = weekStartOf(WEEK_A).add(2, 'day');
        await nextTick();
        expect(mounted.api.preassignedInRange.value.map((m) => m.id)).toEqual(['m-a']);
        mounted.wrapper.unmount();
    });

    describe('in test-hook mode', () => {
        const TEST_SERIES_URL = 'https://example.test/series';

        function hook(
            meetings: OutlookMeeting[],
            options?: { actions?: boolean; seriesUrl?: string }
        ): void {
            (
                window as unknown as {
                    __TEST_SET_OUTLOOK_MEETINGS__: (
                        meetings: OutlookMeeting[],
                        labels?: Partial<OutlookCalendarLabels>,
                        options?: { actions?: boolean; seriesUrl?: string }
                    ) => void;
                }
            ).__TEST_SET_OUTLOOK_MEETINGS__(meetings, undefined, options);
        }

        async function mountHooked(options?: {
            actions?: boolean;
            seriesUrl?: string;
        }): Promise<Mounted> {
            const mounted = mountComposable();
            await advance(500);
            hook([occurrenceA, oneOff, occurrenceB], options);
            await nextTick();
            axiosPost.mockClear();
            axiosDelete.mockClear();
            return mounted;
        }

        it('ignore flags the injected occurrences and requests the hook url', async () => {
            const mounted = await mountHooked({ actions: true, seriesUrl: TEST_SERIES_URL });
            const invalidate = vi.spyOn(mounted.queryClient, 'invalidateQueries');
            axiosPost.mockResolvedValue({ data: {} });

            await mounted.api.ignoreSeries('m-a');

            expect(axiosPost).toHaveBeenCalledTimes(1);
            expect(axiosPost).toHaveBeenCalledWith(`${TEST_SERIES_URL}/m-a/series/ignore`);
            expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-o']);
            mounted.api.includeDismissed.value = true;
            await nextTick();
            expect(mounted.api.meetings.value.map((m) => [m.id, m.series_ignored])).toEqual([
                ['m-a', true],
                ['m-o', undefined],
                ['m-b', true],
            ]);
            // Injected meetings are not server rows: the real read is left alone
            expect(invalidate).not.toHaveBeenCalled();
            mounted.wrapper.unmount();
        });

        it('forget clears the injected assignments and a failure restores them', async () => {
            const mounted = await mountHooked({ actions: true, seriesUrl: TEST_SERIES_URL });
            axiosDelete.mockResolvedValueOnce({ data: {} });

            await mounted.api.forgetSeries('m-b');

            expect(axiosDelete).toHaveBeenCalledWith(`${TEST_SERIES_URL}/m-b/series/assignment`);
            expect(mounted.api.meetings.value.map((m) => m.assignment ?? null)).toEqual([
                null,
                null,
                null,
            ]);

            hook([occurrenceA, oneOff, occurrenceB], {
                actions: true,
                seriesUrl: TEST_SERIES_URL,
            });
            await nextTick();
            axiosDelete.mockRejectedValueOnce(httpError(500));

            await mounted.api.forgetSeries('m-b');

            expect(mounted.api.meetings.value).toEqual([occurrenceA, oneOff, occurrenceB]);
            expect(addNotification).toHaveBeenLastCalledWith(
                'error',
                'Could not update this series',
                'Try again in a moment.'
            );
            mounted.wrapper.unmount();
        });

        it('without seriesUrl the actions send nothing and change nothing', async () => {
            const mounted = await mountHooked({ actions: true });

            await mounted.api.ignoreSeries('m-a');
            await mounted.api.forgetSeries('m-a');

            expect(axiosPost).not.toHaveBeenCalled();
            expect(axiosDelete).not.toHaveBeenCalled();
            expect(mounted.api.meetings.value).toEqual([occurrenceA, oneOff, occurrenceB]);
            mounted.wrapper.unmount();
        });

        it('without actions it cannot act and sends nothing', async () => {
            const mounted = await mountHooked({ seriesUrl: TEST_SERIES_URL });
            expect(mounted.api.canAct.value).toBe(false);

            await mounted.api.ignoreSeries('m-a');
            await mounted.api.unignoreSeries('m-a');
            await mounted.api.forgetSeries('m-a');

            expect(axiosPost).not.toHaveBeenCalled();
            expect(axiosDelete).not.toHaveBeenCalled();
            expect(mounted.api.meetings.value).toEqual([occurrenceA, oneOff, occurrenceB]);
            mounted.wrapper.unmount();
        });
    });
});

// --- Phase 6: out-of-sync flags (06-07)

function flagItem(
    id: string,
    kind: OutlookOutOfSyncItem['kind'],
    entryStart: string,
    overrides: Partial<OutlookOutOfSyncItem> = {}
): OutlookOutOfSyncItem {
    const entryEnd = new Date(Date.parse(entryStart) + 3_600_000).toISOString().replace('.000', '');
    return {
        time_entry_id: id,
        kind,
        meeting_start: entryStart,
        meeting_end: entryEnd,
        new_start: null,
        new_end: null,
        all_day: false,
        entry_start: entryStart,
        entry_end: entryEnd,
        description: `Entry ${id}`,
        ...overrides,
    };
}

// A: moved, entry on Tuesday; B: cancelled, entry on Monday (the earliest, so the first flag).
const FLAG_A = flagItem('te-a', 'moved', '2026-11-03T10:00:00Z', {
    new_start: '2026-11-04T12:00:00Z',
    new_end: '2026-11-04T13:00:00Z',
});
const FLAG_B = flagItem('te-b', 'cancelled', '2026-11-02T09:00:00Z');

function flagsRead(
    items: OutlookOutOfSyncItem[],
    meetings: OutlookMeeting[] = []
): { data: OutlookMeetingsResponse } {
    return {
        data: {
            data: meetings,
            sync: { last_synced_at: null, retry_after: null },
            out_of_sync: { items },
        },
    };
}

function invalidatedKeysOf(spy: { mock: { calls: unknown[][] } }): unknown[] {
    return spy.mock.calls.map((call) => (call[0] as { queryKey?: unknown } | undefined)?.queryKey);
}

async function mountWithFlags(
    items: OutlookOutOfSyncItem[] = [FLAG_A, FLAG_B],
    meetings: OutlookMeeting[] = []
): Promise<Mounted> {
    axiosGet.mockResolvedValue(flagsRead(items, meetings));
    const mounted = mountComposable();
    await advance(500);
    axiosPost.mockReset();
    axiosPost.mockResolvedValue({ data: {} });
    addNotification.mockReset();
    return mounted;
}

describe('useOutlookMeetings out-of-sync state and panel request', () => {
    it('exposes the flags of the read, flagOf and the first flag (earliest entry start)', async () => {
        const mounted = await mountWithFlags();

        expect(mounted.api.outOfSync.value.map((item) => item.time_entry_id)).toEqual([
            'te-a',
            'te-b',
        ]);
        expect(mounted.api.flagOf('te-b')).toEqual(FLAG_B);
        expect(mounted.api.flagOf('te-x')).toBeNull();
        expect(mounted.api.firstOutOfSync.value?.time_entry_id).toBe('te-b');
        mounted.wrapper.unmount();
    });

    it('is empty and inert while it cannot act (injected meetings without actions)', async () => {
        const mounted = await mountWithFlags();
        (
            window as unknown as {
                __TEST_SET_OUTLOOK_MEETINGS__: (list: OutlookMeeting[]) => void;
            }
        ).__TEST_SET_OUTLOOK_MEETINGS__([]);
        await nextTick();

        expect(mounted.api.canAct.value).toBe(false);
        expect(mounted.api.outOfSync.value).toEqual([]);
        expect(mounted.api.flagOf('te-a')).toBeNull();
        expect(mounted.api.firstOutOfSync.value).toBeNull();
        mounted.api.openFlagPanel('te-a');
        expect(mounted.api.flagPanel.value).toBeNull();
        const result = await mounted.api.keepFlag('te-a');
        expect(result.status).toBe('failed');
        expect(axiosPost).not.toHaveBeenCalled();
        mounted.wrapper.unmount();
    });

    it('is empty without the calendar prop (impersonation, D-14)', async () => {
        setPage(null);
        axiosGet.mockResolvedValue(flagsRead([FLAG_A]));
        const mounted = mountComposable();
        await advance(500);

        expect(mounted.api.outOfSync.value).toEqual([]);
        expect(mounted.api.firstOutOfSync.value).toBeNull();
        mounted.wrapper.unmount();
    });

    it('hides the flags and closes the popover once a sync answers not_connected (D-19)', async () => {
        const mounted = await mountWithFlags();
        mounted.api.openFlagPanel('te-a');
        expect(mounted.api.flagPanel.value).not.toBeNull();
        axiosPost.mockResolvedValue(syncResponse({ status: 'not_connected' }));

        mounted.api.requestSync(true);
        await advance(0);

        expect(mounted.api.connectionState.value).toBe('not_connected');
        expect(mounted.api.outOfSync.value).toEqual([]);
        expect(mounted.api.flagPanel.value).toBeNull();
        mounted.wrapper.unmount();
    });

    it('openFlagPanel requests the popover with a new seq each call and ignores unknown ids', async () => {
        const mounted = await mountWithFlags();

        mounted.api.openFlagPanel('te-a');
        expect(mounted.api.flagPanel.value).toEqual({
            timeEntryId: 'te-a',
            anchor: 'entry',
            origin: 'entry',
            seq: 1,
        });

        mounted.api.openFlagPanel('te-a');
        expect(mounted.api.flagPanel.value?.seq).toBe(2);

        mounted.api.openFlagPanel('unknown');
        expect(mounted.api.flagPanel.value?.timeEntryId).toBe('te-a');
        expect(mounted.api.flagPanel.value?.seq).toBe(2);

        mounted.api.openFlagPanel('te-b', { anchor: 'counter', origin: 'counter' });
        expect(mounted.api.flagPanel.value).toEqual({
            timeEntryId: 'te-b',
            anchor: 'counter',
            origin: 'counter',
            seq: 3,
        });

        mounted.api.closeFlagPanel();
        expect(mounted.api.flagPanel.value).toBeNull();
        mounted.wrapper.unmount();
    });
});

describe('useOutlookMeetings keepFlag', () => {
    it('posts keep, is pending until it settles, then invalidates and announces without a toast', async () => {
        const mounted = await mountWithFlags();
        const invalidate = vi.spyOn(mounted.queryClient, 'invalidateQueries');
        const request = deferred<{ data: unknown }>();
        axiosPost.mockReturnValue(request.promise);
        // Keep the refetch from settling so the change made after the answer is observed
        axiosGet.mockReturnValue(new Promise(() => undefined));
        mounted.api.openFlagPanel('te-a');

        const done = mounted.api.keepFlag('te-a');

        expect(axiosPost).toHaveBeenCalledTimes(1);
        expect(axiosPost.mock.calls[0]![0]).toBe(`${OSYNC_URL}/te-a/keep`);
        expect(mounted.api.isFlagPending('te-a')).toBe(true);
        expect(mounted.api.isFlagPending('te-b')).toBe(false);
        // Pessimistic: the flag is still listed while the request runs
        expect(mounted.api.flagOf('te-a')).not.toBeNull();
        const again = await mounted.api.keepFlag('te-a');
        expect(again).toEqual({ status: 'failed', message: '' });
        expect(axiosPost).toHaveBeenCalledTimes(1);

        request.resolve({ data: {} });
        const result = await done;
        await advance(0);

        expect(result).toEqual({ status: 'ok' });
        expect(mounted.api.isFlagPending('te-a')).toBe(false);
        expect(mounted.api.flagOf('te-a')).toBeNull();
        expect(mounted.api.outOfSync.value.map((item) => item.time_entry_id)).toEqual(['te-b']);
        expect(mounted.api.flagPanel.value).toBeNull();
        const keys = invalidatedKeysOf(invalidate);
        expect(keys).toContainEqual(['timeEntries']);
        expect(keys).toContainEqual(['goals']);
        expect(keys).toContainEqual(['m365', 'meetings']);
        expect(mounted.api.announcement.value).toBe('Kept as is');
        expect(addNotification).not.toHaveBeenCalled();
        mounted.wrapper.unmount();
    });

    it('a 404 answer is stale: the toast, a refresh and the popover closes', async () => {
        const mounted = await mountWithFlags();
        const invalidate = vi.spyOn(mounted.queryClient, 'invalidateQueries');
        axiosPost.mockRejectedValue(httpError(404));
        mounted.api.openFlagPanel('te-a');

        const result = await mounted.api.keepFlag('te-a');

        expect(result).toEqual({ status: 'stale' });
        expect(addNotification).toHaveBeenCalledTimes(1);
        expect(addNotification).toHaveBeenCalledWith(
            'error',
            'This entry changed in the meantime',
            'The calendar was refreshed.'
        );
        const keys = invalidatedKeysOf(invalidate);
        expect(keys).toContainEqual(['timeEntries']);
        expect(keys).toContainEqual(['m365', 'meetings']);
        expect(mounted.api.flagPanel.value).toBeNull();
        expect(mounted.api.isFlagPending('te-a')).toBe(false);
        mounted.wrapper.unmount();
    });

    it('a 409 answer is stale as well', async () => {
        const mounted = await mountWithFlags();
        axiosPost.mockRejectedValue(httpError(409));

        expect(await mounted.api.keepFlag('te-a')).toEqual({ status: 'stale' });
        mounted.wrapper.unmount();
    });

    it('a 500 answer fails with the retry copy and the osync_keep_failed toast, keeping the flag', async () => {
        const mounted = await mountWithFlags();
        const invalidate = vi.spyOn(mounted.queryClient, 'invalidateQueries');
        axiosPost.mockRejectedValue(httpError(500));
        mounted.api.openFlagPanel('te-a');

        const result = await mounted.api.keepFlag('te-a');
        await advance(0);

        expect(result).toEqual({ status: 'failed', message: 'Try again in a moment.' });
        expect(addNotification).toHaveBeenCalledTimes(1);
        expect(addNotification).toHaveBeenCalledWith(
            'error',
            'Could not save your choice',
            'Try again in a moment.'
        );
        expect(mounted.api.flagOf('te-a')).not.toBeNull();
        // The popover stays open for the inline alert
        expect(mounted.api.flagPanel.value?.timeEntryId).toBe('te-a');
        expect(mounted.api.announcement.value).toBe('');
        expect(invalidatedKeysOf(invalidate)).not.toContainEqual(['timeEntries']);
        mounted.wrapper.unmount();
    });

    it('sends nothing without an out_of_sync url', async () => {
        const mounted = await mountWithFlags();
        delete (pageProps.microsoft as { calendar: OutlookCalendarProps }).calendar.urls
            .out_of_sync;

        const result = await mounted.api.keepFlag('te-a');

        expect(result).toEqual({ status: 'failed', message: 'Try again in a moment.' });
        expect(axiosPost).not.toHaveBeenCalled();
        mounted.wrapper.unmount();
    });
});

function validationError(message: string): Error {
    return Object.assign(new Error('HTTP 422'), {
        response: { status: 422, headers: {}, data: { message } },
    });
}

describe('useOutlookMeetings adjustFlag', () => {
    it('posts adjust and on success invalidates, toasts the new range and announces', async () => {
        const mounted = await mountWithFlags();
        const invalidate = vi.spyOn(mounted.queryClient, 'invalidateQueries');
        axiosGet.mockReturnValue(new Promise(() => undefined));

        const result = await mounted.api.adjustFlag('te-a');
        await advance(0);

        expect(result).toEqual({ status: 'ok' });
        expect(axiosPost).toHaveBeenCalledTimes(1);
        expect(axiosPost.mock.calls[0]![0]).toBe(`${OSYNC_URL}/te-a/adjust`);
        const keys = invalidatedKeysOf(invalidate);
        expect(keys).toContainEqual(['timeEntries']);
        expect(keys).toContainEqual(['goals']);
        expect(keys).toContainEqual(['m365', 'meetings']);
        expect(addNotification).toHaveBeenCalledTimes(1);
        expect(addNotification).toHaveBeenCalledWith(
            'success',
            'Time entry adjusted to Outlook',
            'Wed, Nov 4 · 12:00 – 13:00'
        );
        expect(mounted.api.announcement.value).toBe('Time entry adjusted to Outlook');
        expect(mounted.api.flagOf('te-a')).toBeNull();
        mounted.wrapper.unmount();
    });

    it("names the new range in the organization's 12-hour format", async () => {
        const mounted = await mountWithFlags();
        mounted.queryClient.setQueryData(['organization', 'org-1'], {
            data: { time_format: '12-hours' },
        });

        await mounted.api.adjustFlag('te-a');

        const message = addNotification.mock.calls[0]?.[2] as string;
        expect(message.startsWith('Wed, Nov 4 · 12:00')).toBe(true);
        expect(message).toContain('PM');
        mounted.wrapper.unmount();
    });

    it("a 422 answer fails with the server's message (overlap) and the osync_adjust_failed toast", async () => {
        const mounted = await mountWithFlags();
        axiosPost.mockRejectedValue(validationError('Overlaps another entry'));

        const result = await mounted.api.adjustFlag('te-a');

        expect(result).toEqual({ status: 'failed', message: 'Overlaps another entry' });
        expect(addNotification).toHaveBeenCalledTimes(1);
        expect(addNotification).toHaveBeenCalledWith(
            'error',
            'Could not adjust the time entry',
            'Overlaps another entry'
        );
        expect(mounted.api.flagOf('te-a')).not.toBeNull();
        mounted.wrapper.unmount();
    });

    it('a 403 answer fails with the forbidden copy', async () => {
        const mounted = await mountWithFlags();
        axiosPost.mockRejectedValue(httpError(403));

        const result = await mounted.api.adjustFlag('te-a');

        expect(result).toEqual({ status: 'failed', message: "You can't edit this time entry." });
        expect(addNotification).toHaveBeenCalledWith(
            'error',
            'Could not adjust the time entry',
            "You can't edit this time entry."
        );
        mounted.wrapper.unmount();
    });
});

describe('useOutlookMeetings deleteFlaggedEntry', () => {
    it('deletes through the core API of the current organization, invalidates and announces', async () => {
        const mounted = await mountWithFlags();
        const invalidate = vi.spyOn(mounted.queryClient, 'invalidateQueries');
        axiosGet.mockReturnValue(new Promise(() => undefined));
        const request = deferred<undefined>();
        deleteTimeEntry.mockReturnValue(request.promise);

        const done = mounted.api.deleteFlaggedEntry('te-b');
        expect(mounted.api.isFlagPending('te-b')).toBe(true);
        request.resolve(undefined);
        const result = await done;
        await advance(0);

        expect(result).toEqual({ status: 'ok' });
        expect(deleteTimeEntry).toHaveBeenCalledTimes(1);
        expect(deleteTimeEntry).toHaveBeenCalledWith(undefined, {
            params: { organization: 'org-1', timeEntry: 'te-b' },
        });
        expect(axiosPost).not.toHaveBeenCalled();
        const keys = invalidatedKeysOf(invalidate);
        expect(keys).toContainEqual(['timeEntries']);
        expect(keys).toContainEqual(['goals']);
        expect(keys).toContainEqual(['m365', 'meetings']);
        expect(addNotification).toHaveBeenCalledTimes(1);
        expect(addNotification).toHaveBeenCalledWith('success', 'Time entry deleted successfully');
        expect(mounted.api.announcement.value).toBe('Time entry deleted');
        expect(mounted.api.flagOf('te-b')).toBeNull();
        expect(mounted.api.isFlagPending('te-b')).toBe(false);
        mounted.wrapper.unmount();
    });

    it('a 404 answer is stale', async () => {
        const mounted = await mountWithFlags();
        deleteTimeEntry.mockRejectedValue(httpError(404));

        const result = await mounted.api.deleteFlaggedEntry('te-b');

        expect(result).toEqual({ status: 'stale' });
        expect(addNotification).toHaveBeenCalledWith(
            'error',
            'This entry changed in the meantime',
            'The calendar was refreshed.'
        );
        mounted.wrapper.unmount();
    });

    it('another failure toasts osync_delete_failed and keeps the flag', async () => {
        const mounted = await mountWithFlags();
        deleteTimeEntry.mockRejectedValue(httpError(500));

        const result = await mounted.api.deleteFlaggedEntry('te-b');

        expect(result).toEqual({ status: 'failed', message: 'Try again in a moment.' });
        expect(addNotification).toHaveBeenCalledTimes(1);
        expect(addNotification).toHaveBeenCalledWith(
            'error',
            'Could not delete the time entry',
            'Try again in a moment.'
        );
        expect(mounted.api.flagOf('te-b')).not.toBeNull();
        mounted.wrapper.unmount();
    });

    it('never deletes an entry that is not flagged (stale, no request)', async () => {
        const mounted = await mountWithFlags();

        const result = await mounted.api.deleteFlaggedEntry('te-unflagged');

        expect(result).toEqual({ status: 'stale' });
        expect(deleteTimeEntry).not.toHaveBeenCalled();
        mounted.wrapper.unmount();
    });

    it('sends nothing without a current organization', async () => {
        const mounted = await mountWithFlags();
        organization.id = undefined;

        const result = await mounted.api.deleteFlaggedEntry('te-b');

        expect(result).toEqual({ status: 'failed', message: 'Try again in a moment.' });
        expect(deleteTimeEntry).not.toHaveBeenCalled();
        mounted.wrapper.unmount();
    });
});

describe('useOutlookMeetings moveEntry (D-03) and auto-adjusts', () => {
    const moved: OutlookMeeting = {
        ...meeting('m-moved', '2026-11-04T12:00:00Z', '2026-11-04T13:00:00Z'),
        moved_from: {
            time_entry_id: 'te-old',
            entry_start: '2026-11-02T10:00:00Z',
            entry_end: '2026-11-02T11:00:00Z',
        },
    };
    const other = meeting('m-other', '2026-11-05T09:00:00Z', '2026-11-05T10:00:00Z');
    const adjusted = {
        time_entry_id: 'te-adj',
        at: '2026-11-05T08:00:00Z',
        from_start: '2026-11-03T10:00:00Z',
        from_end: '2026-11-03T11:00:00Z',
        to_start: '2026-11-04T10:00:00Z',
        to_end: '2026-11-04T11:00:00Z',
    };

    function moveCalls() {
        return axiosPost.mock.calls.filter((call) => String(call[0]).endsWith('/move-entry'));
    }

    it('posts the move, is pending meanwhile and on success the meeting leaves the lane', async () => {
        const mounted = await mountWithFlags([], [moved, other]);
        const invalidate = vi.spyOn(mounted.queryClient, 'invalidateQueries');
        axiosGet.mockReturnValue(new Promise(() => undefined));
        const request = deferred<{ data: unknown }>();
        axiosPost.mockReturnValue(request.promise);

        const done = mounted.api.moveEntry('m-moved');

        expect(moveCalls()).toHaveLength(1);
        expect(moveCalls()[0]![0]).toBe(`${ORG_MEETINGS_URL}/m-moved/move-entry`);
        expect(mounted.api.isMovePending('m-moved')).toBe(true);
        expect(mounted.api.isMovePending('m-other')).toBe(false);
        expect(await mounted.api.moveEntry('m-moved')).toEqual({ status: 'failed', message: '' });
        expect(moveCalls()).toHaveLength(1);
        // Pessimistic: the meeting stays until the answer
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-moved', 'm-other']);

        request.resolve({ data: {} });
        const result = await done;
        await advance(0);

        expect(result).toEqual({ status: 'ok' });
        expect(mounted.api.isMovePending('m-moved')).toBe(false);
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-other']);
        expect(mounted.api.linkedTimeEntryIds.value).toContain('te-old');
        const keys = invalidatedKeysOf(invalidate);
        expect(keys).toContainEqual(['timeEntries']);
        expect(keys).toContainEqual(['goals']);
        expect(keys).toContainEqual(['m365', 'meetings']);
        expect(addNotification).toHaveBeenCalledTimes(1);
        expect(addNotification).toHaveBeenCalledWith(
            'success',
            'Time entry moved here',
            'From Mon, Nov 2 · 10:00 – 11:00'
        );
        expect(mounted.api.announcement.value).toBe('Time entry moved');
        mounted.wrapper.unmount();
    });

    it('a failed move toasts move_entry_failed and keeps the meeting', async () => {
        const mounted = await mountWithFlags([], [moved]);
        axiosPost.mockRejectedValue(httpError(500));

        const result = await mounted.api.moveEntry('m-moved');

        expect(result).toEqual({ status: 'failed', message: 'Try again in a moment.' });
        expect(addNotification).toHaveBeenCalledTimes(1);
        expect(addNotification).toHaveBeenCalledWith(
            'error',
            'Could not move the time entry',
            'Try again in a moment.'
        );
        expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-moved']);
        expect(mounted.api.isMovePending('m-moved')).toBe(false);
        mounted.wrapper.unmount();
    });

    it('a stale move toasts osync_stale and refreshes', async () => {
        const mounted = await mountWithFlags([], [moved]);
        const invalidate = vi.spyOn(mounted.queryClient, 'invalidateQueries');
        axiosPost.mockRejectedValue(httpError(409));

        const result = await mounted.api.moveEntry('m-moved');

        expect(result).toEqual({ status: 'stale' });
        expect(addNotification).toHaveBeenCalledWith(
            'error',
            'This entry changed in the meantime',
            'The calendar was refreshed.'
        );
        expect(invalidatedKeysOf(invalidate)).toContainEqual(['m365', 'meetings']);
        mounted.wrapper.unmount();
    });

    it('autoAdjustedOf reads the silent adjusts of the read', async () => {
        axiosGet.mockResolvedValue({
            data: {
                data: [],
                sync: { last_synced_at: null, retry_after: null },
                auto_adjusted: [adjusted],
            },
        });
        const mounted = mountComposable();
        await advance(500);

        expect(mounted.api.autoAdjustedOf('te-adj')).toEqual(adjusted);
        expect(mounted.api.autoAdjustedOf('te-x')).toBeNull();
        mounted.wrapper.unmount();
    });

    it('nothing is sent and every action fails while it cannot act', async () => {
        const mounted = await mountWithFlags([FLAG_A, FLAG_B], [moved]);
        (
            window as unknown as {
                __TEST_SET_OUTLOOK_MEETINGS__: (list: OutlookMeeting[]) => void;
            }
        ).__TEST_SET_OUTLOOK_MEETINGS__([moved]);
        await nextTick();
        expect(mounted.api.canAct.value).toBe(false);

        expect((await mounted.api.keepFlag('te-a')).status).toBe('failed');
        expect((await mounted.api.adjustFlag('te-a')).status).toBe('failed');
        expect((await mounted.api.deleteFlaggedEntry('te-b')).status).toBe('failed');
        expect((await mounted.api.moveEntry('m-moved')).status).toBe('failed');

        expect(axiosPost).not.toHaveBeenCalled();
        expect(deleteTimeEntry).not.toHaveBeenCalled();
        expect(addNotification).not.toHaveBeenCalled();
        expect(mounted.api.autoAdjustedOf('te-adj')).toBeNull();
        mounted.wrapper.unmount();
    });

    describe('in test-hook mode', () => {
        type Phase6HookOptions = {
            actions?: boolean;
            outOfSync?: OutlookOutOfSyncItem[];
            autoAdjusted?: (typeof adjusted)[];
            outOfSyncUrl?: string;
            moveEntryUrl?: string;
        };

        function hook(meetings: OutlookMeeting[], options: Phase6HookOptions): void {
            (
                window as unknown as {
                    __TEST_SET_OUTLOOK_MEETINGS__: (
                        meetings: OutlookMeeting[],
                        labels: undefined,
                        options: Phase6HookOptions
                    ) => void;
                }
            ).__TEST_SET_OUTLOOK_MEETINGS__(meetings, undefined, options);
        }

        async function mountHook(options: Phase6HookOptions): Promise<Mounted> {
            const mounted = mountComposable();
            await advance(500);
            hook([moved, other], options);
            await nextTick();
            axiosPost.mockReset();
            axiosPost.mockResolvedValue({ data: {} });
            return mounted;
        }

        it('injects the flags and the auto-adjusts, and acts through the hook urls', async () => {
            const mounted = await mountHook({
                actions: true,
                outOfSync: [FLAG_A, FLAG_B],
                autoAdjusted: [adjusted],
                outOfSyncUrl: '/hook/osync',
                moveEntryUrl: '/hook/org-meetings',
            });
            const invalidate = vi.spyOn(mounted.queryClient, 'invalidateQueries');

            expect(mounted.api.outOfSync.value).toEqual([FLAG_A, FLAG_B]);
            expect(mounted.api.autoAdjustedOf('te-adj')).toEqual(adjusted);

            expect(await mounted.api.keepFlag('te-a')).toEqual({ status: 'ok' });
            expect(axiosPost.mock.calls[0]![0]).toBe('/hook/osync/te-a/keep');
            expect(mounted.api.outOfSync.value).toEqual([FLAG_B]);

            expect(await mounted.api.deleteFlaggedEntry('te-b')).toEqual({ status: 'ok' });
            expect(mounted.api.outOfSync.value).toEqual([]);

            expect(await mounted.api.moveEntry('m-moved')).toEqual({ status: 'ok' });
            expect(axiosPost.mock.calls[1]![0]).toBe('/hook/org-meetings/m-moved/move-entry');
            expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-other']);
            expect(mounted.api.linkedTimeEntryIds.value).toEqual(['te-old']);

            // Injected meetings are not server rows: the real read is left alone
            expect(invalidatedKeysOf(invalidate)).not.toContainEqual(['m365', 'meetings']);
            expect(invalidatedKeysOf(invalidate)).toContainEqual(['timeEntries']);
            mounted.wrapper.unmount();
        });

        it('adjust removes the injected flag as well', async () => {
            const mounted = await mountHook({
                actions: true,
                outOfSync: [FLAG_A],
                outOfSyncUrl: '/hook/osync',
            });

            expect(await mounted.api.adjustFlag('te-a')).toEqual({ status: 'ok' });
            expect(axiosPost.mock.calls[0]![0]).toBe('/hook/osync/te-a/adjust');
            expect(mounted.api.outOfSync.value).toEqual([]);
            mounted.wrapper.unmount();
        });

        it('without the urls keep, adjust and move fail without a request', async () => {
            const mounted = await mountHook({ actions: true, outOfSync: [FLAG_A] });

            expect((await mounted.api.keepFlag('te-a')).status).toBe('failed');
            expect((await mounted.api.adjustFlag('te-a')).status).toBe('failed');
            expect((await mounted.api.moveEntry('m-moved')).status).toBe('failed');

            expect(axiosPost).not.toHaveBeenCalled();
            expect(mounted.api.outOfSync.value).toEqual([FLAG_A]);
            expect(mounted.api.meetings.value.map((m) => m.id)).toEqual(['m-moved', 'm-other']);
            mounted.wrapper.unmount();
        });

        it('works without the calendar prop (integration off in CI)', async () => {
            setPage(null);
            const mounted = mountComposable();
            await advance(500);
            (
                window as unknown as {
                    __TEST_SET_OUTLOOK_MEETINGS__: (
                        meetings: OutlookMeeting[],
                        labels: Record<string, string>,
                        options: Phase6HookOptions
                    ) => void;
                }
            ).__TEST_SET_OUTLOOK_MEETINGS__(
                [moved],
                { retry_body: 'Retry.', osync_kept: 'Kept.' },
                { actions: true, outOfSync: [FLAG_A], outOfSyncUrl: '/hook/osync' }
            );
            await nextTick();
            axiosPost.mockResolvedValue({ data: {} });

            expect(mounted.api.outOfSync.value).toEqual([FLAG_A]);
            expect(await mounted.api.keepFlag('te-a')).toEqual({ status: 'ok' });
            await advance(0);
            expect(mounted.api.announcement.value).toBe('Kept.');
            mounted.wrapper.unmount();
        });
    });
});

describe('useOutlookMeetings jumpToFirst', () => {
    // FLAG_B (te-b, Monday 2026-11-02) is the first flag.
    const blocks: HTMLElement[] = [];

    function insertBlock(timeEntryId: string) {
        const block = document.createElement('div');
        block.setAttribute('data-event-id', timeEntryId);
        block.tabIndex = 0;
        const scrollIntoView = vi.fn();
        block.scrollIntoView = scrollIntoView;
        const focus = vi.spyOn(block, 'focus');
        document.body.appendChild(block);
        blocks.push(block);
        return { block, scrollIntoView, focus };
    }

    afterEach(() => {
        blocks.splice(0).forEach((block) => block.remove());
        vi.unstubAllGlobals();
    });

    it('opens in place when the block is rendered: no navigation, centred, focused', async () => {
        const mounted = await mountWithFlags();
        const navigator = vi.fn();
        mounted.api.setCalendarNavigator(navigator);
        const { scrollIntoView, focus } = insertBlock('te-b');

        await mounted.api.jumpToFirst();

        expect(navigator).not.toHaveBeenCalled();
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
        expect(focus).toHaveBeenCalledWith({ preventScroll: true });
        expect(mounted.api.flagPanel.value).toEqual({
            timeEntryId: 'te-b',
            anchor: 'entry',
            origin: 'counter',
            seq: 1,
        });
        expect(mounted.api.jumpBusy.value).toBe(false);
        mounted.wrapper.unmount();
    });

    it('does not scroll smoothly with prefers-reduced-motion', async () => {
        const mounted = await mountWithFlags();
        vi.stubGlobal(
            'matchMedia',
            vi.fn((query: string) => ({ matches: query.includes('reduce'), media: query }))
        );
        const { scrollIntoView } = insertBlock('te-b');

        await mounted.api.jumpToFirst();

        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
        mounted.wrapper.unmount();
    });

    it("navigates to the entry's local day and opens on the block once it appears", async () => {
        vi.mocked(window.getTimezoneSetting).mockReturnValue('America/New_York');
        try {
            // 03:00 UTC on Dec 1 is still Nov 30 in New York
            const late = flagItem('te-late', 'removed', '2026-12-01T03:00:00Z');
            const mounted = await mountWithFlags([late]);
            const navigator = vi.fn();
            mounted.api.setCalendarNavigator(navigator);

            const done = mounted.api.jumpToFirst();
            expect(mounted.api.jumpBusy.value).toBe(true);
            await advance(0);
            expect(navigator).toHaveBeenCalledTimes(1);
            expect(navigator).toHaveBeenCalledWith('2026-11-30');
            expect(mounted.api.flagPanel.value).toBeNull();

            const { focus } = insertBlock('te-late');
            await advance(100);
            await done;

            expect(focus).toHaveBeenCalledWith({ preventScroll: true });
            expect(mounted.api.flagPanel.value).toEqual({
                timeEntryId: 'te-late',
                anchor: 'entry',
                origin: 'counter',
                seq: 1,
            });
            expect(mounted.api.jumpBusy.value).toBe(false);
            mounted.wrapper.unmount();
        } finally {
            vi.mocked(window.getTimezoneSetting).mockReturnValue('UTC');
        }
    });

    it('falls back to the counter anchor 3 s after the data settled without the block', async () => {
        const mounted = await mountWithFlags();
        const navigator = vi.fn();
        mounted.api.setCalendarNavigator(navigator);

        const done = mounted.api.jumpToFirst();
        await advance(0);
        expect(navigator).toHaveBeenCalledWith('2026-11-02');

        // Further clicks during the jump are ignored
        await mounted.api.jumpToFirst();
        expect(navigator).toHaveBeenCalledTimes(1);

        await advance(2_800);
        expect(mounted.api.flagPanel.value).toBeNull();
        expect(mounted.api.jumpBusy.value).toBe(true);

        await advance(300);
        await done;

        expect(mounted.api.flagPanel.value).toEqual({
            timeEntryId: 'te-b',
            anchor: 'counter',
            origin: 'counter',
            seq: 1,
        });
        expect(mounted.api.jumpBusy.value).toBe(false);
        mounted.wrapper.unmount();
    });

    it('without a navigator a jump to an unrendered block falls back after 3 s', async () => {
        const mounted = await mountWithFlags();
        mounted.api.setCalendarNavigator(vi.fn());
        mounted.api.setCalendarNavigator(null);

        const done = mounted.api.jumpToFirst();
        await advance(3_100);
        await done;

        expect(mounted.api.flagPanel.value?.anchor).toBe('counter');
        mounted.wrapper.unmount();
    });

    it('does nothing without flags or while it cannot act', async () => {
        const empty = await mountWithFlags([]);
        const navigator = vi.fn();
        empty.api.setCalendarNavigator(navigator);

        await empty.api.jumpToFirst();

        expect(navigator).not.toHaveBeenCalled();
        expect(empty.api.flagPanel.value).toBeNull();
        expect(empty.api.jumpBusy.value).toBe(false);
        empty.wrapper.unmount();

        setPage(null);
        const inert = mountComposable();
        await advance(500);
        inert.api.setCalendarNavigator(navigator);
        await inert.api.jumpToFirst();
        expect(navigator).not.toHaveBeenCalled();
        inert.wrapper.unmount();
    });
});

describe('useOutlookMeetings auto-adjust announcement', () => {
    async function syncWith(autoAdjusted: number): Promise<{
        mounted: Mounted;
        keys: () => unknown[];
    }> {
        axiosPost.mockResolvedValue(syncResponse({ auto_adjusted: autoAdjusted }));
        const mounted = mountComposable();
        const invalidate = vi.spyOn(mounted.queryClient, 'invalidateQueries');
        await advance(500);
        return { mounted, keys: () => invalidatedKeysOf(invalidate) };
    }

    it('refreshes the time entries and announces the plural text once', async () => {
        const { mounted, keys } = await syncWith(2);

        expect(keys()).toContainEqual(['timeEntries']);
        expect(mounted.api.announcement.value).toBe('2 time entries updated from Outlook');
        expect(addNotification).not.toHaveBeenCalled();
        mounted.wrapper.unmount();
    });

    it('uses the singular text for one entry', async () => {
        const { mounted } = await syncWith(1);

        expect(mounted.api.announcement.value).toBe('1 time entry updated from Outlook');
        mounted.wrapper.unmount();
    });

    it('says nothing and refreshes no time entries when the sync adjusted none', async () => {
        const { mounted, keys } = await syncWith(0);

        expect(keys()).not.toContainEqual(['timeEntries']);
        expect(mounted.api.announcement.value).toBe('');
        mounted.wrapper.unmount();
    });
});
