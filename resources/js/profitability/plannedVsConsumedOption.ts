import dayjs from 'dayjs';
import type { EChartsOption } from 'echarts';
import type { SummaryMonth } from './summaryApi';

// Planned-vs-consumed chart of a contract period (UI-SPEC UI-D7). Pure: the component reads the theme
// colours and copy and passes them in, so the option can be checked without a canvas. One hours axis
// only: money never reaches this chart (it stays in the KPI tiles).

export interface PlannedVsConsumedColors {
    /** `--theme-color-chart`, an "r, g, b" triple (as ReportingChart reads it). */
    accent: string;
    /** `--color-text-tertiary`: the planned reference outline. */
    planned: string;
    /** `--color-text-secondary`: axis and legend text. */
    text: string;
    /** `--color-text-primary`: the current month label. */
    textStrong: string;
    /** `--color-border-tertiary`: gridlines. */
    grid: string;
}

export interface PlannedVsConsumedLabels {
    planned: string;
    consumed: string;
    /** The `summary.chart_tooltip` copy of one month. */
    tooltip: (month: SummaryMonth) => string;
}

export interface PlannedVsConsumedInput {
    months: SummaryMonth[];
    /** Today's month as "YYYY-MM-01"; its label is drawn bold. Null marks no month. */
    currentMonth: string | null;
    colors: PlannedVsConsumedColors;
    labels: PlannedVsConsumedLabels;
    /** Containers under 640px label months "MMM YY" so twelve of them fit. */
    compactLabels: boolean;
    /** Axis labels ("40 h"); defaults to whole hours. */
    formatHours?: (seconds: number) => string;
}

export interface MonthDifference {
    kind: 'left' | 'on_plan' | 'over';
    /** Magnitude in seconds (0 when on plan). */
    seconds: number;
}

/**
 * Planned minus consumed of one month. A gap that rounds to 0.0 h (the precision the copy shows)
 * is "On plan", never "0 h left".
 */
export function monthDifference(plannedSeconds: number, consumedSeconds: number): MonthDifference {
    const difference = plannedSeconds - consumedSeconds;
    if (Math.round(Math.abs(difference) / 360) === 0) return { kind: 'on_plan', seconds: 0 };
    return difference > 0
        ? { kind: 'left', seconds: difference }
        : { kind: 'over', seconds: -difference };
}

const FONT = { fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 400 } as const;

function hoursValue(seconds: number): number {
    return Math.round(seconds / 360) / 10;
}

export function plannedVsConsumedOption(input: PlannedVsConsumedInput): EChartsOption {
    const { months, currentMonth, colors, labels, compactLabels } = input;
    const formatHours = input.formatHours ?? ((seconds: number) => `${hoursValue(seconds)} h`);
    const monthFormat = compactLabels ? 'MMM YY' : 'MMM YYYY';
    const currentIndex =
        currentMonth === null
            ? -1
            : months.findIndex((month) => month.month.slice(0, 7) === currentMonth.slice(0, 7));

    return {
        backgroundColor: 'transparent',
        textStyle: { ...FONT, color: colors.text },
        grid: { top: 32, right: 8, bottom: 32, left: 48 },
        legend: {
            top: 0,
            right: 0,
            itemWidth: 12,
            itemHeight: 12,
            textStyle: { ...FONT, color: colors.text },
            data: [
                {
                    name: labels.planned,
                    itemStyle: {
                        color: 'transparent',
                        borderColor: colors.planned,
                        borderWidth: 2,
                        borderType: 'dashed',
                    },
                },
                { name: labels.consumed },
            ],
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            textStyle: { ...FONT },
            formatter: (params: unknown) => {
                const first = Array.isArray(params) ? params[0] : params;
                const index = (first as { dataIndex?: number } | undefined)?.dataIndex ?? -1;
                const month = months[index];
                return month ? labels.tooltip(month) : '';
            },
        },
        xAxis: {
            type: 'category',
            data: months.map((month) => dayjs(month.month.slice(0, 10)).format(monthFormat)),
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: {
                ...FONT,
                color: colors.text,
                interval: 0,
                rotate: 0,
                formatter: (value: string, index: number) =>
                    index === currentIndex ? `{current|${value}}` : value,
                rich: {
                    current: { ...FONT, color: colors.textStrong, fontWeight: 600 },
                },
            },
        },
        yAxis: {
            type: 'value',
            splitNumber: 3,
            axisLabel: {
                ...FONT,
                color: colors.text,
                formatter: (value: number) => formatHours(value * 3600),
            },
            splitLine: { lineStyle: { color: colors.grid } },
        },
        series: [
            {
                type: 'bar',
                name: labels.consumed,
                data: months.map((month) => hoursValue(month.consumed_seconds)),
                barMaxWidth: 32,
                z: 2,
                itemStyle: {
                    color: `rgba(${colors.accent}, 0.85)`,
                    borderRadius: [4, 4, 0, 0],
                },
            },
            {
                // A reference mark, not a category: a dashed outline on the consumed slot, drawn
                // above it, so an over-plan month shows its bar rising out of the box.
                type: 'bar',
                name: labels.planned,
                data: months.map((month) => hoursValue(month.planned_seconds)),
                barMaxWidth: 32,
                barGap: '-100%',
                z: 3,
                itemStyle: {
                    color: 'transparent',
                    borderColor: colors.planned,
                    borderWidth: 2,
                    borderType: 'dashed',
                },
            },
        ],
    };
}
