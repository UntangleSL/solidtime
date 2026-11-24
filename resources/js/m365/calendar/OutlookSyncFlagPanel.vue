<script setup lang="ts">
import {
    computed,
    inject,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    useId,
    watch,
    type ComputedRef,
} from 'vue';
import { CalendarSync, CircleX, Trash2 } from '@lucide/vue';
import type { Organization } from '@/packages/api/src';
import Button from '@/packages/ui/src/Buttons/Button.vue';
import PrimaryButton from '@/packages/ui/src/Buttons/PrimaryButton.vue';
import SecondaryButton from '@/packages/ui/src/Buttons/SecondaryButton.vue';
import LoadingSpinner from '@/packages/ui/src/LoadingSpinner.vue';
import { Popover, PopoverAnchor, PopoverContent } from '@/packages/ui/src/popover';
import { Separator } from '@/packages/ui/src/separator';
import type { OutlookFlagPanelRequest, OutlookOutOfSyncItem } from '@/m365/types';
import type { OutlookFlagActionResult } from './conversionApi';
import { flagTitle, formatRange } from './syncFlagReason';
import { OUTLOOK_MEETINGS_KEY } from './useOutlookMeetings';

// Resolve popover of one flagged time entry (Phase 6, UI-SPEC section 2, OSYNC-02 / OSYNC-03).
// Mounted once in Calendar.vue and driven by the context's `flagPanel` request: it anchors itself
// to the entry block (`[data-event-id]` inside the calendar root) or to the toolbar counter, shows
// what changed in Outlook and offers the choices. It owns no network code: Keep, Adjust and Delete
// are the context's actions, whose answers drive closing, focus and the inline alert. Every value
// is rendered through text interpolation only.
const context = inject(OUTLOOK_MEETINGS_KEY, null);
const organization = inject<ComputedRef<Organization | undefined> | undefined>(
    'organization',
    undefined
);

const labels = computed(() => context?.labels.value ?? null);
const canAct = computed(() => context?.canAct?.value === true);
const timeFormat = computed(() => organization?.value?.time_format ?? '24-hours');

const request = computed<OutlookFlagPanelRequest | null>(() => context?.flagPanel?.value ?? null);
const item = computed<OutlookOutOfSyncItem | null>(() => {
    const current = request.value;
    if (!context || !current || !canAct.value) return null;
    return context.flagOf(current.timeEntryId);
});

// The element the popover is placed against (the entry block or the counter button).
const anchorEl = ref<HTMLElement | null>(null);

const visible = computed(
    () => labels.value !== null && item.value !== null && anchorEl.value !== null
);

const BLOCK_SELECTOR = '[data-event-id]';
const COUNTER_SELECTOR = '[data-testid="outlook-out-of-sync"]';
const SYNC_SELECTOR = '[data-testid="outlook-sync-button"]';
// The marker opens its own entry's popover on click: its pointer-down never closes this one.
const MARKER_SELECTOR = '[data-testid="outlook-sync-flag-marker"]';

// The block of time entry `id` inside the calendar root (compared through the dataset, so no id
// ever lands in a selector).
function findBlock(id: string): HTMLElement | null {
    const root = document.querySelector('.fc') ?? document;
    for (const block of root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)) {
        if (block.dataset.eventId === id) return block;
    }
    return null;
}

function findCounter(): HTMLElement | null {
    return document.querySelector<HTMLElement>(COUNTER_SELECTOR);
}

function findSync(): HTMLElement | null {
    return document.querySelector<HTMLElement>(SYNC_SELECTOR);
}

function resolveAnchor(current: OutlookFlagPanelRequest): HTMLElement | null {
    return current.anchor === 'counter' ? findCounter() : findBlock(current.timeEntryId);
}

function focusFirst(...candidates: (HTMLElement | null)[]): void {
    candidates.find((element) => element !== null && element.isConnected)?.focus();
}

// Entry: beside the block. Counter (the entry is not rendered): below the toolbar button.
const side = computed(() => (request.value?.anchor === 'counter' ? 'bottom' : 'right'));
const align = computed(() => (request.value?.anchor === 'counter' ? 'end' : 'start'));

// --- Content
const titleId = `outlook-sync-flag-title-${useId()}`;
const title = computed(() =>
    item.value && labels.value ? flagTitle(item.value.kind, labels.value) : ''
);
const description = computed(() => item.value?.description || 'No description');

function range(start: string, end: string | null, allDay = false): string {
    return formatRange(start, end, { full: true, timeFormat: timeFormat.value, allDay });
}

