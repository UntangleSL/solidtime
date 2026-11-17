import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { Project } from '@/packages/api/src';
import { billableRatesLockKey } from '@/packages/ui/src/utils/useBillableRatesLock';
import type {
    OutlookAssignment,
    OutlookCalendarLabels,
    OutlookConversionResult,
    OutlookMeeting,
    OutlookSuggestion,
} from '@/m365/types';
import OutlookConvertForm from './OutlookConvertForm.vue';
import { OUTLOOK_MEETINGS_KEY, type OutlookMeetingsContext } from './useOutlookMeetings';

const { state, addNotification } = vi.hoisted(() => ({
    state: {
        projects: [] as unknown[],
        entries: [] as unknown[],
    },
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
    return {
        useTagsQuery: () => ({
            tags: c(() => [
                { id: 't-1', name: 'Internal' },
                { id: 't-2', name: 'Client' },
            ]),
        }),
    };
});
vi.mock('@/utils/useTimeEntriesInfiniteQuery', async () => {
    const { computed: c } = await import('vue');
    return {
        useTimeEntriesInfiniteQuery: () => ({
            data: c(() => ({ pages: [{ data: state.entries }] })),
        }),
    };
});
vi.mock('@/utils/useTags', () => ({ useTagsStore: () => ({ createTag: vi.fn() }) }));
vi.mock('@/utils/useUser', () => ({ getCurrentOrganizationId: () => 'org-1' }));
vi.mock('@/utils/billing', () => ({ isAllowedToPerformPremiumAction: () => true }));
vi.mock('@/utils/money', () => ({ getOrganizationCurrencyString: () => 'EUR' }));
vi.mock('@/utils/notification', () => ({ useNotificationsStore: () => ({ addNotification }) }));

const labels = {
    no_subject: '(No subject)',
    create_entry: 'Create time entry',
    create_submit: 'Create entry',
    form_context: 'From Outlook · :when',
    field_description: 'Description',
    field_project: 'Project',
    field_start: 'Start',
    field_end: 'End',
    error_project_required: 'Choose a project.',
    error_end_before_start: 'End time must be after start time.',
    error_generic: 'Could not create the time entry. Try again in a moment.',
    cancel: 'Cancel',
    description_placeholder: 'What did you work on?',
    tags: 'Tags',
    tags_one: '1 Tag',
    tags_many: ':count Tags',
    billable: 'Billable',
    non_billable: 'Non-Billable',
    created_success: 'Time entry created successfully',
    reason_series: 'Same series',
    reason_last_used: 'Last used',
    reason_domain_one: 'Like 1 meeting with @:domain',
    reason_domain_many: 'Like :count meetings with @:domain',
    reason_person_one: 'Like 1 meeting with :name',
    reason_person_many: 'Like :count meetings with :name',
    reason_organizer_one: 'Like 1 meeting organized by :name',
    reason_organizer_many: 'Like :count meetings organized by :name',
    reason_subject_one: 'Like 1 meeting with a similar subject',
    reason_subject_many: 'Like :count meetings with a similar subject',
    reason_batch: 'Suggested for :count of :total meetings',
    other_suggestions: 'Other suggestions',
    use_suggestion: 'Use :project',
    series_note_new: 'Other meetings in this series will come pre-assigned to this project.',
    series_note_change:
        'This series will use the new project from now on. Entries already created stay as they are.',
    batch_series_note:
        'Recurring meetings here will use this project for their series from now on.',
} as OutlookCalendarLabels;

const STORAGE_KEY = 'solidtime:m365-last-meeting-project:org-1';

function project(id: string, overrides: Partial<Project> = {}): Project {
    return {
        id,
        name: 'Project ' + id,
        color: '#ef5350',
        client_id: null,
        is_archived: false,
        billable_rate: null,
        is_billable: false,
        estimated_time: null,
        spent_time: 0,
        is_public: false,
        ...overrides,
    } as Project;
}

function meeting(overrides: Partial<OutlookMeeting> = {}): OutlookMeeting {
    return {
        id: 'm-1',
        subject: 'Weekly sync',
        start: '2026-10-27T09:00:00Z',
        end: '2026-10-27T10:00:00Z',
        organizer_name: 'Ada Lovelace',
        is_organizer: false,
        is_online_meeting: false,
        web_link: null,
        dismissed: false,
        ...overrides,
    };
}

function assignment(overrides: Partial<OutlookAssignment> = {}): OutlookAssignment {
    return {
        project_id: 'p-1',
        project_name: 'Project p-1',
        project_color: '#ef5350',
        client_name: null,
        task_id: 'task-1',
        task_name: 'Task 1',
        tags: ['t-1'],
        billable: false,
        converted_at: '2026-10-20T10:00:00Z',
        ...overrides,
    };
}

function suggestion(
    projectId: string,
    overrides: Partial<OutlookSuggestion> = {}
): OutlookSuggestion {
    return {
        project_id: projectId,
        project_name: 'Project ' + projectId,
        project_color: '#42a5f5',
        client_name: null,
        confident: false,
        reason: { kind: 'subject', count: 2, value: null },
        ...overrides,
    };
}

function chips(): HTMLElement[] {
    return Array.from(
        document.body.querySelectorAll<HTMLElement>('[data-testid="outlook-suggestion-pick"]')
    );
}

function chipIds(): (string | null)[] {
    return chips().map((chip) => chip.getAttribute('data-project-id'));
}

function reasonText(): string | null {
    const line = document.body.querySelector('[data-testid="outlook-suggestion-reason"]');
    return line ? (line.textContent?.trim() ?? '') : null;
}

function pickProject(w: VueWrapper, id: string) {
    const dropdown = w.findComponent({ name: 'TimeTrackerProjectTaskDropdown' });
    dropdown.vm.$emit('update:project', id);
    dropdown.vm.$emit('changed');
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

function created(id = 'm-1'): OutlookConversionResult[] {
    return [{ meeting_id: id, status: 'created', time_entry_id: 'te-1', error: null }];
}

let wrapper: VueWrapper | null = null;
let convert: ReturnType<typeof vi.fn>;
const locked = ref(false);

function mountForm(m: OutlookMeeting = meeting()) {
    const context = { convert } as unknown as OutlookMeetingsContext;
    wrapper = mount(OutlookConvertForm, {
        attachTo: document.body,
        props: { mode: 'single', meetings: [m], labels },
        global: {
            provide: {
                [OUTLOOK_MEETINGS_KEY as symbol]: context,
                [billableRatesLockKey as symbol]: {
                    locked: computed(() => locked.value),
                    requestUpgrade: () => undefined,
                },
                organization: computed(() => ({
                    time_format: '24-hours',
                    billable_rate: null,
                })),
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

function el<T extends HTMLElement = HTMLElement>(testid: string): T {
    const found = document.body.querySelector<T>(`[data-testid="${testid}"]`);
    expect(found, testid).not.toBeNull();
    return found as T;
}

function input(testid: string): HTMLInputElement {
    const found = el(testid);
    return (found instanceof HTMLInputElement ? found : found.querySelector('input'))!;
}

function pickerTrigger(): HTMLElement {
    return el('outlook-convert-project').querySelector('button')!;
}

async function setTime(testid: string, value: string) {
    const field = input(testid);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('blur'));
    await settle();
}

function ctrlEnter(target: Element) {
    target.dispatchEvent(
        new KeyboardEvent('keydown', {
            key: 'Enter',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        })
    );
}

beforeEach(() => {
    vi.mocked(window.getTimezoneSetting).mockReturnValue('Europe/Madrid');
    localStorage.clear();
    addNotification.mockReset();
    convert = vi.fn(async () => created());
    locked.value = false;
    state.projects = [
        project('p-1', { is_billable: true }),
        project('p-2'),
        project('p-old', { is_archived: true, is_billable: true }),
    ];
    state.entries = [];
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
    vi.mocked(window.getTimezoneSetting).mockReturnValue('UTC');
});

describe('OutlookConvertForm (single)', () => {
    it('prefills the description with the subject, the times and the context line', async () => {
        mountForm();
        await settle();

        expect(el('outlook-convert-form').textContent).toContain('Create time entry');
        expect(input('outlook-convert-description').value).toBe('Weekly sync');
        expect(input('outlook-convert-description').getAttribute('aria-label')).toBe('Description');
        expect(input('outlook-convert-start').value).toBe('10:00');
        expect(input('outlook-convert-end').value).toBe('11:00');
        expect(el('outlook-convert-duration').textContent?.trim()).toBe('1h 00min');
        expect(el('outlook-convert-context').textContent?.trim()).toBe(
            'From Outlook · Tue, Oct 27 · 10:00 – 11:00'
        );
    });

    it('leaves the description empty with the core placeholder when there is no subject', async () => {
        mountForm(meeting({ subject: null }));
        await settle();

        const description = input('outlook-convert-description');
        expect(description.value).toBe('');
        expect(description.getAttribute('placeholder')).toBe('What did you work on?');
        expect(el('outlook-convert-form').textContent).not.toContain('(No subject)');
    });

    it('keeps a long subject complete in the input', async () => {
        const subject = 'Quarterly planning '.repeat(20).trim();
        mountForm(meeting({ subject }));
        await settle();

        expect(input('outlook-convert-description').value).toBe(subject);
        expect(el('outlook-convert-context').querySelector('.truncate')).not.toBeNull();
    });

    it('prefills the stored last project, follows its billable default and focuses Create entry', async () => {
        localStorage.setItem(STORAGE_KEY, 'p-1');
        mountForm();
        await settle();

        expect(pickerTrigger().textContent).toContain('Project p-1');
        expect(el('outlook-convert-billable').textContent).toContain('Billable');
        expect(el('outlook-convert-billable').textContent).not.toContain('Non-Billable');
        expect(document.activeElement).toBe(el('outlook-convert-submit'));
    });

    it('ignores an archived stored project and uses the latest work entry project instead', async () => {
        localStorage.setItem(STORAGE_KEY, 'p-old');
        state.entries = [
            {
                id: 'te-9',
                type: 'work',
                start: '2026-10-20T08:00:00Z',
                end: '2026-10-20T09:00:00Z',
                project_id: 'p-2',
            },
        ];
        mountForm();
        await settle();

        expect(pickerTrigger().textContent).toContain('Project p-2');
        expect(el('outlook-convert-billable').textContent).toContain('Non-Billable');
    });

    it('starts with an empty picker and focuses it when nothing can be prefilled', async () => {
        mountForm();
        await settle();

        expect(pickerTrigger().textContent).toContain('No Project');
        expect(document.activeElement).toBe(pickerTrigger());
    });

    it('asks for a project, sends nothing and focuses the picker', async () => {
        mountForm();
        await settle();

        el('outlook-convert-submit').click();
        await settle();

        expect(el('outlook-convert-form').textContent).toContain('Choose a project.');
        expect(convert).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(pickerTrigger());
    });

    it('rejects an end that is not after the start and sends nothing', async () => {
        localStorage.setItem(STORAGE_KEY, 'p-1');
        mountForm();
        await settle();

        await setTime('outlook-convert-end', '09:00');
        expect(input('outlook-convert-end').value).toBe('09:00');
        el('outlook-convert-submit').click();
        await settle();

        expect(el('outlook-convert-form').textContent).toContain(
            'End time must be after start time.'
        );
        expect(convert).not.toHaveBeenCalled();
    });

    it('submits the edited times as UTC with seconds 00 and every field', async () => {
        localStorage.setItem(STORAGE_KEY, 'p-1');
        mountForm();
        await settle();

        await setTime('outlook-convert-start', '10:15');
        expect(el('outlook-convert-duration').textContent?.trim()).toBe('0h 45min');
        el('outlook-convert-submit').click();
        await settle();

        expect(convert).toHaveBeenCalledTimes(1);
        expect(convert).toHaveBeenCalledWith(['m-1'], {
            project_id: 'p-1',
            task_id: null,
            tags: [],
            billable: true,
            description: 'Weekly sync',
            start: '2026-10-27T09:15:00Z',
            end: '2026-10-27T10:00:00Z',
            prefill_source: 'last_used',
            prefill_project_id: 'p-1',
        });
    });

    it('submits on Enter in the description', async () => {
        localStorage.setItem(STORAGE_KEY, 'p-2');
        mountForm();
        await settle();

        const description = input('outlook-convert-description');
        description.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        );
        await settle();

        expect(convert).toHaveBeenCalledTimes(1);
        expect(convert.mock.calls[0]![1]).toMatchObject({ project_id: 'p-2', billable: false });
    });

    it('submits on Ctrl+Enter from the tags trigger', async () => {
        localStorage.setItem(STORAGE_KEY, 'p-2');
        mountForm();
        await settle();

        ctrlEnter(el('outlook-convert-tags'));
        await settle();

        expect(convert).toHaveBeenCalledTimes(1);
    });

    it('labels the tags trigger by count', async () => {
        const w = mountForm();
        await settle();
        expect(el('outlook-convert-tags').textContent?.trim()).toBe('Tags');

        const dropdown = w.findComponent({ name: 'TagDropdown' });
        dropdown.vm.$emit('update:modelValue', ['t-1']);
        await settle();
        expect(el('outlook-convert-tags').textContent?.trim()).toBe('1 Tag');

        dropdown.vm.$emit('update:modelValue', ['t-1', 't-2']);
        await settle();
        expect(el('outlook-convert-tags').textContent?.trim()).toBe('2 Tags');
    });

    it('is busy while saving: spinner, disabled fields, no second request, busy events', async () => {
        localStorage.setItem(STORAGE_KEY, 'p-1');
        const request = deferred<OutlookConversionResult[]>();
        convert.mockReturnValue(request.promise);
        const w = mountForm();
        await settle();

        const submit = el<HTMLButtonElement>('outlook-convert-submit');
        submit.click();
        await settle();

        expect(submit.disabled).toBe(true);
        expect(submit.querySelector('svg.animate-spin, .animate-spin')).not.toBeNull();
        expect(input('outlook-convert-description').closest('fieldset')?.disabled).toBe(true);
        submit.click();
        ctrlEnter(el('outlook-convert-form'));
        await settle();
        expect(convert).toHaveBeenCalledTimes(1);
        expect(w.emitted('busy')).toEqual([[true]]);

        request.resolve(created());
        await settle();
        expect(w.emitted('busy')).toEqual([[true], [false]]);
    });

    it('on success remembers the project, shows the toast and emits done', async () => {
        localStorage.setItem(STORAGE_KEY, 'p-old');
        const w = mountForm();
        await settle();
        w.findComponent({ name: 'TimeTrackerProjectTaskDropdown' }).vm.$emit(
            'update:project',
            'p-2'
        );
        await settle();

        el('outlook-convert-submit').click();
        await settle();

        expect(localStorage.getItem(STORAGE_KEY)).toBe('p-2');
        expect(addNotification).toHaveBeenCalledWith('success', 'Time entry created successfully');
        expect(w.emitted('done')).toEqual([[created()]]);
    });

    it('treats an existing entry as a success', async () => {
        localStorage.setItem(STORAGE_KEY, 'p-1');
        convert.mockResolvedValue([
            { meeting_id: 'm-1', status: 'existing', time_entry_id: 'te-7', error: null },
        ]);
        const w = mountForm();
        await settle();

        el('outlook-convert-submit').click();
        await settle();

        expect(w.emitted('done')).toHaveLength(1);
    });

    it('on a failed result shows the reason, keeps the values and focuses Create entry', async () => {
        localStorage.setItem(STORAGE_KEY, 'p-1');
        convert.mockResolvedValue([
            {
                meeting_id: 'm-1',
                status: 'failed',
                time_entry_id: null,
                error: { key: 'forbidden', message: "You can't add time to this project." },
            },
        ]);
        const w = mountForm();
        await settle();
        const description = input('outlook-convert-description');
        description.value = 'Edited';
        description.dispatchEvent(new Event('input', { bubbles: true }));
        await settle();

        el('outlook-convert-submit').click();
        await settle();

        const alert = el('outlook-convert-error');
        expect(alert.getAttribute('role')).toBe('alert');
        expect(alert.textContent?.trim()).toBe("You can't add time to this project.");
        expect(input('outlook-convert-description').value).toBe('Edited');
        expect(pickerTrigger().textContent).toContain('Project p-1');
        expect(document.activeElement).toBe(el('outlook-convert-submit'));
        expect(w.emitted('done')).toBeUndefined();
        expect(addNotification).not.toHaveBeenCalled();
        expect(localStorage.getItem(STORAGE_KEY)).toBe('p-1');
    });

    it('falls back to the generic copy for a failure without a message', async () => {
        localStorage.setItem(STORAGE_KEY, 'p-1');
        convert.mockResolvedValue([
            {
                meeting_id: 'm-1',
                status: 'failed',
                time_entry_id: null,
                error: { key: 'request_failed', message: '' },
            },
        ]);
        mountForm();
        await settle();

        el('outlook-convert-submit').click();
        await settle();

        expect(el('outlook-convert-error').textContent?.trim()).toBe(
            'Could not create the time entry. Try again in a moment.'
        );
    });

    it('emits cancel from the Cancel button', async () => {
        const w = mountForm();
        await settle();

        const cancel = Array.from(document.body.querySelectorAll('button')).find(
            (button) => button.textContent?.trim() === 'Cancel'
        );
        cancel!.click();

        expect(w.emitted('cancel')).toHaveLength(1);
    });

    it('never turns billable on under the billable-rates lock and disables the Billable option', async () => {
        locked.value = true;
        localStorage.setItem(STORAGE_KEY, 'p-1');
        mountForm();
        await settle();

        expect(el('outlook-convert-billable').textContent).toContain('Non-Billable');

        const trigger = el('outlook-convert-billable');
        trigger.dispatchEvent(
            new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
                button: 0,
                pointerType: 'mouse',
            })
        );
        trigger.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        );
        await settle();

        const options = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'));
        const billableOption = options.find((option) => option.textContent?.trim() === 'Billable');
        expect(billableOption).toBeDefined();
        expect(billableOption!.hasAttribute('data-disabled')).toBe(true);
    });

    it('shows "Last used" under a last-used prefill and no reason line without a prefill', async () => {
        localStorage.setItem(STORAGE_KEY, 'p-1');
        mountForm();
        await settle();
        expect(reasonText()).toBe('Last used');
        wrapper!.unmount();
        wrapper = null;
        document.body.innerHTML = '';

        localStorage.clear();
        mountForm();
        await settle();
        expect(reasonText()).toBeNull();
    });

    it('sends prefill_source none and no prefill project when nothing was prefilled', async () => {
        const w = mountForm();
        await settle();
        pickProject(w, 'p-2');
        await settle();

        el('outlook-convert-submit').click();
        await settle();

        expect(convert.mock.calls[0]![1]).toMatchObject({
            project_id: 'p-2',
            prefill_source: 'none',
            prefill_project_id: null,
        });
        expect(reasonText()).toBeNull();
    });

    it('renders the subject as literal text', async () => {
        mountForm(meeting({ subject: '<img src=x onerror=alert(1)>' }));
        await settle();

        expect(el('outlook-convert-form').querySelector('img')).toBeNull();
        expect(input('outlook-convert-description').value).toBe('<img src=x onerror=alert(1)>');
    });
});

describe('OutlookConvertForm (series pre-assignment)', () => {
    it('opens with the series project, task, tags and billable and says "Same series"', async () => {
        localStorage.setItem(STORAGE_KEY, 'p-2');
        mountForm(meeting({ series_key: 's-1', assignment: assignment() }));
        await settle();

        expect(pickerTrigger().textContent).toContain('Project p-1');
        // p-1 is billable by default, the series was logged non-billable: the series wins.
        expect(el('outlook-convert-billable').textContent).toContain('Non-Billable');
        expect(el('outlook-convert-tags').textContent?.trim()).toBe('1 Tag');
        expect(reasonText()).toBe('Same series');
        expect(document.activeElement).toBe(el('outlook-convert-submit'));

        el('outlook-convert-submit').click();
        await settle();

        expect(convert).toHaveBeenCalledWith(['m-1'], {
            project_id: 'p-1',
            task_id: 'task-1',
            tags: ['t-1'],
            billable: false,
            description: 'Weekly sync',
            start: '2026-10-27T09:00:00Z',
            end: '2026-10-27T10:00:00Z',
            prefill_source: 'series',
            prefill_project_id: 'p-1',
        });
    });

    it('follows a project picked by hand: its billable default, no reason line, prefill still reported', async () => {
        state.projects = [...state.projects, project('p-3', { is_billable: true })];
        const w = mountForm(
            meeting({
                series_key: 's-1',
                assignment: assignment({ project_id: 'p-2', billable: true }),
            })
        );
        await settle();
        expect(el('outlook-convert-billable').textContent).not.toContain('Non-Billable');
        expect(reasonText()).toBe('Same series');

        pickProject(w, 'p-3');
        await settle();

        expect(reasonText()).toBeNull();
        expect(el('outlook-convert-billable').textContent).not.toContain('Non-Billable');

        pickProject(w, 'p-1');
        await settle();
        pickProject(w, 'p-3');
        await settle();
        el('outlook-convert-submit').click();
        await settle();

        expect(convert.mock.calls[0]![1]).toMatchObject({
            project_id: 'p-3',
            billable: true,
            prefill_source: 'series',
            prefill_project_id: 'p-2',
        });
    });

    it('lets billable follow the picked project after leaving the series project', async () => {
        state.projects = [...state.projects, project('p-3', { is_billable: true })];
        const w = mountForm(
            meeting({
                series_key: 's-1',
                assignment: assignment({ project_id: 'p-1', billable: false }),
            })
        );
        await settle();
        expect(el('outlook-convert-billable').textContent).toContain('Non-Billable');

        // p-1 is billable by default but the series said non-billable; p-3 is billable by default.
        pickProject(w, 'p-3');
        await settle();
        expect(el('outlook-convert-billable').textContent).not.toContain('Non-Billable');
        expect(reasonText()).toBeNull();
    });

    it('keeps the series billable off under the billable-rates lock', async () => {
        locked.value = true;
        mountForm(meeting({ series_key: 's-1', assignment: assignment({ billable: true }) }));
        await settle();

        expect(el('outlook-convert-billable').textContent).toContain('Non-Billable');
    });
});

describe('OutlookConvertForm (learned suggestions)', () => {
    beforeEach(() => {
        state.projects = [
            project('p-1', { is_billable: true }),
            project('p-2'),
            project('p-3'),
            project('p-4', { is_billable: true }),
            project('p-old', { is_archived: true }),
        ];
    });

    function learned(): OutlookMeeting {
        return meeting({
            suggestions: [
                suggestion('p-1', {
                    confident: true,
                    reason: { kind: 'domain', count: 4, value: 'client.com' },
                }),
                suggestion('p-3', { reason: { kind: 'person', count: 2, value: 'Ana López' } }),
                suggestion('p-4'),
            ],
        });
    }

    it('opens with the confident top suggestion, its reason and the next two as chips', async () => {
        localStorage.setItem(STORAGE_KEY, 'p-2');
        mountForm(learned());
        await settle();

        expect(pickerTrigger().textContent).toContain('Project p-1');
        expect(el('outlook-convert-billable').textContent).not.toContain('Non-Billable');
        expect(el('outlook-convert-tags').textContent?.trim()).toBe('Tags');
        expect(reasonText()).toBe('Like 4 meetings with @client.com');
        expect(el('outlook-suggestion-picks').getAttribute('aria-label')).toBe('Other suggestions');
        expect(chipIds()).toEqual(['p-3', 'p-4']);
        expect(document.activeElement).toBe(el('outlook-convert-submit'));

        el('outlook-convert-submit').click();
        await settle();

        expect(convert.mock.calls[0]![1]).toMatchObject({
            project_id: 'p-1',
            task_id: null,
            tags: [],
            billable: true,
            prefill_source: 'suggestion',
            prefill_project_id: 'p-1',
        });
    });

    it('keeps the last-used project when the top is not confident and offers the best others', async () => {
        localStorage.setItem(STORAGE_KEY, 'p-2');
        mountForm(
            meeting({ suggestions: [suggestion('p-1'), suggestion('p-2'), suggestion('p-3')] })
        );
        await settle();

        expect(pickerTrigger().textContent).toContain('Project p-2');
        expect(reasonText()).toBe('Last used');
        expect(chipIds()).toEqual(['p-1', 'p-3']);
    });

    it('a chip sets its project, clears the task, keeps the tags, follows billable and focuses Create', async () => {
        const w = mountForm(learned());
        await settle();
        const dropdown = w.findComponent({ name: 'TimeTrackerProjectTaskDropdown' });
        dropdown.vm.$emit('update:task', 'task-9');
        w.findComponent({ name: 'TagDropdown' }).vm.$emit('update:modelValue', ['t-1']);
        await settle();

        chips()[0]!.click();
        await settle();

        expect(pickerTrigger().textContent).toContain('Project p-3');
        expect(el('outlook-convert-billable').textContent).toContain('Non-Billable');
        expect(el('outlook-convert-tags').textContent?.trim()).toBe('1 Tag');
        expect(document.activeElement).toBe(el('outlook-convert-submit'));
        expect(reasonText()).toBe('Like 2 meetings with Ana López');
        expect(chipIds()).toEqual(['p-1', 'p-4']);

        el('outlook-convert-submit').click();
        await settle();

        expect(convert.mock.calls[0]![1]).toMatchObject({
            project_id: 'p-3',
            task_id: null,
            tags: ['t-1'],
            billable: false,
            prefill_source: 'suggestion',
            prefill_project_id: 'p-1',
        });
    });

    it('hides the reason line for a project picked by hand that is not a candidate', async () => {
        const w = mountForm(learned());
        await settle();

        pickProject(w, 'p-2');
        await settle();

        expect(reasonText()).toBeNull();
        expect(chipIds()).toEqual(['p-1', 'p-3']);
    });

    it('shows no reason line and no chip group without history', async () => {
        mountForm(meeting({ suggestions: [] }));
        await settle();

        expect(reasonText()).toBeNull();
        expect(document.body.querySelector('[data-testid="outlook-suggestion-picks"]')).toBeNull();
        expect(chips()).toHaveLength(0);
    });

    it('never offers an archived or unknown project and never prefills it', async () => {
        mountForm(
            meeting({
                suggestions: [
                    suggestion('p-old', { confident: true }),
                    suggestion('p-gone'),
                    suggestion('p-2'),
                ],
            })
        );
        await settle();

        expect(pickerTrigger().textContent).toContain('No Project');
        expect(reasonText()).toBeNull();
        expect(chipIds()).toEqual(['p-2']);
    });
});

const batchLabels = {
    ...labels,
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

function outcome(
    id: string,
    status: OutlookConversionResult['status'],
    message = "You can't add time to this project."
): OutlookConversionResult {
    return {
        meeting_id: id,
        status,
        time_entry_id: status === 'failed' ? null : 'te-' + id,
        error: status === 'failed' ? { key: 'forbidden', message } : null,
    };
}

function threeMeetings(): OutlookMeeting[] {
    return [
        meeting({ id: 'm-3', start: '2026-10-28T09:00:00Z', end: '2026-10-28T10:00:00Z' }),
        meeting({ id: 'm-1' }),
        meeting({ id: 'm-2', start: '2026-10-27T13:00:00Z', end: '2026-10-27T14:00:00Z' }),
    ];
}

let announce: ReturnType<typeof vi.fn>;

function mountBatch(meetings: OutlookMeeting[] = threeMeetings()) {
    announce = vi.fn();
    const context = { convert, announce } as unknown as OutlookMeetingsContext;
    wrapper = mount(OutlookConvertForm, {
        attachTo: document.body,
        props: { mode: 'batch', meetings, labels: batchLabels },
        global: {
            provide: {
                [OUTLOOK_MEETINGS_KEY as symbol]: context,
                [billableRatesLockKey as symbol]: {
                    locked: computed(() => locked.value),
                    requestUpgrade: () => undefined,
                },
                organization: computed(() => ({
                    time_format: '24-hours',
                    billable_rate: null,
                })),
            },
        },
    });
    return wrapper;
}

function batchRows(): HTMLElement[] {
    return Array.from(
        document.body.querySelectorAll<HTMLElement>('[data-testid="outlook-batch-row"]')
    );
}

describe('OutlookConvertForm (batch)', () => {
    beforeEach(() => {
        vi.mocked(window.getTimezoneSetting).mockReturnValue('UTC');
        localStorage.setItem(STORAGE_KEY, 'p-1');
    });

    it('lists the meetings in start order with the batch title, note and submit label', async () => {
        mountBatch();
        await settle();

        const form = el('outlook-batch-form');
        expect(form.querySelector('h3')!.textContent?.trim()).toBe('Assign 3 meetings');
        expect(batchRows()).toHaveLength(3);
        expect(batchRows()[0]!.textContent).toContain('Tue 09:00 – 10:00');
        expect(batchRows()[1]!.textContent).toContain('Tue 13:00 – 14:00');
        expect(batchRows()[2]!.textContent).toContain('Wed 09:00 – 10:00');
        expect(form.textContent).toContain(batchLabels.batch_note);
        expect(form.querySelector('[data-testid="outlook-convert-description"]')).toBeNull();
        expect(form.querySelector('[data-testid="outlook-convert-start"]')).toBeNull();
        expect(el('outlook-batch-submit').textContent?.trim()).toBe('Create 3 time entries');
        expect(document.activeElement).toBe(el('outlook-batch-submit'));
    });

    it('shows a spinner on every row while the request runs and disables the controls', async () => {
        const request = deferred<OutlookConversionResult[]>();
        convert.mockReturnValue(request.promise);
        const w = mountBatch();
        await settle();

        const submit = el<HTMLButtonElement>('outlook-batch-submit');
        submit.click();
        await settle();

        expect(convert).toHaveBeenCalledWith(['m-1', 'm-2', 'm-3'], {
            project_id: 'p-1',
            task_id: null,
            tags: [],
            billable: true,
        });
        for (const row of batchRows()) {
            expect(row.getAttribute('data-status')).toBe('pending');
            expect(row.querySelector('.animate-spin')).not.toBeNull();
        }
        expect(submit.disabled).toBe(true);
        expect(submit.querySelector('.animate-spin')).not.toBeNull();
        expect(el('outlook-convert-tags').closest('fieldset')?.disabled).toBe(true);
        expect(w.emitted('busy')).toEqual([[true]]);

        request.resolve(['m-1', 'm-2', 'm-3'].map((id) => outcome(id, 'created')));
        await settle();
        expect(w.emitted('busy')).toEqual([[true], [false]]);
    });

    it('shows each outcome, summarises, focuses the header and offers Close and Retry', async () => {
        convert.mockResolvedValue([
            outcome('m-1', 'created'),
            outcome('m-2', 'existing'),
            outcome('m-3', 'failed'),
        ]);
        const w = mountBatch();
        await settle();

        el('outlook-batch-submit').click();
        await settle();

        expect(batchRows().map((row) => row.getAttribute('data-status'))).toEqual([
            'created',
            'existing',
            'failed',
        ]);
        expect(batchRows()[0]!.textContent).toContain('Created');
        expect(batchRows()[1]!.textContent).toContain('Already had a time entry');
        expect(batchRows()[2]!.textContent).toContain("You can't add time to this project.");

        const summary = el('outlook-batch-summary');
        expect(summary.textContent?.trim()).toBe('2 of 3 time entries created');
        expect(summary.getAttribute('tabindex')).toBe('-1');
        expect(document.activeElement).toBe(summary);
        expect(announce).toHaveBeenCalledTimes(1);
        expect(announce).toHaveBeenCalledWith('2 of 3 time entries created');

        expect(el('outlook-batch-close').textContent?.trim()).toBe('Close');
        expect(el('outlook-batch-retry').textContent?.trim()).toBe('Retry 1 failed');
        expect(document.body.querySelector('[data-testid="outlook-batch-submit"]')).toBeNull();
        expect(el('outlook-convert-tags').closest('fieldset')?.disabled).toBe(false);
        expect(w.emitted('done')).toBeUndefined();
        expect(addNotification).not.toHaveBeenCalled();

        el('outlook-batch-close').click();
        expect(w.emitted('cancel')).toHaveLength(1);
    });

    it('says "No time entries created" when every meeting failed', async () => {
        convert.mockResolvedValue(['m-1', 'm-2', 'm-3'].map((id) => outcome(id, 'failed')));
        mountBatch();
        await settle();

        el('outlook-batch-submit').click();
        await settle();

        expect(el('outlook-batch-summary').textContent?.trim()).toBe('No time entries created');
        expect(el('outlook-batch-retry').textContent?.trim()).toBe('Retry 3 failed');
    });

    it('retries only the failed meetings with the current values and finishes when they succeed', async () => {
        convert.mockResolvedValueOnce([
            outcome('m-1', 'created'),
            outcome('m-2', 'created'),
            outcome('m-3', 'failed'),
        ]);
        const w = mountBatch();
        await settle();
        el('outlook-batch-submit').click();
        await settle();

        w.findComponent({ name: 'TimeTrackerProjectTaskDropdown' }).vm.$emit(
            'update:project',
            'p-2'
        );
        await settle();
        convert.mockResolvedValueOnce([outcome('m-3', 'created')]);
        el('outlook-batch-retry').click();
        await settle();

        expect(convert).toHaveBeenCalledTimes(2);
        expect(convert.mock.calls[1]).toEqual([
            ['m-3'],
            { project_id: 'p-2', task_id: null, tags: [], billable: false },
        ]);
        expect(w.emitted('done')).toHaveLength(1);
        expect((w.emitted('done')![0]![0] as OutlookConversionResult[]).length).toBe(3);
        expect(addNotification).toHaveBeenCalledTimes(1);
        expect(addNotification).toHaveBeenCalledWith(
            'success',
            '3 time entries created successfully'
        );
        expect(localStorage.getItem(STORAGE_KEY)).toBe('p-2');
    });

    it('closes with one toast and one announcement when every meeting is done', async () => {
        convert.mockResolvedValue([
            outcome('m-1', 'created'),
            outcome('m-2', 'existing'),
            outcome('m-3', 'created'),
        ]);
        const w = mountBatch();
        await settle();

        el('outlook-batch-submit').click();
        await settle();

        expect(w.emitted('done')).toHaveLength(1);
        expect(addNotification).toHaveBeenCalledTimes(1);
        expect(addNotification).toHaveBeenCalledWith(
            'success',
            '3 time entries created successfully'
        );
        expect(announce).toHaveBeenCalledTimes(1);
        expect(announce).toHaveBeenCalledWith('3 time entries created successfully');
    });

    it('uses the core toast for a single meeting', async () => {
        convert.mockResolvedValue([outcome('m-1', 'created')]);
        mountBatch([meeting()]);
        await settle();

        expect(el('outlook-batch-form').querySelector('h3')!.textContent?.trim()).toBe(
            'Assign 1 meeting'
        );
        expect(el('outlook-batch-submit').textContent?.trim()).toBe('Create 1 time entry');
        el('outlook-batch-submit').click();
        await settle();

        expect(addNotification).toHaveBeenCalledWith('success', 'Time entry created successfully');
        expect(announce).toHaveBeenCalledWith('Time entry created successfully');
    });

    it('marks a meeting missing from the answer as failed with the generic reason', async () => {
        convert.mockResolvedValue([outcome('m-1', 'created')]);
        mountBatch([meeting(), meeting({ id: 'm-2', start: '2026-10-27T13:00:00Z' })]);
        await settle();

        el('outlook-batch-submit').click();
        await settle();

        expect(batchRows()[1]!.getAttribute('data-status')).toBe('failed');
        expect(batchRows()[1]!.textContent).toContain(batchLabels.error_generic);
    });

    it('puts the rows back when the context sends nothing (already in flight)', async () => {
        convert.mockResolvedValue([]);
        const w = mountBatch();
        await settle();

        el('outlook-batch-submit').click();
        await settle();

        expect(batchRows().every((row) => !row.hasAttribute('data-status'))).toBe(true);
        expect(document.body.querySelector('[data-testid="outlook-batch-summary"]')).toBeNull();
        expect(w.emitted('done')).toBeUndefined();
    });

    it('keeps 20 meetings usable: 20 rows in the list and one toast for all', async () => {
        const many = Array.from({ length: 20 }, (_, index) =>
            meeting({
                id: 'm-' + String(index).padStart(2, '0'),
                start: `2026-10-27T${String(index).padStart(2, '0')}:00:00Z`,
                end: `2026-10-27T${String(index).padStart(2, '0')}:30:00Z`,
            })
        );
        convert.mockImplementation(async (ids: string[]) =>
            ids.map((id) => outcome(id, 'created'))
        );
        mountBatch(many);
        await settle();

        expect(batchRows()).toHaveLength(20);
        expect(el('outlook-batch-submit').textContent?.trim()).toBe('Create 20 time entries');
        el('outlook-batch-submit').click();
        await settle();

        expect(convert.mock.calls[0]![0]).toHaveLength(20);
        expect(addNotification).toHaveBeenCalledTimes(1);
        expect(addNotification).toHaveBeenCalledWith(
            'success',
            '20 time entries created successfully'
        );
    });
});
