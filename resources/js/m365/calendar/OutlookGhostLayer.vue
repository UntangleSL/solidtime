<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue';
import { CalendarDays, EyeOff, User, Video } from '@lucide/vue';
import { HoverCardRoot, HoverCardTrigger } from 'reka-ui';
import type { Organization } from '@/packages/api/src';
import { formatTime, getLocalizedDayJsFromMinutes } from '@/packages/ui/src/utils/time';
import type { OutlookCalendarLabels, OutlookMeeting } from '@/m365/types';
import { fillLabel } from './labels';
import OutlookGhostDetail from './OutlookGhostDetail.vue';
import OutlookMeetingHoverCard from './OutlookMeetingHoverCard.vue';
import {
    HOVER_CLOSE_DELAY_MS,
    hoverOpenDelay,
    noteHoverCardClosed,
    noteHoverCardOpened,
} from './hoverCardDelay';
import { OUTLOOK_MEETINGS_KEY } from './useOutlookMeetings';
import { useEventListener, useResizeObserver } from '@vueuse/core';
import {
    GHOST_MAX_COLUMNS_DAY,
    GHOST_MAX_COLUMNS_WEEK,
    ghostBlockWidthPx,
    ghostColumnStyle,
    ghostLaneWidth,
    layoutGhostsForDay,
    maxGhostColumns,
    type GhostBox,
    type GhostVisibleSettings,
} from './ghostLayout';

// Meeting blocks for one day column, rendered through the core `overlay` slot of CalendarDayColumn
// inside the reserved Outlook lane (Phase 3.1 D-04: right part of every day that has a meeting).
// Blocks are inert for every time-entry interaction: they carry no event-block class, no event id
// and no resizers, and the core slot selection ignores [data-calendar-overlay]. Meeting text is only
// ever rendered through text interpolation.
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
    // From the core day-overlay slot (03.1-04): the calendar context menu is open, or a drag, resize
    // or slot selection is in progress. Undefined (older core) means neither.
    contextMenuOpen?: boolean;
    interacting?: boolean;
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
// The open panel shows the conversion form instead of the details (Phase 4). Only meaningful while
// it equals openId; closing the panel resets it.
const formId = ref<string | null>(null);

watch(openId, (id) => {
    if (id === null || formId.value !== id) formId.value = null;
});

function setOpen(id: string, value: boolean): void {
    if (value) {
        // No panel may open while the context menu is open (D-06 layering rule)
        if (props.contextMenuOpen) return;
        // The panel replaces the hover card of the same meeting
        closeHover();
        openId.value = id;
    } else if (openId.value === id) openId.value = null;
}

function modeOf(id: string): 'detail' | 'form' {
    return openId.value === id && formId.value === id ? 'form' : 'detail';
}

function onCreate(meeting: OutlookMeeting): void {
    if (!canAct.value || openId.value !== meeting.id) return;
    formId.value = meeting.id;
}

// Hover card (UX-03, D-05): at most one per layer (the id of the meeting whose card is shown). Each
// block's HoverCardRoot is controlled: reka requests open/close after its delays and the layer
// decides. An open request is accepted only while a non-touch pointer rests on that block, so the
// focus-triggered open of HoverCardTrigger (keyboard focus, or the focus that follows a click) never
// shows a card (03.1-RESEARCH Pitfall 6).
const hoverId = ref<string | null>(null);
const hoverAnchor = ref<HTMLElement | null>(null);
let pointerOverId: string | null = null;
const openDelay = computed(() => hoverOpenDelay.value);

function onBlockPointerEnter(id: string, event: PointerEvent): void {
    if (event.pointerType !== 'touch') pointerOverId = id;
}

function onBlockPointerLeave(id: string): void {
    if (pointerOverId === id) pointerOverId = null;
}

function closeHover(): void {
    if (hoverId.value === null) return;
    hoverId.value = null;
    hoverAnchor.value = null;
    noteHoverCardClosed();
}

function onHoverOpenChange(id: string, value: boolean): void {
    if (!value) {
        if (hoverId.value === id) closeHover();
        return;
    }
    // Already shown (e.g. the pointer moved from the block into the card itself)
    if (hoverId.value === id) return;
    if (pointerOverId !== id || openId.value === id) return;
    if (props.contextMenuOpen || props.interacting) return;
    hoverAnchor.value = ghostElement(id);
    hoverId.value = id;
    noteHoverCardOpened();
}

