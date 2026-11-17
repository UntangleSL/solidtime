<script setup lang="ts">
import { computed, inject, type ComputedRef } from 'vue';
import { CircleCheck, CircleX, Info } from '@lucide/vue';
import type { Organization } from '@/packages/api/src';
import LoadingSpinner from '@/packages/ui/src/LoadingSpinner.vue';
import { formatTime, getLocalizedDayJs } from '@/packages/ui/src/utils/time';
import type { OutlookCalendarLabels, OutlookConversionResult, OutlookMeeting } from '@/m365/types';

// Meeting rows of the batch form (Phase 4, UI-SPEC section 7; D-08, D-16): subject and time, then a
// status slot that is empty before the submit, a spinner while the request runs and the outcome
// once it is known, with the reason of a failure on a second line. Subjects and server messages
// are rendered through text interpolation only (they come from other people's calendars).
const props = defineProps<{
    meetings: OutlookMeeting[];
    results: Record<string, OutlookConversionResult | 'pending'>;
    labels: OutlookCalendarLabels;
}>();

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

function secondLine(id: string): string | null {
    const value = props.results[id];
    if (value === undefined || value === 'pending') return null;
    if (value.status === 'created') return props.labels.row_created;
    if (value.status === 'existing') return props.labels.row_existing;
    return value.error?.message || props.labels.error_generic;
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
    <ul role="list" class="m-0 max-h-40 list-none overflow-y-auto p-0">
        <li
            v-for="item in meetings"
            :key="item.id"
            class="flex min-h-8 items-center gap-2"
            data-testid="outlook-batch-row"
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
            </span>
            <span class="min-w-0 flex-1">
                <span class="block truncate text-xs font-semibold text-text-primary">
                    {{ item.subject?.trim() ? item.subject : labels.no_subject }}
                </span>
                <span
                    v-if="secondLine(item.id)"
                    class="block text-xs text-text-secondary"
                    data-testid="outlook-batch-row-reason">
                    {{ secondLine(item.id) }}
                </span>
            </span>
            <span
                class="shrink-0 self-start pt-0.5 text-right text-xs text-text-tertiary tabular-nums">
                {{ when(item) }}
            </span>
        </li>
    </ul>
</template>
