import { describe, expect, it } from 'vitest';
import {
    chargeabilityChartHeight,
    chargeabilityOption,
    plottedPeople,
} from './chargeabilityOption';
import type { PeopleViewRow } from './peopleApi';

const H = 3600;

function person(overrides: Partial<PeopleViewRow> = {}): PeopleViewRow {
    return {
        member_id: 'm-1',
        name: 'Ana',
        is_placeholder: false,
        weekly_seconds: 40 * H,
        available_seconds: 160 * H,
        absence_seconds: 0,
        billable_seconds: 109 * H,
        internal_seconds: 51 * H,
        chargeability: 0.684,
        target_percent: 75,
        gap_points: -6.6,
        status: 'below_target',
        ...overrides,
    };
}

const NO_WEEK: Partial<PeopleViewRow> = {
    weekly_seconds: null,
    available_seconds: null,
    chargeability: null,
    target_percent: null,
    gap_points: null,
    status: null,
};

const PEOPLE: PeopleViewRow[] = [
    person(),
    person({ member_id: 'm-2', name: 'Bea', chargeability: 0.9, target_percent: 80 }),
    person({ member_id: 'm-3', name: 'Carl', ...NO_WEEK }),
];

const COLORS = {
    accent: '0, 124, 107',
    target: '#565b5c',
    text: '#3f4546',
    grid: '#dddddd',
};

function build(people: PeopleViewRow[] = PEOPLE) {
    return chargeabilityOption({
        people,
        colors: COLORS,
        labels: {
            chargeability: 'Chargeability',
            target: 'Target',
            tooltip: (row) => `tooltip ${row.name}`,
        },
    });
}

// The option is a plain object; tests read it loosely, the way ECharts does.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

describe('plottedPeople', () => {
    it('leaves out people without a working week or without a ratio', () => {
        const zeroAvailable = person({
            member_id: 'm-4',
            name: 'Dan',
            available_seconds: 0,
            chargeability: null,
        });
        expect(plottedPeople([...PEOPLE, zeroAvailable]).map((row) => row.name)).toEqual([
            'Ana',
            'Bea',
        ]);
    });
});

describe('chargeabilityChartHeight', () => {
    it('is 32px per bar row plus 48px for the axis', () => {
        expect(chargeabilityChartHeight(1)).toBe(80);
        expect(chargeabilityChartHeight(5)).toBe(208);
    });
});

describe('chargeabilityOption', () => {
    it('draws one horizontal accent bar per person with a working week, first person on top', () => {
        const option = build() as Loose;
        expect(option.yAxis).toMatchObject({
            type: 'category',
            inverse: true,
            data: ['Ana', 'Bea'],
        });
        const bars = option.series[0];
        expect(bars).toMatchObject({
            type: 'bar',
            name: 'Chargeability',
            data: [68.4, 90],
            barWidth: 16,
            itemStyle: { color: 'rgba(0, 124, 107, 0.85)', borderRadius: [0, 4, 4, 0] },
        });
    });

    it('labels each bar end with an integer percent in the text colour', () => {
        const bars = (build() as Loose).series[0];
        expect(bars.label).toMatchObject({ show: true, position: 'right', color: COLORS.text });
        expect(bars.label.formatter({ value: 68.4 })).toBe('68 %');
    });

    it('marks each target with a 2px x 16px tertiary tick on the same row', () => {
        const ticks = (build() as Loose).series[1];
        expect(ticks).toMatchObject({
            type: 'scatter',
            name: 'Target',
            symbol: 'rect',
            symbolSize: [2, 16],
            data: [
                [75, 0],
                [80, 1],
            ],
            itemStyle: { color: COLORS.target },
        });
        expect(ticks.z).toBeGreaterThan((build() as Loose).series[0].z ?? 2);
    });

    it('runs the x axis from 0 to 100 % with 0, 50 and 100 % labels', () => {
        const axis = (build() as Loose).xAxis;
        expect(axis).toMatchObject({ type: 'value', min: 0, max: 100, interval: 50 });
        expect([0, 50, 100].map((value) => axis.axisLabel.formatter(value))).toEqual([
            '0 %',
            '50 %',
            '100 %',
        ]);
    });

    it('stretches the x axis to the highest value above 100 % and keeps the three labels', () => {
        const axis = (
            build([person({ chargeability: 1.24 }), person({ target_percent: 110 })]) as Loose
        ).xAxis;
        expect(axis.max).toBe(124);
        expect(axis.axisLabel.formatter(124)).toBe('');
        expect(axis.axisLabel.formatter(100)).toBe('100 %');
    });

    it('puts the two-entry legend top-right', () => {
        const legend = (build() as Loose).legend;
        expect(legend).toMatchObject({ top: 0, right: 0 });
        expect(legend.data.map((entry: { name: string }) => entry.name)).toEqual([
            'Chargeability',
            'Target',
        ]);
    });

    it('builds the tooltip from the plotted person of the hovered row', () => {
        const tooltip = (build() as Loose).tooltip;
        expect(tooltip.formatter([{ dataIndex: 1 }])).toBe('tooltip Bea');
        expect(tooltip.formatter({ dataIndex: 0 })).toBe('tooltip Ana');
        expect(tooltip.formatter([{ dataIndex: 7 }])).toBe('');
    });

    it('escapes the tooltip so a name is never read as HTML', () => {
        const option = build([person({ name: '<img src=x onerror=alert(1)>' })]) as Loose;
        expect(option.tooltip.formatter([{ dataIndex: 0 }])).toBe(
            'tooltip &lt;img src=x onerror=alert(1)&gt;'
        );
    });

    it('uses the reporting chart font', () => {
        const option = build() as Loose;
        expect(option.textStyle).toMatchObject({
            fontFamily: 'Inter, sans-serif',
            fontSize: 12,
            fontWeight: 400,
            color: COLORS.text,
        });
    });
});