// UI-SPEC 3.1 section 2 "Suppress while": this meeting's panel, the context menu, a drag, resize or
// slot selection.
function hoverCardOpen(id: string): boolean {
    return (
        hoverId.value === id && openId.value !== id && !props.contextMenuOpen && !props.interacting
    );
}

// Layering rule (D-06, UX-04): the context menu never opens under a card or panel. A right click
// on this layer closes both in the capture phase, before the core menu mounts (reka opens it after
// a nextTick). The watcher is the safety net for right clicks elsewhere (entries, empty slots, other
// days) and for a right click on the block that owns the open panel.
function closeAllForContextMenu(): void {
    openId.value = null;
    closeHover();
}

watch(
    () => props.contextMenuOpen,
    (open) => {
        if (open) closeAllForContextMenu();
    }
);

watch(
    () => props.interacting,
    (active) => {
        if (active) closeHover();
    }
);

// A zoom step changes the pixel height of an hour: the block moves under the card
watch(
    () => props.minutesToPixels(60),
    () => closeHover()
);

// A wheel inside the calendar (scroll or zoom gesture) closes the card; reka already dismisses it on
// Escape, a pointerdown elsewhere and a scroll of an ancestor of the block. Day and week changes
// unmount the layer.
useEventListener(
    document,
    'wheel',
    (event: WheelEvent) => {
        if (hoverId.value === null) return;
        const target = event.target;
        if (target instanceof Element && target.closest('.fc')) closeHover();
    },
    { capture: true, passive: true }
);

onBeforeUnmount(closeHover);

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

// The ghost after `id` in this day (the previous one for the last), read before it leaves.
function neighbourOf(id: string): string | null {
    const list = boxes.value;
    const index = list.findIndex((box) => box.meeting.id === id);
    return (list[index + 1] ?? list[index - 1] ?? null)?.meeting.id ?? null;
}

// Focus after a ghost left the lane: its neighbour, or the Sync button when the day has none.
async function focusAfterRemoval(neighbour: string | null): Promise<void> {
    await nextTick();
    const next = neighbour ? ghostElement(neighbour) : null;
    (next ?? document.querySelector<HTMLElement>('[data-testid="outlook-sync-button"]'))?.focus();
}

// After a dismiss that removes the focused ghost, focus moves to the next ghost of this day (the
// previous one for the last), or to the Sync button when the day has no ghost left.
async function onDismiss(meeting: OutlookMeeting): Promise<void> {
    const stays = context?.includeDismissed.value === true;
    const neighbour = neighbourOf(meeting.id);
    openId.value = null;
    void context?.dismiss(meeting.id);

    if (stays) {
        await keepFocusOn(meeting.id);
        return;
    }

    await focusAfterRemoval(neighbour);
}

// The form created (or found) the entry: the panel closes and focus follows the Dismiss rule.
async function onConverted(meeting: OutlookMeeting): Promise<void> {
    if (openId.value !== meeting.id) return;
    const neighbour = neighbourOf(meeting.id);
    openId.value = null;
    await focusAfterRemoval(neighbour);
}

async function onCancelForm(meeting: OutlookMeeting): Promise<void> {
    openId.value = null;
    await keepFocusOn(meeting.id);
}

// Measured lane width (border box for the column count, content box for block widths). Until the
// first measurement the column cap applies (3 week, 4 day) and width-dependent text stays compact.
const laneWidthPx = ref<number | null>(null);
const laneInnerWidthPx = ref<number | null>(null);

useResizeObserver(layerEl, (entries) => {
    const entry = entries[0];
    if (!entry) return;
    laneInnerWidthPx.value = entry.contentRect.width;
    laneWidthPx.value = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
});

const maxColumns = computed(() =>
    laneWidthPx.value === null
        ? props.isDayView
            ? GHOST_MAX_COLUMNS_DAY
            : GHOST_MAX_COLUMNS_WEEK
        : maxGhostColumns(laneWidthPx.value, props.isDayView)
);

const boxes = computed(() =>
    layoutGhostsForDay(
        props.meetings,
        props.dayStr,
        props.settings,
        props.minutesToPixels,
        maxColumns.value
    )
);

