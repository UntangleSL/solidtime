<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { Check, CheckCheck } from '@lucide/vue';
import Button from '@/packages/ui/src/Buttons/Button.vue';
import PrimaryButton from '@/packages/ui/src/Buttons/PrimaryButton.vue';
import SecondaryButton from '@/packages/ui/src/Buttons/SecondaryButton.vue';
import { FieldError } from '@/packages/ui/src/field';
import { Popover, PopoverContent, PopoverTrigger } from '@/packages/ui/src/popover';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/packages/ui/src/tooltip';
import { useNotificationsStore } from '@/utils/notification';
import type { OutlookAssignment, OutlookConversionResult, OutlookMeeting } from '@/m365/types';
import OutlookAssignResults from './OutlookAssignResults.vue';
import { fillLabel } from './labels';
import { OUTLOOK_MEETINGS_KEY } from './useOutlookMeetings';

// "Confirm N pre-assigned" (Phase 5, D-04, RULE-02, UI-SPEC section 8): one toolbar action that
// reviews and confirms every pre-assigned meeting the user can see in the current day or week. The
// count only includes meetings whose block is rendered inside the calendar root (`.fc`), so hidden
// weekends and the other days of a day view never count (Phase 4 rendered-block rule), on top of
// the composable's rules (pre-assigned, not dismissed, not in an ignored series, not pending).
// Suggestion-only meetings are never part of it (D-08): only series pre-assignments are confirmed,
// each one with its own series values through the Phase 4 endpoint in confirm mode.
const context = inject(OUTLOOK_MEETINGS_KEY, null);

const labels = computed(() => context?.labels.value ?? null);
const canAct = computed(() => context?.canAct?.value === true);

// With the integration on, only while connected. In the browser-test mode (no calendar prop) the
// injected meetings with actions are enough.
const allowed = computed(() => {
    if (!context || !canAct.value) return false;
    if (context.calendar.value) return context.connectionState.value === 'connected';
    return true;
});

// --- Rendered blocks: ids of the `[data-ghost-id]` elements inside the calendar root, kept up to
// date by one MutationObserver over that root (the body until the root exists).
const renderedIds = ref<ReadonlySet<string>>(new Set());
let observer: MutationObserver | null = null;
let observed: Element | null = null;

function observe(target: Element | null): void {
    if (!observer) return;
    observer.disconnect();
    observed = target;
    observer.observe(target ?? document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-ghost-id'],
    });
}

function scan(): void {
    const root = document.querySelector('.fc');
    if (root !== observed) observe(root);
    const ids = new Set<string>();
    root?.querySelectorAll<HTMLElement>('[data-ghost-id]').forEach((block) => {
        const id = block.dataset.ghostId;
        if (id) ids.add(id);
    });
    const current = renderedIds.value;
    if (ids.size === current.size && [...ids].every((id) => current.has(id))) return;
    renderedIds.value = ids;
}

onMounted(() => {
    observer = new MutationObserver(scan);
    scan();
});

onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
    observed = null;
});

const preassigned = computed<OutlookMeeting[]>(() => context?.preassignedInRange?.value ?? []);

// A changed list re-renders the lanes first; scan once that render is done.
watch(preassigned, () => void nextTick(scan), { flush: 'post' });

const candidates = computed<OutlookMeeting[]>(() =>
    allowed.value ? preassigned.value.filter((meeting) => renderedIds.value.has(meeting.id)) : []
);
const count = computed(() => candidates.value.length);

// --- Popover state. The list is a snapshot taken at open (like the Phase 4 batch form).
const open = ref(false);
const snapshot = ref<OutlookMeeting[]>([]);
const checked = ref<Record<string, boolean>>({});
type RowState = Record<string, OutlookConversionResult | 'pending'>;
const results = ref<RowState>({});
// True while the request runs: the popover then cannot be dismissed.
const busy = ref(false);
// After a submit with at least one failure: summary title, Close and Retry.
const resultView = ref(false);
const noneSelected = ref(false);
const summaryEl = ref<HTMLElement | null>(null);
const titleId = useId();

// The button stays while its popover is open (it anchors it) and freezes its count meanwhile.
const visible = computed(
    () => labels.value !== null && allowed.value && (count.value > 0 || open.value)
);
const shownCount = computed(() => (open.value ? snapshot.value.length : count.value));

function onOpenChange(value: boolean): void {
    if (!value && busy.value) return;
    open.value = value;
}

