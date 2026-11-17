<script setup lang="ts">
import { computed, inject } from 'vue';
import { Check, ClockPlus, Pencil } from '@lucide/vue';
import { HoverCardContent, HoverCardPortal } from 'reka-ui';
import PrimaryButton from '@/packages/ui/src/Buttons/PrimaryButton.vue';
import SecondaryButton from '@/packages/ui/src/Buttons/SecondaryButton.vue';
import type { OutlookCalendarLabels, OutlookMeeting } from '@/m365/types';
import OutlookMeetingSummary from './OutlookMeetingSummary.vue';
import { OUTLOOK_MEETINGS_KEY } from './useOutlookMeetings';
import { isPreassigned } from './suggestions';

// Hover card of one Outlook meeting (03.1-UI-SPEC section 2, UX-03 / D-05; Phase 4 UI-SPEC
// sections 1-2). Thin wrapper over reka HoverCardPortal / HoverCardContent styled like
// PopoverContent; it must sit inside a HoverCardRoot supplied by the caller. Supplemental only: no
// role, not focus-trapped (the block's aria-label and the click panel carry everything).
//
// When the Outlook context can act, the card offers "Create time entry": it asks the context for
// the meeting's form, and the lane closes this card and opens the meeting's panel in form mode. The
// card itself never hosts inputs (D-17). The hint then also names the multi-select modifier.
// A pre-assigned meeting (Phase 5, D-03) offers Edit (the same form channel) and a one-click Confirm
// instead; the card may close while the confirm runs, the block and the toast carry the outcome.
//
// `reference` anchors the card to the meeting block: the block's HoverCardTrigger sits inside the
// panel's Popover, whose Popper context captures the trigger's anchor, so the card's own Popper root
// would otherwise have no anchor to position against.
const props = defineProps<{
    meeting: OutlookMeeting;
    labels: OutlookCalendarLabels;
    reference?: HTMLElement | null;
}>();

const context = inject(OUTLOOK_MEETINGS_KEY, null);
const canAct = computed(() => context?.canAct.value === true);

// Same detection as the core zoom tooltip (CalendarZoomControls): the hint names ⌘ on macOS.
function isMacPlatform(): boolean {
    if (typeof navigator === 'undefined') return false;
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.userAgentData?.platform || nav.platform || '';
    return /mac/i.test(platform);
}

const hint = computed(() => {
    if (!canAct.value) return props.labels.hover_hint;
    return isMacPlatform() ? props.labels.hover_hint_select_mac : props.labels.hover_hint_select;
});

const preassigned = computed(() => canAct.value && isPreassigned(props.meeting));
const confirmPending = computed(
    () => preassigned.value && context?.isConfirmPending(props.meeting.id) === true
);

function onCreate(): void {
    if (!canAct.value) return;
    context?.openForm(props.meeting.id);
}

function onConfirm(): void {
    if (!preassigned.value || confirmPending.value) return;
    void context?.confirmOne(props.meeting.id);
}
</script>

<template>
    <HoverCardPortal>
        <HoverCardContent
            side="right"
            align="start"
            :side-offset="8"
            avoid-collisions
            :reference="reference ?? undefined"
            data-testid="outlook-hover-card"
            class="z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2">
            <OutlookMeetingSummary
                :meeting="meeting"
                :labels="labels"
                testid-prefix="outlook-hover">
                <template #meta>
                    <slot name="meta" />
                </template>
            </OutlookMeetingSummary>
            <p class="mt-3 text-xs text-text-tertiary" data-testid="outlook-hover-hint">
                {{ hint }}
            </p>
            <div v-if="preassigned" class="mt-4 flex justify-end gap-2">
                <slot name="actions" />
                <SecondaryButton :icon="Pencil" data-testid="outlook-hover-edit" @click="onCreate">
                    {{ labels.edit }}
                </SecondaryButton>
                <PrimaryButton
                    type="button"
                    :icon="Check"
                    :loading="confirmPending"
                    data-testid="outlook-hover-confirm"
                    @click="onConfirm">
                    {{ labels.confirm }}
                </PrimaryButton>
            </div>
            <div v-else-if="canAct || $slots.actions" class="mt-3 flex justify-end gap-2">
                <slot name="actions" />
                <PrimaryButton
                    v-if="canAct"
                    type="button"
                    :icon="ClockPlus"
                    data-testid="outlook-hover-create"
                    @click="onCreate">
                    {{ labels.create_entry }}
                </PrimaryButton>
            </div>
        </HoverCardContent>
    </HoverCardPortal>
</template>