function blockStyle(box: GhostBox): Record<string, string> {
    return {
        top: box.top + 'px',
        // 1px gap under every block keeps adjacent meetings visibly separate
        height: box.height - 1 + 'px',
        ...ghostColumnStyle(box.lane, box.lanes, box.cascade),
    };
}

function blockWidthOf(box: GhostBox): number | null {
    const inner = laneInnerWidthPx.value;
    return inner === null ? null : ghostBlockWidthPx(inner, box.lanes, box.cascade);
}

// UI-SPEC 3.1: the T2 one-line block appends 'start – end' only from 150px of block width, and the
// time line falls back to the start time alone under 96px so a narrow column never wraps.
const INLINE_TIME_MIN_WIDTH = 150;
const FULL_RANGE_MIN_WIDTH = 96;

function showsInlineTime(box: GhostBox): boolean {
    const width = blockWidthOf(box);
    return tierOf(box) === 2 && width !== null && width >= INLINE_TIME_MIN_WIDTH;
}

function timeLineOf(box: GhostBox): string {
    const width = blockWidthOf(box);
    return width !== null && width < FULL_RANGE_MIN_WIDTH
        ? formatTime(box.meeting.start, timeFormat.value)
        : timeRangeOf(box.meeting);
}

// The context removes a converted meeting from the cache as soon as the server answered, which can
// unmount its panel (and the form) before the form reports `done`. So a meeting that leaves the
// lane while its form is open closes the panel here, and focus moves to the ghost that followed it
// (the previous one for the last), or to the Sync button.
watch(boxes, (list, previous) => {
    const id = formId.value;
    if (id === null || openId.value !== id) return;
    if (list.some((box) => box.meeting.id === id)) return;

    const before = previous ?? [];
    const index = before.findIndex((box) => box.meeting.id === id);
    const stays = (box: GhostBox | undefined) =>
        box !== undefined && list.some((item) => item.meeting.id === box.meeting.id);
    const after = before.slice(index + 1).find(stays);
    const neighbour = after ?? before.slice(0, Math.max(index, 0)).reverse().find(stays);
    openId.value = null;
    void focusAfterRemoval(neighbour?.meeting.id ?? null);
});

const laneWidth = computed(() => props.overlayLaneWidth ?? ghostLaneWidth(props.isDayView));

const layerLabel = computed(() => {
    const day = getLocalizedDayJsFromMinutes(props.dayStr, 0);
    const weekday = day.format('dddd');
    const date = day.format('D MMM');
    return fillLabel(props.labels.layer_label, { weekday, date, day: `${weekday} ${date}` });
});

// UI-SPEC 3.1 "Meeting block content": the content tier depends only on the drawn block height.
// T1 under 18px: subject only. T2 18-31px: subject on one line. T3 32-45px: subject + time line.
// T4 from 46px: subject on up to two lines + time line. T5 from 60px, day view only: T4 + organizer.
type ContentTier = 1 | 2 | 3 | 4 | 5;

const TIER_2_MIN_HEIGHT = 18;
const TIER_3_MIN_HEIGHT = 32;
const TIER_4_MIN_HEIGHT = 46;
const TIER_5_MIN_HEIGHT = 60;

function tierOf(box: GhostBox): ContentTier {
    if (box.height < TIER_2_MIN_HEIGHT) return 1;
    if (box.height < TIER_3_MIN_HEIGHT) return 2;
    if (box.height < TIER_4_MIN_HEIGHT) return 3;
    if (props.isDayView && box.height >= TIER_5_MIN_HEIGHT) return 5;
    return 4;
}

function timeRangeOf(meeting: OutlookMeeting): string {
    return `${formatTime(meeting.start, timeFormat.value)} – ${formatTime(meeting.end, timeFormat.value)}`;
}

