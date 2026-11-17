import { afterEach, describe, expect, it } from 'vitest';
import { computed } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import type {
    OutlookAssignment,
    OutlookCalendarLabels,
    OutlookConversionResult,
    OutlookMeeting,
} from '@/m365/types';
import OutlookAssignResults from './OutlookAssignResults.vue';

const labels = {
    no_subject: '(No subject)',
    row_created: 'Created',
    row_existing: 'Already had a time entry',
    error_generic: 'Could not create the time entry. Try again in a moment.',
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
    converted_at: '2026-10-20T09:00:00Z',
};

function meeting(id: string, overrides: Partial<OutlookMeeting> = {}): OutlookMeeting {
    return {
        id,
        subject: 'Meeting ' + id,
        start: '2026-10-27T09:00:00Z',
        end: '2026-10-27T10:00:00Z',
        organizer_name: null,
        is_organizer: false,
        is_online_meeting: false,
        web_link: null,
        dismissed: false,
        ...overrides,
    } as OutlookMeeting;
}

function failed(id: string, message: string): OutlookConversionResult {
    return {
        meeting_id: id,
        status: 'failed',
        time_entry_id: null,
        error: { key: 'forbidden', message },
    };
}

let wrapper: VueWrapper | null = null;

function mountRows(
    meetings: OutlookMeeting[],
    results: Record<string, OutlookConversionResult | 'pending'> = {},
    extra: Record<string, unknown> = {}
) {
    wrapper = mount(OutlookAssignResults, {
        attachTo: document.body,
        props: { meetings, results, labels, ...extra },
        global: {
            provide: {
                organization: computed(() => ({ time_format: '24-hours' })),
            },
        },
    });
    return wrapper;
}

