import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import axios from 'axios';
import type {
    OutlookCalendarLabels,
    OutlookConnectionState,
    OutlookMeeting,
    OutlookMeetingsResponse,
    OutlookSyncResponse,
} from '@/m365/types';
import { getLocalizedDayJs } from '@/packages/ui/src/utils/time';
import OutlookCalendarControls from './OutlookCalendarControls.vue';
import { describeSyncStatus, type SyncStatusInput } from './syncStatus';
import {
    OUTLOOK_MEETINGS_KEY,
    useOutlookMeetings,
    type OutlookMeetingsContext,
} from './useOutlookMeetings';

const { pageProps, navigateTo, routerVisit, addNotification } = vi.hoisted(() => ({
    pageProps: {} as Record<string, unknown>,
    navigateTo: vi.fn(),
    routerVisit: vi.fn(),
    addNotification: vi.fn(),
}));

vi.mock('@/utils/notification', () => ({ useNotificationsStore: () => ({ addNotification }) }));

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => ({ props: pageProps }),
    router: { visit: routerVisit, get: routerVisit, post: routerVisit },
}));

vi.mock('@/m365/navigation', () => ({ navigateTo }));

vi.mock('axios', () => ({
    default: { get: vi.fn(), post: vi.fn() },
}));

const axiosGet = vi.mocked(axios.get);
const axiosPost = vi.mocked(axios.post);

const MEETINGS_URL = 'https://app.example.test/m365/meetings';
const SYNC_URL = 'https://app.example.test/m365/meetings/sync';
const CONNECT_URL =
    'https://app.example.test/auth/microsoft/redirect?intent=connect&return=calendar';
const NOW_ISO = '2026-11-05T10:00:00Z';
// Monday of the week that contains NOW_ISO (week start monday, timezone UTC in the test setup)
const WEEK_A = '2026-11-02T00:00:00Z';

const labels: OutlookCalendarLabels = {
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
    no_subject: '(No subject)',
    connect: 'Connect Microsoft 365',
    connect_hint: 'Show your Outlook meetings in the calendar',
    reconnect: 'Reconnect Microsoft',
    reconnect_hint: 'Your Microsoft access expired. Reconnect to see your Outlook meetings.',
} as OutlookCalendarLabels;

function syncAnswer(overrides: Partial<OutlookSyncResponse> = {}): OutlookSyncResponse {
    return {
        status: 'ok',
        retry_after: null,
        last_synced_at: NOW_ISO,
        truncated: false,
        ...overrides,
    };
}

function statusInput(overrides: Partial<SyncStatusInput> = {}): SyncStatusInput {
    return {
        isSyncing: false,
        lastSync: null,
        readFailed: false,
        syncedAt: null,
        visibleCount: 0,
        labels,
        timeFormat: '24-hours',
        now: new Date('2026-11-05T15:00:00Z'),
        ...overrides,
    };
}

// A hand-made context for the component-only tests (the composable itself is covered below).
function fakeContext(initial: Partial<Record<string, unknown>> = {}) {
    const state = {
        calendar: ref<unknown>({
            state: 'connected',
            urls: {},
            connect_url: CONNECT_URL,
            notice: null,
            labels,
        }),
        connectionState: ref<OutlookConnectionState | null>('connected'),
        isSyncing: ref(false),
        lastSync: ref<OutlookSyncResponse | null>(null),
        readFailed: ref(false),
        syncedAt: ref<string | null>(null),
        visibleCount: ref(0),
        canSync: ref(true),
    };
    for (const [key, value] of Object.entries(initial)) {
        (state as Record<string, Ref<unknown>>)[key]!.value = value;
    }
    const requestSync = vi.fn();
    const context = {
        ...state,
        labels: ref(labels),
        bucket: ref(null),
        meetings: ref([]),
        cooldownUntil: ref(0),
        announcement: ref(''),
        requestSync,
        dayOverlayLane: () => null,
    } as unknown as OutlookMeetingsContext;
    return { context, state, requestSync };
}

