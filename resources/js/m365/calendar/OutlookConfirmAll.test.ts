import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import type {
    OutlookAssignment,
    OutlookCalendarLabels,
    OutlookConnectionState,
    OutlookConversionResult,
    OutlookMeeting,
} from '@/m365/types';
import OutlookConfirmAll from './OutlookConfirmAll.vue';
import { isPreassigned } from './suggestions';
import { OUTLOOK_MEETINGS_KEY, type OutlookMeetingsContext } from './useOutlookMeetings';

const { addNotification } = vi.hoisted(() => ({ addNotification: vi.fn() }));

vi.mock('@/utils/notification', () => ({ useNotificationsStore: () => ({ addNotification }) }));

const labels = {
    no_subject: '(No subject)',
    cancel: 'Cancel',
    close: 'Close',
    created_success: 'Time entry created successfully',
    batch_summary: ':done of :total time entries created',
    batch_none: 'No time entries created',
    batch_success_many: ':count time entries created successfully',
    retry_failed: 'Retry :count failed',
    row_created: 'Created',
    row_existing: 'Already had a time entry',
    error_generic: 'Could not create the time entry. Try again in a moment.',
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
} as OutlookCalendarLabels;

const assignment: OutlookAssignment = {
    project_id: 'p-1',
    project_name: 'Internal',
    project_color: '#ef5350',
    client_name: null,
    task_id: null,
    task_name: null,
    tags: [],
    billable: false,
    converted_at: '2020-01-01T10:00:00Z',
};

// Past meetings by default (no "Upcoming"); `upcoming` puts one far in the future.
function meeting(
    id: string,
    hour: number,
    overrides: Partial<OutlookMeeting> = {},
    upcoming = false
): OutlookMeeting {
    const day = upcoming ? '2099-01-06' : '2020-01-07';
    const pad = (value: number) => String(value).padStart(2, '0');
    return {
        id,
        subject: 'Meeting ' + id,
        start: `${day}T${pad(hour)}:00:00Z`,
        end: `${day}T${pad(hour + 1)}:00:00Z`,
        organizer_name: null,
        is_organizer: false,
        is_online_meeting: false,
        web_link: null,
        dismissed: false,
        series_key: 'series-' + id,
        series_ignored: false,
        assignment,
        suggestions: [],
        ...overrides,
    };
}