const before = computed(() =>
    item.value ? range(item.value.meeting_start, item.value.meeting_end, item.value.all_day) : ''
);
const now = computed(() => {
    const current = item.value;
    if (!current || current.new_start === null || current.new_end === null) return null;
    return range(current.new_start, current.new_end, current.all_day);
});
const entry = computed(() =>
    item.value ? range(item.value.entry_start, item.value.entry_end) : ''
);

function sameInstant(a: string | null, b: string | null): boolean {
    return a === null || b === null ? a === b : Date.parse(a) === Date.parse(b);
}

// A cancelled or removed meeting lists the entry only when its times differ from the meeting's.
const entryDiffers = computed(() => {
    const current = item.value;
    if (!current) return false;
    return (
        !sameInstant(current.entry_start, current.meeting_start) ||
        !sameInstant(current.entry_end, current.meeting_end)
    );
});

// An all-day meeting cannot be applied to a timed entry (D-18): no Adjust then.
const canAdjust = computed(
    () => item.value?.kind === 'moved' && !item.value.all_day && now.value !== null
);

// Reka labels the dialog with its (absent) trigger and overrides any aria-labelledby passed to the
// content, so the title takes over the labelling once it is mounted.
function labelDialogByTitle(element: unknown): void {
    if (element instanceof HTMLElement) {
        element.closest('[role="dialog"]')?.setAttribute('aria-labelledby', element.id);
    }
}

// --- Focus
const contentEl = ref<HTMLElement | null>(null);

function button(testid: string): HTMLElement | null {
    return contentEl.value?.querySelector<HTMLElement>(`[data-testid="${testid}"]`) ?? null;
}

// Focus on open: Adjust for a moved flag, never the destructive action otherwise (Keep as is).
function focusDefault(): void {
    focusFirst(
        canAdjust.value ? button('outlook-sync-flag-adjust') : null,
        button('outlook-sync-flag-keep')
    );
}

function onOpenAutoFocus(event: Event): void {
    event.preventDefault();
    void nextTick(focusDefault);
}

// Focus after a close is placed explicitly (outcome table), never by reka.
function onCloseAutoFocus(event: Event): void {
    event.preventDefault();
}

// Esc closes the delete confirmation first, then the popover; closed by Esc, focus returns to the
// entry block, or to the counter when the popover is anchored to it.
let escapeClosing = false;

function onEscapeKeyDown(event: KeyboardEvent): void {
    if (busy.value) {
        event.preventDefault();
        return;
    }
    if (confirmingDelete.value) {
        event.preventDefault();
        cancelDelete();
        return;
    }
    escapeClosing = true;
}