function mountWithContext(context: OutlookMeetingsContext | null, timeFormat = '24-hours') {
    return mount(OutlookCalendarControls, {
        global: {
            provide: {
                ...(context ? { [OUTLOOK_MEETINGS_KEY as symbol]: context } : {}),
                organization: computed(() => ({ time_format: timeFormat })),
            },
        },
    });
}

const syncButton = (wrapper: VueWrapper) => wrapper.find('[data-testid="outlook-sync-button"]');
const statusRegion = (wrapper: VueWrapper) => wrapper.find('[role="status"]');
const connectButton = (wrapper: VueWrapper) =>
    wrapper.find('[data-testid="outlook-connect-button"]');
const reconnectButton = (wrapper: VueWrapper) =>
    wrapper.find('[data-testid="outlook-reconnect-button"]');

describe('OutlookCalendarControls', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-05T15:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders the labelled Sync button and a polite status region when connected', () => {
        const { context } = fakeContext();
        const wrapper = mountWithContext(context);

        expect(wrapper.find('[data-testid="outlook-calendar-controls"]').exists()).toBe(true);
        expect(syncButton(wrapper).text()).toBe('Sync Outlook');
        expect(syncButton(wrapper).attributes('aria-label')).toBe('Sync Outlook meetings');
        expect(syncButton(wrapper).attributes('disabled')).toBeUndefined();
        expect(statusRegion(wrapper).attributes('aria-live')).toBe('polite');
        wrapper.unmount();
    });

    it('reads the dismiss announcement inside the polite status region', async () => {
        const { context } = fakeContext();
        const wrapper = mountWithContext(context);
        const announcement = wrapper.find('[data-testid="outlook-announcement"]');

        expect(statusRegion(wrapper).element.contains(announcement.element)).toBe(true);
        expect(announcement.classes()).toContain('sr-only');
        expect(announcement.text()).toBe('');

        (context.announcement as Ref<string>).value = 'Meeting dismissed';
        await nextTick();

        expect(wrapper.find('[data-testid="outlook-announcement"]').text()).toBe(
            'Meeting dismissed'
        );
        wrapper.unmount();
    });

    it('sends a forced sync once per click', async () => {
        const { context, requestSync } = fakeContext();
        const wrapper = mountWithContext(context);

        await syncButton(wrapper).trigger('click');

        expect(requestSync).toHaveBeenCalledTimes(1);
        expect(requestSync).toHaveBeenCalledWith(true);
        wrapper.unmount();
    });

    it('disables the button with aria-busy and a spinning accent icon while syncing', async () => {
        const { context, state } = fakeContext();
        const wrapper = mountWithContext(context);
        const icon = () => syncButton(wrapper).find('svg');
        expect(syncButton(wrapper).attributes('aria-busy')).toBe('false');
        expect(icon().classes()).not.toContain('motion-safe:animate-spin');

        state.isSyncing.value = true;
        state.canSync.value = false;
        await wrapper.vm.$nextTick();

        expect(syncButton(wrapper).attributes('disabled')).toBeDefined();
        expect(syncButton(wrapper).attributes('aria-busy')).toBe('true');
        expect(icon().classes()).toContain('motion-safe:animate-spin');
        expect(icon().classes()).toContain('text-accent-500');
        expect(statusRegion(wrapper).text()).toBe('Syncing Outlook…');
        wrapper.unmount();
    });

    it('reads Last synced with a same-day time in 24-hours and 12-hours format', async () => {
        const { context, state } = fakeContext({
            syncedAt: '2026-11-05T14:32:00Z',
            visibleCount: 2,
        });
        state.lastSync.value = syncAnswer({ last_synced_at: '2026-11-05T14:32:00Z' });
        const wrapper = mountWithContext(context);
        expect(statusRegion(wrapper).text()).toBe('Last synced 14:32');
        wrapper.unmount();

        const twelve = mountWithContext(context, '12-hours');
        expect(statusRegion(twelve).text()).toBe('Last synced 02:32 PM');
        twelve.unmount();
    });

    it('renders nothing without the calendar prop or without a context', () => {
        const { context, state } = fakeContext();
        state.calendar.value = null;
        const withoutCalendar = mountWithContext(context);
        const withoutContext = mountWithContext(null);

        expect(withoutCalendar.find('[data-testid="outlook-calendar-controls"]').exists()).toBe(
            false
        );
        expect(withoutCalendar.html()).not.toContain('outlook-sync-button');
        expect(withoutContext.find('[data-testid="outlook-calendar-controls"]').exists()).toBe(
            false
        );
        withoutCalendar.unmount();
        withoutContext.unmount();
    });

    it('shows no Sync control for reconnect and not_connected', () => {
        for (const state of ['reconnect', 'not_connected'] as const) {
            const { context } = fakeContext({ connectionState: state });
            const wrapper = mountWithContext(context);

            expect(syncButton(wrapper).exists()).toBe(false);
            expect(statusRegion(wrapper).exists()).toBe(false);
            wrapper.unmount();
        }
    });

    describe('Connect and Reconnect', () => {
        beforeEach(() => {
            navigateTo.mockReset();
            routerVisit.mockReset();
        });

        it('reconnect renders Reconnect Microsoft with the amber icon in the Sync position', () => {
            const { context } = fakeContext({ connectionState: 'reconnect' });
            const wrapper = mountWithContext(context);
            const button = reconnectButton(wrapper);

            expect(button.exists()).toBe(true);
            expect(button.text()).toBe('Reconnect Microsoft');
            expect(button.attributes('aria-label')).toBe('Reconnect Microsoft');
            expect(button.find('svg.text-amber-600').exists()).toBe(true);
            expect(syncButton(wrapper).exists()).toBe(false);
            expect(connectButton(wrapper).exists()).toBe(false);
            // No error banner: the button itself is the prompt (SEC-02)
            expect(wrapper.find('[role="alert"]').exists()).toBe(false);
            wrapper.unmount();
        });

        it('reconnect keeps the last synced text when it is known', () => {
            const { context } = fakeContext({
                connectionState: 'reconnect',
                syncedAt: '2026-11-05T14:32:00Z',
            });
            const wrapper = mountWithContext(context);

            expect(statusRegion(wrapper).text()).toBe('Last synced 14:32');
            expect(statusRegion(wrapper).attributes('aria-live')).toBe('polite');
            wrapper.unmount();
        });

        it('not_connected renders only Connect Microsoft 365 with the Link icon and no status', () => {
            const { context } = fakeContext({
                connectionState: 'not_connected',
                syncedAt: '2026-11-05T14:32:00Z',
            });
            const wrapper = mountWithContext(context);
            const button = connectButton(wrapper);

            expect(button.exists()).toBe(true);
            expect(button.text()).toBe('Connect Microsoft 365');
            expect(button.attributes('aria-label')).toBe('Connect Microsoft 365');
            expect(button.find('svg.lucide-link').exists()).toBe(true);
            expect(wrapper.find('svg.text-amber-600').exists()).toBe(false);
            expect(statusRegion(wrapper).exists()).toBe(false);
            expect(syncButton(wrapper).exists()).toBe(false);
            expect(reconnectButton(wrapper).exists()).toBe(false);
            wrapper.unmount();
        });

        it('collapses the label below md and keeps the accessible name', () => {
            for (const state of ['reconnect', 'not_connected'] as const) {
                const { context } = fakeContext({ connectionState: state });
                const wrapper = mountWithContext(context);
                const button = wrapper.find('button');

                expect(button.classes()).toEqual(
                    expect.arrayContaining(['w-8', 'p-0', 'md:w-auto', 'md:px-3'])
                );
                expect(button.find('span').classes()).toEqual(
                    expect.arrayContaining(['hidden', 'md:inline'])
                );
                expect(button.attributes('aria-label')).toBeTruthy();
                wrapper.unmount();
            }
        });

        it('navigates with navigateTo to the connect url and never through the Inertia router', async () => {
            for (const state of ['reconnect', 'not_connected'] as const) {
                navigateTo.mockReset();
                const { context } = fakeContext({ connectionState: state });
                const wrapper = mountWithContext(context);

                await wrapper.find('button').trigger('click');

                expect(navigateTo).toHaveBeenCalledTimes(1);
                expect(navigateTo).toHaveBeenCalledWith(CONNECT_URL);
                expect(routerVisit).not.toHaveBeenCalled();
                wrapper.unmount();
            }
        });

        it('connected state offers neither Connect nor Reconnect', () => {
            const { context } = fakeContext();
            const wrapper = mountWithContext(context);

            expect(connectButton(wrapper).exists()).toBe(false);
            expect(reconnectButton(wrapper).exists()).toBe(false);
            wrapper.unmount();
        });
    });

    it('shows the amber icon beside the unavailable text only in that state', async () => {
        const { context, state } = fakeContext({ visibleCount: 1 });
        const wrapper = mountWithContext(context);
        expect(wrapper.find('svg.text-amber-600').exists()).toBe(false);

        state.lastSync.value = syncAnswer({ status: 'unavailable', retry_after: 20 });
        await wrapper.vm.$nextTick();

        expect(wrapper.find('svg.text-amber-600').exists()).toBe(true);
        expect(statusRegion(wrapper).text()).toBe('Outlook unavailable, retry later');
        wrapper.unmount();
    });

    it('collapses the status text below lg and the button label below md', () => {
        const { context } = fakeContext({ syncedAt: '2026-11-05T14:32:00Z', visibleCount: 1 });
        const wrapper = mountWithContext(context);

        const text = statusRegion(wrapper).find('span');
        expect(text.classes()).toEqual(expect.arrayContaining(['sr-only', 'lg:not-sr-only']));
        expect(text.classes()).toEqual(expect.arrayContaining(['lg:max-w-64', 'lg:truncate']));
        expect(syncButton(wrapper).find('span').classes()).toEqual(
            expect.arrayContaining(['hidden', 'md:inline'])
        );
        expect(syncButton(wrapper).classes()).toEqual(
            expect.arrayContaining(['w-8', 'p-0', 'md:w-auto', 'md:px-3'])
        );
        // Collapsed or not, the persistent live region and the accessible name stay
        expect(statusRegion(wrapper).attributes('aria-live')).toBe('polite');
        expect(syncButton(wrapper).attributes('aria-label')).toBe('Sync Outlook meetings');
        wrapper.unmount();
    });
});