watch(open, (value) => {
    if (!value) return;
    snapshot.value = [...candidates.value];
    checked.value = Object.fromEntries(snapshot.value.map((meeting) => [meeting.id, true]));
    results.value = {};
    resultView.value = false;
    noneSelected.value = false;
});

// Everything confirmed elsewhere (sync, other tab, single confirms) takes the idle popover with it.
watch(count, (value) => {
    if (value === 0 && open.value && !busy.value && !resultView.value) open.value = false;
});

function plural(one: string, many: string, value: number): string {
    return value === 1 ? one : fillLabel(many, { count: String(value) });
}

const ariaLabel = computed(() =>
    labels.value
        ? plural(
              labels.value.confirm_all_title_one,
              labels.value.confirm_all_title_many,
              shownCount.value
          )
        : ''
);
const shortLabel = computed(() =>
    labels.value
        ? fillLabel(labels.value.confirm_all_short, { count: String(shownCount.value) })
        : ''
);
const longLabel = computed(() =>
    labels.value
        ? fillLabel(labels.value.confirm_all_long, { count: String(shownCount.value) })
        : ''
);

const checkedIds = computed(() =>
    snapshot.value.filter((meeting) => checked.value[meeting.id] === true).map((item) => item.id)
);
const sentIds = ref<string[]>([]);

const titleText = computed(() =>
    labels.value
        ? plural(
              labels.value.confirm_all_title_one,
              labels.value.confirm_all_title_many,
              snapshot.value.length
          )
        : ''
);
const submitLabel = computed(() =>
    labels.value
        ? plural(
              labels.value.confirm_submit_one,
              labels.value.confirm_submit_many,
              checkedIds.value.length
          )
        : ''
);

function isDone(value: OutlookConversionResult | 'pending' | undefined): boolean {
    return value !== undefined && value !== 'pending' && value.status !== 'failed';
}

const doneCount = computed(
    () => snapshot.value.filter((meeting) => isDone(results.value[meeting.id])).length
);
const failedIds = computed(() =>
    snapshot.value
        .filter((meeting) => {
            const value = results.value[meeting.id];
            return value !== undefined && value !== 'pending' && value.status === 'failed';
        })
        .map((meeting) => meeting.id)
);
const summaryText = computed(() => {
    const current = labels.value;
    if (!current) return '';
    return doneCount.value === 0
        ? current.batch_none
        : fillLabel(current.batch_summary, {
              done: String(doneCount.value),
              total: String(sentIds.value.length),
          });
});
const retryLabel = computed(() =>
    labels.value
        ? fillLabel(labels.value.retry_failed, { count: String(failedIds.value.length) })
        : ''
);

function project(meeting: OutlookMeeting): OutlookAssignment | null {
    return meeting.assignment ?? null;
}

function toggle(id: string): void {
    if (busy.value || resultView.value) return;
    checked.value = { ...checked.value, [id]: !checked.value[id] };
    if (checkedIds.value.length > 0) noneSelected.value = false;
}

function failed(id: string, message: string): OutlookConversionResult {
    return {
        meeting_id: id,
        status: 'failed',
        time_entry_id: null,
        error: { key: 'request_failed', message },
    };
}

// First submit: the checked rows only (unticked ones are never sent). In result view (Retry): only
// the failed ones. The composable sends them in chunks of 50.
async function submit(): Promise<void> {
    const current = labels.value;
    if (busy.value || !context || !current) return;

    const ids = resultView.value ? failedIds.value : checkedIds.value;
    if (ids.length === 0) {
        if (!resultView.value) noneSelected.value = true;
        return;
    }
    noneSelected.value = false;
    if (!resultView.value) sentIds.value = [...ids];

    const previous = results.value;
    const pending: RowState = { ...previous };
    ids.forEach((id) => (pending[id] = 'pending'));
    results.value = pending;

    let answer: OutlookConversionResult[] = [];
    busy.value = true;
    try {
        answer = await context.confirmPreassigned(ids);
    } finally {
        busy.value = false;
    }
    // Nothing was sent (one of them is already being confirmed elsewhere, or the context cannot act).
    if (answer.length === 0) {
        results.value = previous;
        return;
    }

    const next: RowState = { ...results.value };
    ids.forEach((id) => {
        next[id] =
            answer.find((result) => result.meeting_id === id) ?? failed(id, current.error_generic);
    });
    results.value = next;

    if (failedIds.value.length === 0) {
        // One toast and one announcement for the whole confirm, never per row (UI-SPEC section 9).
        const text =
            doneCount.value === 1
                ? current.created_success
                : fillLabel(current.batch_success_many, { count: String(doneCount.value) });
        useNotificationsStore().addNotification('success', text);
        context.announce(text);
        open.value = false;
        return;
    }

    resultView.value = true;
    context.announce(summaryText.value);
    await nextTick();
    summaryEl.value?.focus();
}

