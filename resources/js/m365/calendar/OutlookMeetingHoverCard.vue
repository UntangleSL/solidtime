<script setup lang="ts">
import { HoverCardContent, HoverCardPortal } from 'reka-ui';
import type { OutlookCalendarLabels, OutlookMeeting } from '@/m365/types';
import OutlookMeetingSummary from './OutlookMeetingSummary.vue';

// Hover card of one Outlook meeting (03.1-UI-SPEC section 2, UX-03 / D-05). Thin wrapper over reka
// HoverCardPortal / HoverCardContent styled like PopoverContent; it must sit inside a HoverCardRoot
// supplied by the caller. Supplemental only: no role, not focus-trapped (the block's aria-label and
// the click panel carry everything). Phase 4 adds "Create time entry / Assign to project" through
// the `actions` slot.
//
// `reference` anchors the card to the meeting block: the block's HoverCardTrigger sits inside the
// panel's Popover, whose Popper context captures the trigger's anchor, so the card's own Popper root
// would otherwise have no anchor to position against.
defineProps<{
    meeting: OutlookMeeting;
    labels: OutlookCalendarLabels;
    reference?: HTMLElement | null;
}>();
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
                {{ labels.hover_hint }}
            </p>
            <div v-if="$slots.actions" class="mt-3 flex justify-end gap-2">
                <slot name="actions" />
            </div>
        </HoverCardContent>
    </HoverCardPortal>
</template>
