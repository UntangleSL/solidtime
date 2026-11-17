<script setup lang="ts">
import { computed } from 'vue';
import { Repeat } from '@lucide/vue';
import { getLocalizedDayJs } from '@/packages/ui/src/utils/time';
import type { OutlookAssignment, OutlookCalendarLabels } from '@/m365/types';
import { fillLabel } from './labels';
import OutlookProjectDot from './OutlookProjectDot.vue';

// Pre-assignment block of a recurring meeting (Phase 5 UI-SPEC sections 2 and 3, RULE-01 /
// RULE-05): eyebrow, project line (dot, name, client) and detail line (task, tags, billable). The
// full variant (detail panel) adds the why line. 12px rows with 4px between them; the host sets the
// top margin. Server values are only rendered through text interpolation, and long names truncate
// with the full text in `title`.
const props = defineProps<{
    assignment: OutlookAssignment;
    labels: OutlookCalendarLabels;
    variant: 'compact' | 'full';
}>();

const SEPARATOR = ' · ';

const clientName = computed(() => props.assignment.client_name?.trim() || null);

const projectTitle = computed(() =>
    clientName.value
        ? `${props.assignment.project_name}${SEPARATOR}${clientName.value}`
        : props.assignment.project_name
);

const detail = computed(() => {
    const parts: string[] = [];
    const task = props.assignment.task_name?.trim();
    if (task) parts.push(task);
    const count = props.assignment.tags.length;
    if (count === 1) parts.push(props.labels.tags_one);
    if (count > 1) parts.push(fillLabel(props.labels.tags_many, { count: String(count) }));
    parts.push(props.assignment.billable ? props.labels.billable : props.labels.non_billable);
    return parts.join(SEPARATOR);
});

// "You logged this series to Acme Website on Tue, Nov 10." (date in the user's timezone, like the
// panel time row).
const why = computed(() =>
    fillLabel(props.labels.why_series, {
        project: props.assignment.project_name,
        date: getLocalizedDayJs(props.assignment.converted_at).format('ddd, MMM D'),
    })
);
</script>

<template>
    <div
        class="space-y-1 text-xs"
        :data-testid="
            variant === 'full' ? 'outlook-detail-preassignment' : 'outlook-preassignment'
        ">
        <div
            class="flex items-center gap-1 text-text-tertiary"
            data-testid="outlook-preassignment-eyebrow">
            <Repeat class="size-3 shrink-0" aria-hidden="true" />
            <span>{{ labels.preassigned_eyebrow }}</span>
        </div>
        <div class="flex min-w-0 items-center gap-1" data-testid="outlook-preassignment-project">
            <OutlookProjectDot :color="assignment.project_color" />
            <span class="min-w-0 truncate" :title="projectTitle">
                <span class="font-semibold text-text-primary">{{ assignment.project_name }}</span>
                <span v-if="clientName" class="text-text-tertiary"
                    >{{ SEPARATOR }}{{ clientName }}</span
                >
            </span>
        </div>
        <p
            class="truncate text-text-secondary"
            :title="detail"
            data-testid="outlook-preassignment-detail">
            {{ detail }}
        </p>
        <p
            v-if="variant === 'full'"
            class="text-text-tertiary tabular-nums"
            data-testid="outlook-detail-why">
            {{ why }}
        </p>
    </div>
</template>
