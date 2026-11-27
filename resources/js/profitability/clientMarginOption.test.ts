import { describe, expect, it } from 'vitest';
import {
    MAX_CLIENT_BARS,
    clientMarginBars,
    clientMarginChartHeight,
    clientMarginOption,
    truncateClientName,
    type ClientMarginEntry,
    type ClientMarginInput,
} from './clientMarginOption';

function entry(name: string, margin: number, overrides: Partial<ClientMarginEntry> = {}) {
    return {
        key: name,
        name,
        margin_cents: margin,
        amount_cents: 100000,
        cost_cents: 100000 - margin,
        margin_percent: margin / 1000,
        unpriced_cost_seconds: 0,
        ...overrides,
    };
}

const COLORS = {
    accent: '0, 124, 107',
    loss: '#B91C1C',
    text: '#565B5C',
    baseline: '#DDDDDD',
};

function input(clients: ClientMarginEntry[]): ClientMarginInput {
    return {
        clients,
        colors: COLORS,
        labels: {
            other: 'Other clients',
            tooltip: (bar) => `${bar.name} · Margin ${bar.margin_cents}`,
            incomplete: (bar) => `Incomplete: ${bar.unpriced_cost_seconds / 3600} h`,
        },
        formatMoney: (cents) => `€${(cents / 100).toFixed(2)}`,
    };
}

interface BarDatum {
    value: number;
    itemStyle: { color: string; borderRadius: number[] };
    label: { position: string };
}

function series(option: ReturnType<typeof clientMarginOption>) {
    const list = option.series as Array<Record<string, unknown>>;
    return list[0] as {
        type: string;
        barWidth: number;
        data: BarDatum[];
        label: { show: boolean; color: string; formatter: (p: { dataIndex: number }) => string };
        markLine: { data: Array<{ xAxis: number }>; lineStyle: { color: string; width: number } };
    };
}

function axisNames(option: ReturnType<typeof clientMarginOption>): string[] {
    return (option.yAxis as { data: string[] }).data;
}

describe('clientMarginBars', () => {
    it('sorts clients by margin descending', () => {
        const bars = clientMarginBars(
            [entry('Low', -5000), entry('High', 9000), entry('Mid', 100)],
            'Other clients'
        );

        expect(bars.map((bar) => bar.name)).toEqual(['High', 'Mid', 'Low']);
    });

    it('keeps 12 clients as 12 bars', () => {
        const clients = Array.from({ length: 12 }, (_, i) => entry(`C${i}`, i * 100));

        expect(clientMarginBars(clients, 'Other clients')).toHaveLength(MAX_CLIENT_BARS);
    });

    it('turns 13 clients into 11 bars plus Other clients summing the rest', () => {
        const clients = [
            ...Array.from({ length: 11 }, (_, i) => entry(`Big${i}`, 10000 + i)),
            entry('Small1', 100, { unpriced_cost_seconds: 3600 }),
            entry('Small2', -200),
        ];
        const bars = clientMarginBars(clients, 'Other clients');

        expect(bars).toHaveLength(12);
        const other = bars[11];
        expect(other?.other).toBe(true);
        expect(other?.name).toBe('Other clients');
        expect(other?.margin_cents).toBe(-100);
        expect(other?.amount_cents).toBe(200000);
        expect(other?.cost_cents).toBe(200100);
        expect(other?.unpriced_cost_seconds).toBe(3600);
        expect(other?.incomplete).toBe(true);
        expect(other?.margin_percent).toBeCloseTo(-0.05, 5);
        expect(bars.slice(0, 11).every((bar) => bar.name.startsWith('Big'))).toBe(true);
    });

    it('keeps the largest losses as their own bars when grouping', () => {
        const clients = [
            ...Array.from({ length: 10 }, (_, i) => entry(`Gain${i}`, 5000 + i)),
            entry('Disaster', -90000),
            entry('Tiny1', 10),
            entry('Tiny2', 20),
        ];
        const names = clientMarginBars(clients, 'Other clients').map((bar) => bar.name);

        expect(names).toContain('Disaster');
        expect(names.at(-2)).toBe('Disaster');
        expect(names.at(-1)).toBe('Other clients');
    });
});

