import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { billableRatesLockKey } from '@/packages/ui/src/utils/useBillableRatesLock';
import type { OutlookCalendarLabels, OutlookConversionResult, OutlookMeeting } from '@/m365/types';
import OutlookSelectionBar from './OutlookSelectionBar.vue';
import { OUTLOOK_MEETINGS_KEY, type OutlookMeetingsContext } from './useOutlookMeetings';
import { useOutlookSelection } from './useOutlookSelection';

const { state, addNotification } = vi.hoisted(() => ({
    state: { projects: [] as unknown[] },
    addNotification: vi.fn(),
}));

vi.mock('@/utils/useProjectsQuery', async () => {
    const { computed: c } = await import('vue');
    return { useProjectsQuery: () => ({ projects: c(() => state.projects) }) };
});
vi.mock('@/utils/useTasksQuery', async () => {
    const { computed: c } = await import('vue');
    return { useTasksQuery: () => ({ tasks: c(() => []) }) };
});
vi.mock('@/utils/useClientsQuery', async () => {
    const { computed: c } = await import('vue');
    return { useClientsQuery: () => ({ clients: c(() => []) }) };
});
vi.mock('@/utils/useTagsQuery', async () => {
    const { computed: c } = await import('vue');
    return { useTagsQuery: () => ({ tags: c(() => []) }) };
});
vi.mock('@/utils/useTimeEntriesInfiniteQuery', async () => {
    const { computed: c } = await import('vue');
    return {
        useTimeEntriesInfiniteQuery: () => ({ data: c(() => ({ pages: [{ data: [] }] })) }),
    };
});
vi.mock('@/utils/useTags', () => ({ useTagsStore: () => ({ createTag: vi.fn() }) }));
vi.mock('@/utils/useUser', () => ({ getCurrentOrganizationId: () => 'org-1' }));
vi.mock('@/utils/billing', () => ({ isAllowedToPerformPremiumAction: () => true }));
vi.mock('@/utils/money', () => ({ getOrganizationCurrencyString: () => 'EUR' }));
vi.mock('@/utils/notification', () => ({ useNotificationsStore: () => ({ addNotification }) }));

const labels = {
    no_subject: '(No subject)',
    field_project: 'Project',
    error_project_required: 'Choose a project.',
    error_generic: 'Could not create the time entry. Try again in a moment.',
    cancel: 'Cancel',
    tags: 'Tags',
    tags_one: '1 Tag',
    tags_many: ':count Tags',
    billable: 'Billable',
    non_billable: 'Non-Billable',
    created_success: 'Time entry created successfully',
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
} as OutlookCalendarLabels;

const STORAGE_KEY = 'solidtime:m365-last-meeting-project:org-1';

