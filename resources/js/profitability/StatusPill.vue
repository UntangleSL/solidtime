<script setup lang="ts">
import { computed, type Component } from 'vue';
import { CircleCheck, CircleDashed, Info, Lock, OctagonAlert, TriangleAlert } from '@lucide/vue';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/packages/ui/src/tooltip';
import { t, type LabelTree } from './labels';

// Status is always icon + text + colour, never colour alone (UI-SPEC UI-D2, WCAG 1.4.1). Colours are
// on text and icon only: no fill, no border. Light mode uses the 800/700 steps (the 700 green and
// amber steps fall under 4.5:1 on hover rows and the sidebar).
const props = defineProps<{
    status: string;
    labels: LabelTree | null | undefined;
}>();

interface Look {
    icon: Component;
    tone: string;
}

const NEUTRAL = 'text-text-secondary';
const LOOKS: Record<string, Look> = {
    on_track: { icon: CircleCheck, tone: 'text-green-800 dark:text-green-400' },
    at_risk: { icon: TriangleAlert, tone: 'text-amber-800 dark:text-amber-400' },
    over: { icon: OctagonAlert, tone: 'text-red-700 dark:text-red-400' },
    below_target: { icon: OctagonAlert, tone: 'text-red-700 dark:text-red-400' },
    not_started: { icon: CircleDashed, tone: NEUTRAL },
    no_contract: { icon: CircleDashed, tone: NEUTRAL },
    closed: { icon: Lock, tone: NEUTRAL },
    incomplete: { icon: Info, tone: NEUTRAL },
};

// Only these statuses carry an explanation in the copy (status_tooltip).
const EXPLAINED = ['on_track', 'at_risk', 'over'];

const look = computed<Look>(() => LOOKS[props.status] ?? { icon: Info, tone: NEUTRAL });
const label = computed(() => t(props.labels, `status.${props.status}`));
const tooltip = computed(() =>
    EXPLAINED.includes(props.status) ? t(props.labels, `status_tooltip.${props.status}`) : null
);
const pillClass = computed(
    () => `inline-flex items-center gap-1 text-xs font-semibold ${look.value.tone}`
);
</script>

<template>
    <TooltipProvider v-if="tooltip" :delay-duration="300">
        <Tooltip>
            <TooltipTrigger as-child>
                <span
                    data-testid="profitability-status"
                    :data-status="status"
                    tabindex="0"
                    :class="pillClass">
                    <component :is="look.icon" class="size-3.5 shrink-0" aria-hidden="true" />
                    <span>{{ label }}</span>
                </span>
            </TooltipTrigger>
            <TooltipContent data-testid="profitability-status-tooltip">
                <p>{{ tooltip }}</p>
            </TooltipContent>
        </Tooltip>
    </TooltipProvider>
    <span v-else data-testid="profitability-status" :data-status="status" :class="pillClass">
        <component :is="look.icon" class="size-3.5 shrink-0" aria-hidden="true" />
        <span>{{ label }}</span>
    </span>
</template>