describe('describeSyncStatus', () => {
    it('syncing', () => {
        const status = describeSyncStatus(statusInput({ isSyncing: true, syncedAt: NOW_ISO }));

        expect(status).toEqual({
            kind: 'syncing',
            text: 'Syncing Outlook…',
            tooltip: null,
            warning: false,
        });
    });

    it('unavailable keeps the cached hint', () => {
        for (const status of ['throttled', 'unavailable'] as const) {
            const withCache = describeSyncStatus(
                statusInput({ lastSync: syncAnswer({ status }), visibleCount: 3 })
            );
            const withoutCache = describeSyncStatus(
                statusInput({ lastSync: syncAnswer({ status }), visibleCount: 0 })
            );

            expect(withCache.kind).toBe('unavailable');
            expect(withCache.warning).toBe(true);
            expect(withCache.text).toBe('Outlook unavailable, retry later');
            expect(withCache.tooltip).toBe(labels.unavailable_cached_hint);
            expect(withoutCache.kind).toBe('unavailable');
            expect(withoutCache.tooltip).toBeNull();
        }
        // A failed read is unavailable as well, never a reconnect
        expect(describeSyncStatus(statusInput({ readFailed: true })).kind).toBe('unavailable');
    });

    it('no mailbox status is quiet', () => {
        const status = describeSyncStatus(
            statusInput({ lastSync: syncAnswer({ status: 'no_mailbox' }) })
        );

        expect(status.kind).toBe('no_mailbox');
        expect(status.warning).toBe(false);
        expect(status.text).toBe('No Outlook calendar for this account');
    });

    it('shows the empty-range status', () => {
        const status = describeSyncStatus(
            statusInput({ syncedAt: '2026-11-05T14:32:00Z', visibleCount: 0 })
        );

        expect(status.kind).toBe('empty');
        expect(status.warning).toBe(false);
        expect(status.text).toBe('No Outlook meetings in this range · Last synced 14:32');
        expect(status.tooltip).toBe('Press Sync Outlook to check again.');
    });

    it('shows only the time for today, the short date and time for another day', () => {
        const today = describeSyncStatus(
            statusInput({ syncedAt: '2026-11-05T14:32:00Z', visibleCount: 4 })
        );
        const earlier = describeSyncStatus(
            statusInput({ syncedAt: '2026-11-03T09:05:00Z', visibleCount: 4 })
        );

        expect(today).toMatchObject({ kind: 'synced', text: 'Last synced 14:32' });
        expect(earlier).toMatchObject({ kind: 'synced', text: 'Last synced 3 Nov 09:05' });
    });

    it('has no text before anything was synced', () => {
        expect(describeSyncStatus(statusInput())).toEqual({
            kind: 'none',
            text: '',
            tooltip: null,
            warning: false,
        });
    });
});

