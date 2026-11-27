<script setup lang="ts">
import VChart, { THEME_KEY } from 'vue-echarts';
import { computed, provide, ref } from 'vue';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { useElementSize } from '@vueuse/core';
import { useCssVariable } from '@/packages/ui/src';
import { formatHours, formatHoursNumber, formatMonth, formatPeriod } from './format';
import { t, type LabelTree } from './labels';
import { monthDifference, plannedVsConsumedOption } from './plannedVsConsumedOption';
import type { SummaryMonth } from './summaryApi';

// ECharts setup copied from the core reporting chart (not imported: the fork keeps its own copy so
// upstream changes to that chart never reach this one). Colours follow the theme through the CSS
// variables, so the chart follows light, dark and the accent presets.
use([CanvasRenderer, BarChart, GridComponent, TooltipComponent, LegendComponent]);

provide(THEME_KEY, 'dark');

const props = defineProps<{
    months: SummaryMonth[];
    /** Today's month as "YYYY-MM-01"; null marks no month. */
    currentMonth: string | null;
    startsOn: string;
    endsOn: string;
    labels: LabelTree | null | undefined;
    numberFormat?: string | null;
}>();

const accentColor = useCssVariable('--theme-color-chart');
const textColor = useCssVariable('--color-text-secondary');
const strongTextColor = useCssVariable('--color-text-primary');
const plannedColor = useCssVariable('--color-text-tertiary');
const gridColor = useCssVariable('--color-border-tertiary');

const container = ref<HTMLElement | null>(null);
const { width } = useElementSize(container);

function label(path: string, params?: Record<string, string | number>): string {
    return t(props.labels, path, params);
}

function hours(seconds: number): string {
    return formatHours(seconds, props.numberFormat);
}

function differenceText(month: SummaryMonth): string {
    const result = monthDifference(month.planned_seconds, month.consumed_seconds);
    if (result.kind === 'on_plan') return label('common.on_plan');
    const n = formatHoursNumber(result.seconds, props.numberFormat);
    return label(result.kind === 'over' ? 'common.hours_over' : 'common.hours_left', { n });
}

const ariaLabel = computed(() =>
    label('summary.chart_aria', { period: formatPeriod(props.startsOn, props.endsOn) })
);

const option = computed(() =>
    plannedVsConsumedOption({
        months: props.months,
        currentMonth: props.currentMonth,
        colors: {
            accent: accentColor.value,
            planned: plannedColor.value,
            text: textColor.value,
            textStrong: strongTextColor.value,
            grid: gridColor.value,
        },
        labels: {
            planned: label('summary.chart_planned'),
            consumed: label('summary.chart_consumed'),
            tooltip: (month) =>
                label('summary.chart_tooltip', {
                    month: formatMonth(month.month),
                    planned: hours(month.planned_seconds),
                    consumed: hours(month.consumed_seconds),
                    difference: differenceText(month),
                }),
        },
        // Before the first measure (width 0) keep the long labels.
        compactLabels: width.value > 0 && width.value < 640,
        formatHours: hours,
    })
);
</script>

<template>
    <div
        ref="container"
        role="img"
        :aria-label="ariaLabel"
        class="w-[calc(100%-1px)]"
        data-testid="profitability-planned-chart">
        <v-chart :autoresize="true" class="planned-chart" :option="option" />
    </div>
</template>

<style scoped>
.planned-chart {
    height: 240px;
    background: transparent;
}
</style>
