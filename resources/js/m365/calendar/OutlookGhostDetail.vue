<script setup lang="ts">
import { computed, inject, useId, type ComputedRef } from 'vue';
import { CalendarDays, Clock } from '@lucide/vue';
import type { Organization } from '@/packages/api/src';
import Button from '@/packages/ui/src/Buttons/Button.vue';
import { Popover, PopoverContent, PopoverTrigger } from '@/packages/ui/src/popover';
import { Separator } from '@/packages/ui/src/separator';
import {
    formatHumanReadableDuration,
    formatTime,
    getLocalizedDayJs,
} from '@/packages/ui/src/utils/time';
import type { OutlookCalendarLabels, OutlookMeeting } from '@/m365/types';

// Detail panel of one ghost (non-modal popover). The default slot is the trigger (the ghost). It
// owns no network code: Dismiss and Restore are emitted and the caller acts. Meeting values are only
// ever rendered through text interpolation.
const props = defineProps<{
    meeting: OutlookMeeting;
    labels: OutlookCalendarLabels;
    canAct: boolean;
}>();

const emit = defineEmits<{
    dismiss: [];
    restore: [];
}>();

const open = defineModel<boolean>('open', { default: false });

const organization = inject<ComputedRef<Organization | undefined> | undefined>(
    'organization',
    undefined
);
const timeFormat = computed(() => organization?.value?.time_format ?? '24-hours');

const subjectId = `outlook-detail-${useId()}`;

const subject = computed(() =>
    props.meeting.subject?.trim() ? props.meeting.subject : props.labels.no_subject
);

// "Tue, Oct 27 · 10:00 – 11:00 · 1h 00min"; both dates when the meeting crosses local midnight.
const timeRow = computed(() => {
    const start = getLocalizedDayJs(props.meeting.start);
    const end = getLocalizedDayJs(props.meeting.end);
    const dateFormat = 'ddd, MMM D';
    const startTime = formatTime(props.meeting.start, timeFormat.value);
    const endTime = formatTime(props.meeting.end, timeFormat.value);
    const seconds = Math.max(0, end.diff(start, 'second'));
    const duration = formatHumanReadableDuration(
        seconds,
        organization?.value?.interval_format,
        organization?.value?.number_format
    );
    const range = start.isSame(end, 'day')
        ? `${start.format(dateFormat)} · ${startTime} – ${endTime}`
        : `${start.format(dateFormat)} ${startTime} – ${end.format(dateFormat)} ${endTime}`;
    return `${range} · ${duration}`;
});

// Reka labels the dialog with its trigger (the ghost) and overrides any aria-labelledby passed to the
// content, so the subject heading takes over the labelling once it is mounted.
function labelDialogBySubject(el: unknown): void {
    if (el instanceof HTMLElement) {
        el.closest('[role="dialog"]')?.setAttribute('aria-labelledby', el.id);
    }
}

function onAction() {
    if (props.meeting.dismissed) emit('restore');
    else emit('dismiss');
}
</script>

<template>
    <Popover v-model:open="open">
        <PopoverTrigger as-child>
            <slot />
        </PopoverTrigger>
        <PopoverContent
            class="w-80 p-4"
            side="right"
            align="start"
            :side-offset="8"
            data-testid="outlook-ghost-detail">
            <div class="flex items-center gap-1.5 text-xs text-text-tertiary">
                <CalendarDays class="size-3.5 shrink-0" aria-hidden="true" />
                <span>{{ meeting.dismissed ? labels.eyebrow_dismissed : labels.eyebrow }}</span>
            </div>
            <h3
                :id="subjectId"
                :ref="labelDialogBySubject"
                class="mt-1 text-sm font-semibold text-text-primary line-clamp-3 break-words">
                {{ subject }}
            </h3>
            <div class="mt-2 flex items-start gap-1.5 text-xs text-text-secondary">
                <Clock class="mt-px size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
                <span data-testid="outlook-detail-time">{{ timeRow }}</span>
            </div>
            <Separator class="my-3" />
            <div class="flex justify-end gap-2">
                <Button
                    v-if="canAct"
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="outlook-detail-action"
                    @click="onAction">
                    {{ meeting.dismissed ? labels.restore : labels.dismiss }}
                </Button>
            </div>
        </PopoverContent>
    </Popover>
</template>