function organizerOf(meeting: OutlookMeeting): string | null {
    if (meeting.is_organizer) return props.labels.you_organize;
    return meeting.organizer_name?.trim() || null;
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
        data-testid="outlook-lane"
        class="m365-lane absolute inset-y-0 right-0.5 pointer-events-none"
        :style="{ width: laneWidth }"
        @contextmenu.capture="closeAllForContextMenu">
        <HoverCardRoot
            v-for="box in boxes"
            :key="box.meeting.id"
            :open="hoverCardOpen(box.meeting.id)"
            :open-delay="openDelay"
            :close-delay="HOVER_CLOSE_DELAY_MS"
            @update:open="(value: boolean) => onHoverOpenChange(box.meeting.id, value)">
            <OutlookGhostDetail
                :meeting="box.meeting"
                :labels="labels"
                :can-act="canAct"
                :open="openId === box.meeting.id"
                :mode="modeOf(box.meeting.id)"
                @update:open="(value: boolean) => setOpen(box.meeting.id, value)"
                @dismiss="onDismiss(box.meeting)"
                @restore="onRestore(box.meeting)"
                @create="onCreate(box.meeting)"
                @converted="onConverted(box.meeting)"
                @cancel-form="onCancelForm(box.meeting)">
                <HoverCardTrigger as-child>
                    <div
                        class="m365-ghost m365-meeting absolute pointer-events-auto select-none cursor-pointer rounded-sm overflow-hidden hover:z-[1] focus:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 data-[panel-open]:ring-2 data-[panel-open]:ring-accent-700 dark:data-[panel-open]:ring-accent-200"
                        :class="{
                            'm365-meeting--dismissed': box.meeting.dismissed,
                            'm365-meeting--cascaded': box.cascade > 0,
                            'rounded-t-none': box.isClippedStart,
                            'rounded-b-none': box.isClippedEnd,
                        }"
                        data-calendar-overlay
                        :data-ghost-id="box.meeting.id"
                        :data-panel-open="openId === box.meeting.id ? '' : undefined"
                        role="button"
                        tabindex="0"
                        :aria-label="ariaLabelOf(box.meeting)"
                        :style="blockStyle(box)"
                        @keydown.enter.prevent="($event.currentTarget as HTMLElement).click()"
                        @keydown.space.prevent="($event.currentTarget as HTMLElement).click()"
                        @pointerenter="onBlockPointerEnter(box.meeting.id, $event)"
                        @pointerleave="onBlockPointerLeave(box.meeting.id)">
                        <div
                            class="flex h-full min-w-0 flex-col overflow-hidden px-1.5 text-xs leading-[14px]"
                            :class="tierOf(box) === 1 ? 'py-0' : 'py-0.5'"
                            :data-ghost-tier="tierOf(box)">
                            <div v-if="tierOf(box) <= 2" class="flex min-w-0 items-center gap-1">
                                <span
                                    class="m365-meeting__subject min-w-0 truncate"
                                    :class="{ 'font-semibold': !box.meeting.dismissed }"
                                    data-ghost-subject>
                                    {{ subjectOf(box.meeting) }}
                                </span>
                                <span
                                    v-if="showsInlineTime(box)"
                                    class="m365-meeting__meta shrink-0 whitespace-nowrap"
                                    data-ghost-time-inline>
                                    {{ timeRangeOf(box.meeting) }}
                                </span>
                                <Video
                                    v-if="box.meeting.is_online_meeting"
                                    class="m365-meeting__meta ml-auto size-3 shrink-0"
                                    aria-hidden="true" />
                            </div>
                            <template v-else>
                                <span
                                    class="m365-meeting__subject min-w-0 break-words"
                                    :class="{
                                        'font-semibold': !box.meeting.dismissed,
                                        truncate: tierOf(box) === 3,
                                        'line-clamp-2': tierOf(box) >= 4,
                                    }"
                                    data-ghost-subject>
                                    {{ subjectOf(box.meeting) }}
                                </span>
                                <div
                                    class="m365-meeting__meta flex min-w-0 items-center gap-1"
                                    data-ghost-time>
                                    <EyeOff
                                        v-if="box.meeting.dismissed"
                                        class="size-3 shrink-0"
                                        aria-hidden="true" />
                                    <CalendarDays
                                        v-else
                                        class="size-3 shrink-0"
                                        aria-hidden="true" />
                                    <span class="min-w-0 truncate">{{ timeLineOf(box) }}</span>
                                    <Video
                                        v-if="box.meeting.is_online_meeting"
                                        class="ml-auto size-3 shrink-0"
                                        aria-hidden="true" />
                                </div>
                                <div
                                    v-if="tierOf(box) === 5 && organizerOf(box.meeting)"
                                    class="m365-meeting__meta flex min-w-0 items-center gap-1"
                                    data-ghost-organizer>
                                    <User class="size-3 shrink-0" aria-hidden="true" />
                                    <span class="min-w-0 truncate">{{
                                        organizerOf(box.meeting)
                                    }}</span>
                                </div>
                            </template>
                        </div>
                    </div>
                </HoverCardTrigger>
            </OutlookGhostDetail>
            <OutlookMeetingHoverCard
                :meeting="box.meeting"
                :labels="labels"
                :reference="hoverId === box.meeting.id ? hoverAnchor : null" />
        </HoverCardRoot>
    </div>
