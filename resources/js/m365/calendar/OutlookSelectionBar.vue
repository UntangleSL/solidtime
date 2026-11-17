<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue';
import { useEventListener, useResizeObserver } from '@vueuse/core';
import { ListChecks, X } from '@lucide/vue';
import { Button } from '@/packages/ui/src/Buttons';
import PrimaryButton from '@/packages/ui/src/Buttons/PrimaryButton.vue';
import { Popover, PopoverContent, PopoverTrigger } from '@/packages/ui/src/popover';
import type { OutlookConversionResult, OutlookMeeting } from '@/m365/types';
import OutlookConvertForm from './OutlookConvertForm.vue';
import { fillLabel } from './labels';
import { OUTLOOK_MEETINGS_KEY } from './useOutlookMeetings';

// Floating bar shown while Outlook meetings are selected (Phase 4, D-07, UI-SPEC section 6). It
// hosts the batch form in a popover anchored to the bar. Teleported to the body and fixed, centred
// on the calendar grid (not the viewport, so the sidebar does not offset it) and 16px above the
// grid's visible bottom; z-40 keeps it above blocks and entries and below popovers and toasts.
const context = inject(OUTLOOK_MEETINGS_KEY, null);

const labels = computed(() => context?.labels.value ?? null);
const selectedIds = computed(() => context?.selection.selectedIds.value ?? []);
const count = computed(() => selectedIds.value.length);

const popoverOpen = ref(false);
// True while the batch request runs: the popover then cannot be dismissed and the bar stays.
const busy = ref(false);

const visible = computed(() => labels.value !== null && (count.value > 0 || busy.value));

function byStartThenId(a: OutlookMeeting, b: OutlookMeeting): number {
    const diff = new Date(a.start).getTime() - new Date(b.start).getTime();
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// The meetings handed to the batch form when it opens (the form keeps its own copy while open).
const batchMeetings = ref<OutlookMeeting[]>([]);

function selectedMeetings(): OutlookMeeting[] {
    const ids = new Set(selectedIds.value);
    return (context?.meetings.value ?? []).filter((item) => ids.has(item.id)).sort(byStartThenId);
}

watch(popoverOpen, (open) => {
    if (open) batchMeetings.value = selectedMeetings();
    else busy.value = false;
});

// A selection emptied from elsewhere (navigation, sync, Clear) takes the idle popover with it.
watch(count, (value) => {
    if (value === 0 && !busy.value) popoverOpen.value = false;
});

const countText = computed(() => {
    const current = labels.value;
    if (!current) return '';
    return count.value === 1
        ? current.selected_one
        : fillLabel(current.selected_many, { count: String(count.value) });
});

const assignText = computed(() => {
    const current = labels.value;
    if (!current) return '';
    return count.value === 1
        ? current.assign_one
        : fillLabel(current.assign_many, { count: String(count.value) });
});

function clearSelection(): void {
    context?.selection.clear();
}

function onDone(_results: OutlookConversionResult[]): void {
    popoverOpen.value = false;
}

function onCancel(): void {
    popoverOpen.value = false;
}

// Layers of the nested pickers (project and tag dropdowns, billable select, a tag create dialog)
// are portaled outside the popover; an interaction inside them must never close the form.
const NESTED_LAYERS =
    '[data-reka-popper-content-wrapper], [role="listbox"], [role="menu"], [role="dialog"]';

function eventTarget(event: Event): Element | null {
    const original = (event as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent;
    const target = original?.target ?? event.target;
    return target instanceof Element ? target : null;
}

const barEl = ref<HTMLElement | null>(null);

function onInteractOutside(event: Event): void {
    if (busy.value) {
        event.preventDefault();
        return;
    }
    const target = eventTarget(event);
    // The bar itself (its trigger toggles the popover) and nested picker layers keep it open.
    if (target && (barEl.value?.contains(target) || target.closest(NESTED_LAYERS))) {
        event.preventDefault();
    }
}

function onEscapeKeyDown(event: KeyboardEvent): void {
    if (busy.value) event.preventDefault();
}

// The form moves focus itself (Create button with a prefilled project, else the project picker).
function onOpenAutoFocus(event: Event): void {
    event.preventDefault();
}

// --- Placement: centred on the calendar grid (`.fc`), 16px above its visible bottom.
const gridEl = ref<HTMLElement | null>(null);
const placement = ref<{ left: number; bottom: number } | null>(null);

function measure(): void {
    if (!visible.value) return;
    const grid = document.querySelector<HTMLElement>('.fc');
    gridEl.value = grid;
    if (!grid) {
        placement.value = null;
        return;
    }
    const rect = grid.getBoundingClientRect();
    const visibleBottom = Math.min(window.innerHeight, rect.bottom);
    placement.value = {
        left: rect.left + rect.width / 2,
        bottom: Math.max(0, window.innerHeight - visibleBottom) + 16,
    };
}

watch(visible, (value) => {
    if (value) measure();
});
useEventListener(window, 'resize', measure);
useResizeObserver(gridEl, measure);

const placementStyle = computed(() =>
    placement.value
        ? { left: `${placement.value.left}px`, bottom: `${placement.value.bottom}px` }
        : { left: '50%', bottom: '16px' }
);
</script>

<template>
    <Teleport to="body">
        <div
            v-if="visible && labels"
            class="fixed z-40 -translate-x-1/2"
            :style="placementStyle"
            data-testid="outlook-selection-bar-position">
            <div
                ref="barEl"
                role="toolbar"
                :aria-label="labels.selection_label"
                class="flex h-12 items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-dropdown"
                data-testid="outlook-selection-bar">
                <span class="whitespace-nowrap text-[13px] font-normal tabular-nums">
                    {{ countText }}
                </span>
                <Popover v-model:open="popoverOpen">
                    <PopoverTrigger as-child>
                        <PrimaryButton
                            type="button"
                            :icon="ListChecks"
                            data-testid="outlook-selection-assign">
                            {{ assignText }}
                        </PrimaryButton>
                    </PopoverTrigger>
                    <PopoverContent
                        side="top"
                        align="center"
                        :side-offset="8"
                        class="w-96 p-4"
                        data-testid="outlook-batch-popover"
                        @interact-outside="onInteractOutside"
                        @escape-key-down="onEscapeKeyDown"
                        @open-auto-focus="onOpenAutoFocus">
                        <OutlookConvertForm
                            v-if="popoverOpen && batchMeetings.length > 0"
                            mode="batch"
                            :meetings="batchMeetings"
                            :labels="labels"
                            @busy="(value: boolean) => (busy = value)"
                            @done="onDone"
                            @cancel="onCancel" />
                    </PopoverContent>
                </Popover>
                <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    :aria-label="labels.clear_selection"
                    data-testid="outlook-selection-clear"
                    @click="clearSelection">
                    <X aria-hidden="true" />
                </Button>
            </div>
        </div>
    </Teleport>
</template>
