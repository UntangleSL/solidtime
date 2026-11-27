import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import PeriodMonthTable from './PeriodMonthTable.vue';
import type { SummaryMonth } from './summaryApi';

const H = 3600;

const labels = {
    common: {
        hours_over: ':n h over',
        hours_left: ':n h left',
        on_plan: 'On plan',
        total: 'Total',
        this_month_suffix: '(this month)',
    },
    summary: {
        month: 'Month',
        planned: 'Planned',
        consumed: 'Consumed',
        difference: 'Difference',
    },
};

const QUARTER: SummaryMonth[] = [
    { month: '2026-10-01', planned_seconds: 40 * H, consumed_seconds: 40 * H },
    { month: '2026-11-01', planned_seconds: 40 * H, consumed_seconds: 46 * H },
    { month: '2026-12-01', planned_seconds: 1240 * H, consumed_seconds: 0 },
];

let wrapper: VueWrapper | null = null;

function mountTable(months: SummaryMonth[] = QUARTER, currentMonth: string | null = '2026-11-01') {
    wrapper = mount(PeriodMonthTable, {
        props: { months, currentMonth, labels, numberFormat: 'comma-point' },
    });
    return wrapper;
}

function cells(row: Element): string[] {
    return [...row.querySelectorAll('th, td')].map(
        (cell) => cell.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    );
}

describe('PeriodMonthTable', () => {
    afterEach(() => {
        wrapper?.unmount();
        wrapper = null;
    });

    it('is a table Month | Planned | Consumed | Difference', () => {
        const table = mountTable().find('table');
        expect(table.exists()).toBe(true);
        const headers = table.findAll('thead th').map((cell) => cell.text());
        expect(headers).toEqual(['Month', 'Planned', 'Consumed', 'Difference']);
    });

    it('shows on plan, over in the over colour and hours left in the secondary colour', () => {
        const rows = mountTable().findAll('[data-testid="profitability-month-row"]');
        expect(rows).toHaveLength(3);

        expect(cells(rows[0]!.element)).toEqual(['Oct 2026', '40 h', '40 h', 'On plan']);

        const over = rows[1]!.find('[data-testid="profitability-month-difference"]');
        expect(over.text()).toBe('6 h over');
        expect(over.classes()).toContain('text-red-700');

        const left = rows[2]!.find('[data-testid="profitability-month-difference"]');
        expect(left.text()).toBe('1,240 h left');
        expect(left.classes()).toContain('text-text-secondary');
    });

    it('marks the current month with a left border and "(this month)"', () => {
        const rows = mountTable().findAll('[data-testid="profitability-month-row"]');
        const current = rows[1]!;
        expect(current.attributes('data-current')).toBe('true');
        expect(current.find('th').text()).toBe('Nov 2026 (this month)');
        expect(current.find('th').classes()).toEqual(
            expect.arrayContaining(['border-l-2', 'border-text-primary'])
        );
        expect(rows[0]!.attributes('data-current')).toBeUndefined();
        expect(rows[0]!.text()).not.toContain('(this month)');
    });

    it('shows a dash for the consumption of future months', () => {
        const rows = mountTable().findAll('[data-testid="profitability-month-row"]');
        expect(rows[2]!.find('[data-testid="profitability-month-consumed"]').text()).toBe('—');
        expect(rows[1]!.find('[data-testid="profitability-month-consumed"]').text()).toBe('46 h');
    });

    it('adds a Total row in weight 600', () => {
        const total = mountTable().find('[data-testid="profitability-month-total"]');
        expect(cells(total.element)).toEqual(['Total', '1,320 h', '86 h', '1,234 h left']);
        expect(total.classes()).toContain('font-semibold');
    });

    it('right-aligns the numbers with tabular figures', () => {
        const cell = mountTable().find('[data-testid="profitability-month-consumed"]');
        expect(cell.classes()).toEqual(expect.arrayContaining(['text-right', 'tabular-nums']));
    });

    it('marks no row for a closed period', () => {
        const table = mountTable(QUARTER, '2027-03-01');
        expect(table.text()).not.toContain('(this month)');
        expect(table.find('[data-current="true"]').exists()).toBe(false);
    });
});
