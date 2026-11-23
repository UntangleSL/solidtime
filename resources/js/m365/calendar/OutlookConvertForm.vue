<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, useId, watch, type ComputedRef } from 'vue';
import { CalendarDays, CircleX, Repeat } from '@lucide/vue';
import { TagIcon } from '@heroicons/vue/20/solid';
import type {
    Client,
    CreateClientBody,
    CreateProjectBody,
    Organization,
    Project,
} from '@/packages/api/src';
import { Button } from '@/packages/ui/src/Buttons';
import PrimaryButton from '@/packages/ui/src/Buttons/PrimaryButton.vue';
import SecondaryButton from '@/packages/ui/src/Buttons/SecondaryButton.vue';
import { Field, FieldError, FieldLabel } from '@/packages/ui/src/field';
import BillableIcon from '@/packages/ui/src/Icons/BillableIcon.vue';
import TextInput from '@/packages/ui/src/Input/TextInput.vue';
import TimePickerSimple from '@/packages/ui/src/Input/TimePickerSimple.vue';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/packages/ui/src/select';
import TagDropdown from '@/packages/ui/src/Tag/TagDropdown.vue';
import TimeTrackerProjectTaskDropdown from '@/packages/ui/src/TimeTracker/TimeTrackerProjectTaskDropdown.vue';
import { useBillableRatesLock } from '@/packages/ui/src/utils/useBillableRatesLock';
import {
    formatHumanReadableDuration,
    formatTime,
    getLocalizedDayJs,
} from '@/packages/ui/src/utils/time';
import { isAllowedToPerformPremiumAction } from '@/utils/billing';
import { getOrganizationCurrencyString } from '@/utils/money';
import { canCreateProjects } from '@/utils/permissions';
import { useNotificationsStore } from '@/utils/notification';
import { getLastWorkTimeEntry } from '@/utils/useCurrentTimeEntry';
import { useClientsStore } from '@/utils/useClients';
import { useClientsQuery } from '@/utils/useClientsQuery';
import { useProjectsStore } from '@/utils/useProjects';
import { useProjectsQuery } from '@/utils/useProjectsQuery';
import { useTagsQuery } from '@/utils/useTagsQuery';
import { useTagsStore } from '@/utils/useTags';
import { useTasksQuery } from '@/utils/useTasksQuery';
import { useTimeEntriesInfiniteQuery } from '@/utils/useTimeEntriesInfiniteQuery';
import { getCurrentOrganizationId } from '@/utils/useUser';
import type {
    OutlookCalendarLabels,
    OutlookConversionResult,
    OutlookMeeting,
    OutlookSuggestion,
} from '@/m365/types';
import OutlookAssignResults from './OutlookAssignResults.vue';
import OutlookSuggestionPicks from './OutlookSuggestionPicks.vue';
import { fillLabel } from './labels';
import { readLastProject, rememberLastProject, resolvePrefillProject } from './lastProject';
import { type PrefillReason, reasonIcon, reasonLabel } from './suggestionReason';
import {
    batchSeriesNote,
    type Prefill,
    quickPicks,
    resolveBatchPrefill,
    resolveSinglePrefill,
    seriesNote,
} from './suggestions';
import { OUTLOOK_MEETINGS_KEY } from './useOutlookMeetings';

// Mini form that turns Outlook meetings into time entries (Phase 4). Single mode (UI-SPEC section
// 3; D-02, D-03) lives in the meeting's detail panel (form mode); batch mode (section 7; D-07,
// D-08) lives in the popover of the floating selection bar. Both talk only to the injected Outlook
// context, which owns the request and the cache. Pickers are the core ones, imported unchanged.
// Meeting values are only ever rendered through text interpolation and input values.
const props = defineProps<{
    mode: 'single' | 'batch';
    meetings: OutlookMeeting[];
    labels: OutlookCalendarLabels;
}>();

const emit = defineEmits<{
    done: [results: OutlookConversionResult[]];
    cancel: [];
    busy: [value: boolean];
}>();

const context = inject(OUTLOOK_MEETINGS_KEY, null);
const organization = inject<ComputedRef<Organization | undefined> | undefined>(
    'organization',
    undefined
);
const { locked: billableRatesLocked } = useBillableRatesLock();

