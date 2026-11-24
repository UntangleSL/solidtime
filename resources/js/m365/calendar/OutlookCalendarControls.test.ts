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
    OutlookOutOfSyncItem,
    OutlookSyncResponse,
} from '@/m365/types';
import { getLocalizedDayJs } from '@/packages/ui/src/utils/time';
import OutlookCalendarControls from './OutlookCalendarControls.vue';
import {
    cooldownProgress,
    describeSyncStatus,
    formatCooldownSeconds,
    remainingCooldownSeconds,
    type SyncStatusInput,
} from './syncStatus';
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
    sync_in: 'Sync in :seconds',
    sync_cooldown_hint: 'Just synced. You can sync again in :seconds.',
    sync_backoff_hint: 'Outlook asked us to wait. You can sync again in :seconds.',
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
        cooldownUntil: ref(0),
        cooldownStartedAt: ref(0),
        cooldownKind: ref<'manual' | 'backoff' | null>(null),
        // Phase 5 bulk confirm (OutlookConfirmAll): off unless a test opts in
        canAct: ref(false),
        preassignedInRange: ref<OutlookMeeting[]>([]),
        // Phase 6 out-of-sync counter (OutlookSyncFlagCounter): no flags unless a test opts in
        outOfSync: ref<OutlookOutOfSyncItem[]>([]),
        jumpBusy: ref(false),
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
        announcement: ref(''),
        requestSync,
        confirmPreassigned: vi.fn(async () => []),
        jumpToFirst: vi.fn(async () => {}),
        announce: vi.fn(),
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
        expect(syncButton(wrapper).attributes('aria-disabled')).toBeUndefined();
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

    it('ignores clicks while Sync is unavailable', async () => {
        const { context, requestSync } = fakeContext({ canSync: false });
        const wrapper = mountWithContext(context);

        await syncButton(wrapper).trigger('click');

        expect(syncButton(wrapper).attributes('aria-disabled')).toBe('true');
        expect(requestSync).not.toHaveBeenCalled();
        wrapper.unmount();
    });

    it('marks the button aria-disabled with aria-busy and a spinning accent icon while syncing', async () => {
        const { context, state } = fakeContext();
        const wrapper = mountWithContext(context);
        const icon = () => syncButton(wrapper).find('svg');
        expect(syncButton(wrapper).attributes('aria-busy')).toBe('false');
        expect(icon().classes()).not.toContain('motion-safe:animate-spin');

        state.isSyncing.value = true;
        state.canSync.value = false;
        await wrapper.vm.$nextTick();

        expect(syncButton(wrapper).attributes('aria-disabled')).toBe('true');
        expect(syncButton(wrapper).attributes('disabled')).toBeUndefined();
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

describe('OutlookCalendarControls bulk confirm', () => {
    const preassigned: OutlookMeeting = {
        id: 'pre-1',
        subject: 'Weekly sync',
        start: '2026-11-03T09:00:00Z',
        end: '2026-11-03T10:00:00Z',
        organizer_name: null,
        is_organizer: false,
        is_online_meeting: false,
        web_link: null,
        dismissed: false,
        series_key: 'series-1',
        assignment: {
            project_id: 'p-1',
            project_name: 'Internal',
            project_color: '#ef5350',
            client_name: null,
            task_id: null,
            task_name: null,
            tags: [],
            billable: false,
            converted_at: '2026-10-27T09:00:00Z',
        },
        suggestions: [],
    };
    const confirmLabels = {
        ...labels,
        confirm_all_short: 'Confirm :count',
        confirm_all_long: 'Confirm :count pre-assigned',
        confirm_all_tooltip: 'Review and confirm the pre-assigned meetings in view',
        confirm_all_title_one: 'Confirm 1 pre-assigned meeting',
        confirm_all_title_many: 'Confirm :count pre-assigned meetings',
    } as OutlookCalendarLabels;

    function renderBlocks(ids: string[]): void {
        const root = document.createElement('div');
        root.className = 'fc';
        ids.forEach((id) => {
            const block = document.createElement('div');
            block.dataset.ghostId = id;
            root.appendChild(block);
        });
        document.body.appendChild(root);
    }

    function confirmContext(initial: Partial<Record<string, unknown>> = {}) {
        const fake = fakeContext({ canAct: true, preassignedInRange: [preassigned], ...initial });
        (fake.context as unknown as { labels: Ref<OutlookCalendarLabels> }).labels.value =
            confirmLabels;
        return fake;
    }

    const confirmButton = (wrapper: VueWrapper) =>
        wrapper.find('[data-testid="outlook-confirm-all"]');
    const settle = async () => {
        await nextTick();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await nextTick();
    };

    beforeEach(() => {
        renderBlocks(['pre-1']);
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('renders Confirm immediately before the Sync button while connected', async () => {
        const { context } = confirmContext();
        const wrapper = mountWithContext(context);
        await settle();

        const button = confirmButton(wrapper);
        expect(button.exists()).toBe(true);
        expect(button.attributes('aria-label')).toBe('Confirm 1 pre-assigned meeting');
        // Each button sits in its tooltip trigger span; Confirm's span is right before Sync's
        const syncSpan = syncButton(wrapper).element.parentElement!;
        expect(syncSpan.previousElementSibling).toBe(button.element.parentElement);
        // Status first, then Confirm, then Sync (Tab order: Confirm before Sync)
        const root = wrapper.find('[data-testid="outlook-calendar-controls"]').element;
        const order = Array.from(root.children).map(
            (child) =>
                child.getAttribute('data-testid') ??
                child.querySelector('[data-testid]')?.getAttribute('data-testid')
        );
        expect(order.slice(0, 3)).toEqual([
            'outlook-sync-status',
            'outlook-confirm-all',
            'outlook-sync-button',
        ]);
        wrapper.unmount();
    });

    it('renders no Confirm button when the count is 0 or without canAct', async () => {
        for (const initial of [{ preassignedInRange: [] }, { canAct: false }]) {
            const { context } = confirmContext(initial);
            const wrapper = mountWithContext(context);
            await settle();

            expect(confirmButton(wrapper).exists()).toBe(false);
            expect(syncButton(wrapper).exists()).toBe(true);
            wrapper.unmount();
        }
    });

    it('renders no Confirm button for reconnect and not_connected', async () => {
        for (const state of ['reconnect', 'not_connected'] as const) {
            const { context } = confirmContext({ connectionState: state });
            const wrapper = mountWithContext(context);
            await settle();

            expect(confirmButton(wrapper).exists()).toBe(false);
            wrapper.unmount();
        }
    });

    it('renders only the Confirm button in the browser-test mode with actions', async () => {
        const { context } = confirmContext({ calendar: null, connectionState: null });
        const wrapper = mountWithContext(context);
        await settle();

        expect(wrapper.find('[data-testid="outlook-calendar-controls"]').exists()).toBe(true);
        expect(confirmButton(wrapper).exists()).toBe(true);
        expect(syncButton(wrapper).exists()).toBe(false);
        expect(connectButton(wrapper).exists()).toBe(false);
        expect(reconnectButton(wrapper).exists()).toBe(false);
        expect(statusRegion(wrapper).exists()).toBe(false);
        wrapper.unmount();
    });

    it('renders nothing in the browser-test mode without actions', async () => {
        const { context } = confirmContext({
            calendar: null,
            connectionState: null,
            canAct: false,
        });
        const wrapper = mountWithContext(context);
        await settle();

        expect(wrapper.find('[data-testid="outlook-calendar-controls"]').exists()).toBe(false);
        wrapper.unmount();
    });
});

describe('OutlookCalendarControls out-of-sync counter', () => {
    const flagLabels = {
        ...labels,
        osync_count_one: '1 out of sync',
        osync_count_many: ':count out of sync',
        osync_count_aria_one: '1 time entry out of sync with Outlook. Show it.',
        osync_count_aria_many: ':count time entries out of sync with Outlook. Show the first one.',
        osync_count_tooltip: 'Show the first entry that changed in Outlook',
        confirm_all_short: 'Confirm :count',
        confirm_all_long: 'Confirm :count pre-assigned',
        confirm_all_tooltip: 'Review and confirm the pre-assigned meetings in view',
        confirm_all_title_one: 'Confirm 1 pre-assigned meeting',
        confirm_all_title_many: 'Confirm :count pre-assigned meetings',
    } as OutlookCalendarLabels;

    function flag(id: string, start: string): OutlookOutOfSyncItem {
        return {
            time_entry_id: id,
            kind: 'cancelled',
            meeting_start: start,
            meeting_end: start.replace('T09', 'T10'),
            new_start: null,
            new_end: null,
            all_day: false,
            entry_start: start,
            entry_end: start.replace('T09', 'T10'),
            description: '',
        };
    }

    // One flag in the visible week and one weeks ago: the count covers the whole window
    const FLAGS = [flag('te-1', '2026-11-03T09:00:00Z'), flag('te-2', '2026-10-20T09:00:00Z')];

    const preassigned: OutlookMeeting = {
        id: 'pre-1',
        subject: 'Weekly sync',
        start: '2026-11-03T09:00:00Z',
        end: '2026-11-03T10:00:00Z',
        organizer_name: null,
        is_organizer: false,
        is_online_meeting: false,
        web_link: null,
        dismissed: false,
        series_key: 'series-1',
        assignment: {
            project_id: 'p-1',
            project_name: 'Internal',
            project_color: '#ef5350',
            client_name: null,
            task_id: null,
            task_name: null,
            tags: [],
            billable: false,
            converted_at: '2026-10-27T09:00:00Z',
        },
        suggestions: [],
    };

    function flagContext(initial: Partial<Record<string, unknown>> = {}) {
        const fake = fakeContext({ canAct: true, outOfSync: FLAGS, ...initial });
        (fake.context as unknown as { labels: Ref<OutlookCalendarLabels> }).labels.value =
            flagLabels;
        return fake;
    }

    function renderBlocks(ids: string[]): void {
        const root = document.createElement('div');
        root.className = 'fc';
        ids.forEach((id) => {
            const block = document.createElement('div');
            block.dataset.ghostId = id;
            root.appendChild(block);
        });
        document.body.appendChild(root);
    }

    // The data-testid of each direct child of the controls (or of the first one inside it)
    function order(wrapper: VueWrapper): (string | null | undefined)[] {
        const root = wrapper.find('[data-testid="outlook-calendar-controls"]').element;
        return Array.from(root.children).map(
            (child) =>
                child.getAttribute('data-testid') ??
                child.querySelector('[data-testid]')?.getAttribute('data-testid')
        );
    }

    const counter = (wrapper: VueWrapper) => wrapper.find('[data-testid="outlook-out-of-sync"]');
    const settle = async () => {
        await nextTick();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await nextTick();
    };

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('sits between the status and Sync while connected, with the whole-window count', async () => {
        const { context } = flagContext();
        const wrapper = mountWithContext(context);
        await settle();

        expect(counter(wrapper).exists()).toBe(true);
        expect(counter(wrapper).attributes('data-count')).toBe('2');
        expect(counter(wrapper).attributes('aria-label')).toBe(
            '2 time entries out of sync with Outlook. Show the first one.'
        );
        expect(order(wrapper).slice(0, 3)).toEqual([
            'outlook-sync-status',
            'outlook-out-of-sync',
            'outlook-sync-button',
        ]);
        wrapper.unmount();
    });

    it('comes before Confirm N when both are shown: status, counter, Confirm, Sync', async () => {
        renderBlocks(['pre-1']);
        const { context } = flagContext({ preassignedInRange: [preassigned] });
        const wrapper = mountWithContext(context);
        await settle();

        expect(order(wrapper).slice(0, 4)).toEqual([
            'outlook-sync-status',
            'outlook-out-of-sync',
            'outlook-confirm-all',
            'outlook-sync-button',
        ]);
        wrapper.unmount();
    });

    it('jumps to the first flagged entry on click', async () => {
        const { context } = flagContext();
        const wrapper = mountWithContext(context);
        await settle();

        await counter(wrapper).trigger('click');
        await settle();

        expect(context.jumpToFirst).toHaveBeenCalledTimes(1);
        wrapper.unmount();
    });

    it('renders next to Reconnect in the reconnect state', async () => {
        const { context } = flagContext({
            connectionState: 'reconnect',
            syncedAt: '2026-11-05T14:32:00Z',
        });
        const wrapper = mountWithContext(context);
        await settle();

        expect(counter(wrapper).exists()).toBe(true);
        expect(order(wrapper)).toEqual([
            'outlook-sync-status',
            'outlook-out-of-sync',
            'outlook-reconnect-button',
        ]);
        expect(syncButton(wrapper).exists()).toBe(false);
        wrapper.unmount();
    });

    it('renders with Confirm all in the browser-test mode with actions, without Sync or Connect', async () => {
        renderBlocks(['pre-1']);
        const { context } = flagContext({
            calendar: null,
            connectionState: null,
            preassignedInRange: [preassigned],
        });
        const wrapper = mountWithContext(context);
        await settle();

        expect(order(wrapper)).toEqual(['outlook-out-of-sync', 'outlook-confirm-all']);
        expect(syncButton(wrapper).exists()).toBe(false);
        expect(connectButton(wrapper).exists()).toBe(false);
        expect(reconnectButton(wrapper).exists()).toBe(false);
        expect(statusRegion(wrapper).exists()).toBe(false);
        wrapper.unmount();
    });

    it('renders the counter alone in the browser-test mode when only flags are injected', async () => {
        const { context } = flagContext({ calendar: null, connectionState: null });
        const wrapper = mountWithContext(context);
        await settle();

        expect(order(wrapper)).toEqual(['outlook-out-of-sync']);
        wrapper.unmount();
    });

    it('renders no counter at 0 or without canAct', async () => {
        for (const initial of [
            { outOfSync: [] },
            { canAct: false },
            { connectionState: 'reconnect', outOfSync: [] },
            { connectionState: 'reconnect', canAct: false },
            { calendar: null, connectionState: null, outOfSync: [] },
        ]) {
            const { context } = flagContext(initial);
            const wrapper = mountWithContext(context);
            await settle();

            expect(counter(wrapper).exists()).toBe(false);
            wrapper.unmount();
        }
    });

    it('renders no counter while not connected, even with a stray list', async () => {
        const { context } = flagContext({ connectionState: 'not_connected' });
        const wrapper = mountWithContext(context);
        await settle();

        expect(counter(wrapper).exists()).toBe(false);
        expect(connectButton(wrapper).exists()).toBe(true);
        wrapper.unmount();
    });
});

describe('OutlookCalendarControls cooldown ticker', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-05T15:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function coolingContext(ms: number) {
        return fakeContext({
            canSync: false,
            cooldownKind: 'manual',
            cooldownStartedAt: Date.now(),
            cooldownUntil: Date.now() + ms,
        });
    }

    it('stops ticking when the cooldown ends and on unmount', async () => {
        const baseline = vi.getTimerCount();
        const { context, state } = coolingContext(3_000);
        const wrapper = mountWithContext(context);
        await nextTick();
        expect(vi.getTimerCount()).toBe(baseline + 1);
        expect(syncButton(wrapper).text()).toBe('Sync in 3s');

        await vi.advanceTimersByTimeAsync(1_000);
        expect(syncButton(wrapper).text()).toBe('Sync in 2s');
        await vi.advanceTimersByTimeAsync(2_000);
        state.canSync.value = true;
        await nextTick();

        // The cooldown ended: idle again, silently, and no interval stays scheduled
        expect(syncButton(wrapper).text()).toBe('Sync Outlook');
        expect(syncButton(wrapper).attributes('data-cooldown')).toBeUndefined();
        expect(statusRegion(wrapper).text()).toBe('');
        expect(vi.getTimerCount()).toBe(baseline);
        wrapper.unmount();

        const again = coolingContext(10_000);
        const second = mountWithContext(again.context);
        await nextTick();
        expect(vi.getTimerCount()).toBe(baseline + 1);
        second.unmount();
        expect(vi.getTimerCount()).toBe(baseline);
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
describe('cooldown helpers', () => {
    it('formats seconds under a minute and minutes with seconds from a minute on', () => {
        expect(formatCooldownSeconds(8)).toBe('8s');
        expect(formatCooldownSeconds(59)).toBe('59s');
        expect(formatCooldownSeconds(60)).toBe('1m');
        expect(formatCooldownSeconds(80)).toBe('1m 20s');
        expect(formatCooldownSeconds(125)).toBe('2m 5s');
    });

    it('rounds the remaining seconds up and never below 0', () => {
        expect(remainingCooldownSeconds(10_000, 0)).toBe(10);
        expect(remainingCooldownSeconds(10_000, 1)).toBe(10);
        expect(remainingCooldownSeconds(10_000, 1_000)).toBe(9);
        expect(remainingCooldownSeconds(10_000, 9_999)).toBe(1);
        expect(remainingCooldownSeconds(10_000, 10_000)).toBe(0);
        expect(remainingCooldownSeconds(10_000, 12_000)).toBe(0);
    });

    it('reports the share of the cooldown still to run', () => {
        expect(cooldownProgress(1_000, 11_000, 1_000)).toBe(1);
        expect(cooldownProgress(1_000, 11_000, 6_000)).toBe(0.5);
        expect(cooldownProgress(1_000, 11_000, 11_000)).toBe(0);
        expect(cooldownProgress(1_000, 11_000, 20_000)).toBe(0);
        expect(cooldownProgress(1_000, 11_000, 0)).toBe(1);
        expect(cooldownProgress(5_000, 5_000, 5_000)).toBe(0);
    });
});

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

    function mountPage(attach = false): Mounted {
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
            ...(attach ? { attachTo: document.body } : {}),
        });
        return { wrapper, api };
    }

    const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
    // Unavailable Sync uses aria-disabled (never the disabled attribute, which would drop focus)
    const disabled = (wrapper: VueWrapper) => {
        expect(syncButton(wrapper).attributes('disabled')).toBeUndefined();
        return syncButton(wrapper).attributes('aria-disabled') === 'true';
    };
    const cooldown = (wrapper: VueWrapper) => syncButton(wrapper).attributes('data-cooldown');
    const ring = (wrapper: VueWrapper) =>
        syncButton(wrapper).find('[data-testid="outlook-sync-cooldown-ring"]');
    const refreshIcon = (wrapper: VueWrapper) =>
        syncButton(wrapper).find('[data-testid="outlook-sync-icon"]');
    // A read whose last sync is hours old, so the debounced automatic sync runs
    const staleRead = () => readResponse(CACHED, '2026-11-05T08:00:00Z');
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
        expect(cooldown(wrapper)).toBe('backoff');
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

    it('an automatic navigation sync leaves Sync available once it settles', async () => {
        axiosGet.mockImplementation(async () => staleRead());
        let resolve!: (value: { data: OutlookSyncResponse }) => void;
        axiosPost.mockReturnValue(
            new Promise((res) => {
                resolve = res;
            })
        );
        const { wrapper, api } = mountPage();
        await advance(0);
        await advance(400);

        expect(axiosPost).toHaveBeenCalledTimes(1);
        expect(axiosPost).toHaveBeenCalledWith(SYNC_URL, expect.objectContaining({ force: false }));
        // Only while the automatic sync is in flight is the button unavailable
        expect(disabled(wrapper)).toBe(true);
        expect(cooldown(wrapper)).toBeUndefined();

        resolve({ data: syncAnswer() });
        await advance(0);
        await advance(0);

        expect(api.isSyncing.value).toBe(false);
        expect(api.canSync.value).toBe(true);
        expect(api.cooldownKind.value).toBeNull();
        expect(syncButton(wrapper).attributes('aria-disabled')).toBeUndefined();
        expect(cooldown(wrapper)).toBeUndefined();
        expect(refreshIcon(wrapper).exists()).toBe(true);
        wrapper.unmount();
    });

    it('a manual sync starts a 10 s manual cooldown and keeps focus', async () => {
        const { wrapper, api } = mountPage(true);
        await advance(0);
        const button = syncButton(wrapper).element as HTMLButtonElement;
        button.focus();
        expect(document.activeElement).toBe(button);

        await press(wrapper);

        expect(axiosPost).toHaveBeenCalledTimes(1);
        expect(disabled(wrapper)).toBe(true);
        expect(cooldown(wrapper)).toBe('manual');
        expect(api.cooldownKind.value).toBe('manual');
        expect(document.activeElement).toBe(button);
        expect(ring(wrapper).exists()).toBe(true);
        expect(ring(wrapper).attributes('aria-hidden')).toBe('true');
        expect(refreshIcon(wrapper).exists()).toBe(false);
        expect(syncButton(wrapper).attributes('aria-label')).toBe('Sync Outlook meetings');

        // A second press during the cooldown posts nothing
        await syncButton(wrapper).trigger('click');
        await advance(100);
        expect(axiosPost).toHaveBeenCalledTimes(1);

        await advance(9_900);
        expect(disabled(wrapper)).toBe(false);
        expect(cooldown(wrapper)).toBeUndefined();
        expect(api.cooldownKind.value).toBeNull();
        expect(ring(wrapper).exists()).toBe(false);
        expect(refreshIcon(wrapper).exists()).toBe(true);
        expect(document.activeElement).toBe(button);
        wrapper.unmount();
    });

    it('an automatic sync answering throttled with retry_after backs off', async () => {
        axiosGet.mockImplementation(async () => staleRead());
        axiosPost.mockResolvedValue({ data: syncAnswer({ status: 'throttled', retry_after: 20 }) });
        const { wrapper, api } = mountPage();
        await advance(0);
        await advance(400);
        await advance(0);

        expect(axiosPost).toHaveBeenCalledWith(SYNC_URL, expect.objectContaining({ force: false }));
        expect(disabled(wrapper)).toBe(true);
        expect(cooldown(wrapper)).toBe('backoff');
        expect(ring(wrapper).exists()).toBe(true);
        await advance(19_000);
        expect(cooldown(wrapper)).toBe('backoff');
        await advance(1_000);
        expect(disabled(wrapper)).toBe(false);
        expect(cooldown(wrapper)).toBeUndefined();
        expect(api.cooldownKind.value).toBeNull();
        wrapper.unmount();
    });

    it('a read sync.retry_after starts a backoff cooldown', async () => {
        axiosGet.mockImplementation(async () =>
            readResponse(CACHED, new Date(Date.now() - 5_000).toISOString(), 15)
        );
        const { wrapper, api } = mountPage();
        await advance(0);
        await advance(0);

        expect(api.cooldownKind.value).toBe('backoff');
        expect(cooldown(wrapper)).toBe('backoff');
        await advance(14_999);
        expect(api.cooldownKind.value).toBe('backoff');
        await advance(1);
        expect(api.cooldownKind.value).toBeNull();
        expect(cooldown(wrapper)).toBeUndefined();
        wrapper.unmount();
    });

    it('a manual sync answering unavailable with retry_after 3 still cools 10 s', async () => {
        axiosPost.mockResolvedValue({
            data: syncAnswer({ status: 'unavailable', retry_after: 3 }),
        });
        const { wrapper, api } = mountPage();
        await advance(0);
        await press(wrapper);

        expect(api.cooldownKind.value).toBe('manual');
        expect(cooldown(wrapper)).toBe('manual');
        await advance(9_999);
        expect(disabled(wrapper)).toBe(true);
        await advance(1);
        expect(disabled(wrapper)).toBe(false);
        expect(api.cooldownKind.value).toBeNull();
        wrapper.unmount();
    });

    const label = (wrapper: VueWrapper) =>
        syncButton(wrapper).find('[data-testid="outlook-sync-label"]');

    // Opens the Sync tooltip (focus opens it at once) and returns its lines
    async function tooltipLines(wrapper: VueWrapper): Promise<string[]> {
        // The tooltip trigger is the span around the button
        syncButton(wrapper).element.parentElement!.dispatchEvent(new FocusEvent('focus'));
        await nextTick();
        await nextTick();
        const content = document.body.querySelector('[data-testid="outlook-sync-tooltip"]');
        expect(content).not.toBeNull();
        return Array.from(content!.querySelectorAll('p')).map((p) => p.textContent!.trim());
    }

    it('shows "Sync in 10s" right after a manual sync and "Sync in 8s" two seconds later', async () => {
        const { wrapper } = mountPage();
        await advance(0);
        expect(label(wrapper).text()).toBe('Sync Outlook');
        expect(label(wrapper).classes()).not.toContain('tabular-nums');

        await press(wrapper);
        expect(label(wrapper).text()).toBe('Sync in 10s');
        expect(label(wrapper).classes()).toEqual(
            expect.arrayContaining(['hidden', 'md:inline', 'tabular-nums'])
        );
        expect(syncButton(wrapper).classes()).toContain('md:min-w-[8rem]');

        await advance(2_000);
        expect(label(wrapper).text()).toBe('Sync in 8s');

        await advance(8_000);
        expect(label(wrapper).text()).toBe('Sync Outlook');
        wrapper.unmount();
    });

    it('the tooltip says when a manual sync is available again', async () => {
        const { wrapper } = mountPage(true);
        await advance(0);
        await press(wrapper);
        await advance(2_000);

        const lines = await tooltipLines(wrapper);
        expect(lines[0]).toBe('Just synced. You can sync again in 8s.');
        expect(lines[1]).toBe('Last synced 10:00');
        wrapper.unmount();
    });

    it('the tooltip explains a back-off wait', async () => {
        axiosPost.mockResolvedValue({ data: syncAnswer({ status: 'throttled', retry_after: 80 }) });
        const { wrapper } = mountPage(true);
        await advance(0);
        await press(wrapper);

        expect(cooldown(wrapper)).toBe('backoff');
        expect(label(wrapper).text()).toBe('Sync in 1m 20s');
        const lines = await tooltipLines(wrapper);
        expect(lines[0]).toBe('Outlook asked us to wait. You can sync again in 1m 20s.');
        expect(lines[1]).toBe('Outlook unavailable, retry later');
        wrapper.unmount();
    });

    it('describes the wait through aria-describedby and never through the live region', async () => {
        const { wrapper } = mountPage();
        await advance(0);
        expect(syncButton(wrapper).attributes('aria-describedby')).toBeUndefined();

        await press(wrapper);
        const id = syncButton(wrapper).attributes('aria-describedby');
        expect(id).toBeTruthy();
        const hint = wrapper.find(`[id="${id}"]`);
        expect(hint.exists()).toBe(true);
        expect(hint.classes()).toContain('sr-only');
        expect(hint.attributes('role')).toBeUndefined();
        expect(hint.attributes('aria-live')).toBeUndefined();
        expect(hint.text()).toBe('Just synced. You can sync again in 10s.');
        expect(syncButton(wrapper).attributes('aria-label')).toBe('Sync Outlook meetings');

        for (let second = 0; second < 10; second++) {
            expect(statusRegion(wrapper).text()).not.toContain('Sync in');
            expect(statusRegion(wrapper).text()).not.toContain('sync again');
            await advance(1_000);
        }

        // The cooldown ended: no hint, no description, nothing announced
        expect(syncButton(wrapper).attributes('aria-describedby')).toBeUndefined();
        expect(wrapper.find('[data-testid="outlook-sync-cooldown-hint"]').exists()).toBe(false);
        expect(statusRegion(wrapper).text()).toBe('Last synced 10:00');
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

    it('shows the whole-window out-of-sync count of the read between the status and Sync', async () => {
        const item = (id: string, start: string): OutlookOutOfSyncItem => ({
            time_entry_id: id,
            kind: 'cancelled',
            meeting_start: start,
            meeting_end: start.replace('T09', 'T10'),
            new_start: null,
            new_end: null,
            all_day: false,
            entry_start: start,
            entry_end: start.replace('T09', 'T10'),
            description: '',
        });
        (pageProps.microsoft as { calendar: { labels: OutlookCalendarLabels } }).calendar.labels = {
            ...labels,
            osync_count_one: '1 out of sync',
            osync_count_many: ':count out of sync',
            osync_count_aria_one: '1 time entry out of sync with Outlook. Show it.',
            osync_count_aria_many:
                ':count time entries out of sync with Outlook. Show the first one.',
            osync_count_tooltip: 'Show the first entry that changed in Outlook',
        } as OutlookCalendarLabels;
        axiosGet.mockImplementation(async () => {
            const read = readResponse();
            // Flags outside the visible week count as well (future plus the last 60 days)
            read.data.out_of_sync = {
                items: [
                    item('te-1', '2026-11-03T09:00:00Z'),
                    item('te-2', '2026-10-01T09:00:00Z'),
                    item('te-3', '2026-12-01T09:00:00Z'),
                ],
            };
            return read;
        });
        const { wrapper } = mountPage();
        await advance(0);
        await advance(0);

        const counter = wrapper.find('[data-testid="outlook-out-of-sync"]');
        expect(counter.exists()).toBe(true);
        expect(counter.attributes('data-count')).toBe('3');
        const root = wrapper.find('[data-testid="outlook-calendar-controls"]').element;
        const order = Array.from(root.children).map(
            (child) =>
                child.getAttribute('data-testid') ??
                child.querySelector('[data-testid]')?.getAttribute('data-testid')
        );
        expect(order.slice(0, 3)).toEqual([
            'outlook-sync-status',
            'outlook-out-of-sync',
            'outlook-sync-button',
        ]);
        wrapper.unmount();
    });

    it('shows injected flags next to Confirm all in the browser-test mode with actions', async () => {
        delete pageProps.microsoft;
        const { wrapper } = mountPage(true);
        await advance(0);
        (
            window as unknown as {
                __TEST_SET_OUTLOOK_MEETINGS__: (
                    list: OutlookMeeting[],
                    labels?: Partial<OutlookCalendarLabels>,
                    options?: { actions?: boolean; outOfSync?: OutlookOutOfSyncItem[] }
                ) => void;
            }
        ).__TEST_SET_OUTLOOK_MEETINGS__(
            [],
            {
                ...labels,
                osync_count_one: '1 out of sync',
                osync_count_many: ':count out of sync',
                osync_count_aria_one: '1 time entry out of sync with Outlook. Show it.',
                osync_count_aria_many:
                    ':count time entries out of sync with Outlook. Show the first one.',
            },
            {
                actions: true,
                outOfSync: [
                    {
                        time_entry_id: 'te-1',
                        kind: 'removed',
                        meeting_start: '2026-11-03T09:00:00Z',
                        meeting_end: '2026-11-03T10:00:00Z',
                        new_start: null,
                        new_end: null,
                        all_day: false,
                        entry_start: '2026-11-03T09:00:00Z',
                        entry_end: '2026-11-03T10:00:00Z',
                        description: '',
                    },
                ],
            }
        );
        await advance(0);
        await advance(0);

        const counter = wrapper.find('[data-testid="outlook-out-of-sync"]');
        expect(counter.exists()).toBe(true);
        expect(counter.attributes('data-count')).toBe('1');
        expect(counter.attributes('aria-label')).toBe(
            '1 time entry out of sync with Outlook. Show it.'
        );
        expect(syncButton(wrapper).exists()).toBe(false);
        expect(connectButton(wrapper).exists()).toBe(false);
        expect(reconnectButton(wrapper).exists()).toBe(false);
        wrapper.unmount();
    });

    it('counts the rendered pre-assigned injected meetings in the browser-test mode with actions', async () => {
        delete pageProps.microsoft;
        const { wrapper } = mountPage(true);
        await advance(0);
        expect(wrapper.find('[data-testid="outlook-calendar-controls"]').exists()).toBe(false);

        const assignment = {
            project_id: 'p-1',
            project_name: 'Internal',
            project_color: '#ef5350',
            client_name: null,
            task_id: null,
            task_name: null,
            tags: [],
            billable: false,
            converted_at: '2026-10-27T09:00:00Z',
        };
        const base = CACHED[0]!;
        const injected: OutlookMeeting[] = [
            { ...base, id: 'pre-tue', series_key: 'a', assignment },
            {
                ...base,
                id: 'pre-wed',
                series_key: 'b',
                assignment,
                start: '2026-11-04T09:00:00Z',
                end: '2026-11-04T10:00:00Z',
            },
            // Saturday of the week: hidden weekend, no block rendered
            {
                ...base,
                id: 'pre-sat',
                series_key: 'c',
                assignment,
                start: '2026-11-07T09:00:00Z',
                end: '2026-11-07T10:00:00Z',
            },
            { ...base, id: 'dismissed', series_key: 'd', assignment, dismissed: true },
            {
                ...base,
                id: 'suggested',
                assignment: null,
                suggestions: [
                    {
                        project_id: 'p-2',
                        project_name: 'Client work',
                        project_color: '#000000',
                        client_name: null,
                        confident: true,
                        reason: { kind: 'subject', count: 3, value: null },
                    },
                ],
            },
        ];
        const root = document.createElement('div');
        root.className = 'fc';
        for (const id of ['pre-tue', 'pre-wed', 'dismissed', 'suggested']) {
            const block = document.createElement('div');
            block.dataset.ghostId = id;
            root.appendChild(block);
        }
        document.body.appendChild(root);
        (
            window as unknown as {
                __TEST_SET_OUTLOOK_MEETINGS__: (
                    list: OutlookMeeting[],
                    labels?: Partial<OutlookCalendarLabels>,
                    options?: { actions?: boolean; convertUrl?: string }
                ) => void;
            }
        ).__TEST_SET_OUTLOOK_MEETINGS__(
            injected,
            {
                ...labels,
                confirm_all_short: 'Confirm :count',
                confirm_all_long: 'Confirm :count pre-assigned',
                confirm_all_title_one: 'Confirm 1 pre-assigned meeting',
                confirm_all_title_many: 'Confirm :count pre-assigned meetings',
            },
            { actions: true, convertUrl: 'https://app.example.test/convert' }
        );
        await advance(0);
        await advance(0);

        expect(wrapper.find('[data-testid="outlook-calendar-controls"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="outlook-confirm-all"]').attributes('aria-label')).toBe(
            'Confirm 2 pre-assigned meetings'
        );
        expect(syncButton(wrapper).exists()).toBe(false);
        expect(connectButton(wrapper).exists()).toBe(false);
        wrapper.unmount();
        root.remove();
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
