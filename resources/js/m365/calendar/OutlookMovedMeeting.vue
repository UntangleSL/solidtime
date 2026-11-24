<script setup lang="ts">
import { computed, inject, useId, type ComputedRef } from 'vue';
import { CalendarClock, MoveRight } from '@lucide/vue';
import type { Organization } from '@/packages/api/src';
import Button from '@/packages/ui/src/Buttons/Button.vue';
import LoadingSpinner from '@/packages/ui/src/LoadingSpinner.vue';
import type { OutlookCalendarLabels, OutlookMeeting } from '@/m365/types';
import { fillLabel } from './labels';
import { formatRange, shortDate } from './syncFlagReason';

// D-03 (06-UI-SPEC section 4): a meeting that Outlook moved after it had started, while its link
// still points to the entry logged at the old slot. Variant `block` is the panel part (eyebrow,
// body naming the logged range, and the neutral outline "Move my entry here"); variant `note` is
// the single hover-card line. It owns no network code: the button emits `move` and the caller acts.
// Renders nothing for a meeting without `moved_from`; the caller decides on canAct (D-14). Text is
// only ever rendered through interpolation.
const props = withDefaults(
    defineProps<{
        meeting: OutlookMeeting;
        labels: OutlookCalendarLabels;
        variant: 'block' | 'note';
        // The move runs: the button shows its spinner and is disabled.
        pending?: boolean;
        // Another action of the panel runs (e.g. a confirm): the button is disabled.
        disabled?: boolean;
    }>(),
    { pending: false, disabled: false }
);

const emit = defineEmits<{ move: [] }>();

const organization = inject<ComputedRef<Organization | undefined> | undefined>(
    'organization',
    undefined
);
const timeFormat = computed(() => organization?.value?.time_format ?? '24-hours');

const movedFrom = computed(() => props.meeting.moved_from ?? null);

const bodyId = `outlook-moved-body-${useId()}`;

// "You logged it on Tue, Nov 24 · 10:00 – 11:00. …": the entry's current range, full form.
const body = computed(() => {
    const from = movedFrom.value;
    if (!from) return '';
    const when = formatRange(from.entry_start, from.entry_end, {
        full: true,
        timeFormat: timeFormat.value,
    });
    return fillLabel(props.labels.moved_body, { when });
});

const note = computed(() => {
    const from = movedFrom.value;
    return from
        ? fillLabel(props.labels.moved_hover_note, { date: shortDate(from.entry_start) })
        : '';
});

function onMove(): void {
    if (props.pending || props.disabled) return;
    emit('move');
}
</script>

<template>
    <template v-if="movedFrom">
        <div v-if="variant === 'block'" class="mt-4 space-y-2" data-testid="outlook-moved-block">
            <p
                class="flex items-center gap-1 text-xs text-text-tertiary"
                data-testid="outlook-moved-eyebrow">
                <CalendarClock class="size-3 shrink-0" aria-hidden="true" />
                <span>{{ labels.moved_eyebrow }}</span>
            </p>
            <p
                :id="bodyId"
                class="text-xs text-text-secondary tabular-nums"
                data-testid="outlook-moved-body">
                {{ body }}
            </p>
            <Button
                type="button"
                variant="outline"
                size="sm"
                :disabled="pending || disabled"
                :aria-busy="pending ? 'true' : undefined"
                :aria-describedby="bodyId"
                data-testid="outlook-detail-move-entry"
                @click="onMove">
                <LoadingSpinner
                    v-if="pending"
                    class="m-0"
                    data-testid="outlook-detail-move-spinner" />
                <MoveRight v-else aria-hidden="true" />
                <span>{{ labels.move_entry_here }}</span>
            </Button>
        </div>
        <p
            v-else
            class="mt-2 flex items-center gap-1 text-xs text-text-tertiary tabular-nums"
            data-testid="outlook-hover-moved-note">
            <CalendarClock class="size-3 shrink-0" aria-hidden="true" />
            <span>{{ note }}</span>
        </p>
    </template>
</template>
