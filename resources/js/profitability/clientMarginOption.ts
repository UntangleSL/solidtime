import type { EChartsOption } from 'echarts';

// "Margin by client" chart of the Clients view (UI-SPEC "Chart: Margin by client", D-19). Pure: the
// component reads the theme colours and copy and passes them in, so the option can be checked
// without a canvas. One horizontal bar per client, sorted by margin descending, gains in the accent
// and losses in the loss colour; the sign in the value label carries the polarity, so no legend.

export interface ClientMarginEntry {
    /** Stable key (client id, or a fixed key for the "No client" bucket). */
    key: string;
    /** Display name, already resolved ("No client" for the bucket). */
    name: string;
    margin_cents: number;
    amount_cents: number;
    cost_cents: number;
    /** 0..100 float, null without an amount. */
    margin_percent: number | null;
    unpriced_cost_seconds: number;
}

export interface ClientMarginBar extends ClientMarginEntry {
    /** The "Other clients" bar that sums the clients beyond the first 11. */
    other: boolean;
    /** Some hours of this bar have no hourly cost (the " *" suffix and tooltip line). */
    incomplete: boolean;
    /** The y-axis label: the name truncated at 24 characters, plus " *" when incomplete. */
    axisLabel: string;
}

export interface ClientMarginColors {
    /** `--theme-color-chart`, an "r, g, b" triple (as ReportingChart reads it). */
    accent: string;
    /** The loss colour (red-700 light, red-400 dark). */
    loss: string;
    /** `--color-text-secondary`: axis names and value labels. */
    text: string;
    /** `--color-border-secondary`: the zero baseline. */
    baseline: string;
}

export interface ClientMarginLabels {
    /** "Other clients". */
    other: string;
    /** The `money.margin_chart_tooltip` copy of one bar (plain text, escaped by the builder). */
    tooltip: (bar: ClientMarginBar) => string;
    /** The `money.incomplete_chart_tooltip` line of an incomplete bar (plain text). */
    incomplete: (bar: ClientMarginBar) => string;
}

export interface ClientMarginInput {
    clients: ClientMarginEntry[];
    colors: ClientMarginColors;
    labels: ClientMarginLabels;
    /** Money in the organization's format, used for the value labels. */
    formatMoney: (cents: number) => string;
}

/** Above this many clients the chart keeps MAX_CLIENT_BARS - 1 bars plus "Other clients". */
export const MAX_CLIENT_BARS = 12;

const NAME_LIMIT = 24;
const ROW_HEIGHT = 32;
const CHROME_HEIGHT = 48;
const OTHER_KEY = '__other_clients__';

const FONT = { fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 400 } as const;

/** A name longer than 24 characters becomes its first 23 plus "…" (the tooltip keeps it whole). */
export function truncateClientName(name: string): string {
    const characters = Array.from(name);
    if (characters.length <= NAME_LIMIT) return name;
    return `${characters.slice(0, NAME_LIMIT - 1).join('')}…`;
}

/** 32px per bar row plus 48px for the chart's own padding. */
export function clientMarginChartHeight(barCount: number): number {
    return ROW_HEIGHT * barCount + CHROME_HEIGHT;
}

