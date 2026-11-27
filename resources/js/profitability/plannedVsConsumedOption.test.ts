import { describe, expect, it } from 'vitest';
import { monthDifference, plannedVsConsumedOption } from './plannedVsConsumedOption';
import type { SummaryMonth } from './summaryApi';

const H = 3600;

const QUARTER: SummaryMonth[] = [
    { month: '2026-10-01', planned_seconds: 40 * H, consumed_seconds: 30 * H },
    { month: '2026-11-01', planned_seconds: 40 * H, consumed_seconds: 46 * H },
    { month: '2026-12-01', planned_seconds: 40 * H, consumed_seconds: 0 },
];

const COLORS = {
    accent: '0, 124, 107',
    planned: '#565b5c',
    text: '#3f4546',
    textStrong: '#1c1c1c',
    grid: '#dddddd',
};

function build(overrides: Partial<Parameters<typeof plannedVsConsumedOption>[0]> = {}) {
    return plannedVsConsumedOption({
        months: QUARTER,
        currentMonth: '2026-11-01',
        colors: COLORS,
        labels: {
            planned: 'Planned',
            consumed: 'Consumed',
            tooltip: (month) => `tooltip ${month.month}`,
        },
        compactLabels: false,
        formatHours: (seconds) => `${Math.round(seconds / 360) / 10} h`,
        ...overrides,
    });
}

// The option is a plain object; tests read it loosely, the way ECharts does.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

describe('plannedVsConsumedOption', () => {
    it('overlays a dashed planned outline above the accent consumed bar on the same slot', () => {
        const option = build() as Loose;
        expect(option.series).toHaveLength(2);
        const [consumed, planned] = option.series;

        expect(consumed).toMatchObject({
            type: 'bar',
            name: 'Consumed',
            data: [30, 46, 0],
            barMaxWidth: 32,
            itemStyle: { color: 'rgba(0, 124, 107, 0.85)', borderRadius: [4, 4, 0, 0] },
        });
        expect(planned).toMatchObject({
            type: 'bar',
            name: 'Planned',
            data: [40, 40, 40],
            barGap: '-100%',
            barMaxWidth: 32,
            itemStyle: {
                color: 'transparent',
                borderColor: '#565b5c',
                borderWidth: 2,
                borderType: 'dashed',
            },
        });
        expect(planned.z).toBeGreaterThan(consumed.z);
    });

    it('labels the hours axis "40 h" with 3 or 4 split lines', () => {
        const option = build() as Loose;
        expect(option.yAxis.type).toBe('value');
        expect(option.yAxis.splitNumber).toBeGreaterThanOrEqual(3);
        expect(option.yAxis.splitNumber).toBeLessThanOrEqual(4);
        expect(option.yAxis.axisLabel.formatter(40)).toBe('40 h');
        expect(option.yAxis.splitLine.lineStyle.color).toBe('#dddddd');
    });

    it('labels months MMM YYYY with the current month in the bold rich style', () => {
        const option = build() as Loose;
        expect(option.xAxis.data).toEqual(['Oct 2026', 'Nov 2026', 'Dec 2026']);
        const { formatter, rich, color, fontFamily, fontSize } = option.xAxis.axisLabel;
        expect(formatter('Oct 2026', 0)).toBe('Oct 2026');
        expect(formatter('Nov 2026', 1)).toBe('{current|Nov 2026}');
        expect(formatter('Dec 2026', 2)).toBe('Dec 2026');
        expect(rich.current).toMatchObject({ color: '#1c1c1c', fontWeight: 600 });
        expect(color).toBe('#3f4546');
        expect(fontFamily).toBe('Inter, sans-serif');
        expect(fontSize).toBe(12);
    });

    it('marks no month when the current month is outside the period', () => {
        const option = build({ currentMonth: null }) as Loose;
        expect(option.xAxis.axisLabel.formatter('Nov 2026', 1)).toBe('Nov 2026');
    });

    it('uses the UI-SPEC grid, an axis tooltip and a top-right legend', () => {
        const option = build() as Loose;
        expect(option.grid).toEqual({ top: 32, right: 8, bottom: 32, left: 48 });
        expect(option.tooltip.trigger).toBe('axis');
        expect(option.tooltip.axisPointer).toEqual({ type: 'shadow' });
        expect(option.tooltip.formatter([{ dataIndex: 1 }])).toBe('tooltip 2026-11-01');
        expect(option.legend.right).toBe(0);
        expect(option.legend.top).toBe(0);
        expect(option.legend.data.map((item: Loose) => item.name)).toEqual(['Planned', 'Consumed']);
        expect(option.legend.textStyle).toMatchObject({ fontSize: 12, color: '#3f4546' });
    });

    it('carries no money', () => {
        const serialized = JSON.stringify(build()).toLowerCase();
        for (const word of ['cents', 'amount', 'cost', 'margin', '€', '$']) {
            expect(serialized).not.toContain(word);
        }
    });

    it('fits twelve months with MMM YY labels in a narrow container', () => {
        const months = Array.from({ length: 12 }, (_, index) => ({
            month: `2026-${String(index + 1).padStart(2, '0')}-01`,
            planned_seconds: 10 * H,
            consumed_seconds: 5 * H,
        }));
        const option = build({ months, compactLabels: true, currentMonth: '2026-11-01' }) as Loose;
        expect(option.xAxis.data).toHaveLength(12);
        expect(option.xAxis.data[0]).toBe('Jan 26');
        expect(option.xAxis.data[11]).toBe('Dec 26');
        expect(option.xAxis.axisLabel.interval).toBe(0);
        expect(option.xAxis.axisLabel.rotate).toBe(0);
        expect(option.series[0].barMaxWidth).toBe(32);
        expect(option.xAxis.axisLabel.formatter('Nov 26', 10)).toBe('{current|Nov 26}');
    });
});

describe('monthDifference', () => {
    it('reads hours left, on plan and over at the shown precision', () => {
        expect(monthDifference(40 * H, 30 * H)).toEqual({ kind: 'left', seconds: 10 * H });
        expect(monthDifference(40 * H, 46 * H)).toEqual({ kind: 'over', seconds: 6 * H });
        expect(monthDifference(40 * H, 40 * H)).toEqual({ kind: 'on_plan', seconds: 0 });
        // under 0.05 h either way rounds to "0 h": shown as On plan
        expect(monthDifference(40 * H, 40 * H + 100)).toEqual({ kind: 'on_plan', seconds: 0 });
    });
});