// While an action runs the popover cannot be dismissed (the same guard as OutlookGhostDetail).
// A marker's click asks for its own entry's popover, so its pointer-down does not close this one.
function onInteractOutside(event: Event): void {
    if (busy.value) {
        event.preventDefault();
        return;
    }
    const original = (event as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent;
    const target = original?.target ?? event.target;
    if (target instanceof Element && target.closest(MARKER_SELECTOR)) event.preventDefault();
}

function onOpenChange(value: boolean): void {
    if (value || busy.value) return;
    const current = request.value;
    const returnTo =
        escapeClosing && current
            ? current.anchor === 'counter'
                ? findCounter()
                : findBlock(current.timeEntryId)
            : null;
    escapeClosing = false;
    context?.closeFlagPanel();
    if (returnTo) void nextTick(() => focusFirst(returnTo));
}

// --- Delete: an inline two-step confirmation (no undo exists, D-05). Only the second click deletes.
const confirmingDelete = ref(false);

function askDelete(): void {
    confirmingDelete.value = true;
    void nextTick(() => focusFirst(button('outlook-sync-flag-delete-cancel')));
}

function cancelDelete(): void {
    confirmingDelete.value = false;
    void nextTick(() => focusFirst(button('outlook-sync-flag-delete')));
}

// --- Actions
type Action = 'keep' | 'adjust' | 'delete';
const acting = ref<Action | null>(null);
// The mapped reason of the last failed action (inline role=alert line).
const alert = ref<string | null>(null);

const busy = computed(() => {
    if (acting.value !== null) return true;
    const current = request.value;
    return current !== null && context?.isFlagPending(current.timeEntryId) === true;
});

const ACTION_BUTTON: Record<Action, string> = {
    keep: 'outlook-sync-flag-keep',
    adjust: 'outlook-sync-flag-adjust',
    delete: 'outlook-sync-flag-delete-confirm',
};

// The entry block is aria-busy while its action runs; only this panel sets and removes it.
let busyBlock: HTMLElement | null = null;

function markBusy(id: string): void {
    busyBlock = findBlock(id);
    busyBlock?.setAttribute('aria-busy', 'true');
}

function clearBusy(id: string | null): void {
    busyBlock?.removeAttribute('aria-busy');
    busyBlock = null;
    if (id !== null) findBlock(id)?.removeAttribute('aria-busy');
}

async function run(action: Action): Promise<void> {
    const current = request.value;
    if (!context || !current || item.value === null || acting.value !== null) return;
    const id = current.timeEntryId;
    const origin = current.origin;

    acting.value = action;
    alert.value = null;
    markBusy(id);
    let result: OutlookFlagActionResult;
    try {
        if (action === 'adjust') result = await context.adjustFlag(id);
        else if (action === 'delete') result = await context.deleteFlaggedEntry(id);
        else result = await context.keepFlag(id);
    } finally {
        acting.value = null;
        clearBusy(id);
    }

    const sameRequest = request.value?.seq === current.seq;
    if (result.status === 'failed') {
        if (!sameRequest) return;
        // Stays open with its values (a failed delete keeps its confirm footer); retry is Enter.
        // An empty message means nothing was sent (already pending): no alert then.
        alert.value = result.message === '' ? null : result.message;
        await nextTick();
        reanchor();
        focusFirst(button(ACTION_BUTTON[action]));
        return;
    }
    // Another entry's popover was asked for meanwhile: leave it and its focus alone.
    if (request.value !== null && !sameRequest) return;

    if (sameRequest) context.closeFlagPanel();
    await nextTick();
    await nextTick();
    // Deleted, or stale (the calendar refreshes): the counter while it is shown, else Sync.
    if (action === 'delete' || result.status === 'stale') {
        focusFirst(findCounter(), findSync());
        return;
    }
    // Opened from the counter: back to the counter while it is shown; otherwise the entry block
    // (at its new times after an adjust), else the counter, else Sync.
    if (origin === 'counter') focusFirst(findCounter(), findBlock(id), findSync());
    else focusFirst(findBlock(id), findCounter(), findSync());
}

// --- Re-anchoring. The anchor block re-renders (refetch, drag elsewhere): an idle popover moves to
// the block with the same data-event-id, or closes silently when there is none.
function reanchor(): void {
    const current = request.value;
    if (!current || busy.value || anchorEl.value === null) return;
    const anchor = resolveAnchor(current);
    if (anchor === null) {
        anchorEl.value = null;
        context?.closeFlagPanel();
        return;
    }
    if (anchor !== anchorEl.value) anchorEl.value = anchor;
}

let observer: MutationObserver | null = null;

watch(visible, (value) => {
    observer?.disconnect();
    observer = null;
    if (!value) return;
    observer = new MutationObserver(reanchor);
    observer.observe(document.body, { childList: true, subtree: true });
});

// The flag was resolved elsewhere (another tab, a sync): an idle popover closes with it.
watch(item, (value) => {
    if (value === null && request.value !== null && !busy.value) context?.closeFlagPanel();
});

// Starting a drag or resize on any entry closes an idle popover.
function onDocumentPointerDown(event: Event): void {
    if (!visible.value || busy.value) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest(MARKER_SELECTOR)) return;
    if (target.closest(BLOCK_SELECTOR)) context?.closeFlagPanel();
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown, true));

onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onDocumentPointerDown, true);
    observer?.disconnect();
    observer = null;
    clearBusy(null);
});

// A new request (another entry, or the same one again) resets the popover and finds its anchor.
watch(
    () => request.value?.seq ?? null,
    () => {
        const current = request.value;
        const wasOpen = visible.value;
        confirmingDelete.value = false;
        escapeClosing = false;
        alert.value = null;
        if (!current || item.value === null) {
            anchorEl.value = null;
            return;
        }
        const anchor = resolveAnchor(current);
        anchorEl.value = anchor;
        if (anchor === null) {
            context?.closeFlagPanel();
            return;
        }
        if (wasOpen) void nextTick(focusDefault);
    },
    { immediate: true }
);
</script>

