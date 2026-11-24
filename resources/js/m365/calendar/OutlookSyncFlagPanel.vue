<script setup lang="ts">
import { computed, inject, nextTick, ref, useId, watch, type ComputedRef } from 'vue';
import { CalendarSync, Trash2 } from '@lucide/vue';
import type { Organization } from '@/packages/api/src';
import Button from '@/packages/ui/src/Buttons/Button.vue';
import PrimaryButton from '@/packages/ui/src/Buttons/PrimaryButton.vue';
import SecondaryButton from '@/packages/ui/src/Buttons/SecondaryButton.vue';
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
    if (confirmingDelete.value) {
        event.preventDefault();
        cancelDelete();
        return;
    }
    escapeClosing = true;
}

function onOpenChange(value: boolean): void {
    if (value) return;
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

async function run(action: Action): Promise<void> {
    const current = request.value;
    if (!context || !current || item.value === null || acting.value !== null) return;
    const id = current.timeEntryId;
    const origin = current.origin;

    acting.value = action;
    let result: OutlookFlagActionResult;
    try {
        if (action === 'adjust') result = await context.adjustFlag(id);
        else if (action === 'delete') result = await context.deleteFlaggedEntry(id);
        else result = await context.keepFlag(id);
    } finally {
        acting.value = null;
    }
    if (result.status !== 'ok') return;

    if (request.value?.seq === current.seq) context.closeFlagPanel();
    await nextTick();
    await nextTick();
    // The entry is gone: the counter while it is shown, else Sync.
    if (action === 'delete') {
        focusFirst(findCounter(), findSync());
        return;
    }
    // Opened from the counter: back to the counter while it is shown; otherwise the entry block
    // (at its new times after an adjust), else the counter, else Sync.
    if (origin === 'counter') focusFirst(findCounter(), findBlock(id), findSync());
    else focusFirst(findBlock(id), findCounter(), findSync());
}

// A new request (another entry, or the same one again) resets the popover and finds its anchor.
watch(
    () => request.value?.seq ?? null,
    () => {
        const current = request.value;
        const wasOpen = visible.value;
        confirmingDelete.value = false;
        escapeClosing = false;
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
            side="right"
            align="start"
            :side-offset="8"
            :reference="anchorEl ?? undefined"
            data-testid="outlook-sync-flag-panel"
            :data-kind="item.kind"
            :data-anchor="request?.anchor"
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
                            :disabled="acting !== null"
                            data-testid="outlook-sync-flag-delete-cancel"
                            @click="cancelDelete">
                            {{ labels.cancel }}
                        </SecondaryButton>
                        <Button
                            type="button"
                            variant="destructive"
                            :disabled="acting !== null"
                            data-testid="outlook-sync-flag-delete-confirm"
                            @click="run('delete')">
                            <Trash2 aria-hidden="true" />
                            <span>{{ labels.osync_delete_confirm }}</span>
                        </Button>
                    </div>
                </div>
                <div v-else class="mt-4 flex justify-end gap-2">
                    <SecondaryButton
                        type="button"
                        :loading="acting === 'keep'"
                        :disabled="acting !== null"
                        data-testid="outlook-sync-flag-keep"
                        @click="run('keep')">
                        {{ labels.osync_keep }}
                    </SecondaryButton>
                    <PrimaryButton
                        v-if="canAdjust"
                        type="button"
                        :icon="CalendarSync"
                        :loading="acting === 'adjust'"
                        :disabled="acting !== null"
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
                        :disabled="acting !== null"
                        data-testid="outlook-sync-flag-delete"
                        @click="askDelete">
                        <Trash2 aria-hidden="true" />
                        <span>{{ labels.osync_delete }}</span>
                    </Button>
                </div>
            </div>
        </PopoverContent>
    </Popover>
</template>