function byMarginDescending(a: ClientMarginEntry, b: ClientMarginEntry): number {
    if (a.margin_cents !== b.margin_cents) return b.margin_cents - a.margin_cents;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

function toBar(entry: ClientMarginEntry, other = false): ClientMarginBar {
    const incomplete = entry.unpriced_cost_seconds > 0;
    return {
        ...entry,
        other,
        incomplete,
        axisLabel: `${truncateClientName(entry.name)}${incomplete ? ' *' : ''}`,
    };
}

/**
 * The bars in display order (top first). Up to 12 clients each get a bar, sorted by margin
 * descending. Above 12, the 11 clients with the largest margins in absolute value keep their bar (so
 * the biggest losses stay visible, they are what the view is for) and the rest are summed into one
 * "Other clients" bar, drawn last.
 */
export function clientMarginBars(
    clients: readonly ClientMarginEntry[],
    otherName: string
): ClientMarginBar[] {
    if (clients.length <= MAX_CLIENT_BARS) {
        return [...clients].sort(byMarginDescending).map((entry) => toBar(entry));
    }
    const byImpact = [...clients].sort((a, b) => {
        const difference = Math.abs(b.margin_cents) - Math.abs(a.margin_cents);
        return difference !== 0 ? difference : byMarginDescending(a, b);
    });
    const kept = byImpact.slice(0, MAX_CLIENT_BARS - 1).sort(byMarginDescending);
    const rest = byImpact.slice(MAX_CLIENT_BARS - 1);
    const sum = (pick: (entry: ClientMarginEntry) => number) =>
        rest.reduce((total, entry) => total + pick(entry), 0);
    const amount = sum((entry) => entry.amount_cents);
    const margin = sum((entry) => entry.margin_cents);
    const other: ClientMarginEntry = {
        key: OTHER_KEY,
        name: otherName,
        margin_cents: margin,
        amount_cents: amount,
        cost_cents: sum((entry) => entry.cost_cents),
        margin_percent: amount === 0 ? null : (margin / amount) * 100,
        unpriced_cost_seconds: sum((entry) => entry.unpriced_cost_seconds),
    };
    return [...kept.map((entry) => toBar(entry)), toBar(other, true)];
}

// ECharts renders tooltip strings as HTML: client names are user data, so every line is escaped.
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function dataIndexOf(params: unknown): number {
    const first = Array.isArray(params) ? params[0] : params;
    return (first as { dataIndex?: number } | undefined)?.dataIndex ?? -1;
}

export function clientMarginOption(input: ClientMarginInput): EChartsOption {
    const { colors, labels, formatMoney } = input;
    const bars = clientMarginBars(input.clients, labels.other);
    const values = bars.map((bar) => bar.margin_cents / 100);
    const lowest = Math.min(0, ...values);
    const highest = Math.max(0, ...values);
    // Room at both ends for the value labels, which sit outside the bar ends.
    const span = highest - lowest || 1;
    const pad = span * 0.25;

    return {
        backgroundColor: 'transparent',
        textStyle: { ...FONT, color: colors.text },
        grid: { top: 24, right: 8, bottom: 24, left: 8, containLabel: true },
        tooltip: {
            trigger: 'item',
            textStyle: { ...FONT },
            formatter: (params: unknown) => {
                const bar = bars[dataIndexOf(params)];
                if (!bar) return '';
                const lines = [labels.tooltip(bar)];
                if (bar.incomplete) lines.push(labels.incomplete(bar));
                return lines.map(escapeHtml).join('<br/>');
            },
        },
        xAxis: {
            type: 'value',
            show: false,
            min: lowest < 0 ? lowest - pad : 0,
            max: highest > 0 ? highest + pad : lowest < 0 ? 0 : 1,
        },
        yAxis: {
            type: 'category',
            inverse: true,
            data: bars.map((bar) => bar.axisLabel),
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { ...FONT, color: colors.text },
        },
        series: [
            {
                type: 'bar',
                barWidth: 16,
                data: bars.map((bar, index) => {
                    const loss = bar.margin_cents < 0;
                    return {
                        value: values[index] as number,
                        itemStyle: {
                            color: loss ? colors.loss : `rgba(${colors.accent}, 0.85)`,
                            // Rounded at the data end only: right for gains, left for losses
                            borderRadius: loss ? [4, 0, 0, 4] : [0, 4, 4, 0],
                        },
                        label: { position: loss ? 'left' : 'right' },
                    };
                }),
                label: {
                    show: true,
                    ...FONT,
                    color: colors.text,
                    formatter: (params: unknown) => {
                        const bar = bars[dataIndexOf(params)];
                        return bar ? formatMoney(bar.margin_cents) : '';
                    },
                },
                markLine: {
                    silent: true,
                    symbol: 'none',
                    label: { show: false },
                    lineStyle: { color: colors.baseline, width: 1, type: 'solid' },
                    data: [{ xAxis: 0 }],
                },
            },
        ],
    };
}