describe('truncateClientName', () => {
    it('truncates names longer than 24 characters', () => {
        expect(truncateClientName('Short name')).toBe('Short name');
        expect(truncateClientName('A'.repeat(24))).toBe('A'.repeat(24));
        const long = truncateClientName('International Consolidated Holdings');
        expect(long).toHaveLength(24);
        expect(long.endsWith('…')).toBe(true);
    });
});

describe('clientMarginOption', () => {
    it('draws one horizontal 16px bar per client, accent for gains and loss colour for losses', () => {
        const option = clientMarginOption(input([entry('Gain', 50000), entry('Loss', -20000)]));
        const bars = series(option);

        expect(bars.type).toBe('bar');
        expect(bars.barWidth).toBe(16);
        expect((option.xAxis as { type: string }).type).toBe('value');
        expect((option.yAxis as { type: string; inverse: boolean }).type).toBe('category');
        expect((option.yAxis as { inverse: boolean }).inverse).toBe(true);
        expect(bars.data[0]?.value).toBe(500);
        expect(bars.data[0]?.itemStyle.color).toBe('rgba(0, 124, 107, 0.85)');
        expect(bars.data[0]?.itemStyle.borderRadius).toEqual([0, 4, 4, 0]);
        expect(bars.data[0]?.label.position).toBe('right');
        expect(bars.data[1]?.value).toBe(-200);
        expect(bars.data[1]?.itemStyle.color).toBe('#B91C1C');
        expect(bars.data[1]?.itemStyle.borderRadius).toEqual([4, 0, 0, 4]);
        expect(bars.data[1]?.label.position).toBe('left');
    });

    it('labels values in the text colour, never the bar colour', () => {
        const bars = series(clientMarginOption(input([entry('Gain', 50000), entry('L', -2000)])));

        expect(bars.label.show).toBe(true);
        expect(bars.label.color).toBe(COLORS.text);
        expect(bars.label.formatter({ dataIndex: 0 })).toBe('€500.00');
        expect(bars.label.formatter({ dataIndex: 1 })).toBe('€-20.00');
    });

    it('draws the zero baseline as a 1px line', () => {
        const bars = series(clientMarginOption(input([entry('A', 1), entry('B', -1)])));

        expect(bars.markLine.data).toEqual([{ xAxis: 0 }]);
        expect(bars.markLine.lineStyle.color).toBe(COLORS.baseline);
        expect(bars.markLine.lineStyle.width).toBe(1);
    });

    it('truncates axis names and marks incomplete clients with " *"', () => {
        const option = clientMarginOption(
            input([
                entry('International Consolidated Holdings', 9000),
                entry('Partial', 100, { unpriced_cost_seconds: 7200 }),
            ])
        );

        expect(axisNames(option)).toEqual(['International Consolida…', 'Partial *']);
    });

    it('shows the full name and the incomplete line in an escaped item tooltip', () => {
        const option = clientMarginOption(
            input([
                entry('International <b>Consolidated</b> Holdings', 9000),
                entry('Partial', 100, { unpriced_cost_seconds: 7200 }),
            ])
        );
        const tooltip = option.tooltip as {
            trigger: string;
            formatter: (p: { dataIndex: number }) => string;
        };

        expect(tooltip.trigger).toBe('item');
        expect(tooltip.formatter({ dataIndex: 0 })).toBe(
            'International &lt;b&gt;Consolidated&lt;/b&gt; Holdings · Margin 9000'
        );
        expect(tooltip.formatter({ dataIndex: 1 })).toBe(
            'Partial · Margin 100<br/>Incomplete: 2 h'
        );
    });

    it('has no legend', () => {
        expect(clientMarginOption(input([entry('A', 1), entry('B', 2)])).legend).toBeUndefined();
    });

    it('gives 32px per row plus 48px', () => {
        expect(clientMarginChartHeight(2)).toBe(112);
        expect(clientMarginChartHeight(12)).toBe(432);
    });
});