<template>
    <Popover v-if="context" :open="visible" @update:open="onOpenChange">
        <PopoverAnchor :reference="anchorEl ?? undefined" />
        <PopoverContent
            v-if="item && labels"
            class="w-96 p-4"
            :side="side"
            :align="align"
            :side-offset="8"
            :reference="anchorEl ?? undefined"
            data-testid="outlook-sync-flag-panel"
            :data-kind="item.kind"
            :data-anchor="request?.anchor"
            :aria-busy="busy ? 'true' : undefined"
            @interact-outside="onInteractOutside"
            @escape-key-down="onEscapeKeyDown"
            @open-auto-focus="onOpenAutoFocus"
            @close-auto-focus="onCloseAutoFocus">
            <div ref="contentEl">
                <h3
                    :id="titleId"
                    :ref="labelDialogByTitle"
                    class="text-sm font-semibold text-text-primary"
                    data-testid="outlook-sync-flag-title">
                    {{ title }}
                </h3>
                <p
                    class="mt-1 truncate text-xs font-semibold text-text-primary"
                    :title="description"
                    data-testid="outlook-sync-flag-description">
                    {{ description }}
                </p>
                <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs tabular-nums">
                    <template v-if="item.kind === 'moved'">
                        <dt class="text-text-tertiary">{{ labels.osync_row_before }}</dt>
                        <dd
                            class="truncate text-text-tertiary"
                            data-testid="outlook-sync-flag-before">
                            {{ before }}
                        </dd>
                        <template v-if="now">
                            <dt class="text-text-tertiary">{{ labels.osync_row_now }}</dt>
                            <dd
                                class="truncate font-semibold text-text-primary"
                                data-testid="outlook-sync-flag-now">
                                {{ now }}
                            </dd>
                        </template>
                        <dt class="text-text-tertiary">{{ labels.osync_row_entry }}</dt>
                        <dd
                            class="truncate text-text-secondary"
                            data-testid="outlook-sync-flag-entry">
                            {{ entry }}
                        </dd>
                    </template>
                    <template v-else>
                        <dt class="text-text-tertiary">{{ labels.osync_row_meeting }}</dt>
                        <dd
                            class="truncate text-text-secondary"
                            data-testid="outlook-sync-flag-meeting">
                            {{ before }}
                        </dd>
                        <template v-if="entryDiffers">
                            <dt class="text-text-tertiary">{{ labels.osync_row_entry }}</dt>
                            <dd
                                class="truncate text-text-secondary"
                                data-testid="outlook-sync-flag-entry">
                                {{ entry }}
                            </dd>
                        </template>
                    </template>
                </dl>
                <p class="mt-2 text-xs text-text-tertiary" data-testid="outlook-sync-flag-note">
                    {{ item.kind === 'moved' ? labels.osync_note_moved : labels.osync_note_gone }}
                </p>
                <p
                    v-if="request?.anchor === 'counter'"
                    class="mt-2 text-xs text-text-tertiary"
                    data-testid="outlook-sync-flag-not-in-view">
                    {{ labels.osync_not_in_view }}
                </p>
                <Separator class="mt-4" />
                <div v-if="confirmingDelete" class="mt-4">
                    <p
                        class="text-xs text-text-secondary"
                        data-testid="outlook-sync-flag-delete-question">
                        {{ labels.osync_delete_question }}
                    </p>
                    <div class="mt-2 flex justify-end gap-2">
                        <SecondaryButton
                            type="button"
                            :disabled="busy"
                            data-testid="outlook-sync-flag-delete-cancel"
                            @click="cancelDelete">
                            {{ labels.cancel }}
                        </SecondaryButton>
                        <Button
                            type="button"
                            variant="destructive"
                            :disabled="busy"
                            data-testid="outlook-sync-flag-delete-confirm"
                            @click="run('delete')">
                            <LoadingSpinner
                                v-if="acting === 'delete'"
                                class="m-0 h-4 w-4 text-current"
                                data-testid="outlook-sync-flag-delete-spinner" />
                            <Trash2 v-else aria-hidden="true" />
                            <span>{{ labels.osync_delete_confirm }}</span>
                        </Button>
                    </div>
                </div>
                <div v-else class="mt-4 flex justify-end gap-2">
                    <SecondaryButton
                        type="button"
                        :loading="acting === 'keep'"
                        :disabled="busy"
                        data-testid="outlook-sync-flag-keep"
                        @click="run('keep')">
                        {{ labels.osync_keep }}
                    </SecondaryButton>
                    <PrimaryButton
                        v-if="canAdjust"
                        type="button"
                        :icon="CalendarSync"
                        :loading="acting === 'adjust'"
                        :disabled="busy"
                        data-testid="outlook-sync-flag-adjust"
                        @click="run('adjust')">
                        {{ labels.osync_adjust }}
                    </PrimaryButton>
                    <Button
                        v-if="item.kind !== 'moved'"
                        type="button"
                        variant="outline"
                        size="default"
                        class="text-destructive hover:text-destructive"
                        :disabled="busy"
                        data-testid="outlook-sync-flag-delete"
                        @click="askDelete">
                        <Trash2 aria-hidden="true" />
                        <span>{{ labels.osync_delete }}</span>
                    </Button>
                </div>
                <p
                    v-if="alert"
                    role="alert"
                    class="mt-2 flex items-center gap-1 text-xs text-destructive"
                    data-testid="outlook-sync-flag-alert">
                    <CircleX class="size-3 shrink-0" aria-hidden="true" />
                    <span>{{ alert }}</span>
                </p>
            </div>
        </PopoverContent>
    </Popover>
</template>
