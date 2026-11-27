import { describe, expect, it } from 'vitest';
import { fill, formatHours, formatMonth, formatPercent, formatPeriod, formatPp } from './format';

describe('formatHours', () => {
    it('writes decimal hours with at most one decimal and drops a trailing .0', () => {
        expect(formatHours(45000)).toBe('12.5 h');
        expect(formatHours(432000)).toBe('120 h');
        expect(formatHours(0)).toBe('0 h');
        expect(formatHours(1800)).toBe('0.5 h');
        // 1 h 2 min rounds to one decimal: 1.0 -> 1
        expect(formatHours(3720)).toBe('1 h');
        // 1 h 57 min rounds up to 2
        expect(formatHours(7020)).toBe('2 h');
        expect(formatHours(5580)).toBe('1.6 h');
    });

    it('groups thousands with the organization number format', () => {
        expect(formatHours(4464000, 'comma-point')).toBe('1,240 h');
        expect(formatHours(4464000 + 1800, 'comma-point')).toBe('1,240.5 h');
        expect(formatHours(4464000 + 1800, 'point-comma')).toBe('1.240,5 h');
        expect(formatHours(4464000, 'space-comma')).toBe('1 240 h');
        expect(formatHours(4464000, 'apostrophe-point')).toBe("1'240 h");
        expect(formatHours(45000, 'point-comma')).toBe('12,5 h');
    });

    it('keeps the plain number without a known format', () => {
        expect(formatHours(4464000)).toBe('1240 h');
        expect(formatHours(4464000, null)).toBe('1240 h');
    });
});

describe('formatPercent and formatPp', () => {
    it('writes an integer percent with a space before the sign', () => {
        expect(formatPercent(0.684)).toBe('68 %');
        expect(formatPercent(1)).toBe('100 %');
        expect(formatPercent(1.256)).toBe('126 %');
        expect(formatPercent(0)).toBe('0 %');
    });

    it('signs percentage points with a real minus', () => {
        expect(formatPp(-7)).toBe('−7 pp');
        expect(formatPp(-7.4)).toBe('−7 pp');
        expect(formatPp(3)).toBe('+3 pp');
        expect(formatPp(0)).toBe('0 pp');
    });
});

describe('formatMonth and formatPeriod', () => {
    it('writes a month as MMM YYYY', () => {
        expect(formatMonth('2026-11-01')).toBe('Nov 2026');
        expect(formatMonth('2027-01-01')).toBe('Jan 2027');
    });

    it('writes every period shape of UI-D1', () => {
        expect(formatPeriod('2026-11-01', '2026-11-30')).toBe('Nov 2026');
        expect(formatPeriod('2026-10-01', '2026-12-31')).toBe('Oct – Dec 2026');
        expect(formatPeriod('2026-01-01', '2026-12-31')).toBe('Jan – Dec 2026');
        expect(formatPeriod('2026-11-15', '2026-11-30')).toBe('15 – 30 Nov 2026');
        expect(formatPeriod('2026-11-15', '2027-03-31')).toBe('15 Nov 2026 – 31 Mar 2027');
    });

    it('writes whole months across years and part months inside one year', () => {
        expect(formatPeriod('2026-12-01', '2027-02-28')).toBe('Dec 2026 – Feb 2027');
        expect(formatPeriod('2026-10-15', '2026-11-30')).toBe('15 Oct – 30 Nov 2026');
        expect(formatPeriod('2026-11-15', '2026-11-15')).toBe('15 Nov 2026');
    });
});

describe('fill', () => {
    it('replaces :key tokens and leaves unknown placeholders as written', () => {
        expect(fill('Since :date', { date: 'x' })).toBe('Since x');
        expect(fill(':n h over', { n: 6 })).toBe('6 h over');
        expect(fill('Sold :h at :rate', { h: '40 h' })).toBe('Sold 40 h at :rate');
        expect(fill('No placeholder')).toBe('No placeholder');
    });

    it('does not treat a longer token as a shorter one', () => {
        expect(fill(':sold of :soldier', { sold: '40 h' })).toBe('40 h of :soldier');
    });
});
