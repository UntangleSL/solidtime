<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import { TriangleAlert } from '@lucide/vue';
import Button from '@/packages/ui/src/Buttons/Button.vue';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/packages/ui/src/tooltip';
import { countAria, countLabel } from './syncFlagReason';
import { OUTLOOK_MEETINGS_KEY } from './useOutlookMeetings';

// Toolbar counter "N out of sync" (Phase 6, D-09, D-10, D-11, UI-SPEC section 3): how many of the
// user's entries wait for a decision across the whole flagged window (future plus the last 60 days,
// the server's list, not only the visible days), and one click to the first of them. Hidden, not
// disabled, at 0 and while the context cannot act (impersonation, D-14); the composable serves no
// flags while disconnected from Microsoft (D-19).
const context = inject(OUTLOOK_MEETINGS_KEY, null);

const labels = computed(() => context?.labels.value ?? null);
const canAct = computed(() => context?.canAct?.value === true);
const count = computed(() => context?.outOfSync?.value.length ?? 0);
const visible = computed(() => labels.value !== null && canAct.value && count.value > 0);

// Busy from the click until the jump settles: the composable's flag, plus a local one so a click
// that lands before the composable marks itself busy is never sent twice.
const clicking = ref(false);
const busy = computed(() => clicking.value || context?.jumpBusy?.value === true);

const label = computed(() => (labels.value ? countLabel(count.value, labels.value) : ''));
const ariaLabel = computed(() => (labels.value ? countAria(count.value, labels.value) : ''));

// The words around the number, shown from md on; below md only the number stays. Null when the
// copy does not contain the number (the whole label is then shown from md on instead).
const parts = computed(() => {
    const number = String(count.value);
    const at = label.value.indexOf(number);
    if (at === -1) return null;
    return {
        before: label.value.slice(0, at),
        after: label.value.slice(at + number.length),
    };
});

async function onClick(): Promise<void> {
    if (!context || busy.value) return;
    clicking.value = true;
    try {
        await context.jumpToFirst();
    } finally {
        clicking.value = false;
    }
}
</script>

<template>
    <TooltipProvider v-if="visible && labels" :delay-duration="300">
        <Tooltip>
            <TooltipTrigger as-child>
                <span class="inline-flex">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="outlook-out-of-sync"
                        class="h-8 px-2 md:px-3"
                        :data-count="count"
                        :aria-label="ariaLabel"
                        :aria-busy="busy ? 'true' : 'false'"
                        @click="onClick">
                        <TriangleAlert
                            class="text-amber-700 dark:text-amber-400"
                            aria-hidden="true" />
                        <span v-if="parts" class="tabular-nums"
                            ><span v-if="parts.before" class="hidden md:inline">{{
                                parts.before
                            }}</span
                            ><span data-testid="outlook-out-of-sync-count">{{ count }}</span
                            ><span v-if="parts.after" class="hidden md:inline">{{
                                parts.after
                            }}</span></span
                        >
                        <template v-else>
                            <span
                                data-testid="outlook-out-of-sync-count"
                                class="tabular-nums md:hidden">
                                {{ count }}
                            </span>
                            <span class="hidden md:inline">{{ label }}</span>
                        </template>
                    </Button>
                </span>
            </TooltipTrigger>
            <TooltipContent data-testid="outlook-out-of-sync-tooltip">
                <p>{{ labels.osync_count_tooltip }}</p>
            </TooltipContent>
        </Tooltip>
    </TooltipProvider>
</template>