// The composable and the component together, against a mocked transport.
describe('OutlookCalendarControls with the real composable', () => {
    const CACHED: OutlookMeeting[] = [
        {
            id: 'cached',
            subject: 'Cached meeting',
            start: '2026-11-03T09:00:00Z',
            end: '2026-11-03T10:00:00Z',
            organizer_name: null,
            is_organizer: false,
            is_online_meeting: false,
            web_link: null,
            dismissed: false,
        },
    ];

    function setPage(state: OutlookConnectionState): void {
        pageProps.microsoft = {
            enabled: true,
            login_url: 'https://app.example.test/auth/microsoft/redirect',
            labels: { sign_in: 'Sign in', sign_in_hint: 'Hint' },
            calendar: {
                state,
                urls: { meetings: MEETINGS_URL, sync: SYNC_URL },
                connect_url: CONNECT_URL,
                notice: null,
                labels,
            },
        };
    }

    function readResponse(
        meetings: OutlookMeeting[] = CACHED,
        lastSyncedAt: string | null = new Date(Date.now() - 5_000).toISOString(),
        retryAfter: number | null = null
    ): { data: OutlookMeetingsResponse } {
        return {
            data: {
                data: meetings,
                sync: { last_synced_at: lastSyncedAt, retry_after: retryAfter },
            },
        };
    }

    function httpError(status: number, headers: Record<string, string> = {}): Error {
        return Object.assign(new Error(`HTTP ${status}`), { response: { status, headers } });
    }

    interface Mounted {
        wrapper: VueWrapper;
        api: OutlookMeetingsContext;
    }

    function mountPage(): Mounted {
        const start = ref(getLocalizedDayJs(WEEK_A));
        const end = ref(getLocalizedDayJs(WEEK_A).add(7, 'day'));
        let api!: OutlookMeetingsContext;
        const Harness = defineComponent({
            setup() {
                api = useOutlookMeetings(start, end);
                // Same shape as Calendar.vue: the controls are a descendant of the composable owner
                return () =>
                    h('div', [
                        h(
                            'span',
                            { 'data-testid': 'meeting-count' },
                            String(api.meetings.value.length)
                        ),
                        h(OutlookCalendarControls),
                    ]);
            },
        });
        const wrapper = mount(Harness, {
            global: {
                plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]],
                provide: { organization: computed(() => ({ time_format: '24-hours' })) },
            },
        });
        return { wrapper, api };
    }

    const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
    const disabled = (wrapper: VueWrapper) =>
        syncButton(wrapper).attributes('disabled') !== undefined;
    const meetingCount = (wrapper: VueWrapper) =>
        wrapper.find('[data-testid="meeting-count"]').text();

    // Press Sync and let the forced sync (0 ms debounce) and the follow-up read settle
    async function press(wrapper: VueWrapper): Promise<void> {
        await syncButton(wrapper).trigger('click');
        await advance(0);
        await advance(0);
    }

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(NOW_ISO));
        axiosGet.mockReset();
        axiosPost.mockReset();
        // A fresh cache: no automatic sync, so each test starts with an enabled button
        axiosGet.mockImplementation(async () => readResponse());
        axiosPost.mockResolvedValue({ data: syncAnswer() });
        setPage('connected');
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('sends a forced sync and updates the status to Last synced', async () => {
        axiosGet.mockImplementation(async () => readResponse(CACHED, '2026-11-05T08:00:00Z'));
        let resolve!: (value: { data: OutlookSyncResponse }) => void;
        axiosPost.mockReturnValue(
            new Promise((res) => {
                resolve = res;
            })
        );
        const { wrapper } = mountPage();
        await advance(0);
        expect(statusRegion(wrapper).text()).toBe('Last synced 08:00');
        expect(disabled(wrapper)).toBe(false);

        await syncButton(wrapper).trigger('click');
        await advance(0);
        expect(axiosPost).toHaveBeenCalledWith(SYNC_URL, {
            start: WEEK_A,
            end: '2026-11-09T00:00:00Z',
            force: true,
        });
        expect(syncButton(wrapper).attributes('aria-busy')).toBe('true');
        expect(statusRegion(wrapper).text()).toBe('Syncing Outlook…');
        resolve({ data: syncAnswer({ last_synced_at: '2026-11-05T09:58:00Z' }) });
        await advance(0);

        expect(statusRegion(wrapper).text()).toBe('Last synced 09:58');
        expect(syncButton(wrapper).attributes('aria-busy')).toBe('false');
        wrapper.unmount();
    });

    it('stays disabled for 10 s after a completed sync, then enables', async () => {
        const { wrapper } = mountPage();
        await advance(0);
        await press(wrapper);
        expect(axiosPost).toHaveBeenCalledTimes(1);
        expect(disabled(wrapper)).toBe(true);

        await advance(9_999);
        expect(disabled(wrapper)).toBe(true);
        await syncButton(wrapper).trigger('click');
        await advance(100);
        expect(axiosPost).toHaveBeenCalledTimes(1);

        await advance(1);
        expect(disabled(wrapper)).toBe(false);
        wrapper.unmount();
    });

    it('keeps Sync disabled for the retry_after of a throttled answer', async () => {
        axiosPost.mockResolvedValue({ data: syncAnswer({ status: 'throttled', retry_after: 20 }) });
        const { wrapper } = mountPage();
        await advance(0);
        await press(wrapper);

        expect(statusRegion(wrapper).text()).toBe('Outlook unavailable, retry later');
        await advance(19_999);
        expect(disabled(wrapper)).toBe(true);
        await advance(1);
        expect(disabled(wrapper)).toBe(false);
        wrapper.unmount();
    });

    it('disables Sync on load while the read response carries a retry_after', async () => {
        axiosGet.mockImplementation(async () =>
            readResponse(CACHED, new Date(Date.now() - 5_000).toISOString(), 15)
        );
        const { wrapper } = mountPage();
        await advance(0);
        await advance(0);

        expect(disabled(wrapper)).toBe(true);
        await advance(14_999);
        expect(disabled(wrapper)).toBe(true);
        await advance(1);
        expect(disabled(wrapper)).toBe(false);
        wrapper.unmount();
    });

    it('axios 500 on sync yields unavailable, keeps meetings and sets the cooldown', async () => {
        axiosPost.mockRejectedValue(httpError(500));
        const { wrapper, api } = mountPage();
        await advance(0);
        expect(meetingCount(wrapper)).toBe('1');
        await press(wrapper);

        expect(statusRegion(wrapper).text()).toBe('Outlook unavailable, retry later');
        expect(wrapper.find('svg.text-amber-600').exists()).toBe(true);
        expect(meetingCount(wrapper)).toBe('1');
        expect(api.connectionState.value).toBe('connected');
        expect(disabled(wrapper)).toBe(true);
        await advance(9_999);
        expect(disabled(wrapper)).toBe(true);
        await advance(1);
        expect(disabled(wrapper)).toBe(false);
        wrapper.unmount();
    });

    it('route-level 429 on sync yields unavailable, keeps meetings and sets the cooldown', async () => {
        axiosPost.mockRejectedValueOnce(httpError(429, { 'retry-after': '30' }));
        const { wrapper } = mountPage();
        await advance(0);
        await press(wrapper);

        expect(statusRegion(wrapper).text()).toBe('Outlook unavailable, retry later');
        expect(meetingCount(wrapper)).toBe('1');
        await advance(29_999);
        expect(disabled(wrapper)).toBe(true);
        await advance(1);
        expect(disabled(wrapper)).toBe(false);

        // Without a Retry-After header the 10 s cooldown applies
        axiosPost.mockRejectedValueOnce(httpError(429));
        await press(wrapper);
        await advance(9_999);
        expect(disabled(wrapper)).toBe(true);
        await advance(1);
        expect(disabled(wrapper)).toBe(false);
        wrapper.unmount();
    });

    it('a session failure (401 or 419) is unavailable and never offers Reconnect', async () => {
        for (const status of [401, 419]) {
            axiosPost.mockReset();
            axiosPost.mockRejectedValue(httpError(status));
            const { wrapper, api } = mountPage();
            await advance(0);
            await press(wrapper);

            expect(statusRegion(wrapper).text()).toBe('Outlook unavailable, retry later');
            expect(api.connectionState.value).toBe('connected');
            expect(syncButton(wrapper).exists()).toBe(true);
            expect(wrapper.text()).not.toContain('Reconnect');
            wrapper.unmount();
            await advance(20_000);
        }
    });

    it('a sync that answers reconnect or not_connected removes the Sync control', async () => {
        for (const status of ['reconnect', 'not_connected'] as const) {
            axiosPost.mockReset();
            axiosPost.mockResolvedValue({ data: syncAnswer({ status }) });
            const { wrapper, api } = mountPage();
            await advance(0);
            expect(syncButton(wrapper).exists()).toBe(true);
            await press(wrapper);

            expect(api.connectionState.value).toBe(status);
            expect(syncButton(wrapper).exists()).toBe(false);
            // The Connect / Reconnect prompt takes the Sync position without a reload, and the last
            // known meetings stay visible
            expect(
                (status === 'reconnect' ? reconnectButton : connectButton)(wrapper).exists()
            ).toBe(true);
            expect(meetingCount(wrapper)).toBe('1');
            wrapper.unmount();
            await advance(20_000);
        }
    });

    describe('connect notice', () => {
        function setNotice(notice: { level: 'success' | 'error'; message: string } | null): void {
            setPage('connected');
            (pageProps.microsoft as { calendar: { notice: unknown } }).calendar.notice = notice;
        }

        beforeEach(() => {
            addNotification.mockReset();
        });

        it('shows an error notice once on mount through the notification store', async () => {
            setNotice({ level: 'error', message: 'That Microsoft account is already in use.' });
            const { wrapper } = mountPage();
            await advance(0);

            expect(addNotification).toHaveBeenCalledTimes(1);
            expect(addNotification).toHaveBeenCalledWith(
                'error',
                'That Microsoft account is already in use.'
            );
            await advance(20_000);
            expect(addNotification).toHaveBeenCalledTimes(1);
            wrapper.unmount();
        });

        it('shows a success notice through the notification store', async () => {
            setNotice({ level: 'success', message: 'Microsoft account connected.' });
            const { wrapper } = mountPage();
            await advance(0);

            expect(addNotification).toHaveBeenCalledTimes(1);
            expect(addNotification).toHaveBeenCalledWith('success', 'Microsoft account connected.');
            wrapper.unmount();
        });

        it('shows nothing without a notice', async () => {
            setNotice(null);
            const { wrapper } = mountPage();
            await advance(0);

            expect(addNotification).not.toHaveBeenCalled();
            wrapper.unmount();
        });
    });
});