function close(): void {
    if (busy.value) return;
    open.value = false;
}

function onInteractOutside(event: Event): void {
    if (busy.value) event.preventDefault();
}

function onEscapeKeyDown(event: KeyboardEvent): void {
    if (busy.value) event.preventDefault();
}

// Focus goes to the submit button (Enter confirms what is listed).
function onOpenAutoFocus(event: Event): void {
    event.preventDefault();
    void nextTick(() =>
        document.querySelector<HTMLElement>('[data-testid="outlook-confirm-submit"]')?.focus()
    );
}

// With nothing left to confirm the button is gone: focus goes to Sync instead of the body.
function onCloseAutoFocus(event: Event): void {
    if (count.value > 0) return;
    event.preventDefault();
    document.querySelector<HTMLElement>('[data-testid="outlook-sync-button"]')?.focus();
}
</script>

<template>
    <Popover v-if="visible && labels" :open="open" @update:open="onOpenChange">
        <TooltipProvider :delay-duration="300">
            <Tooltip>
                <TooltipTrigger as-child>
                    <span class="inline-flex">
                        <PopoverTrigger as-child>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                data-testid="outlook-confirm-all"
                                class="w-8 p-0 md:w-auto md:px-3"
                                :aria-label="ariaLabel">
                                <CheckCheck aria-hidden="true" />
                                <span
                                    class="hidden tabular-nums md:inline lg:hidden"
                                    data-testid="outlook-confirm-all-short">
                                    {{ shortLabel }}
                                </span>
                                <span
                                    class="hidden tabular-nums lg:inline"
                                    data-testid="outlook-confirm-all-long">
                                    {{ longLabel }}
                                </span>
                            </Button>
                        </PopoverTrigger>
                    </span>
                </TooltipTrigger>
                <TooltipContent data-testid="outlook-confirm-all-tooltip">
                    <p>{{ labels.confirm_all_tooltip }}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
        <PopoverContent
            side="bottom"
            align="end"
            :side-offset="8"
            class="w-96 space-y-4 p-4"
            data-testid="outlook-confirm-all-popover"
            :aria-labelledby="titleId"
            :aria-busy="busy ? 'true' : undefined"
            @interact-outside="onInteractOutside"
            @escape-key-down="onEscapeKeyDown"
            @open-auto-focus="onOpenAutoFocus"
            @close-auto-focus="onCloseAutoFocus">
            <h3
                :id="titleId"
                ref="summaryEl"
                class="text-sm font-semibold text-text-primary focus:outline-none"
                :tabindex="resultView ? -1 : undefined"
                :data-testid="resultView ? 'outlook-confirm-summary' : 'outlook-confirm-title'">
                {{ resultView ? summaryText : titleText }}
            </h3>

            <OutlookAssignResults
                :meetings="snapshot"
                :results="results"
                :labels="labels"
                :checked="checked"
                :check-disabled="busy || resultView"
                :project="project"
                row-testid="outlook-confirm-row"
                list-class="max-h-60"
                @toggle="toggle" />

            <p class="text-xs text-text-tertiary" data-testid="outlook-confirm-note">
                {{ labels.confirm_all_note }}
            </p>

            <FieldError v-if="noneSelected" class="text-xs" data-testid="outlook-confirm-none">
                {{ labels.confirm_none_selected }}
            </FieldError>

            <div v-if="resultView" class="flex justify-end gap-2">
                <SecondaryButton
                    type="button"
                    :disabled="busy"
                    data-testid="outlook-confirm-close"
                    @click="close">
                    {{ labels.close }}
                </SecondaryButton>
                <PrimaryButton
                    type="button"
                    :loading="busy"
                    data-testid="outlook-confirm-retry"
                    @click="submit">
                    {{ retryLabel }}
                </PrimaryButton>
            </div>
            <div v-else class="flex justify-end gap-2">
                <SecondaryButton
                    type="button"
                    :disabled="busy"
                    data-testid="outlook-confirm-cancel"
                    @click="close">
                    {{ labels.cancel }}
                </SecondaryButton>
                <PrimaryButton
                    type="button"
                    :icon="Check"
                    :loading="busy"
                    data-testid="outlook-confirm-submit"
                    @click="submit">
                    {{ submitLabel }}
                </PrimaryButton>
            </div>
        </PopoverContent>
    </Popover>
</template>