// Same caches as the calendar page, so the pickers are usually filled at once.
const { projects } = useProjectsQuery();
const { tasks } = useTasksQuery();
const { clients } = useClientsQuery();
const { tags } = useTagsQuery();
// Loaded when the form mounts (only then): the fallback prefill is the project of the latest entry.
const timeEntriesQuery = useTimeEntriesInfiniteQuery();

const organizationId = getCurrentOrganizationId() ?? null;
const currency = getOrganizationCurrencyString();
const enableEstimatedTime = isAllowedToPerformPremiumAction();

// The mode is fixed for the life of the form (the hosts mount one form per mode).
const isBatch = props.mode === 'batch';

const meeting = computed(() => props.meetings[0]!);

function byStartThenId(a: OutlookMeeting, b: OutlookMeeting): number {
    const diff = new Date(a.start).getTime() - new Date(b.start).getTime();
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Batch: the meetings as they were when the form opened, in start order. Converted meetings leave
// the selection (and so the host's list) while the form still has to show their row.
const batchMeetings: OutlookMeeting[] = isBatch ? [...props.meetings].sort(byStartThenId) : [];

const titleId = `outlook-convert-title-${useId()}`;
const rootEl = ref<HTMLElement | null>(null);

const description = ref(!isBatch && meeting.value.subject?.trim() ? meeting.value.subject : '');
const projectId = ref<string | null>(null);
const taskId = ref<string | null>(null);
const selectedTags = ref<string[]>([]);
const billable = ref(false);
// Localized timestamps (TimePickerSimple edits hours and minutes only, so the dates stay the
// meeting's own days, D-03).
const localStart = ref(isBatch ? '' : getLocalizedDayJs(meeting.value.start).format());
const localEnd = ref(isBatch ? '' : getLocalizedDayJs(meeting.value.end).format());

const saving = ref(false);
const projectError = ref(false);
const timeError = ref(false);
const serverError = ref<string | null>(null);

// --- Prefill. Phase 4 (D-02): last project used for a meeting conversion, else the latest entry's
// project. Phase 5 puts the series pre-assignment and a confident learned suggestion before it
// (resolveSinglePrefill; batch: a shared assignment, else the majority candidate, D-08). The
// meeting payload carries both, so the prefill never waits on a lookup.
const storedProjectId = organizationId ? readLastProject(organizationId) : null;
const recentProjectId = computed(() => {
    const entries = timeEntriesQuery.data.value?.pages.flatMap((page) => page.data) ?? [];
    return getLastWorkTimeEntry(entries)?.project_id ?? null;
});
const prefillProjectId = computed(() =>
    resolvePrefillProject(storedProjectId, projects.value, recentProjectId.value)
);
const prefill = computed<Prefill>(() =>
    isBatch
        ? resolveBatchPrefill(batchMeetings, projects.value, prefillProjectId.value)
        : resolveSinglePrefill(meeting.value, projects.value, prefillProjectId.value)
);

const NO_PREFILL: Prefill = {
    source: 'none',
    projectId: null,
    taskId: null,
    tags: [],
    billable: null,
    reason: null,
};
const PREFILL_RANK: Record<Prefill['source'], number> = {
    none: 0,
    last_used: 1,
    suggestion: 2,
    series: 3,
};
// The prefill the form applied, sent with the conversion (D-16) so the server can tell whether the
// user kept it. It stays the same after the user picks another project.
const appliedPrefill = ref<Prefill>(NO_PREFILL);
// Once the user picked something, a late prefill (data still loading) never overrides it.
let projectTouched = false;

// A later prefill replaces an untouched one only when it is better (series > suggestion > last
// used): the Phase 4 rule kept the first last-used project, and so does this.
function applyPrefill(next: Prefill): void {
    if (projectTouched || next.projectId === null) return;
    const current = appliedPrefill.value;
    if (current.source !== 'none' && PREFILL_RANK[next.source] <= PREFILL_RANK[current.source]) {
        return;
    }
    appliedPrefill.value = next;
    projectId.value = next.projectId;
    taskId.value = next.taskId;
    if (next.source === 'series') selectedTags.value = [...next.tags];
    // The prefill arrived after the focus went to the picker: a repeat conversion is Enter.
    if (rootEl.value && document.activeElement === pickerTrigger()) {
        void nextTick(focusSubmit);
    }
}

watch(prefill, applyPrefill, { immediate: true });

// Billable follows the selected project's default (same rule as the core create modal), never
// turned on while billable rates are locked. A prefill that carries its own billable (the series
// assignment) keeps it while its project is selected, even when the projects refetch (RESEARCH
// Pitfall 4).
watch(
    [projectId, projects, appliedPrefill],
    ([id]) => {
        if (!id) return;
        const applied = appliedPrefill.value;
        if (applied.billable !== null && applied.projectId === id) {
            billable.value = applied.billable && !billableRatesLocked.value;
            return;
        }
        const project = projects.value.find((item) => item.id === id);
        if (project) billable.value = project.is_billable && !billableRatesLocked.value;
    },
    { immediate: true }
);

// --- Quick picks (D-07): the candidates the user can switch to in one click. Only projects the
// picker can show (loaded, not archived).
type PickCandidate = Pick<
    OutlookSuggestion,
    'project_id' | 'project_name' | 'project_color' | 'client_name'
> & { reason: PrefillReason };

function usableProject(id: string): boolean {
    return projects.value.some((project) => project.id === id && !project.is_archived);
}

const singleCandidates = computed<OutlookSuggestion[]>(() =>
    isBatch
        ? []
        : (meeting.value.suggestions ?? []).filter((item) => usableProject(item.project_id))
);

// Batch (UI-SPEC section 7): each meeting's top candidate, its series assignment counting as top,
// most common first, ties to the earliest meeting (resolveBatchPrefill's order). Assignments are
// candidates too (reason 'series'), so a project only named by some meetings' series can still be
// picked in one click.
const batchCandidates = computed<PickCandidate[]>(() => {
    if (!isBatch) return [];
    const tallies = new Map<string, { candidate: PickCandidate; count: number; first: number }>();
    batchMeetings.forEach((item, index) => {
        const top: PickCandidate | undefined = item.assignment
            ? {
                  project_id: item.assignment.project_id,
                  project_name: item.assignment.project_name,
                  project_color: item.assignment.project_color,
                  client_name: item.assignment.client_name,
                  reason: { kind: 'series' },
              }
            : item.suggestions?.[0];
        if (top === undefined || !usableProject(top.project_id)) return;
        const tally = tallies.get(top.project_id);
        if (tally) tally.count++;
        else tallies.set(top.project_id, { candidate: top, count: 1, first: index });
    });
    return [...tallies.values()]
        .sort((a, b) => b.count - a.count || a.first - b.first)
        .map((tally) => tally.candidate);
});

const candidates = computed<PickCandidate[]>(() =>
    isBatch ? batchCandidates.value : singleCandidates.value
);
const picks = computed<PickCandidate[]>(() =>
    isBatch
        ? batchCandidates.value.filter((item) => item.project_id !== projectId.value).slice(0, 2)
        : quickPicks(singleCandidates.value, projectId.value)
);

function onSuggestionPicked(id: string): void {
    projectTouched = true;
    projectId.value = id;
    taskId.value = null;
    void nextTick(focusSubmit);
}

// Why the project in the picker is there (RULE-05): the reason of the prefill while its project is
// selected, else the reason of the candidate it is. A project picked by hand that is not a
// candidate has no reason line.
const currentReason = computed<PrefillReason | null>(() => {
    const id = projectId.value;
    if (!id) return null;
    const applied = appliedPrefill.value;
    if (applied.projectId === id) return applied.reason;
    return candidates.value.find((item) => item.project_id === id)?.reason ?? null;
});
const currentReasonLabel = computed(() =>
    currentReason.value ? reasonLabel(currentReason.value, props.labels) : ''
);
const currentReasonIcon = computed(() =>
    currentReason.value ? reasonIcon(currentReason.value.kind) : null
);

// What the conversion will do to the series (D-05): the first conversion of a recurring meeting
// pre-assigns its series; a different project moves a pre-assigned series from now on.
const seriesNoteText = computed<string | null>(() => {
    const id = projectId.value;
    if (!id) return null;
    if (isBatch) return batchSeriesNote(batchMeetings) ? props.labels.batch_series_note : null;
    const kind = seriesNote(meeting.value, id);
    if (kind === 'new') return props.labels.series_note_new;
    if (kind === 'change') return props.labels.series_note_change;
    return null;
});

watch(projectId, (id) => {
    if (id) projectError.value = false;
});

watch([localStart, localEnd], () => {
    timeError.value = false;
});

function onProjectPicked(): void {
    projectTouched = true;
}

const billableProxy = computed({
    get: () => (billable.value ? 'true' : 'false'),
    set: (value: string) => {
        billable.value = value === 'true';
    },
});

const tagsLabel = computed(() => {
    const count = selectedTags.value.length;
    if (count === 0) return props.labels.tags;
    if (count === 1) return props.labels.tags_one;
    return fillLabel(props.labels.tags_many, { count: String(count) });
});

async function createTag(name: string) {
    return await useTagsStore().createTag(name);
}

// "Create new Project" in the core picker opens the core project modal (with its own "create
// client"); the modal is a portaled dialog, which the host popovers treat as a nested layer.
async function createProject(project: CreateProjectBody): Promise<Project | undefined> {
    const created = await useProjectsStore().createProject(project);
    // The core picker does not select what it created; the form does, like a manual pick.
    if (created) {
        projectId.value = created.id;
        taskId.value = null;
        onProjectPicked();
    }
    return created;
}

async function createClient(client: CreateClientBody): Promise<Client | undefined> {
    return await useClientsStore().createClient(client);
}

const allowCreateProject = computed(() => canCreateProjects());

const timeFormat = computed(() => organization?.value?.time_format ?? '24-hours');

// "Tue, Nov 17 · 10:00 – 11:00" like OutlookMeetingSummary's time row, without the duration.
const contextLine = computed(() => {
    const start = getLocalizedDayJs(meeting.value.start);
    const end = getLocalizedDayJs(meeting.value.end);
    const dateFormat = 'ddd, MMM D';
    const startTime = formatTime(meeting.value.start, timeFormat.value);
    const endTime = formatTime(meeting.value.end, timeFormat.value);
    const when = start.isSame(end, 'day')
        ? `${start.format(dateFormat)} · ${startTime} – ${endTime}`
        : `${start.format(dateFormat)} ${startTime} – ${end.format(dateFormat)} ${endTime}`;
    return fillLabel(props.labels.form_context, { when });
});

const duration = computed(() => {
    const seconds = Math.max(
        0,
        getLocalizedDayJs(localEnd.value).diff(getLocalizedDayJs(localStart.value), 'second')
    );
    return formatHumanReadableDuration(
        seconds,
        organization?.value?.interval_format,
        organization?.value?.number_format
    );
});

// UTC with a Z suffix and seconds 00, the format the core time-entry request accepts.
function toUtc(local: string): string {
    return getLocalizedDayJs(local).second(0).millisecond(0).utc().format('YYYY-MM-DDTHH:mm:ss[Z]');
}

function pickerTrigger(): HTMLElement | null {
    return (
        rootEl.value?.querySelector<HTMLElement>(
            '[data-testid="outlook-convert-project"] button'
        ) ?? null
    );
}

function focusPicker(): void {
    pickerTrigger()?.focus();
}

const submitTestId = isBatch ? 'outlook-batch-submit' : 'outlook-convert-submit';

function focusSubmit(): void {
    rootEl.value?.querySelector<HTMLElement>(`[data-testid="${submitTestId}"]`)?.focus();
}

function submit(): Promise<void> {
    return isBatch ? submitBatch() : submitSingle();
}

async function submitSingle(): Promise<void> {
    if (saving.value) return;
    serverError.value = null;

    if (!projectId.value) {
        projectError.value = true;
        await nextTick();
        focusPicker();
        return;
    }
    const start = toUtc(localStart.value);
    const end = toUtc(localEnd.value);
    if (!getLocalizedDayJs(end).isAfter(getLocalizedDayJs(start))) {
        timeError.value = true;
        return;
    }
    if (!context) {
        serverError.value = props.labels.error_generic;
        return;
    }

    const id = meeting.value.id;
    const project = projectId.value;
    saving.value = true;
    emit('busy', true);
    let results: OutlookConversionResult[];
    try {
        results = await context.convert([id], {
            project_id: project,
            task_id: taskId.value,
            tags: [...selectedTags.value],
            billable: billable.value,
            description: description.value,
            start,
            end,
            prefill_source: appliedPrefill.value.source,
            prefill_project_id: appliedPrefill.value.projectId,
        });
    } finally {
        saving.value = false;
        emit('busy', false);
    }

    // Another conversion of this meeting is still running (the context sent nothing)
    if (results.length === 0) return;

    const own = results.find((result) => result.meeting_id === id) ?? results[0];
    if (own && own.status !== 'failed') {
        if (organizationId) rememberLastProject(organizationId, project);
        useNotificationsStore().addNotification('success', props.labels.created_success);
        emit('done', results);
        return;
    }

    serverError.value = own?.error?.message || props.labels.error_generic;
    await nextTick();
    focusSubmit();
}

// --- Batch mode (D-07): one request for every listed meeting, no description and no times (each
// meeting keeps its own time and its subject becomes the description, server side).
const batchCount = computed(() => batchMeetings.length);

function plural(one: string, many: string, count: number): string {
    return count === 1 ? one : fillLabel(many, { count: String(count) });
}

const batchTitle = computed(() =>
    plural(props.labels.assign_one, props.labels.assign_many, batchCount.value)
);
const batchSubmitLabel = computed(() =>
    plural(props.labels.batch_submit_one, props.labels.batch_submit_many, batchCount.value)
);

// Per-meeting state of the batch (D-08): absent before the first submit, 'pending' while its
// request runs, then the server's result. Kept across retries so done rows stay listed.
type BatchState = Record<string, OutlookConversionResult | 'pending'>;
const batchResults = ref<BatchState>({});
// After a submit with at least one failure the form shows the outcome (header summary, Close and
// Retry); every control stays usable so a retry can use other values.
const resultView = ref(false);
const summaryEl = ref<HTMLElement | null>(null);

function isDone(value: OutlookConversionResult | 'pending' | undefined): boolean {
    return value !== undefined && value !== 'pending' && value.status !== 'failed';
}

const doneCount = computed(
    () => batchMeetings.filter((item) => isDone(batchResults.value[item.id])).length
);
const failedIds = computed(() =>
    batchMeetings
        .filter((item) => {
            const value = batchResults.value[item.id];
            return value !== undefined && value !== 'pending' && value.status === 'failed';
        })
        .map((item) => item.id)
);

const summaryText = computed(() =>
    doneCount.value === 0
        ? props.labels.batch_none
        : fillLabel(props.labels.batch_summary, {
              done: String(doneCount.value),
              total: String(batchCount.value),
          })
);
const retryLabel = computed(() =>
    fillLabel(props.labels.retry_failed, { count: String(failedIds.value.length) })
);

function failed(id: string, message: string): OutlookConversionResult {
    return {
        meeting_id: id,
        status: 'failed',
        time_entry_id: null,
        error: { key: 'request_failed', message },
    };
}

// First submit: every listed meeting. In result view (Retry, Ctrl/Cmd+Enter): only the failed
// ones, with the current values.
async function submitBatch(): Promise<void> {
    if (saving.value) return;

    if (!projectId.value) {
        projectError.value = true;
        await nextTick();
        focusPicker();
        return;
    }

    const ids = resultView.value ? failedIds.value : batchMeetings.map((item) => item.id);
    if (ids.length === 0) return;
    const project = projectId.value;
    const previous = batchResults.value;
    const pending: BatchState = { ...previous };
    ids.forEach((id) => (pending[id] = 'pending'));
    batchResults.value = pending;

    let results: OutlookConversionResult[] = [];
    if (context) {
        saving.value = true;
        emit('busy', true);
        try {
            results = await context.convert(ids, {
                project_id: project,
                task_id: taskId.value,
                tags: [...selectedTags.value],
                billable: billable.value,
                prefill_source: appliedPrefill.value.source,
                prefill_project_id: appliedPrefill.value.projectId,
            });
        } finally {
            saving.value = false;
            emit('busy', false);
        }
        // Another conversion of one of these meetings is still running (the context sent nothing).
        if (results.length === 0) {
            batchResults.value = previous;
            return;
        }
    }

    const next: BatchState = { ...batchResults.value };
    ids.forEach((id) => {
        next[id] =
            results.find((result) => result.meeting_id === id) ??
            failed(id, props.labels.error_generic);
    });
    batchResults.value = next;
    if (results.some((result) => result.status !== 'failed') && organizationId) {
        rememberLastProject(organizationId, project);
    }

    if (failedIds.value.length === 0) {
        // One toast and one announcement for the whole batch, never per row (UI-SPEC section 9).
        const text =
            doneCount.value === 1
                ? props.labels.created_success
                : fillLabel(props.labels.batch_success_many, { count: String(doneCount.value) });
        useNotificationsStore().addNotification('success', text);
        context?.announce(text);
        emit(
            'done',
            batchMeetings
                .map((item) => next[item.id])
                .filter((value): value is OutlookConversionResult => isDone(value))
        );
        return;
    }

    resultView.value = true;
    context?.announce(summaryText.value);
    await nextTick();
    summaryEl.value?.focus();
}

// Ctrl/Cmd+Enter submits from any field of the form. Open pickers render in their own layers
// (portaled), so their Enter never reaches this handler.
function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
        event.preventDefault();
        void submit();
    }
}

