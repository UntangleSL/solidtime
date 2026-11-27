<script setup lang="ts">
import VChart, { THEME_KEY } from 'vue-echarts';
import { computed, onMounted, provide, ref, watch } from 'vue';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart } from 'echarts/charts';
import { GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { useCssVariable } from '@/packages/ui/src';
import { formatHoursNumber } from './format';
import { t, type LabelTree } from './labels';
import { formatMarginPercent } from './clientsApi';
import {
    clientMarginBars,
    clientMarginChartHeight,
    clientMarginOption,
    type ClientMarginBar,
    type ClientMarginEntry,
} from './clientMarginOption';

// ECharts setup copied from the core reporting chart (not imported: the fork keeps its own copy so
// upstream changes to that chart never reach this one). Colours follow the theme through the CSS
// variables, so the chart follows light, dark and the accent presets. The client table below the
// chart is its text alternative.
use([CanvasRenderer, BarChart, GridComponent, TooltipComponent, MarkLineComponent]);

provide(THEME_KEY, 'dark');

const props = defineProps<{
    clients: ClientMarginEntry[];
    /** The range label of the aria name ("This month"). */
    rangeLabel: string;
    labels: LabelTree | null | undefined;
    numberFormat?: string | null;
    /** Money in the organization's format (real minus for losses). */
    formatMoney: (cents: number) => string;
}>();

const accentColor = useCssVariable('--theme-color-chart');
const textColor = useCssVariable('--color-text-secondary');
const baselineColor = useCssVariable('--color-border-secondary');

// The loss colour is the status palette's red (text-red-700, dark:text-red-400), which has no CSS
// variable: a hidden probe with those classes gives the computed colour for the active theme. It is
// re-read whenever the theme variables change (light/dark switch).
const LOSS_FALLBACK = '#B91C1C';
const lossProbe = ref<HTMLElement | null>(null);
const lossColor = ref(LOSS_FALLBACK);

function readLossColor() {
    if (lossProbe.value === null) return;
    const color = getComputedStyle(lossProbe.value).color;
    lossColor.value = color && color.trim() !== '' ? color : LOSS_FALLBACK;
}

onMounted(readLossColor);
watch([textColor, accentColor], readLossColor);

function label(path: string, params?: Record<string, string | number>): string {
    return t(props.labels, path, params);
}

const barCount = computed(() => clientMarginBars(props.clients, '').length);
const height = computed(() => `${clientMarginChartHeight(barCount.value)}px`);

const ariaLabel = computed(() => label('money.margin_chart_aria', { range: props.rangeLabel }));

const option = computed(() =>
    clientMarginOption({
        clients: props.clients,
        colors: {
            accent: accentColor.value,
            loss: lossColor.value,
            text: textColor.value,
            baseline: baselineColor.value,
        },
        labels: {
            other: label('money.other_clients'),
            tooltip: (bar: ClientMarginBar) =>
                label('money.margin_chart_tooltip', {
                    client: bar.name,
                    margin: props.formatMoney(bar.margin_cents),
                    pct: formatMarginPercent(bar.margin_percent),
                    amount: props.formatMoney(bar.amount_cents),
                    cost: props.formatMoney(bar.cost_cents),
                }),
            incomplete: (bar: ClientMarginBar) =>
                label('money.incomplete_chart_tooltip', {
                    n: formatHoursNumber(bar.unpriced_cost_seconds, props.numberFormat),
                }),
        },
        formatMoney: props.formatMoney,
    })
);
</script>

<template>
    <div
        role="img"
        :aria-label="ariaLabel"
        class="w-[calc(100%-1px)]"
        data-testid="profitability-client-margin-chart">
        <span
            ref="lossProbe"
            class="hidden text-red-700 dark:text-red-400"
            aria-hidden="true"></span>
        <v-chart
            :autoresize="true"
            class="client-margin-chart"
            :style="{ height }"
            :option="option" />
    </div>
</template>

<style scoped>
.client-margin-chart {
    background: transparent;
}
</style>
