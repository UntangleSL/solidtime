<script setup lang="ts">
import { computed, inject, ref, useId, watch, type ComputedRef } from 'vue';
import { TriangleAlert } from '@lucide/vue';
import type { Organization } from '@/packages/api/src';
import { describeBlock } from './describeBlock';
import { flagDescribed, flagReason } from './syncFlagReason';
import { OUTLOOK_MEETINGS_KEY } from './useOutlookMeetings';

// Out-of-sync marker of a time entry whose Outlook meeting moved, was cancelled or was removed
// (Phase 6 UI-SPEC section 1, D-08, OSYNC-03). Rendered through the core `event-extra` slot right
// after the Phase 4 origin icon, only while the entry has a flag and the context can act.
// It sits inside the core block (role="button", drag on pointerdown, edit modal on click), so it is
// a plain span, not focusable and without a role: pointerdown and click stop here and the click
// asks for the resolve popover anchored to the entry; the keyboard paths are the entry context
// menu and the toolbar counter. The block's aria-label hides inner text, so the reason reaches
// screen readers through a hidden description attached to the block's aria-describedby.
// Every text is interpolated (no markup); the marker never sets aria-busy (the popover owns it).
const props = defineProps<{
    timeEntryId: string;
}>();

const context = inject(OUTLOOK_MEETINGS_KEY, null);
const organization = inject<ComputedRef<Organization | undefined> | undefined>(
    'organization',
    undefined
);
const timeFormat = computed(() => organization?.value?.time_format ?? '24-hours');

const labels = computed(() => context?.labels.value ?? null);

const flag = computed(() => {
    if (!context || context.canAct.value !== true) return null;
    return context.flagOf?.(props.timeEntryId) ?? null;
});

const title = computed(() => {
    if (!flag.value || !labels.value) return '';
    const reason = flagReason(flag.value, labels.value, timeFormat.value);
    return `${reason}\n${labels.value.osync_click_hint}`;
});

const described = computed(() =>
    flag.value && labels.value ? flagDescribed(flag.value, labels.value, timeFormat.value) : ''
);

const descriptionId = `outlook-sync-flag-${useId()}`;
const descriptionEl = ref<HTMLElement | null>(null);

// Attach the description to the closest core block while it is rendered; the remover runs when
// the marker goes away (flag resolved, context lost) or unmounts.
watch(
    descriptionEl,
    (el, _previous, onCleanup) => {
        if (!el) return;
        onCleanup(describeBlock(el, descriptionId));
    },
    { flush: 'post' }
);

function onClick(): void {
    if (!context || !flag.value) return;
    context.openFlagPanel(props.timeEntryId, { anchor: 'entry', origin: 'entry' });
}
</script>

<template>
    <span
        v-if="flag && labels"
        data-testid="outlook-sync-flag-marker"
        :data-flag-kind="flag.kind"
        class="relative inline-flex shrink-0 cursor-pointer items-center before:absolute before:-inset-1 before:content-['']"
        :title="title"
        @pointerdown.stop
        @click.stop="onClick()">
        <TriangleAlert
            class="size-3 shrink-0 text-amber-700 fill-amber-100 dark:text-amber-300 dark:fill-amber-950"
            aria-hidden="true" />
        <span :id="descriptionId" ref="descriptionEl" hidden>{{ described }}</span>
    </span>
</template>
