<script setup lang="ts">
import { computed, inject } from 'vue';
import { CalendarDays } from '@lucide/vue';
import { OUTLOOK_MEETINGS_KEY } from './useOutlookMeetings';

// "My time | Outlook" caption under the weekday and date of a day header (UI-SPEC 3.1 D-04, zone
// cue 3), rendered through the core `day-header-extra` slot. While the Outlook cluster is active
// (connected or reconnect) every header cell reserves the 16px row, empty on days without a lane,
// so the header height never changes across weeks. With the integration off, not connected,
// impersonating or in test-hook mode (no calendar prop) nothing renders. Decorative only: the lane
// group already carries an accessible name, so the row is aria-hidden and has no handlers.
const props = defineProps<{
    dayStr: string;
    isDayView: boolean;
}>();

const context = inject(OUTLOOK_MEETINGS_KEY, null);

const active = computed(() => {
    const state = context?.connectionState.value ?? null;
    return context?.labels.value != null && (state === 'connected' || state === 'reconnect');
});

const labels = computed(() => context?.labels.value ?? null);

// Same width string as the lane drawn in the day column, so the caption sits above the lane.
const laneWidth = computed(() =>
    active.value ? (context?.dayOverlayLane(props.dayStr, props.isDayView) ?? null) : null
);
</script>

<template>
    <div
        v-if="active && labels"
        aria-hidden="true"
        data-testid="outlook-lane-caption"
        class="-mx-2 mt-1 flex h-4 items-center text-left text-xs leading-4 text-text-tertiary">
        <template v-if="laneWidth">
            <span class="min-w-0 flex-1 truncate px-1.5">{{ labels.lane_caption_time }}</span>
            <span
                class="mr-0.5 flex h-full shrink-0 items-center gap-1 overflow-hidden border-l border-border-tertiary px-1.5"
                data-caption-outlook
                :style="{ width: laneWidth }">
                <CalendarDays class="size-3 shrink-0 text-accent-600 dark:text-accent-400" />
                <span class="min-w-0 truncate">{{ labels.lane_caption_outlook }}</span>
            </span>
        </template>
    </div>
</template>
