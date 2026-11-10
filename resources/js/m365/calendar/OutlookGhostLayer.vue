<script setup lang="ts">
import { computed, inject, nextTick, ref, type ComputedRef } from 'vue';
import { CalendarDays, EyeOff, Video } from '@lucide/vue';
import type { Organization } from '@/packages/api/src';
import { formatTime, getLocalizedDayJsFromMinutes } from '@/packages/ui/src/utils/time';
import type { OutlookCalendarLabels, OutlookMeeting } from '@/m365/types';
import { fillLabel } from './labels';
import OutlookGhostDetail from './OutlookGhostDetail.vue';
import { OUTLOOK_MEETINGS_KEY } from './useOutlookMeetings';
import {
    ghostLaneWidth,
    layoutGhostsForDay,
    type GhostBox,
    type GhostVisibleSettings,
} from './ghostLayout';

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

// The injected context carries the actions; without it (tests, test-hook mode) the panel is read-only.
const context = inject(OUTLOOK_MEETINGS_KEY, null);
const canAct = computed(() => context?.canAct.value === true);

// One detail panel open at a time (the id of the meeting whose panel is open).
const openId = ref<string | null>(null);

function setOpen(id: string, value: boolean): void {
    if (value) openId.value = id;
    else if (openId.value === id) openId.value = null;
}

const layerEl = ref<HTMLElement | null>(null);

function ghostElement(id: string): HTMLElement | null {
    return layerEl.value?.querySelector<HTMLElement>(`[data-ghost-id="${CSS.escape(id)}"]`) ?? null;
}

// A restore, or a dismiss while dismissed meetings are shown, keeps the ghost rendered (as the
// other variant): focus stays on that same ghost.
async function keepFocusOn(id: string): Promise<void> {
    await nextTick();
    ghostElement(id)?.focus();
}

async function onRestore(meeting: OutlookMeeting): Promise<void> {
    openId.value = null;
    void context?.restore(meeting.id);
    await keepFocusOn(meeting.id);
}

// After a dismiss that removes the focused ghost, focus moves to the next ghost of this day (the
// previous one for the last), or to the Sync button when the day has no ghost left.
async function onDismiss(meeting: OutlookMeeting): Promise<void> {
    const stays = context?.includeDismissed.value === true;
    const list = boxes.value;
    const index = list.findIndex((box) => box.meeting.id === meeting.id);
    const neighbour = list[index + 1] ?? list[index - 1] ?? null;
    openId.value = null;
    void context?.dismiss(meeting.id);

    if (stays) {
        await keepFocusOn(meeting.id);
        return;
    }

    await nextTick();
    const next = neighbour ? ghostElement(neighbour.meeting.id) : null;
    (next ?? document.querySelector<HTMLElement>('[data-testid="outlook-sync-button"]'))?.focus();
}

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

// UI-SPEC "Content by available height": under 24px subject only; 24px to 39px adds the time
// inline in day view; 40px and over adds a time line (and the organizer in day view).
const TIME_INLINE_MIN_HEIGHT = 24;
const TIME_LINE_MIN_HEIGHT = 40;

function timeRangeOf(meeting: OutlookMeeting): string {
    return `${formatTime(meeting.start, timeFormat.value)} – ${formatTime(meeting.end, timeFormat.value)}`;
}

function showsInlineTime(box: GhostBox): boolean {
    return (
        props.isDayView && box.height >= TIME_INLINE_MIN_HEIGHT && box.height < TIME_LINE_MIN_HEIGHT
    );
}

function showsTimeLine(box: GhostBox): boolean {
    return box.height >= TIME_LINE_MIN_HEIGHT;
}

function showsOrganizer(box: GhostBox): boolean {
    return props.isDayView && box.height >= TIME_LINE_MIN_HEIGHT && !!box.meeting.organizer_name;
}

function subjectOf(meeting: OutlookMeeting): string {
    return meeting.subject?.trim() ? meeting.subject : props.labels.no_subject;
}

