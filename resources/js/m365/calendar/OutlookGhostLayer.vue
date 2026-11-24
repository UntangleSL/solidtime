<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue';
import { CalendarDays, Check, EyeOff, User, Video } from '@lucide/vue';
import { HoverCardRoot, HoverCardTrigger } from 'reka-ui';
import type { Organization } from '@/packages/api/src';
import { formatTime, getLocalizedDayJsFromMinutes } from '@/packages/ui/src/utils/time';
import type {
    OutlookAssignment,
    OutlookCalendarLabels,
    OutlookConversionResult,
    OutlookMeeting,
} from '@/m365/types';
import { fillLabel } from './labels';
import OutlookGhostDetail from './OutlookGhostDetail.vue';
import OutlookMeetingHoverCard from './OutlookMeetingHoverCard.vue';
import OutlookProjectDot from './OutlookProjectDot.vue';
import LoadingSpinner from '@/packages/ui/src/LoadingSpinner.vue';
import { isFaded, isPreassigned } from './suggestions';
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

// Multi-select (Phase 4 D-07, UI-SPEC section 5): one selection for the whole calendar, kept by the
// context (inert while it cannot act). A panel and a selection never coexist.
const selection = computed(() => context?.selection ?? null);
const hasSelection = computed(() => (selection.value?.selectedIds.value.length ?? 0) > 0);

function isSelected(id: string): boolean {
    return selection.value?.isSelected(id) === true;
}

// One detail panel open at a time (the id of the meeting whose panel is open).
const openId = ref<string | null>(null);
// The open panel shows the conversion form instead of the details (Phase 4). Only meaningful while
// it equals openId; closing the panel resets it.
const formId = ref<string | null>(null);

// Panel Confirm (Phase 5, UI-SPEC section 3): the ids whose panel confirm runs, and the inline
// failure reason of the open panel. Any panel change clears the reason.
const confirmingIds = ref<string[]>([]);
const confirmError = ref<{ id: string; message: string } | null>(null);

watch(openId, (id) => {
    if (id === null || formId.value !== id) formId.value = null;
    if (confirmError.value?.id !== id) confirmError.value = null;
});