function rows(testid = 'outlook-batch-row'): HTMLElement[] {
    return Array.from(document.body.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`));
}

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
});

describe('OutlookAssignResults', () => {
    it('lists the meetings with an empty status slot before the submit', () => {
        mountRows([meeting('m-1'), meeting('m-2', { subject: null })]);

        const list = document.body.querySelector('[role="list"]')!;
        expect(list.className).toContain('max-h-40');
        expect(list.className).toContain('overflow-y-auto');
        const [first, second] = rows();
        expect(first!.hasAttribute('data-status')).toBe(false);
        expect(first!.querySelector('svg')).toBeNull();
        expect(first!.textContent).toContain('Meeting m-1');
        expect(first!.textContent).toContain('Tue 09:00 – 10:00');
        expect(second!.textContent).toContain('(No subject)');
    });

    it('shows a spinner on every pending row', () => {
        mountRows([meeting('m-1'), meeting('m-2')], { 'm-1': 'pending', 'm-2': 'pending' });

        for (const row of rows()) {
            expect(row.getAttribute('data-status')).toBe('pending');
            expect(row.querySelector('.animate-spin')).not.toBeNull();
        }
    });

    it('shows created, existing and failed rows with their icon and second line', () => {
        mountRows([meeting('m-1'), meeting('m-2'), meeting('m-3')], {
            'm-1': { meeting_id: 'm-1', status: 'created', time_entry_id: 'te-1', error: null },
            'm-2': { meeting_id: 'm-2', status: 'existing', time_entry_id: 'te-2', error: null },
            'm-3': failed('m-3', "You can't add time to this project."),
        });

        const [created, existing, fail] = rows();
        expect(created!.getAttribute('data-status')).toBe('created');
        expect(created!.querySelector('svg')!.getAttribute('class')).toContain('text-green-700');
        expect(created!.textContent).toContain('Created');

        expect(existing!.getAttribute('data-status')).toBe('existing');
        expect(existing!.querySelector('svg')!.getAttribute('class')).toContain(
            'text-text-tertiary'
        );
        expect(existing!.textContent).toContain('Already had a time entry');

        expect(fail!.getAttribute('data-status')).toBe('failed');
        expect(fail!.querySelector('svg')!.getAttribute('class')).toContain('text-destructive');
        expect(
            fail!.querySelector('[data-testid="outlook-batch-row-reason"]')!.textContent?.trim()
        ).toBe("You can't add time to this project.");
    });

    it('falls back to the generic reason for a failure without a message', () => {
        mountRows([meeting('m-1')], { 'm-1': failed('m-1', '') });

        expect(rows()[0]!.textContent).toContain(
            'Could not create the time entry. Try again in a moment.'
        );
    });

    it('renders the subject and the server message as literal text', () => {
        mountRows([meeting('m-1', { subject: '<img src=x onerror=alert(1)>' })], {
            'm-1': failed('m-1', '<b>bold</b>'),
        });

        const row = rows()[0]!;
        expect(row.querySelector('img')).toBeNull();
        expect(row.querySelector('b')).toBeNull();
        expect(row.textContent).toContain('<img src=x onerror=alert(1)>');
        expect(row.textContent).toContain('<b>bold</b>');
    });

    it('repeats the day for a meeting that ends on another day', () => {
        mountRows([meeting('m-1', { start: '2026-10-27T23:00:00Z', end: '2026-10-28T01:00:00Z' })]);

        expect(rows()[0]!.textContent).toContain('Tue 23:00 – Wed 01:00');
    });

    it('renders 20 rows inside the scrolling list', () => {
        mountRows(Array.from({ length: 20 }, (_, index) => meeting('m-' + index)));

        expect(rows()).toHaveLength(20);
        expect(document.body.querySelector('[role="list"]')!.children).toHaveLength(20);
    });

    it('renders no checkbox and no project line without the selectable props', () => {
        mountRows([meeting('m-1', { assignment })]);

        const row = rows()[0]!;
        expect(row.querySelector('input')).toBeNull();
        expect(row.querySelector('[data-testid="outlook-project-dot"]')).toBeNull();
        expect(row.textContent).not.toContain('Internal');
    });
});

describe('OutlookAssignResults in selectable mode (bulk confirm)', () => {
    const project = (item: OutlookMeeting) => item.assignment ?? null;
    const selectable = (checked: Record<string, boolean>) => ({
        checked,
        project,
        rowTestid: 'outlook-confirm-row',
        listClass: 'max-h-60',
    });

    it('puts an include checkbox and the project line on rows without a result', () => {
        mountRows(
            [
                meeting('m-1', { assignment }),
                meeting('m-2', {
                    assignment,
                    subject: 'Weekly sync',
                    start: '2099-01-06T09:00:00Z',
                    end: '2099-01-06T10:00:00Z',
                }),
            ],
            {},
            selectable({ 'm-1': true, 'm-2': false })
        );

        expect(rows()).toHaveLength(0);
        const [past, future] = rows('outlook-confirm-row');
        const pastBox = past!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
        expect(pastBox.checked).toBe(true);
        expect(pastBox.disabled).toBe(false);
        expect(pastBox.getAttribute('aria-label')).toBe('Include Meeting m-1');
        const futureBox = future!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
        expect(futureBox.checked).toBe(false);
        expect(futureBox.getAttribute('aria-label')).toBe('Include Weekly sync');

        const line = past!.querySelector('[data-testid="outlook-batch-row-project"]')!;
        expect(line.querySelector('[data-testid="outlook-project-dot"]')).not.toBeNull();
        expect(line.textContent).toContain('Internal');
        expect(line.textContent).not.toContain('Upcoming');
        expect(future!.textContent).toContain('· Upcoming');
        expect(document.body.querySelector('[role="list"]')!.className).toContain('max-h-60');
        expect(document.body.querySelector('[role="list"]')!.className).not.toContain('max-h-40');
    });

    it('emits toggle with the meeting id', async () => {
        mountRows([meeting('m-1', { assignment })], {}, selectable({ 'm-1': true }));

        const box = rows('outlook-confirm-row')[0]!.querySelector<HTMLInputElement>('input')!;
        box.checked = false;
        box.dispatchEvent(new Event('change', { bubbles: true }));

        expect(wrapper!.emitted('toggle')).toEqual([['m-1']]);
    });

    it('disables the checkboxes while a row is pending and replaces the line by the result', () => {
        mountRows(
            [
                meeting('m-1', { assignment }),
                meeting('m-2', { assignment }),
                meeting('m-3', { assignment }),
            ],
            {
                'm-1': 'pending',
                'm-3': failed('m-3', 'Nope'),
            },
            selectable({ 'm-1': true, 'm-2': false, 'm-3': true })
        );

        const [pending, unticked, fail] = rows('outlook-confirm-row');
        expect(pending!.querySelector('input')).toBeNull();
        expect(pending!.querySelector('.animate-spin')).not.toBeNull();
        expect(pending!.textContent).not.toContain('Internal');
        expect(unticked!.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
        expect(fail!.querySelector('input')).toBeNull();
        expect(fail!.getAttribute('data-status')).toBe('failed');
        expect(fail!.textContent).toContain('Nope');
        expect(fail!.textContent).not.toContain('Internal');
    });

    it('disables the checkboxes with checkDisabled', () => {
        mountRows(
            [meeting('m-1', { assignment })],
            {},
            {
                ...selectable({ 'm-1': true }),
                checkDisabled: true,
            }
        );

        expect(
            rows('outlook-confirm-row')[0]!.querySelector<HTMLInputElement>('input')!.disabled
        ).toBe(true);
    });
});
