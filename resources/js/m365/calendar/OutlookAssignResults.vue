<script setup lang="ts">
import { computed, inject, type ComputedRef } from 'vue';
import { CircleCheck, CircleX, Info } from '@lucide/vue';
import type { Organization } from '@/packages/api/src';
import Checkbox from '@/packages/ui/src/Input/Checkbox.vue';
import LoadingSpinner from '@/packages/ui/src/LoadingSpinner.vue';
import { formatTime, getLocalizedDayJs } from '@/packages/ui/src/utils/time';
import type {
    OutlookAssignment,
    OutlookCalendarLabels,
    OutlookConversionResult,
    OutlookMeeting,
} from '@/m365/types';
import OutlookProjectDot from './OutlookProjectDot.vue';
import { fillLabel } from './labels';

// Meeting rows of the batch form (Phase 4, UI-SPEC section 7; D-08, D-16): subject and time, then a
// status slot that is empty before the submit, a spinner while the request runs and the outcome
// once it is known, with the reason of a failure on a second line. Subjects and server messages
// are rendered through text interpolation only (they come from other people's calendars).
// The bulk confirm (Phase 5, UI-SPEC section 8) reuses it in selectable mode: `checked` puts an
// include checkbox in the status slot of every row without a result, and `project` adds the
// series project (dot + name, " · Upcoming" for a meeting that has not started) as the second line
// until the row has a result. Without those props the Phase 4 output is unchanged.
const props = withDefaults(
    defineProps<{
        meetings: OutlookMeeting[];
        results: Record<string, OutlookConversionResult | 'pending'>;
        labels: OutlookCalendarLabels;
        checked?: Record<string, boolean>;
        // Disables every include checkbox (they are disabled anyway while a row is pending).
        checkDisabled?: boolean;
        project?: (meeting: OutlookMeeting) => OutlookAssignment | null;
        rowTestid?: string;
        listClass?: string;
    }>(),
    {
        checked: undefined,
        checkDisabled: false,
        project: undefined,
        rowTestid: 'outlook-batch-row',
        listClass: 'max-h-40',
    }
);

const emit = defineEmits<{ toggle: [id: string] }>();

const organization = inject<ComputedRef<Organization | undefined> | undefined>(
    'organization',
    undefined
);
const timeFormat = computed(() => organization?.value?.time_format ?? '24-hours');

type RowStatus = 'pending' | 'created' | 'existing' | 'failed';

function status(id: string): RowStatus | undefined {
    const value = props.results[id];
    if (value === undefined) return undefined;
    return value === 'pending' ? 'pending' : value.status;
}

const anyPending = computed(() =>
    Object.values(props.results).some((value) => value === 'pending')
);

function secondLine(id: string): string | null {
    const value = props.results[id];
    if (value === undefined || value === 'pending') return null;
    if (value.status === 'created') return props.labels.row_created;
    if (value.status === 'existing') return props.labels.row_existing;
    return value.error?.message || props.labels.error_generic;
}

function subject(item: OutlookMeeting): string {
    return item.subject?.trim() ? item.subject : props.labels.no_subject;
}

// The project line shows only before the row has a result (the result reason replaces it).
function projectOf(item: OutlookMeeting): OutlookAssignment | null {
    if (!props.project || props.results[item.id] !== undefined) return null;
    return props.project(item);
}

function isUpcoming(item: OutlookMeeting): boolean {
    return Date.parse(item.start) > Date.now();
}

// "Tue 10:00 – 11:00" (the end day is repeated only when the meeting ends on another day).
function when(item: OutlookMeeting): string {
    const start = getLocalizedDayJs(item.start);
    const end = getLocalizedDayJs(item.end);
    const startTime = formatTime(item.start, timeFormat.value);
    const endTime = formatTime(item.end, timeFormat.value);
    return start.isSame(end, 'day')
        ? `${start.format('ddd')} ${startTime} – ${endTime}`
        : `${start.format('ddd')} ${startTime} – ${end.format('ddd')} ${endTime}`;
}
</script>

<template>
    <ul role="list" class="m-0 list-none overflow-y-auto p-0" :class="listClass">
        <li
            v-for="item in meetings"
            :key="item.id"
            class="flex min-h-8 items-center gap-2"
            :data-testid="rowTestid"
            :data-status="status(item.id)">
            <span class="flex size-4 shrink-0 items-center justify-center">
                <LoadingSpinner
                    v-if="status(item.id) === 'pending'"
                    class="m-0 h-3 w-3"
                    aria-hidden="true" />
                <CircleCheck
                    v-else-if="status(item.id) === 'created'"
                    class="size-4 text-green-700 dark:text-green-400"
                    aria-hidden="true" />
                <Info
                    v-else-if="status(item.id) === 'existing'"
                    class="size-4 text-text-tertiary"
                    aria-hidden="true" />
                <CircleX
                    v-else-if="status(item.id) === 'failed'"
                    class="size-4 text-destructive"
                    aria-hidden="true" />
                <Checkbox
                    v-else-if="checked"
                    :checked="checked[item.id] === true"
                    :disabled="checkDisabled || anyPending"
                    :aria-label="fillLabel(labels.include_meeting, { subject: subject(item) })"
                    data-testid="outlook-include-checkbox"
                    @update:checked="emit('toggle', item.id)" />
            </span>
            <span class="min-w-0 flex-1">
                <span class="block truncate text-xs font-semibold text-text-primary">
                    {{ subject(item) }}
                </span>
                <span
                    v-if="secondLine(item.id)"
                    class="block text-xs text-text-secondary"
                    data-testid="outlook-batch-row-reason">
                    {{ secondLine(item.id) }}
                </span>
                <span
                    v-else-if="projectOf(item)"
                    class="flex min-w-0 items-center gap-1 text-xs"
                    data-testid="outlook-batch-row-project">
                    <OutlookProjectDot :color="projectOf(item)!.project_color" />
                    <span class="min-w-0 truncate text-text-secondary">
                        {{ projectOf(item)!.project_name }}
                    </span>
                    <span
                        v-if="isUpcoming(item)"
                        class="shrink-0 text-text-tertiary"
                        data-testid="outlook-batch-row-upcoming">
                        · {{ labels.row_upcoming }}
                    </span>
                </span>
            </span>
            <span
                class="shrink-0 self-start pt-0.5 text-right text-xs text-text-tertiary tabular-nums">
                {{ when(item) }}
            </span>
        </li>
    </ul>
</template>