function setOpen(id: string, value: boolean): void {
    if (value) {
        // No panel may open while the context menu is open (D-06 layering rule)
        if (props.contextMenuOpen) return;
        // The panel replaces the hover card of the same meeting; a plain click clears the selection
        closeHover();
        selection.value?.clear();
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

// Whether Ctrl, Cmd or Shift is held, from the last pointer or key event: while a selection exists
// and a modifier is held no card opens, so cards do not flash during multi-select.
let modifierHeld = false;

function hasModifier(event: MouseEvent | KeyboardEvent): boolean {
    return event.ctrlKey || event.metaKey || event.shiftKey;
}

function noteModifiers(event: MouseEvent | KeyboardEvent): void {
    modifierHeld = hasModifier(event);
}

useEventListener(document, 'keydown', noteModifiers, { capture: true, passive: true });
useEventListener(document, 'keyup', noteModifiers, { capture: true, passive: true });
useEventListener(window, 'blur', () => {
    modifierHeld = false;
});

function onBlockPointerEnter(id: string, event: PointerEvent): void {
    noteModifiers(event);
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
    if (modifierHeld && hasSelection.value) return;
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

// The meetings rendered anywhere in the calendar (every day layer of the visible range), in context
// order: a Shift range never reaches a meeting on a hidden day.
function renderedMeetings(): OutlookMeeting[] {
    const root: ParentNode = layerEl.value?.closest('.fc') ?? document;
    const ids = new Set(
        Array.from(root.querySelectorAll<HTMLElement>('[data-ghost-id]')).map(
            (el) => el.dataset.ghostId
        )
    );
    const source = context?.meetings?.value ?? props.meetings;
    return source.filter((meeting) => ids.has(meeting.id));
}

// Ctrl/Cmd toggles the meeting (and makes it the range anchor), Shift adds the range from the
// anchor. Any open panel and card close first.
function selectFromInput(id: string, range: boolean): void {
    const current = selection.value;
    if (!canAct.value || !current) return;
    openId.value = null;
    closeHover();
    if (range) current.selectRange(id, renderedMeetings());
    else current.toggle(id);
}

// Capture phase on the lane: a modifier click on a block selects instead of opening the panel. The
// block's PopoverTrigger listener sits on the block itself (as-child), so only stopping the event
// before it reaches the block keeps the panel closed (04-RESEARCH Pitfall 6). Without canAct the
// click goes through and behaves like a plain click.
function onLaneClickCapture(event: MouseEvent): void {
    if (!canAct.value || !selection.value || !hasModifier(event)) return;
    const target = event.target;
    const block = target instanceof Element ? target.closest<HTMLElement>('[data-ghost-id]') : null;
    const id = block?.dataset.ghostId;
    if (!block || !id || !layerEl.value?.contains(block)) return;
    event.preventDefault();
    event.stopPropagation();
    selectFromInput(id, event.shiftKey);
}

// Enter on a focused block: Ctrl/Cmd+Enter toggles, Shift+Enter adds the range, plain Enter opens
// the panel like a click (a synthetic click carries no modifier keys).
function onBlockEnter(event: KeyboardEvent, id: string): void {
    if (canAct.value && selection.value && hasModifier(event)) {
        selectFromInput(id, event.shiftKey);
        return;
    }
    (event.currentTarget as HTMLElement).click();
}

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

// The ghost after `id` in this day (the previous one for the last), read before it leaves. Ghosts
// for which `leaves` is true (e.g. the other occurrences of a series being ignored) are skipped.
function neighbourOf(
    id: string,
    leaves: (meeting: OutlookMeeting) => boolean = (meeting) => meeting.id === id
): string | null {
    const list = boxes.value;
    const index = list.findIndex((box) => box.meeting.id === id);
    if (index < 0) return null;
    const stays = (box: GhostBox) => !leaves(box.meeting);
    const after = list.slice(index + 1).find(stays);
    const before = list.slice(0, index).reverse().find(stays);
    return (after ?? before)?.meeting.id ?? null;
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

// Series actions from the panel's More actions menu (Phase 5, D-10 / D-11). The context is
// optimistic and owns the feedback (toasts, announcements, revert on failure); the panel closes.
// Ignore hides every occurrence of the series (or fades them while dismissed meetings are shown):
// focus follows the Dismiss rule, skipping the other occurrences that leave with it.
async function onIgnoreSeries(meeting: OutlookMeeting): Promise<void> {
    const stays = context?.includeDismissed.value === true;
    const series = meeting.series_key ?? null;
    const neighbour = neighbourOf(
        meeting.id,
        (other) => other.id === meeting.id || (series !== null && other.series_key === series)
    );
    openId.value = null;
    void context?.ignoreSeries(meeting.id);

    if (stays) {
        await keepFocusOn(meeting.id);
        return;
    }

    await focusAfterRemoval(neighbour);
}

// Stop ignoring and Forget keep the meeting in the lane (normal or plain look): focus stays on it.
async function onUnignoreSeries(meeting: OutlookMeeting): Promise<void> {
    openId.value = null;
    void context?.unignoreSeries(meeting.id);
    await keepFocusOn(meeting.id);
}

async function onForgetSeries(meeting: OutlookMeeting): Promise<void> {
    openId.value = null;
    void context?.forgetSeries(meeting.id);
    await keepFocusOn(meeting.id);
}

// The form created (or found) the entry: the panel closes and focus follows the Dismiss rule.
async function onConverted(meeting: OutlookMeeting): Promise<void> {
    if (openId.value !== meeting.id) return;
    const neighbour = neighbourOf(meeting.id);
    openId.value = null;
    await focusAfterRemoval(neighbour);
}

// A confirm of this meeting runs, from any surface (panel, hover card, menu, bulk): the block shows
// a spinner instead of the project dot, aria-busy and the progress cursor (UI-SPEC section 1).
function isPending(id: string): boolean {
    return context?.isConfirmPending?.(id) === true || confirmingIds.value.includes(id);
}

// Phase 6 (D-03): a move of this meeting's logged entry runs ("Move my entry here").
function isMoving(id: string): boolean {
    return context?.isMovePending?.(id) === true;
}

function confirmErrorOf(id: string): string | null {
    return confirmError.value?.id === id ? confirmError.value.message : null;
}

// Confirm from the panel (pessimistic): the panel stays open with the button spinner until the
// request settles. Created or existing: the meeting has left the cache, the panel closes and focus
// follows the conversion rule. Failed: the panel stays open with the reason inline (the context
// already showed the toast). Nothing sent (cannot act, already pending): nothing changes.
async function onConfirm(meeting: OutlookMeeting): Promise<void> {
    const id = meeting.id;
    if (!canAct.value || !context || openId.value !== id || confirmingIds.value.includes(id)) {
        return;
    }
    const neighbour = neighbourOf(id);
    confirmError.value = null;
    confirmingIds.value = [...confirmingIds.value, id];
    let result: OutlookConversionResult | null = null;
    try {
        result = await context.confirmOne(id);
    } finally {
        confirmingIds.value = confirmingIds.value.filter((item) => item !== id);
    }
    if (result === null) return;

    if (result.status === 'created' || result.status === 'existing') {
        if (openId.value === id) openId.value = null;
        await focusAfterRemoval(neighbour);
        return;
    }
    if (openId.value === id) {
        confirmError.value = { id, message: result.error?.message || props.labels.confirm_failed };
    }
}

function panelElement(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-testid="outlook-ghost-detail"]');
}

// "Move my entry here" from the panel (D-03, UI-SPEC section 4). The context runs the move and owns
// the toasts and the announcement; the panel stays open, undismissable, until it settles. Ok: the
// meeting has left the lane, focus goes to the moved entry block when rendered, else the Phase 4
// removal rule. Failed: the reason goes to the panel's alert line and focus back to the button.
// Stale: the context refreshed the calendar, the panel closes and focus stays on the meeting while
// it is still in the lane (as a plain suggestion), else follows the removal rule.
async function onMoveEntry(meeting: OutlookMeeting): Promise<void> {
    const id = meeting.id;
    if (!canAct.value || !context || openId.value !== id || isMoving(id)) return;
    if (confirmingIds.value.includes(id)) return;
    const entryId = meeting.moved_from?.time_entry_id ?? null;
    const neighbour = neighbourOf(id);
    confirmError.value = null;

    const result = await context.moveEntry(id);

    if (result.status === 'ok') {
        if (openId.value === id) openId.value = null;
        await nextTick();
        const entry = entryId
            ? document.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(entryId)}"]`)
            : null;
        if (entry) entry.focus();
        else await focusAfterRemoval(neighbour);
        return;
    }
    if (result.status === 'failed') {
        if (openId.value !== id) return;
        confirmError.value = { id, message: result.message || props.labels.move_entry_failed };
        await nextTick();
        panelElement()
            ?.querySelector<HTMLElement>('[data-testid="outlook-detail-move-entry"]')
            ?.focus();
        return;
    }
    if (openId.value === id) openId.value = null;
    if (ghostElement(id)) await keepFocusOn(id);
    else await focusAfterRemoval(neighbour);
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

// The form channel of the context (hover card and meeting menu actions): a request for a meeting of
// this day opens its panel straight in form mode, never while the context menu is open (that
// surface waits for the menu to close before asking). Requests for other days are not ours.
watch(
    () => context?.formRequest?.value ?? null,
    (request) => {
        if (!request || !canAct.value || props.contextMenuOpen) return;
        if (!boxes.value.some((box) => box.meeting.id === request.id)) return;
        closeHover();
        openId.value = request.id;
        formId.value = request.id;
    }
);

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

// Phase 5 (UI-SPEC section 1): a pre-assigned block adds a project line. T3 drops the time line
// (the grid position gives the time) and keeps the subject on one line; T4 under 60px keeps the
// subject on one line; from 60px the subject may take two lines. Never the organizer line.
function subjectLinesOf(box: GhostBox): 1 | 2 {
    if (preassignmentOf(box.meeting)) return box.height >= TIER_5_MIN_HEIGHT ? 2 : 1;
    return tierOf(box) >= 4 ? 2 : 1;
}

function showsTimeLine(box: GhostBox): boolean {
    return !(preassignmentOf(box.meeting) && tierOf(box) === 3);
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

// The series pre-assignment shown in the block (Phase 5 D-03): only on a non-faded meeting that the
// server sent with an assignment. The project colour reaches the dot only.
function preassignmentOf(meeting: OutlookMeeting): OutlookAssignment | null {
    return isPreassigned(meeting) ? (meeting.assignment ?? null) : null;
}

function ariaLabelOf(meeting: OutlookMeeting): string {
    let label = fillLabel(props.labels.ghost_label, {
        subject: subjectOf(meeting),
        start: formatTime(meeting.start, timeFormat.value),
        end: formatTime(meeting.end, timeFormat.value),
    });
    const assignment = preassignmentOf(meeting);
    if (assignment) {
        label += fillLabel(props.labels.preassigned_suffix, { project: assignment.project_name });
    }
    // An occurrence of an ignored series reads as such instead of ", dismissed" (UI-SPEC section 5).
    if (meeting.series_ignored === true) label += props.labels.series_ignored_suffix;
    else if (meeting.dismissed) label += props.labels.dismissed_suffix;
    return isSelected(meeting.id) ? label + props.labels.selected_suffix : label;
}

// aria-pressed only while a selection exists, so the blocks read as plain buttons otherwise.
function ariaPressedOf(id: string): 'true' | 'false' | undefined {
    if (!hasSelection.value) return undefined;
    return isSelected(id) ? 'true' : 'false';
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
        @contextmenu.capture="closeAllForContextMenu"
        @click.capture="onLaneClickCapture">
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
                :confirming="confirmingIds.includes(box.meeting.id)"
                :confirm-error="confirmErrorOf(box.meeting.id)"
                :moving="isMoving(box.meeting.id)"
                @update:open="(value: boolean) => setOpen(box.meeting.id, value)"
                @dismiss="onDismiss(box.meeting)"
                @restore="onRestore(box.meeting)"
                @create="onCreate(box.meeting)"
                @confirm="onConfirm(box.meeting)"
                @ignore-series="onIgnoreSeries(box.meeting)"
                @unignore-series="onUnignoreSeries(box.meeting)"
                @forget-series="onForgetSeries(box.meeting)"
                @converted="onConverted(box.meeting)"
                @cancel-form="onCancelForm(box.meeting)"
                @move-entry="onMoveEntry(box.meeting)">
                <HoverCardTrigger as-child>
                    <div
                        class="m365-ghost m365-meeting absolute pointer-events-auto select-none rounded-sm overflow-hidden hover:z-[1] focus:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 data-[panel-open]:ring-2 data-[panel-open]:ring-accent-700 dark:data-[panel-open]:ring-accent-200"
                        :class="{
                            'm365-meeting--dismissed': isFaded(box.meeting),
                            'm365-meeting--cascaded': box.cascade > 0,
                            'rounded-t-none': box.isClippedStart,
                            'rounded-b-none': box.isClippedEnd,
                            'm365-meeting--selected ring-2 ring-accent-700 dark:ring-accent-200 ring-offset-0':
                                isSelected(box.meeting.id),
                            'cursor-progress': isPending(box.meeting.id),
                            'cursor-pointer': !isPending(box.meeting.id),
                        }"
                        data-calendar-overlay
                        :data-ghost-id="box.meeting.id"
                        :data-panel-open="openId === box.meeting.id ? '' : undefined"
                        :data-selected="isSelected(box.meeting.id) ? '' : undefined"
                        :data-preassigned="preassignmentOf(box.meeting) ? '' : undefined"
                        role="button"
                        tabindex="0"
                        :aria-label="ariaLabelOf(box.meeting)"
                        :aria-pressed="ariaPressedOf(box.meeting.id)"
                        :aria-busy="isPending(box.meeting.id) ? 'true' : undefined"
                        :style="blockStyle(box)"
                        @keydown.enter.prevent="onBlockEnter($event, box.meeting.id)"
                        @keydown.space.prevent="($event.currentTarget as HTMLElement).click()"
                        @pointerenter="onBlockPointerEnter(box.meeting.id, $event)"
                        @pointermove="noteModifiers($event)"
                        @pointerleave="onBlockPointerLeave(box.meeting.id)">
                        <div
                            class="flex h-full min-w-0 flex-col overflow-hidden px-1.5 text-xs leading-[14px]"
                            :class="tierOf(box) === 1 ? 'py-0' : 'py-0.5'"
                            :data-ghost-tier="tierOf(box)">
                            <div v-if="tierOf(box) <= 2" class="flex min-w-0 items-center gap-1">
                                <template v-if="preassignmentOf(box.meeting)">
                                    <LoadingSpinner
                                        v-if="isPending(box.meeting.id)"
                                        class="m365-meeting__meta m-0 h-3 w-3 shrink-0"
                                        data-testid="outlook-preassigned-spinner" />
                                    <OutlookProjectDot
                                        v-else
                                        :color="preassignmentOf(box.meeting)!.project_color" />
                                </template>
                                <span
                                    class="m365-meeting__subject min-w-0 truncate"
                                    :class="{ 'font-semibold': !isFaded(box.meeting) }"
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
                                        'font-semibold': !isFaded(box.meeting),
                                        truncate: subjectLinesOf(box) === 1,
                                        'line-clamp-2': subjectLinesOf(box) === 2,
                                    }"
                                    data-ghost-subject>
                                    {{ subjectOf(box.meeting) }}
                                </span>
                                <div
                                    v-if="showsTimeLine(box)"
                                    class="m365-meeting__meta flex min-w-0 items-center gap-1"
                                    data-ghost-time>
                                    <EyeOff
                                        v-if="isFaded(box.meeting)"
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
                                    v-if="preassignmentOf(box.meeting)"
                                    class="m365-meeting__meta flex min-w-0 items-center gap-1"
                                    data-testid="outlook-preassigned-line">
                                    <LoadingSpinner
                                        v-if="isPending(box.meeting.id)"
                                        class="m-0 h-3 w-3 shrink-0 text-current"
                                        data-testid="outlook-preassigned-spinner" />
                                    <OutlookProjectDot
                                        v-else
                                        :color="preassignmentOf(box.meeting)!.project_color" />
                                    <span
                                        class="min-w-0 truncate"
                                        :title="preassignmentOf(box.meeting)!.project_name"
                                        >{{ preassignmentOf(box.meeting)!.project_name }}</span
                                    >
                                </div>
                                <div
                                    v-else-if="tierOf(box) === 5 && organizerOf(box.meeting)"
                                    class="m365-meeting__meta flex min-w-0 items-center gap-1"
                                    data-ghost-organizer>
                                    <User class="size-3 shrink-0" aria-hidden="true" />
                                    <span class="min-w-0 truncate">{{
                                        organizerOf(box.meeting)
                                    }}</span>
                                </div>
                            </template>
                        </div>
                        <!-- Selected check badge: 16px from tier 3, 12px on tiers 1-2 (UI-SPEC) -->
                        <span
                            v-if="isSelected(box.meeting.id)"
                            class="m365-meeting__badge absolute top-1 right-1 flex items-center justify-center rounded-full"
                            :class="tierOf(box) >= 3 ? 'size-4' : 'size-3'"
                            aria-hidden="true"
                            data-ghost-badge>
                            <Check
                                :class="tierOf(box) >= 3 ? 'size-3' : 'size-2'"
                                :stroke-width="3" />
                        </span>
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
/* Selected (Phase 4): the hover fill at rest; the ring comes from utility classes */
.m365-meeting--selected:not(.m365-meeting--dismissed) {
    background-color: var(--m365-meeting-bg-hover, var(--fb-hover));
}
.m365-meeting__badge {
    background-color: var(--m365-meeting-bar, var(--fb-bar));
    color: var(--color-on-accent);
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
