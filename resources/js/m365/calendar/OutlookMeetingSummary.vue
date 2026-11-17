<script setup lang="ts">
import { computed, inject, onMounted, ref, type ComputedRef } from 'vue';
import { CalendarDays, Clock, User, Video } from '@lucide/vue';
import type { Organization } from '@/packages/api/src';
import {
    formatHumanReadableDuration,
    formatTime,
    getLocalizedDayJs,
} from '@/packages/ui/src/utils/time';
import type { OutlookCalendarLabels, OutlookMeeting } from '@/m365/types';
import { fillLabel } from './labels';

// Shared rows of one Outlook meeting (eyebrow, subject, time, organizer, online, `meta` slot),
// rendered by both the detail panel (prefix outlook-detail) and the hover card (prefix
// outlook-hover), so Phase 4 extends one place. Meeting values are only ever rendered through text
// interpolation.
const props = defineProps<{
    meeting: OutlookMeeting;
    labels: OutlookCalendarLabels;
    testidPrefix: 'outlook-detail' | 'outlook-hover';
    subjectId?: string;
}>();

const emit = defineEmits<{
    /** The subject heading is in the DOM (the panel labels its dialog by it). */
    'subject-mounted': [element: HTMLElement];
}>();

const organization = inject<ComputedRef<Organization | undefined> | undefined>(
    'organization',
    undefined
);
const timeFormat = computed(() => organization?.value?.time_format ?? '24-hours');

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

const organizerText = computed(() => {
    if (props.meeting.is_organizer) return props.labels.you_organize;
    const name = props.meeting.organizer_name?.trim();
    return name ? fillLabel(props.labels.organized_by, { name }) : null;
});

const subjectEl = ref<HTMLElement | null>(null);

onMounted(() => {
    if (subjectEl.value) emit('subject-mounted', subjectEl.value);
});

defineExpose({ subjectEl });
</script>

<template>
    <div class="flex items-center gap-1.5 text-xs text-text-tertiary">
        <CalendarDays class="size-3.5 shrink-0" aria-hidden="true" />
        <span>{{ meeting.dismissed ? labels.eyebrow_dismissed : labels.eyebrow }}</span>
    </div>
    <h3
        :id="subjectId"
        ref="subjectEl"
        class="mt-1 text-sm font-semibold text-text-primary line-clamp-3 break-words"
        :data-testid="`${testidPrefix}-subject`">
        {{ subject }}
    </h3>
    <div class="mt-2 flex items-start gap-1.5 text-xs text-text-secondary">
        <Clock class="mt-px size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
        <span :data-testid="`${testidPrefix}-time`">{{ timeRow }}</span>
    </div>
    <div v-if="organizerText" class="mt-1.5 flex items-start gap-1.5 text-xs text-text-secondary">
        <User class="mt-px size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
        <span :data-testid="`${testidPrefix}-organizer`">{{ organizerText }}</span>
    </div>
    <div
        v-if="meeting.is_online_meeting"
        class="mt-1.5 flex items-start gap-1.5 text-xs text-text-secondary">
        <Video class="mt-px size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
        <span :data-testid="`${testidPrefix}-online`">{{ labels.online }}</span>
    </div>
    <slot name="meta" />
</template>
