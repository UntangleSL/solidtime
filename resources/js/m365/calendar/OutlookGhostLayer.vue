<script setup lang="ts">
import { computed, inject, type ComputedRef } from 'vue';
import type { Organization } from '@/packages/api/src';
import { formatTime, getLocalizedDayJsFromMinutes } from '@/packages/ui/src/utils/time';
import type { OutlookCalendarLabels, OutlookMeeting } from '@/m365/types';
import { fillLabel } from './labels';
import { ghostLaneWidth, layoutGhostsForDay, type GhostVisibleSettings } from './ghostLayout';

// Ghost blocks for one day column, rendered through the core `overlay` slot of CalendarDayColumn
// inside the reserved Outlook lane. Ghosts are inert for every time-entry interaction: they carry
// no event-block class, no event id and no resizers, and the core slot selection ignores
// [data-calendar-overlay]. Meeting text is only ever rendered through text interpolation.
const props = defineProps<{
    meetings: OutlookMeeting[];
    labels: OutlookCalendarLabels;
    dayStr: string;
    isDayView: boolean;
    hasActivityStatus?: boolean;
    totalGridHeight?: number;
    minutesToPixels: (minutes: number) => number;
    settings: GhostVisibleSettings;
    overlayLaneWidth?: string | null;
}>();

const organization = inject<ComputedRef<Organization | undefined> | undefined>(
    'organization',
    undefined
);
const timeFormat = computed(() => organization?.value?.time_format ?? '24-hours');

const boxes = computed(() =>
    layoutGhostsForDay(props.meetings, props.dayStr, props.settings, props.minutesToPixels)
);

const laneWidth = computed(() => props.overlayLaneWidth ?? ghostLaneWidth(props.isDayView));

const layerLabel = computed(() => {
    const day = getLocalizedDayJsFromMinutes(props.dayStr, 0);
    const weekday = day.format('dddd');
    const date = day.format('D MMM');
    return fillLabel(props.labels.layer_label, { weekday, date, day: `${weekday} ${date}` });
});

function subjectOf(meeting: OutlookMeeting): string {
    return meeting.subject?.trim() ? meeting.subject : props.labels.no_subject;
}

function ariaLabelOf(meeting: OutlookMeeting): string {
    return fillLabel(props.labels.ghost_label, {
        subject: subjectOf(meeting),
        start: formatTime(meeting.start, timeFormat.value),
        end: formatTime(meeting.end, timeFormat.value),
    });
}
</script>

<template>
    <div
        v-if="boxes.length > 0"
        role="group"
        :aria-label="layerLabel"
        class="absolute inset-y-0 right-0.5 pointer-events-none"
        :style="{ width: laneWidth }">
        <div
            v-for="box in boxes"
            :key="box.meeting.id"
            class="m365-ghost absolute pointer-events-auto select-none cursor-pointer rounded-sm border border-dashed border-text-tertiary"
            data-calendar-overlay
            role="button"
            tabindex="0"
            :aria-label="ariaLabelOf(box.meeting)"
            :style="{ top: box.top + 'px', height: box.height + 'px' }">
            <span class="block px-1 text-2xs font-semibold text-text-secondary truncate">
                {{ subjectOf(box.meeting) }}
            </span>
        </div>
    </div>
</template>

<style scoped>
.m365-ghost {
    background-color: color-mix(in srgb, var(--color-bg-tertiary) 55%, transparent);
}
.m365-ghost:hover {
    background-color: color-mix(in srgb, var(--color-bg-tertiary) 80%, transparent);
    border-color: var(--color-text-primary);
}
</style>