function onDescriptionEnter(event: KeyboardEvent): void {
    if (event.isComposing || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    void submit();
}

onMounted(() => {
    // The dialog is labelled by the form title while the form is shown (reka labels it by the
    // trigger otherwise).
    const title = rootEl.value?.querySelector<HTMLElement>(`#${CSS.escape(titleId)}`);
    if (title) title.closest('[role="dialog"]')?.setAttribute('aria-labelledby', titleId);

    void nextTick(() => {
        if (projectId.value) focusSubmit();
        else focusPicker();
    });
});
</script>

<template>
    <div
        ref="rootEl"
        class="space-y-4"
        :data-testid="isBatch ? 'outlook-batch-form' : 'outlook-convert-form'"
        :aria-busy="saving ? 'true' : undefined"
        @keydown="onKeydown">
        <div class="min-w-0">
            <h3
                :id="titleId"
                ref="summaryEl"
                class="text-sm font-semibold text-text-primary focus:outline-none"
                :tabindex="resultView ? -1 : undefined"
                :data-testid="resultView ? 'outlook-batch-summary' : undefined">
                {{ !isBatch ? labels.create_entry : resultView ? summaryText : batchTitle }}
            </h3>
            <p
                v-if="!isBatch"
                class="mt-1 flex min-w-0 items-center gap-1 text-xs text-text-tertiary tabular-nums"
                data-testid="outlook-convert-context">
                <CalendarDays class="size-3 shrink-0" aria-hidden="true" />
                <span class="min-w-0 truncate">{{ contextLine }}</span>
            </p>
        </div>

        <OutlookAssignResults
            v-if="isBatch"
            :meetings="batchMeetings"
            :results="batchResults"
            :labels="labels" />

        <fieldset :disabled="saving" class="m-0 min-w-0 space-y-4 border-0 p-0">
            <TextInput
                v-if="!isBatch"
                v-model="description"
                type="text"
                class="block w-full"
                :aria-label="labels.field_description"
                :placeholder="labels.description_placeholder"
                data-testid="outlook-convert-description"
                @keydown.enter="onDescriptionEnter" />

            <Field :data-invalid="projectError ? 'true' : undefined" class="gap-2">
                <FieldLabel class="text-sm font-normal">{{ labels.field_project }}</FieldLabel>
                <div class="min-w-0">
                    <div class="min-w-0" data-testid="outlook-convert-project">
                        <TimeTrackerProjectTaskDropdown
                            v-model:project="projectId"
                            v-model:task="taskId"
                            variant="input"
                            size="default"
                            align="start"
                            :no-project-value="null"
                            :projects="projects"
                            :tasks="tasks"
                            :clients="clients"
                            :create-project="createProject"
                            :create-client="createClient"
                            :can-create-project="allowCreateProject"
                            :currency="currency"
                            :enable-estimated-time="enableEstimatedTime"
                            :organization-billable-rate="organization?.billable_rate ?? null"
                            @changed="onProjectPicked" />
                    </div>
                    <p
                        v-if="currentReason"
                        class="mt-1 flex min-w-0 items-center gap-1 text-xs text-text-tertiary"
                        data-testid="outlook-suggestion-reason">
                        <component
                            :is="currentReasonIcon"
                            class="size-3 shrink-0"
                            aria-hidden="true" />
                        <span class="min-w-0 truncate" :title="currentReasonLabel">
                            {{ currentReasonLabel }}
                        </span>
                    </p>
                    <OutlookSuggestionPicks
                        :candidates="picks"
                        :labels="labels"
                        @pick="onSuggestionPicked" />
                    <p
                        v-if="seriesNoteText"
                        class="mt-2 flex items-start gap-1 text-xs text-text-tertiary"
                        data-testid="outlook-series-note">
                        <Repeat class="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                        <span>{{ seriesNoteText }}</span>
                    </p>
                </div>
                <FieldError v-if="projectError" class="text-xs">
                    {{ labels.error_project_required }}
                </FieldError>
            </Field>

            <div class="flex min-w-0 gap-2">
                <TagDropdown
                    v-model="selectedTags"
                    :create-tag="createTag"
                    :tags="tags"
                    :show-no-tag-option="false">
                    <template #trigger>
                        <Button variant="input" type="button" data-testid="outlook-convert-tags">
                            <TagIcon class="h-4 text-icon-default" />
                            <span>{{ tagsLabel }}</span>
                        </Button>
                    </template>
                </TagDropdown>
                <Select v-model="billableProxy">
                    <SelectTrigger :show-chevron="false" data-testid="outlook-convert-billable">
                        <SelectValue class="flex items-center gap-2">
                            <BillableIcon class="h-4 text-icon-default" />
                            <span>{{ billable ? labels.billable : labels.non_billable }}</span>
                        </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="true" :disabled="billableRatesLocked">
                            {{ labels.billable }}
                        </SelectItem>
                        <SelectItem value="false">{{ labels.non_billable }}</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <Field v-if="!isBatch" :data-invalid="timeError ? 'true' : undefined" class="gap-2">
                <div class="grid grid-cols-2 gap-2">
                    <div class="min-w-0 space-y-2">
                        <FieldLabel class="text-sm font-normal" :for="`${titleId}-start`">
                            {{ labels.field_start }}
                        </FieldLabel>
                        <TimePickerSimple
                            :id="`${titleId}-start`"
                            v-model="localStart"
                            data-testid="outlook-convert-start" />
                    </div>
                    <div class="min-w-0 space-y-2">
                        <FieldLabel class="text-sm font-normal" :for="`${titleId}-end`">
                            {{ labels.field_end }}
                        </FieldLabel>
                        <TimePickerSimple
                            :id="`${titleId}-end`"
                            v-model="localEnd"
                            data-testid="outlook-convert-end" />
                    </div>
                </div>
                <p
                    class="text-xs text-text-tertiary tabular-nums"
                    data-testid="outlook-convert-duration">
                    {{ duration }}
                </p>
                <FieldError v-if="timeError" class="text-xs">
                    {{ labels.error_end_before_start }}
                </FieldError>
            </Field>
        </fieldset>

        <p v-if="isBatch" class="text-xs text-text-tertiary">{{ labels.batch_note }}</p>

        <p
            v-if="serverError"
            role="alert"
            class="flex items-start gap-1 text-xs text-destructive"
            data-testid="outlook-convert-error">
            <CircleX class="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            <span>{{ serverError }}</span>
        </p>

        <div v-if="resultView" class="flex justify-end gap-2">
            <SecondaryButton
                type="button"
                :disabled="saving"
                data-testid="outlook-batch-close"
                @click="emit('cancel')">
                {{ labels.close }}
            </SecondaryButton>
            <PrimaryButton
                type="button"
                :loading="saving"
                data-testid="outlook-batch-retry"
                @click="submit">
                {{ retryLabel }}
            </PrimaryButton>
        </div>
        <div v-else class="flex justify-end gap-2">
            <SecondaryButton type="button" :disabled="saving" @click="emit('cancel')">
                {{ labels.cancel }}
            </SecondaryButton>
            <PrimaryButton
                type="button"
                :loading="saving"
                :data-testid="submitTestId"
                @click="submit">
                {{ isBatch ? batchSubmitLabel : labels.create_submit }}
            </PrimaryButton>
        </div>
    </div>
</template>
