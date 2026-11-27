<script setup lang="ts">
import { computed } from 'vue';
import { formatHours } from './format';
import { t, type LabelTree } from './labels';

// Budget meter (UI-SPEC UI-D6). The track is scaled to max(sold, consumed, projected), so it equals
// the hours sold while everything fits. Consumed is the accent fill. The rest of the projection is a
// 40 % striped accent segment: the texture, not the colour, separates it from consumed. The budget
// tick marks the hours sold; it is labelled only when the track is scaled past them. Consumption
// beyond the tick switches to the over colour.
const props = defineProps<{
    soldSeconds: number;
    consumedSeconds: number;
    projectedSeconds?: number | null;
    status: string;
    variant: 'full' | 'compact';
    closed?: boolean;
    labels: LabelTree | null | undefined;
    numberFormat?: string | null;
}>();

const sold = computed(() => Math.max(0, props.soldSeconds));
const consumed = computed(() => Math.max(0, props.consumedSeconds));
// A closed period has no projection left: it ends where consumption ended.
const projected = computed(() =>
    props.closed || props.projectedSeconds == null
        ? consumed.value
        : Math.max(0, props.projectedSeconds)
);
const scale = computed(() => Math.max(sold.value, consumed.value, projected.value));

function percent(seconds: number): number {
    return scale.value > 0 ? (seconds / scale.value) * 100 : 0;
}

function css(value: number): string {
    return `${Number(value.toFixed(3))}%`;
}

const soldPct = computed(() => percent(sold.value));
const withinPct = computed(() => percent(Math.min(consumed.value, sold.value)));
const overPct = computed(() =>
    consumed.value > sold.value ? percent(consumed.value - sold.value) : 0
);
const consumedPct = computed(() => percent(consumed.value));
const projectedPct = computed(() =>
    projected.value > consumed.value ? percent(projected.value - consumed.value) : 0
);
const scaledPastSold = computed(() => scale.value > sold.value);

function hours(seconds: number): string {
    return formatHours(seconds, props.numberFormat);
}

// ARIA numbers are decimal hours (one decimal), the same quantity the copy shows.
function hourValue(seconds: number): number {
    return Math.round(seconds / 360) / 10;
}

const valueText = computed(() =>
    t(props.labels, 'summary.meter_valuetext', {
        consumed: hours(consumed.value),
        sold: hours(sold.value),
        projected: hours(projected.value),
        status: t(props.labels, `status.${props.status}`),
    })
);
const tickLabel = computed(() =>
    scaledPastSold.value
        ? t(props.labels, 'summary.meter_sold_tick', { h: hours(sold.value) })
        : null
);

const compact = computed(() => props.variant === 'compact');
</script>

<template>
    <div
        role="meter"
        class="w-full"
        aria-valuemin="0"
        :aria-valuemax="hourValue(sold)"
        :aria-valuenow="hourValue(consumed)"
        :aria-valuetext="valueText"
        :data-variant="variant"
        :data-scale-seconds="scale">
        <div class="relative" :class="tickLabel ? 'pt-5' : ''">
            <span
                v-if="tickLabel"
                data-testid="profitability-meter-tick-label"
                class="absolute top-0 -translate-x-1/2 whitespace-nowrap text-xs text-text-secondary tabular-nums"
                aria-hidden="true"
                :style="{ left: css(soldPct) }">
                {{ tickLabel }}
            </span>
            <div class="relative">
                <div
                    data-testid="profitability-meter-track"
                    class="relative w-full overflow-hidden rounded-full bg-quaternary"
                    :class="compact ? 'h-1' : 'h-2'">
                    <div
                        data-testid="profitability-meter-consumed"
                        class="absolute inset-y-0 left-0 rounded-l-full bg-accent-400 dark:bg-accent-200 motion-safe:transition-[width] duration-200"
                        :style="{ width: css(withinPct) }"></div>
                    <div
                        v-if="overPct > 0"
                        data-testid="profitability-meter-over"
                        class="absolute inset-y-0 bg-red-700 dark:bg-red-400 motion-safe:transition-[width] duration-200"
                        :style="{ left: css(soldPct), width: css(overPct) }"></div>
                    <div
                        v-if="projectedPct > 0"
                        data-testid="profitability-meter-projected"
                        class="absolute inset-y-0 text-accent-400 dark:text-accent-200 opacity-40 bg-[repeating-linear-gradient(45deg,currentColor_0_2px,transparent_2px_6px)] motion-safe:transition-[width] duration-200"
                        :style="{ left: css(consumedPct), width: css(projectedPct) }"></div>
                </div>
                <div
                    data-testid="profitability-meter-tick"
                    class="absolute top-1/2 -translate-y-1/2 w-0.5 bg-text-primary"
                    :class="compact ? 'h-3' : 'h-4'"
                    :style="{ left: `calc(${css(soldPct)} - 1px)` }"
                    aria-hidden="true"></div>
            </div>
        </div>
    </div>
</template>