function ariaLabelOf(meeting: OutlookMeeting): string {
    const label = fillLabel(props.labels.ghost_label, {
        subject: subjectOf(meeting),
        start: formatTime(meeting.start, timeFormat.value),
        end: formatTime(meeting.end, timeFormat.value),
    });
    return meeting.dismissed ? label + props.labels.dismissed_suffix : label;
}
</script>

<template>
    <div
        v-if="boxes.length > 0"
        ref="layerEl"
        role="group"
        :aria-label="layerLabel"
        class="absolute inset-y-0 right-0.5 pointer-events-none"
        :style="{ width: laneWidth }">
        <OutlookGhostDetail
            v-for="box in boxes"
            :key="box.meeting.id"
            :meeting="box.meeting"
            :labels="labels"
            :can-act="canAct"
            :open="openId === box.meeting.id"
            @update:open="(value: boolean) => setOpen(box.meeting.id, value)"
            @dismiss="onDismiss(box.meeting)"
            @restore="onRestore(box.meeting)">
            <div
                class="m365-ghost absolute pointer-events-auto select-none cursor-pointer rounded-sm border border-text-tertiary overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 data-[state=open]:ring-2 data-[state=open]:ring-accent-500"
                :class="{
                    'border-dashed': !box.meeting.dismissed,
                    'border-dotted m365-ghost--dismissed': box.meeting.dismissed,
                    'rounded-t-none': box.isClippedStart,
                    'rounded-b-none': box.isClippedEnd,
                }"
                data-calendar-overlay
                :data-ghost-id="box.meeting.id"
                role="button"
                tabindex="0"
                :aria-label="ariaLabelOf(box.meeting)"
                :style="{
                    top: box.top + 'px',
                    height: box.height + 'px',
                    left: (box.lane * 100) / box.lanes + '%',
                    width: 100 / box.lanes + '%',
                }"
                @keydown.enter.prevent="($event.currentTarget as HTMLElement).click()"
                @keydown.space.prevent="($event.currentTarget as HTMLElement).click()">
                <div class="flex h-full items-start gap-1 px-1 py-px text-2xs leading-tight">
                    <EyeOff
                        v-if="box.meeting.dismissed"
                        class="mt-px h-3 w-3 shrink-0 text-text-tertiary"
                        aria-hidden="true" />
                    <CalendarDays
                        v-else
                        class="mt-px h-3 w-3 shrink-0 text-text-tertiary"
                        aria-hidden="true" />
                    <div class="min-w-0 flex-1">
                        <div class="flex items-baseline gap-1">
                            <span class="truncate font-semibold text-text-secondary">
                                {{ subjectOf(box.meeting) }}
                            </span>
                            <span
                                v-if="showsInlineTime(box)"
                                class="truncate text-text-tertiary"
                                data-ghost-time-inline>
                                {{ timeRangeOf(box.meeting) }}
                            </span>
                        </div>
                        <div v-if="showsTimeLine(box)" class="truncate text-text-tertiary">
                            {{ timeRangeOf(box.meeting) }}
                        </div>
                        <div v-if="showsOrganizer(box)" class="truncate text-text-tertiary">
                            {{ box.meeting.organizer_name }}
                        </div>
                    </div>
                    <Video
                        v-if="box.meeting.is_online_meeting"
                        class="mt-px h-3 w-3 shrink-0 text-text-tertiary"
                        aria-hidden="true" />
                </div>
            </div>
        </OutlookGhostDetail>
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
/* Dismissed variant (only rendered while "Show dismissed meetings" is on): 25% fill */
.m365-ghost--dismissed {
    background-color: color-mix(in srgb, var(--color-bg-tertiary) 25%, transparent);
}
.m365-ghost--dismissed:hover {
    background-color: color-mix(in srgb, var(--color-bg-tertiary) 50%, transparent);
}
</style>
