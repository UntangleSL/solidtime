import type { EChartsOption } from 'echarts';
import type { PeopleViewRow } from './peopleApi';

// "Chargeability vs target" chart of the People view (UI-SPEC, D-13). Pure: the component reads the
// theme colours and copy and passes them in, so the option can be checked without a canvas. The
// table under the chart is its text alternative.

export interface ChargeabilityColors {
    /** `--theme-color-chart`, an "r, g, b" triple (as ReportingChart reads it). */
    accent: string;
    /** `--color-text-tertiary`: the target tick (a reference mark, never the accent). */
    target: string;
    /** `--color-text-secondary`: axis, legend and value-label text. */
    text: string;
    /** `--color-border-tertiary`: gridlines. */
    grid: string;
}

export interface ChargeabilityLabels {
    chargeability: string;
    target: string;
    /** The `admin.people.chart_tooltip` copy of one person. */
    tooltip: (row: PeopleViewRow) => string;
}

export interface ChargeabilityInput {
    people: PeopleViewRow[];
    colors: ChargeabilityColors;
    labels: ChargeabilityLabels;
}

/** Bar rows are 32px; the axis and legend take 48px (UI-SPEC Spacing). */
export const ROW_HEIGHT = 32;
export const AXIS_HEIGHT = 48;

export function chargeabilityChartHeight(rows: number): number {
    return rows * ROW_HEIGHT + AXIS_HEIGHT;
}

/**
 * The people the chart plots: those with a working week (available hours known) and a ratio. People
 * without a working week stay in the table with the "Set in Settings" link and are not plotted.
 */
export function plottedPeople(people: PeopleViewRow[]): PeopleViewRow[] {
    return people.filter((row) => row.available_seconds !== null && row.chargeability !== null);
}

const FONT = { fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 400 } as const;

const AXIS_LABELS = [0, 50, 100];

/** Longer names are cut on the axis; the tooltip carries the full name. */
const NAME_LIMIT = 24;

const HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

/** ECharts writes an HTML tooltip with innerHTML: a person's name is user data, so it is escaped. */
export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

function percentValue(ratio: number): number {
    return Math.round(ratio * 1000) / 10;
}

function truncate(name: string): string {
    return name.length > NAME_LIMIT ? `${name.slice(0, NAME_LIMIT - 1)}…` : name;
}

export function chargeabilityOption(input: ChargeabilityInput): EChartsOption {
    const { colors, labels } = input;
    const people = plottedPeople(input.people);
    const values = people.map((row) => percentValue(row.chargeability ?? 0));
    const targets = people.map((row) => row.target_percent);
    const max = Math.max(100, ...values, ...targets.map((target) => target ?? 0));

    return {
        backgroundColor: 'transparent',
        textStyle: { ...FONT, color: colors.text },
        grid: { top: 28, right: 48, bottom: 0, left: 0, containLabel: true },
        legend: {
            top: 0,
            right: 0,
            itemWidth: 12,
            itemHeight: 12,
            textStyle: { ...FONT, color: colors.text },
            data: [
                { name: labels.chargeability, icon: 'rect' },
                // A thin upright tick, as drawn on the rows (aspect kept inside the 12px box)
                { name: labels.target, icon: 'path://M0 0h2v12h-2z' },
            ],
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            textStyle: { ...FONT },
            formatter: (params: unknown) => {
                const first = Array.isArray(params) ? params[0] : params;
                const index = (first as { dataIndex?: number } | undefined)?.dataIndex ?? -1;
                const row = people[index];
                return row ? escapeHtml(labels.tooltip(row)) : '';
            },
        },
        xAxis: {
            type: 'value',
            min: 0,
            max,
            interval: 50,
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: {
                ...FONT,
                color: colors.text,
                // Only 0 %, 50 % and 100 %, whatever the stretched maximum is
                formatter: (value: number) => (AXIS_LABELS.includes(value) ? `${value} %` : ''),
            },
            splitLine: { lineStyle: { color: colors.grid } },
        },
        yAxis: {
            type: 'category',
            inverse: true,
            data: people.map((row) => row.name),
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { ...FONT, color: colors.text, formatter: truncate },
        },
        series: [
            {
                type: 'bar',
                name: labels.chargeability,
                data: values,
                barWidth: 16,
                z: 2,
                itemStyle: {
                    color: `rgba(${colors.accent}, 0.85)`,
                    borderRadius: [0, 4, 4, 0],
                },
                label: {
                    show: true,
                    position: 'right',
                    ...FONT,
                    color: colors.text,
                    formatter: (params: { value?: unknown }) =>
                        `${Math.round(Number(params.value ?? 0))} %`,
                },
            },
            {
                // A reference mark, not a category: the target sits on the person's row, above the bar.
                type: 'scatter',
                name: labels.target,
                // [x, category index] pairs, so each tick lands on its person's row
                data: targets.flatMap((target, index) =>
                    target === null ? [] : [[target, index]]
                ),
                symbol: 'rect',
                symbolSize: [2, 16],
                z: 3,
                itemStyle: { color: colors.target },
            },
        ],
    };
}