</template>

<style scoped>
/*
 * Outlook identity (UI-SPEC 3.1 "Color", D-02). The --m365-* properties are declared by the theme
 * layer (Phase 3.2, resources/css/untangle-theme.css on :root) and only consumed here, with the
 * UI-SPEC formula of the active mode as fallback (the local --fb-* properties; light first, then
 * the accent-400 dark set). Fills are opaque mixes over the opaque --color-bg-primary (solid
 * block); only the lane wash is translucent so the grid lines stay visible.
 */
.m365-lane {
    --fb-wash: color-mix(in srgb, rgb(var(--color-accent-500)) 6%, transparent);
    background-color: var(--m365-lane-bg, var(--fb-wash));
    border-left: 1px solid var(--color-border-tertiary);
}

.m365-meeting {
    --fb-fill: color-mix(in srgb, rgb(var(--color-accent-500)) 16%, var(--color-bg-primary));
    --fb-hover: color-mix(in srgb, rgb(var(--color-accent-500)) 24%, var(--color-bg-primary));
    --fb-dismissed: color-mix(in srgb, rgb(var(--color-accent-500)) 6%, var(--color-bg-primary));
    --fb-border: color-mix(in srgb, rgb(var(--color-accent-600)) 35%, var(--color-bg-primary));
    --fb-bar: rgb(var(--color-accent-600));
    background-color: var(--m365-meeting-bg, var(--fb-fill));
    border: 1px solid var(--m365-meeting-border, var(--fb-border));
    border-left: 3px solid var(--m365-meeting-bar, var(--fb-bar));
}
.m365-meeting:hover {
    background-color: var(--m365-meeting-bg-hover, var(--fb-hover));
}
/*
 * A cascaded extra (more overlaps than columns) gets a 1px --color-bg-primary edge on its left so
 * the bar of every block stays visible. Through --tw-shadow so the focus and panel rings compose.
 */
.m365-meeting--cascaded {
    --tw-shadow: -1px 0 0 var(--color-bg-primary);
    box-shadow:
        var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);
}
.m365-meeting__subject {
    color: var(--m365-meeting-text, var(--color-text-primary));
}
.m365-meeting__meta {
    color: var(--m365-meeting-text-2, var(--color-text-secondary));
}

/* Dismissed variant (only rendered while "Show dismissed meetings" is on): no bar, dotted border */
.m365-meeting--dismissed,
.m365-meeting--dismissed:hover {
    background-color: var(--m365-meeting-bg-dismissed, var(--fb-dismissed));
    border: 1px dotted var(--color-text-tertiary);
}
.m365-meeting--dismissed .m365-meeting__subject {
    color: var(--m365-meeting-text-2, var(--color-text-secondary));
}

/* Dark fallbacks. Vue scopes only the last compound selector, so :root.dark stays global. */
:root.dark .m365-lane {
    --fb-wash: color-mix(in srgb, rgb(var(--color-accent-400)) 8%, transparent);
}
:root.dark .m365-meeting {
    --fb-fill: color-mix(in srgb, rgb(var(--color-accent-400)) 22%, var(--color-bg-primary));
    --fb-hover: color-mix(in srgb, rgb(var(--color-accent-400)) 30%, var(--color-bg-primary));
    --fb-dismissed: color-mix(in srgb, rgb(var(--color-accent-400)) 6%, var(--color-bg-primary));
    --fb-border: color-mix(in srgb, rgb(var(--color-accent-400)) 40%, var(--color-bg-primary));
    --fb-bar: rgb(var(--color-accent-400));
}
</style>
