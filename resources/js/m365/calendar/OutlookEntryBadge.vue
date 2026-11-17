<script setup lang="ts">
import { computed, inject } from 'vue';
import { CalendarDays } from '@lucide/vue';
import { OUTLOOK_MEETINGS_KEY } from './useOutlookMeetings';

// Outlook origin marker on a time entry created from a meeting (UI-SPEC section 8, D-04, ASGN-05),
// rendered through the core `event-extra` slot as the first item of the entry's title row. The
// marker follows the entry id, so it survives edits and moves (D-05) and goes with the entry when it
// is deleted. It inherits the entry text colour (never accent) and adds no interaction. Without a
// provided context, or for entries that did not come from a meeting, nothing renders.
const props = defineProps<{
    timeEntryId: string;
}>();

const context = inject(OUTLOOK_MEETINGS_KEY, null);

const label = computed(() => context?.labels.value?.from_meeting ?? null);

const linked = computed(
    () => context?.linkedTimeEntryIds.value.includes(props.timeEntryId) ?? false
);
</script>

<template>
    <span
        v-if="linked && label"
        data-testid="outlook-entry-badge"
        class="inline-flex shrink-0 items-center"
        :title="label">
        <CalendarDays class="w-3 h-3 shrink-0" aria-hidden="true" />
        <span class="sr-only">{{ label }}</span>
    </span>
</template>
