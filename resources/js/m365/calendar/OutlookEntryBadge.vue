<script setup lang="ts">
import { computed, inject, ref, useId, watch, type ComputedRef } from 'vue';
import { CalendarDays } from '@lucide/vue';
import type { Organization } from '@/packages/api/src';
import { describeBlock } from './describeBlock';
import { autoAdjustedNote } from './syncFlagReason';
import { OUTLOOK_MEETINGS_KEY } from './useOutlookMeetings';

// Outlook origin marker on a time entry created from a meeting (UI-SPEC section 8, D-04, ASGN-05),
// rendered through the core `event-extra` slot as the first item of the entry's title row. The
// marker follows the entry id, so it survives edits and moves (D-05) and goes with the entry when it
// is deleted. It inherits the entry text colour (never accent) and adds no interaction. Without a
// provided context, or for entries that did not come from a meeting, nothing renders.
// Phase 6 (06-UI-SPEC sections 1 and 5): the core block's aria-label hides inner text, so the origin
// text reaches screen readers through a hidden description attached to the block's
// aria-describedby. For 7 days after a silent auto-adjust (D-04) the tooltip and the description
// gain "Updated from Outlook: old → new"; nothing else changes and no toast is shown.
const props = defineProps<{
    timeEntryId: string;
}>();

const context = inject(OUTLOOK_MEETINGS_KEY, null);
const organization = inject<ComputedRef<Organization | undefined> | undefined>(
    'organization',
    undefined
);
const timeFormat = computed(() => organization?.value?.time_format ?? '24-hours');

const label = computed(() => context?.labels.value?.from_meeting ?? null);

const linked = computed(
    () => context?.linkedTimeEntryIds.value.includes(props.timeEntryId) ?? false
);

const note = computed(() => {
    const current = context?.labels.value;
    const adjusted = context?.autoAdjustedOf?.(props.timeEntryId) ?? null;
    if (!current || !adjusted) return null;
    return autoAdjustedNote(adjusted, current, timeFormat.value);
});

const title = computed(() =>
    note.value ? `${label.value ?? ''}\n${note.value}` : (label.value ?? '')
);

// Each line read as a sentence, so the description joins cleanly with the out-of-sync one.
function sentence(text: string): string {
    const trimmed = text.trim();
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

const described = computed(() =>
    [label.value, note.value]
        .filter((line): line is string => typeof line === 'string' && line.trim() !== '')
        .map(sentence)
        .join(' ')
);

const descriptionId = `outlook-entry-origin-${useId()}`;
const descriptionEl = ref<HTMLElement | null>(null);

// Attach the description to the closest core block while the badge is rendered; the remover runs
// when the badge goes away or unmounts.
watch(
    descriptionEl,
    (el, _previous, onCleanup) => {
        if (!el) return;
        onCleanup(describeBlock(el, descriptionId));
    },
    { flush: 'post' }
);
</script>

<template>
    <span
        v-if="linked && label"
        data-testid="outlook-entry-badge"
        class="inline-flex shrink-0 items-center"
        :data-auto-adjusted="note ? '' : undefined"
        :title="title">
        <CalendarDays class="w-3 h-3 shrink-0" aria-hidden="true" />
        <span :id="descriptionId" ref="descriptionEl" hidden>{{ described }}</span>
    </span>
</template>
