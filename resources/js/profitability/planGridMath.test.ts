import { describe, expect, it } from 'vitest';
import { evenSplit, sumState } from './planGridMath';

describe('evenSplit (client mirror of PlanDistributor::evenSplit)', () => {
    it('matches the server cases', () => {
        expect(evenSplit(144000, 3)).toEqual([48600, 48600, 46800]);
        expect(evenSplit(78000, 2)).toEqual([39600, 38400]);
    });

    it('front-loads extra half hours and puts a sub-step remainder on the last month', () => {
        // 100 h over 3 months: 200 steps -> 67, 67, 66
        expect(evenSplit(360000, 3)).toEqual([120600, 120600, 118800]);
        // 10 h 10 min over 2 months: 20 steps + 600 s
        expect(evenSplit(36600, 2)).toEqual([18000, 18600]);
    });

    it('always sums to the budget', () => {
        for (const budget of [0, 1, 1799, 1800, 77400, 432000, 4464000, 3600000000]) {
            for (const months of [1, 2, 3, 7, 12]) {
                const split = evenSplit(budget, months);
                expect(split).toHaveLength(months);
                expect(split.reduce((sum, value) => sum + value, 0)).toBe(budget);
            }
        }
    });

    it('returns nothing for no months and honours a custom step', () => {
        expect(evenSplit(144000, 0)).toEqual([]);
        expect(evenSplit(10, 3, 1)).toEqual([4, 3, 3]);
    });
});

describe('sumState', () => {
    it('is equal when the months add up to the hours sold', () => {
        expect(sumState([72000, 72000], 144000)).toEqual({
            kind: 'equal',
            planned: 144000,
            seconds: 0,
        });
    });

    it('is under with the hours left to distribute', () => {
        expect(sumState([72000, 54000], 144000)).toEqual({
            kind: 'under',
            planned: 126000,
            seconds: 18000,
        });
    });

    it('is over with the hours above the hours sold', () => {
        expect(sumState([90000, 72000], 144000)).toEqual({
            kind: 'over',
            planned: 162000,
            seconds: 18000,
        });
    });
});
