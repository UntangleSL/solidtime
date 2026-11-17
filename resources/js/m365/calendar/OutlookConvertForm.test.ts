import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { Project } from '@/packages/api/src';
import { billableRatesLockKey } from '@/packages/ui/src/utils/useBillableRatesLock';
import type { OutlookCalendarLabels, OutlookConversionResult, OutlookMeeting } from '@/m365/types';
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

    it('renders the subject as literal text', async () => {
        mountForm(meeting({ subject: '<img src=x onerror=alert(1)>' }));
        await settle();

        expect(el('outlook-convert-form').querySelector('img')).toBeNull();
        expect(input('outlook-convert-description').value).toBe('<img src=x onerror=alert(1)>');
    });
});
