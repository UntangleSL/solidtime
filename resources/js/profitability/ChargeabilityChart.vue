<script setup lang="ts">
import VChart, { THEME_KEY } from 'vue-echarts';
import { computed, provide } from 'vue';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { useCssVariable } from '@/packages/ui/src';
import {
    chargeabilityChartHeight,
    chargeabilityOption,
    plottedPeople,
} from './chargeabilityOption';
import { formatHours, formatPercent } from './format';
import { t, type LabelTree } from './labels';
import type { PeopleViewRow } from './peopleApi';

// ECharts setup copied from the core reporting chart (not imported: the fork keeps its own copy so
// upstream changes to that chart never reach this one). Colours follow the theme through the CSS
// variables, so the chart follows light, dark and the accent presets.
use([CanvasRenderer, BarChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent]);

provide(THEME_KEY, 'dark');

const props = defineProps<{
    people: PeopleViewRow[];
    /** The selected range's label ("This month"), for the accessible name. */
    rangeLabel: string;
    labels: LabelTree | null | undefined;
    numberFormat?: string | null;
}>();

const accentColor = useCssVariable('--theme-color-chart');
const textColor = useCssVariable('--color-text-secondary');
const targetColor = useCssVariable('--color-text-tertiary');
const gridColor = useCssVariable('--color-border-tertiary');

function label(path: string, params?: Record<string, string | number>): string {
    return t(props.labels, path, params);
}

function hours(seconds: number): string {
    return formatHours(seconds, props.numberFormat);
}

const rows = computed(() => plottedPeople(props.people).length);
const height = computed(() => `${chargeabilityChartHeight(rows.value)}px`);

const ariaLabel = computed(() => label('admin.people.chart_aria', { range: props.rangeLabel }));

const option = computed(() =>
    chargeabilityOption({
        people: props.people,
        colors: {
            accent: accentColor.value,
            target: targetColor.value,
            text: textColor.value,
            grid: gridColor.value,
        },
        labels: {
            chargeability: label('admin.people.chart_legend_chargeability'),
            target: label('admin.people.chart_legend_target'),
            tooltip: (row) =>
                label('admin.people.chart_tooltip', {
                    name: row.name,
                    pct: formatPercent(row.chargeability ?? 0),
                    target:
                        row.target_percent === null
                            ? '--'
                            : formatPercent(row.target_percent / 100),
                    billable: hours(row.billable_seconds),
                    available: hours(row.available_seconds ?? 0),
                }),
        },
    })
);
</script>

<template>
    <div
        role="img"
        :aria-label="ariaLabel"
        class="w-[calc(100%-1px)]"
        data-testid="profitability-chargeability-chart">
        <v-chart
            :autoresize="true"
            class="chargeability-chart"
            :style="{ height }"
            :option="option" />
    </div>
</template>

<style scoped>
.chargeability-chart {
    background: transparent;
}
</style>
