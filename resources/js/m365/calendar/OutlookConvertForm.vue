<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, useId, watch, type ComputedRef } from 'vue';
import { CalendarDays, CircleX } from '@lucide/vue';
import { TagIcon } from '@heroicons/vue/20/solid';
import type { Organization } from '@/packages/api/src';
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
import { useNotificationsStore } from '@/utils/notification';
import { getLastWorkTimeEntry } from '@/utils/useCurrentTimeEntry';
import { useClientsQuery } from '@/utils/useClientsQuery';
import { useProjectsQuery } from '@/utils/useProjectsQuery';
import { useTagsQuery } from '@/utils/useTagsQuery';
import { useTagsStore } from '@/utils/useTags';
import { useTasksQuery } from '@/utils/useTasksQuery';
import { useTimeEntriesInfiniteQuery } from '@/utils/useTimeEntriesInfiniteQuery';
import { getCurrentOrganizationId } from '@/utils/useUser';
import type { OutlookCalendarLabels, OutlookConversionResult, OutlookMeeting } from '@/m365/types';
import { fillLabel } from './labels';
import { readLastProject, rememberLastProject, resolvePrefillProject } from './lastProject';
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

// --- Prefill (D-02): last project used for a meeting conversion, else the latest entry's project.
const storedProjectId = organizationId ? readLastProject(organizationId) : null;
const recentProjectId = computed(() => {
    const entries = timeEntriesQuery.data.value?.pages.flatMap((page) => page.data) ?? [];
    return getLastWorkTimeEntry(entries)?.project_id ?? null;
});
const prefillProjectId = computed(() =>
    resolvePrefillProject(storedProjectId, projects.value, recentProjectId.value)
);
// Once the user picked something, a late prefill (data still loading) never overrides it.
let projectTouched = false;

watch(
    prefillProjectId,
    (id) => {
        if (projectTouched || projectId.value !== null || id === null) return;
        projectId.value = id;
        // The prefill arrived after the focus went to the picker: a repeat conversion is Enter.
        if (rootEl.value && document.activeElement === pickerTrigger()) {
            void nextTick(focusSubmit);
        }
    },
    { immediate: true }
);

// Billable follows the selected project's default (same rule as the core create modal), never
// turned on while billable rates are locked.
watch(
    [projectId, projects],
    ([id]) => {
        if (!id) return;
        const project = projects.value.find((item) => item.id === id);
        if (project) billable.value = project.is_billable && !billableRatesLocked.value;
    },
    { immediate: true }
);

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

// Core picker props for a flow that never creates projects (a modal over the popover).
async function noCreate() {
    return undefined;
}

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

// "Tue 10:00 – 11:00" (the end day is repeated only when the meeting ends on another day).
function rowWhen(item: OutlookMeeting): string {
    const start = getLocalizedDayJs(item.start);
    const end = getLocalizedDayJs(item.end);
    const startTime = formatTime(item.start, timeFormat.value);
    const endTime = formatTime(item.end, timeFormat.value);
    return start.isSame(end, 'day')
        ? `${start.format('ddd')} ${startTime} – ${endTime}`
        : `${start.format('ddd')} ${startTime} – ${end.format('ddd')} ${endTime}`;
}

async function submitBatch(): Promise<void> {
    if (saving.value) return;

    if (!projectId.value) {
        projectError.value = true;
        await nextTick();
        focusPicker();
        return;
    }
    if (!context) return;

    const ids = batchMeetings.map((item) => item.id);
    const project = projectId.value;
    saving.value = true;
    emit('busy', true);
    let results: OutlookConversionResult[];
    try {
        results = await context.convert(ids, {
            project_id: project,
            task_id: taskId.value,
            tags: [...selectedTags.value],
            billable: billable.value,
        });
    } finally {
        saving.value = false;
        emit('busy', false);
    }
    if (results.length === 0) return;

    if (results.every((result) => result.status !== 'failed')) {
        if (organizationId) rememberLastProject(organizationId, project);
        emit('done', results);
    }
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
            <h3 :id="titleId" class="text-sm font-semibold text-text-primary">
                {{ isBatch ? batchTitle : labels.create_entry }}
            </h3>
            <p
                v-if="!isBatch"
                class="mt-1 flex min-w-0 items-center gap-1 text-xs text-text-tertiary tabular-nums"
                data-testid="outlook-convert-context">
                <CalendarDays class="size-3 shrink-0" aria-hidden="true" />
                <span class="min-w-0 truncate">{{ contextLine }}</span>
            </p>
        </div>

        <ul v-if="isBatch" role="list" class="m-0 max-h-40 list-none overflow-y-auto p-0">
            <li
                v-for="item in batchMeetings"
                :key="item.id"
                class="flex min-h-8 items-center gap-2"
                data-testid="outlook-batch-row">
                <span class="flex size-4 shrink-0 items-center justify-center"></span>
                <span class="min-w-0 flex-1 truncate text-xs font-semibold text-text-primary">
                    {{ item.subject?.trim() ? item.subject : labels.no_subject }}
                </span>
                <span class="shrink-0 text-right text-xs text-text-tertiary tabular-nums">
                    {{ rowWhen(item) }}
                </span>
            </li>
        </ul>

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
                        :create-project="noCreate"
                        :create-client="noCreate"
                        :can-create-project="false"
                        :currency="currency"
                        :enable-estimated-time="enableEstimatedTime"
                        :organization-billable-rate="organization?.billable_rate ?? null"
                        @changed="onProjectPicked" />
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

        <div class="flex justify-end gap-2">
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