function meeting(id: string, start: string, overrides: Partial<OutlookMeeting> = {}) {
    return {
        id,
        subject: 'Meeting ' + id,
        start,
        end: start.replace(
            /T(\d\d)/,
            (_m, hour: string) => `T${String(Number(hour) + 1).padStart(2, '0')}`
        ),
        organizer_name: 'Ada Lovelace',
        is_organizer: false,
        is_online_meeting: false,
        web_link: null,
        dismissed: false,
        ...overrides,
    } as OutlookMeeting;
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

let wrapper: VueWrapper | null = null;
let convert: ReturnType<typeof vi.fn>;
let announce: ReturnType<typeof vi.fn>;
let selection: ReturnType<typeof useOutlookSelection>;
const meetings = ref<OutlookMeeting[]>([]);

function mountBar() {
    selection = useOutlookSelection();
    // Like the real context: done meetings leave the cache and the selection.
    convert = vi.fn(async (ids: string[]) => {
        const answer = ids.map((id) => result(id, 'created'));
        meetings.value = meetings.value.filter((item) => !ids.includes(item.id));
        selection.remove(ids);
        return answer;
    });
    announce = vi.fn();
    const context = {
        labels: computed(() => labels),
        meetings: computed(() => meetings.value),
        selection,
        get convert() {
            return convert;
        },
        announce,
    } as unknown as OutlookMeetingsContext;
    wrapper = mount(OutlookSelectionBar, {
        attachTo: document.body,
        global: {
            provide: {
                [OUTLOOK_MEETINGS_KEY as symbol]: context,
                [billableRatesLockKey as symbol]: {
                    locked: computed(() => false),
                    requestUpgrade: () => undefined,
                },
                organization: computed(() => ({ time_format: '24-hours', billable_rate: null })),
            },
        },
    });
    return wrapper;
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

async function openBatch() {
    el('outlook-selection-assign').click();
    await settle();
}

beforeEach(() => {
    localStorage.clear();
    addNotification.mockReset();
    state.projects = [
        {
            id: 'p-1',
            name: 'Project p-1',
            color: '#ef5350',
            client_id: null,
            is_archived: false,
            billable_rate: null,
            is_billable: true,
            estimated_time: null,
            spent_time: 0,
            is_public: false,
        },
    ];
    meetings.value = [
        meeting('m-2', '2026-10-27T13:00:00Z'),
        meeting('m-1', '2026-10-27T09:00:00Z'),
        meeting('m-3', '2026-10-28T09:00:00Z', { subject: null }),
    ];
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
});

describe('OutlookSelectionBar', () => {
    it('stays hidden while nothing is selected', async () => {
        mountBar();
        await settle();
        expect(query('outlook-selection-bar')).toBeNull();
    });

    it('shows the count and the assign button for one and for several meetings', async () => {
        mountBar();
        selection.toggle('m-1');
        await settle();

        const bar = el('outlook-selection-bar');
        expect(bar.getAttribute('role')).toBe('toolbar');
        expect(bar.getAttribute('aria-label')).toBe('Meeting selection');
        expect(bar.textContent).toContain('1 meeting selected');
        expect(el('outlook-selection-assign').textContent?.trim()).toBe('Assign 1 meeting');

        selection.toggle('m-2');
        await settle();
        expect(bar.textContent).toContain('2 meetings selected');
        expect(el('outlook-selection-assign').textContent?.trim()).toBe('Assign 2 meetings');
        expect(el('outlook-selection-clear').getAttribute('aria-label')).toBe('Clear selection');
    });

    it('opens the batch form with the selected meetings in start order and no time fields', async () => {
        mountBar();
        selection.toggle('m-2');
        selection.toggle('m-1');
        await settle();
        await openBatch();

        const form = el('outlook-batch-form');
        expect(form.textContent).toContain('Assign 2 meetings');
        const rows = Array.from(form.querySelectorAll('[data-testid="outlook-batch-row"]'));
        expect(rows).toHaveLength(2);
        expect(rows[0]!.textContent).toContain('Meeting m-1');
        expect(rows[0]!.textContent).toContain('Tue 09:00 – 10:00');
        expect(rows[1]!.textContent).toContain('Meeting m-2');
        expect(rows[1]!.textContent).toContain('Tue 13:00 – 14:00');
        expect(form.querySelector('[role="list"]')?.className).toContain('max-h-40');
        expect(form.textContent).toContain(
            'Each meeting keeps its own time, and its subject becomes the description.'
        );
        expect(form.querySelector('[data-testid="outlook-convert-description"]')).toBeNull();
        expect(form.querySelector('[data-testid="outlook-convert-start"]')).toBeNull();
        expect(form.querySelector('[data-testid="outlook-convert-end"]')).toBeNull();
        expect(el('outlook-batch-submit').textContent?.trim()).toBe('Create 2 time entries');
    });

    it('shows "(No subject)" for a meeting without a subject', async () => {
        mountBar();
        selection.toggle('m-3');
        await settle();
        await openBatch();

        expect(el('outlook-batch-row').textContent).toContain('(No subject)');
        expect(el('outlook-batch-submit').textContent?.trim()).toBe('Create 1 time entry');
    });

    it('sends one request with every selected id and no description or times', async () => {
        localStorage.setItem(STORAGE_KEY, 'p-1');
        mountBar();
        selection.toggle('m-2');
        selection.toggle('m-1');
        await settle();
        await openBatch();

        el('outlook-batch-submit').click();
        await settle();

        expect(convert).toHaveBeenCalledTimes(1);
        expect(convert).toHaveBeenCalledWith(['m-1', 'm-2'], {
            project_id: 'p-1',
            task_id: null,
            tags: [],
            billable: true,
        });
        // Every meeting was created: the meetings left the selection, the popover and bar are gone.
        expect(selection.selectedIds.value).toEqual([]);
        expect(query('outlook-batch-form')).toBeNull();
        expect(query('outlook-selection-bar')).toBeNull();
    });

    it('asks for a project before sending anything', async () => {
        mountBar();
        selection.toggle('m-1');
        await settle();
        await openBatch();

        el('outlook-batch-submit').click();
        await settle();

        expect(convert).not.toHaveBeenCalled();
        expect(el('outlook-batch-form').textContent).toContain('Choose a project.');
    });

    it('clears the selection from the clear button', async () => {
        mountBar();
        selection.toggle('m-1');
        selection.toggle('m-2');
        await settle();

        el('outlook-selection-clear').click();
        await settle();

        expect(selection.selectedIds.value).toEqual([]);
        expect(query('outlook-selection-bar')).toBeNull();
    });

    it('keeps the result view open after a partial failure and the failed meeting selected', async () => {
        localStorage.setItem(STORAGE_KEY, 'p-1');
        mountBar();
        convert.mockImplementation(async (ids: string[]) => {
            meetings.value = meetings.value.filter((item) => item.id !== 'm-1');
            selection.remove(['m-1']);
            return ids.map((id) =>
                id === 'm-1' ? result(id, 'created') : result(id, 'failed', 'Not allowed.')
            );
        });
        selection.toggle('m-1');
        selection.toggle('m-2');
        await settle();
        await openBatch();

        el('outlook-batch-submit').click();
        await settle();

        expect(el('outlook-batch-summary').textContent?.trim()).toBe('1 of 2 time entries created');
        expect(document.body.querySelectorAll('[data-testid="outlook-batch-row"]')).toHaveLength(2);
        expect(selection.selectedIds.value).toEqual(['m-2']);
        expect(addNotification).not.toHaveBeenCalled();

        el('outlook-batch-close').click();
        await settle();

        expect(query('outlook-batch-form')).toBeNull();
        expect(el('outlook-selection-assign').textContent?.trim()).toBe('Assign 1 meeting');
    });
});