function result(
    id: string,
    status: OutlookConversionResult['status'],
    message = ''
): OutlookConversionResult {
    return {
        meeting_id: id,
        status,
        time_entry_id: status === 'failed' ? null : 'te-' + id,
        error: status === 'failed' ? { key: 'forbidden', message } : null,
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

// Fake context: the list rule mirrors the composable (pre-assigned, not faded, not pending, start
// order) through the real isPreassigned; confirmPreassigned behaves like the real one (pending
// while it runs, done meetings leave the list).
const all = ref<OutlookMeeting[]>([]);
const pendingIds = ref<string[]>([]);
const canAct = ref(true);
const calendar = ref<unknown>(null);
const connectionState = ref<OutlookConnectionState | null>(null);
let answers: (ids: string[]) => OutlookConversionResult[];
let gate: Promise<unknown> | null;
const confirmPreassigned = vi.fn(async (ids: string[]) => {
    pendingIds.value = [...pendingIds.value, ...ids];
    if (gate) await gate;
    const answer = answers(ids);
    const done = answer.filter((item) => item.status !== 'failed').map((item) => item.meeting_id);
    all.value = all.value.filter((item) => !done.includes(item.id));
    pendingIds.value = pendingIds.value.filter((id) => !ids.includes(id));
    return answer;
});
const announce = vi.fn();

function context(): OutlookMeetingsContext {
    return {
        labels: computed(() => labels),
        calendar,
        connectionState,
        canAct,
        preassignedInRange: computed(() =>
            all.value
                .filter((item) => isPreassigned(item) && !pendingIds.value.includes(item.id))
                .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
        ),
        confirmPreassigned,
        announce,
    } as unknown as OutlookMeetingsContext;
}

let wrapper: VueWrapper | null = null;

function mountButton() {
    wrapper = mount(OutlookConfirmAll, {
        attachTo: document.body,
        global: {
            provide: {
                [OUTLOOK_MEETINGS_KEY as symbol]: context(),
                organization: computed(() => ({ time_format: '24-hours' })),
            },
        },
    });
    return wrapper;
}

// The calendar root with one block per rendered meeting (what the ghost layer draws).
function renderBlocks(ids: string[]): void {
    let root = document.body.querySelector<HTMLElement>('.fc');
    if (!root) {
        root = document.createElement('div');
        root.className = 'fc';
        document.body.appendChild(root);
    }
    root.replaceChildren(
        ...ids.map((id) => {
            const block = document.createElement('div');
            block.dataset.ghostId = id;
            return block;
        })
    );
}

async function settle() {
    await nextTick();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
}

function query(testid: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
}

function el(testid: string): HTMLElement {
    const found = query(testid);
    expect(found, testid).not.toBeNull();
    return found as HTMLElement;
}

function rows(): HTMLElement[] {
    return Array.from(
        document.body.querySelectorAll<HTMLElement>('[data-testid="outlook-confirm-row"]')
    );
}

function checkbox(row: HTMLElement): HTMLInputElement | null {
    return row.querySelector<HTMLInputElement>('input[type="checkbox"]');
}

function untick(row: HTMLElement): void {
    const input = checkbox(row)!;
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function openPopover() {
    el('outlook-confirm-all').click();
    await settle();
    expect(query('outlook-confirm-all-popover')).not.toBeNull();
}

function pressEscape(target: EventTarget = document.body) {
    target.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
}

function pointerDown(target: Element) {
    target.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
    );
}

beforeEach(() => {
    addNotification.mockReset();
    announce.mockReset();
    confirmPreassigned.mockClear();
    answers = (ids) => ids.map((id) => result(id, 'created'));
    gate = null;
    canAct.value = true;
    calendar.value = null;
    connectionState.value = null;
    pendingIds.value = [];
    all.value = [meeting('m-3', 14), meeting('m-1', 9), meeting('m-2', 11)];
    renderBlocks(['m-1', 'm-2', 'm-3']);
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
});

describe('OutlookConfirmAll', () => {
    it('lists the rendered pre-assigned meetings with a checked include box and the project', async () => {
        mountButton();
        await settle();

        const button = el('outlook-confirm-all');
        expect(button.getAttribute('aria-label')).toBe('Confirm 3 pre-assigned meetings');
        expect(el('outlook-confirm-all-short').textContent?.trim()).toBe('Confirm 3');
        expect(el('outlook-confirm-all-long').textContent?.trim()).toBe('Confirm 3 pre-assigned');

        await openPopover();
        expect(el('outlook-confirm-all-popover').textContent).toContain(
            'Confirm 3 pre-assigned meetings'
        );
        const list = rows();
        expect(list).toHaveLength(3);
        expect(list.map((row) => row.textContent)).toEqual([
            expect.stringContaining('Meeting m-1'),
            expect.stringContaining('Meeting m-2'),
            expect.stringContaining('Meeting m-3'),
        ]);
        for (const row of list) {
            const box = checkbox(row)!;
            expect(box.checked).toBe(true);
            expect(box.getAttribute('aria-label')).toBe(
                'Include ' + row.querySelector('.font-semibold')!.textContent!.trim()
            );
            expect(row.querySelector('[data-testid="outlook-project-dot"]')).not.toBeNull();
            expect(row.textContent).toContain('Internal');
            expect(row.textContent).not.toContain('Upcoming');
        }
        expect(el('outlook-confirm-note').textContent).toContain('Each meeting keeps its own time');
        expect(el('outlook-confirm-submit').textContent?.trim()).toBe('Confirm 3 meetings');
        expect(document.body.querySelector('[role="list"]')!.className).toContain('max-h-60');
    });

    it('confirms the checked meetings in start order with per-row results and one toast', async () => {
        const request = deferred<void>();
        gate = request.promise;
        mountButton();
        await settle();
        await openPopover();

        el('outlook-confirm-submit').click();
        await settle();
        expect(confirmPreassigned).toHaveBeenCalledWith(['m-1', 'm-2', 'm-3']);
        expect(rows().map((row) => row.dataset.status)).toEqual(['pending', 'pending', 'pending']);
        for (const row of rows()) expect(checkbox(row)).toBeNull();

        request.resolve();
        await settle();

        expect(addNotification).toHaveBeenCalledTimes(1);
        expect(addNotification).toHaveBeenCalledWith(
            'success',
            '3 time entries created successfully'
        );
        expect(announce).toHaveBeenCalledTimes(1);
        expect(announce).toHaveBeenCalledWith('3 time entries created successfully');
        // Everything confirmed: the popover closes and the button leaves with the last meeting
        expect(query('outlook-confirm-all-popover')).toBeNull();
        expect(query('outlook-confirm-all')).toBeNull();
    });

    it('uses the singular labels and the single success toast for one meeting', async () => {
        all.value = [meeting('m-1', 9)];
        mountButton();
        await settle();

        expect(el('outlook-confirm-all').getAttribute('aria-label')).toBe(
            'Confirm 1 pre-assigned meeting'
        );
        await openPopover();
        expect(el('outlook-confirm-all-popover').textContent).toContain(
            'Confirm 1 pre-assigned meeting'
        );
        expect(el('outlook-confirm-submit').textContent?.trim()).toBe('Confirm 1 meeting');

        el('outlook-confirm-submit').click();
        await settle();
        expect(addNotification).toHaveBeenCalledWith('success', 'Time entry created successfully');
    });

    it('renders the responsive label steps and the tooltip copy', async () => {
        mountButton();
        await settle();

        const button = el('outlook-confirm-all');
        expect(button.className).toContain('w-8');
        expect(button.className).toContain('p-0');
        expect(button.className).toContain('md:w-auto');
        const short = el('outlook-confirm-all-short');
        expect(short.className).toContain('hidden');
        expect(short.className).toContain('md:inline');
        expect(short.className).toContain('lg:hidden');
        expect(short.className).toContain('tabular-nums');
        const long = el('outlook-confirm-all-long');
        expect(long.className).toContain('hidden');
        expect(long.className).toContain('lg:inline');
        expect(button.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');

        button.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
        button.focus();
        await new Promise((resolve) => setTimeout(resolve, 350));
        await settle();
        expect(el('outlook-confirm-all-tooltip').textContent).toContain(
            'Review and confirm the pre-assigned meetings in view'
        );
    });

    // Regression (CI Playwright): the trigger sits inside the tooltip, whose own popper root took the
    // anchor, so the popover was never placed and stayed parked above the viewport. Floating UI only
    // replaces reka's parking transform once it has a reference to measure.
    it('anchors the popover to the toolbar button so it is placed on screen', async () => {
        mountButton();
        await settle();
        const button = el('outlook-confirm-all');
        const measured = vi.spyOn(button, 'getBoundingClientRect');
        await openPopover();
        await settle();

        const wrapper = el('outlook-confirm-all-popover').closest<HTMLElement>(
            '[data-reka-popper-content-wrapper]'
        )!;
        expect(wrapper).not.toBeNull();
        expect(wrapper.style.transform).not.toBe('translate(0, -200%)');
        expect(wrapper.style.transform).toMatch(/^translate\(-?[\d.]+px, -?[\d.]+px\)$/);
        expect(measured).toHaveBeenCalled();
        expect(el('outlook-confirm-all-popover').dataset.side).toBe('bottom');
    });

    it('sends only the ticked meetings and keeps the checkbox of an unticked row', async () => {
        const request = deferred<void>();
        gate = request.promise;
        mountButton();
        await settle();
        await openPopover();

        untick(rows()[1]!);
        await settle();
        expect(el('outlook-confirm-submit').textContent?.trim()).toBe('Confirm 2 meetings');

        el('outlook-confirm-submit').click();
        await settle();
        expect(confirmPreassigned).toHaveBeenCalledWith(['m-1', 'm-3']);
        const unticked = rows()[1]!;
        expect(unticked.hasAttribute('data-status')).toBe(false);
        expect(checkbox(unticked)!.checked).toBe(false);
        expect(checkbox(unticked)!.disabled).toBe(true);

        request.resolve();
        await settle();
        expect(addNotification).toHaveBeenCalledWith(
            'success',
            '2 time entries created successfully'
        );
    });

    it('asks for a selection when every row is unticked and sends nothing', async () => {
        mountButton();
        await settle();
        await openPopover();

        for (const row of rows()) untick(row);
        await settle();
        const submit = el('outlook-confirm-submit') as HTMLButtonElement;
        expect(submit.disabled).toBe(false);

        submit.click();
        await settle();
        expect(confirmPreassigned).not.toHaveBeenCalled();
        const error = el('outlook-confirm-none');
        expect(error.textContent?.trim()).toBe('Select at least one meeting.');
        expect(error.getAttribute('role')).toBe('alert');
        expect(query('outlook-confirm-all-popover')).not.toBeNull();
    });

    it('marks a meeting that has not started yet as Upcoming', async () => {
        all.value = [meeting('m-1', 9), meeting('m-9', 9, {}, true)];
        renderBlocks(['m-1', 'm-9']);
        mountButton();
        await settle();
        await openPopover();

        const [past, future] = rows();
        expect(past!.textContent).not.toContain('Upcoming');
        expect(
            future!.querySelector('[data-testid="outlook-batch-row-upcoming"]')!.textContent?.trim()
        ).toBe('· Upcoming');
    });

    it('shows the result view on a failure and retries only the failed meeting', async () => {
        answers = (ids) =>
            ids.map((id) =>
                id === 'm-2'
                    ? result(id, 'failed', "You can't add time to this project.")
                    : result(id, 'created')
            );
        mountButton();
        await settle();
        await openPopover();

        el('outlook-confirm-submit').click();
        await settle();

        expect(el('outlook-confirm-summary').textContent?.trim()).toBe(
            '2 of 3 time entries created'
        );
        expect(announce).toHaveBeenCalledWith('2 of 3 time entries created');
        expect(addNotification).not.toHaveBeenCalled();
        expect(rows().map((row) => row.dataset.status)).toEqual(['created', 'failed', 'created']);
        expect(rows()[1]!.textContent).toContain("You can't add time to this project.");
        const retry = el('outlook-confirm-retry');
        expect(retry.textContent?.trim()).toBe('Retry 1 failed');
        expect(query('outlook-confirm-submit')).toBeNull();

        answers = (ids) => ids.map((id) => result(id, 'created'));
        retry.click();
        await settle();
        expect(confirmPreassigned).toHaveBeenLastCalledWith(['m-2']);
        expect(addNotification).toHaveBeenCalledWith(
            'success',
            '3 time entries created successfully'
        );
        expect(query('outlook-confirm-all-popover')).toBeNull();
    });

    it('Close leaves the result view', async () => {
        answers = (ids) => ids.map((id) => result(id, 'failed', 'Nope'));
        mountButton();
        await settle();
        await openPopover();

        el('outlook-confirm-submit').click();
        await settle();
        expect(el('outlook-confirm-summary').textContent?.trim()).toBe('No time entries created');

        el('outlook-confirm-close').click();
        await settle();
        expect(query('outlook-confirm-all-popover')).toBeNull();
        expect(query('outlook-confirm-all')).not.toBeNull();
    });

    it('ignores Escape and outside clicks while the request runs', async () => {
        const request = deferred<void>();
        gate = request.promise;
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        mountButton();
        await settle();
        await openPopover();

        el('outlook-confirm-submit').click();
        await settle();
        pressEscape(document.activeElement ?? document.body);
        pointerDown(outside);
        await settle();
        expect(query('outlook-confirm-all-popover')).not.toBeNull();
        // The trigger stays (it anchors the popover) even though the pending meetings left the count
        expect(query('outlook-confirm-all')).not.toBeNull();

        request.resolve();
        await settle();
    });

    it('closes on Escape when idle', async () => {
        mountButton();
        await settle();
        await openPopover();

        pressEscape(document.activeElement ?? document.body);
        await settle();
        expect(query('outlook-confirm-all-popover')).toBeNull();
    });

    it('counts only meetings whose block is rendered (hidden weekend, other days of a day view)', async () => {
        renderBlocks(['m-1', 'm-3']);
        mountButton();
        await settle();

        expect(el('outlook-confirm-all').getAttribute('aria-label')).toBe(
            'Confirm 2 pre-assigned meetings'
        );
        await openPopover();
        expect(rows()).toHaveLength(2);
        expect(rows().some((row) => row.textContent?.includes('Meeting m-2'))).toBe(false);
    });

    it('follows the rendered blocks as the lanes change', async () => {
        renderBlocks([]);
        mountButton();
        await settle();
        expect(query('outlook-confirm-all')).toBeNull();

        renderBlocks(['m-2']);
        await settle();
        expect(el('outlook-confirm-all').getAttribute('aria-label')).toBe(
            'Confirm 1 pre-assigned meeting'
        );
    });

    it('never counts dismissed, ignored, pending or suggestion-only meetings (D-08)', async () => {
        all.value = [
            meeting('m-1', 9),
            meeting('m-d', 10, { dismissed: true }),
            meeting('m-i', 11, { series_ignored: true }),
            meeting('m-p', 12),
            meeting('m-s', 13, {
                assignment: null,
                suggestions: [
                    {
                        project_id: 'p-2',
                        project_name: 'Client work',
                        project_color: '#000000',
                        client_name: null,
                        confident: true,
                        reason: { kind: 'subject', count: 4, value: null },
                    },
                ],
            }),
        ];
        pendingIds.value = ['m-p'];
        renderBlocks(['m-1', 'm-d', 'm-i', 'm-p', 'm-s']);
        mountButton();
        await settle();

        expect(el('outlook-confirm-all').getAttribute('aria-label')).toBe(
            'Confirm 1 pre-assigned meeting'
        );
        await openPopover();
        expect(rows()).toHaveLength(1);
        el('outlook-confirm-submit').click();
        await settle();
        expect(confirmPreassigned).toHaveBeenCalledWith(['m-1']);
    });

    it('closes the idle popover when the count drops to 0, and stays while busy', async () => {
        mountButton();
        await settle();
        await openPopover();

        all.value = [];
        await settle();
        expect(query('outlook-confirm-all-popover')).toBeNull();
        expect(query('outlook-confirm-all')).toBeNull();

        // Busy: the pending meetings leave the count, the popover stays until the answer
        all.value = [meeting('m-1', 9)];
        await settle();
        await openPopover();
        const request = deferred<void>();
        gate = request.promise;
        el('outlook-confirm-submit').click();
        await settle();
        expect(query('outlook-confirm-all-popover')).not.toBeNull();
        request.resolve();
        await settle();
    });

    it('hands every checked meeting to the composable at once (it chunks them)', async () => {
        const ids = Array.from(
            { length: 120 },
            (_, index) => 'b-' + String(index).padStart(3, '0')
        );
        all.value = ids.map((id, index) =>
            meeting(id, 0, { start: new Date(Date.UTC(2020, 0, 7, 0, index)).toISOString() })
        );
        renderBlocks(ids);
        mountButton();
        await settle();
        await openPopover();
        expect(rows()).toHaveLength(120);

        el('outlook-confirm-submit').click();
        await settle();
        expect(confirmPreassigned).toHaveBeenCalledTimes(1);
        expect(confirmPreassigned.mock.calls[0]![0]).toEqual(ids);
    });

    it('renders nothing without canAct, or with a calendar that is not connected', async () => {
        canAct.value = false;
        mountButton();
        await settle();
        expect(query('outlook-confirm-all')).toBeNull();

        canAct.value = true;
        calendar.value = { state: 'reconnect' };
        connectionState.value = 'reconnect';
        await settle();
        expect(query('outlook-confirm-all')).toBeNull();

        connectionState.value = 'connected';
        await settle();
        expect(query('outlook-confirm-all')).not.toBeNull();
    });

    it('renders the subject as literal text', async () => {
        all.value = [meeting('m-1', 9, { subject: '<img src=x onerror=alert(1)>' })];
        mountButton();
        await settle();
        await openPopover();

        const row = rows()[0]!;
        expect(row.querySelector('img')).toBeNull();
        expect(row.textContent).toContain('<img src=x onerror=alert(1)>');
        expect(checkbox(row)!.getAttribute('aria-label')).toBe(
            'Include <img src=x onerror=alert(1)>'
        );
    });
});
