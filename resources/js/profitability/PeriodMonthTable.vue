<script setup lang="ts">
import { computed } from 'vue';
import { formatHours, formatHoursNumber, formatMonth } from './format';
import { t, type LabelTree } from './labels';
import { monthDifference } from './plannedVsConsumedOption';
import type { SummaryMonth } from './summaryApi';

// Month table of a contract period (UI-SPEC "Project summary card"): the text alternative of the
// planned-vs-consumed chart, always rendered. Months after today's month have no consumption yet
// ("—"); today's month is marked with a left border and "(this month)".
const props = defineProps<{
    months: SummaryMonth[];
    /** Today's month as "YYYY-MM-01" (the profitability timezone's month). */
    currentMonth: string | null;
    labels: LabelTree | null | undefined;
    numberFormat?: string | null;
}>();

const OVER_TONE = 'text-red-700 dark:text-red-400';
const DASH = '—';

function label(path: string, params?: Record<string, string | number>): string {
    return t(props.labels, path, params);
}

function hours(seconds: number): string {
    return formatHours(seconds, props.numberFormat);
}

function monthKey(value: string): string {
    return value.slice(0, 7);
}

function difference(planned: number, consumed: number) {
    const result = monthDifference(planned, consumed);
    if (result.kind === 'on_plan') {
        return { text: label('common.on_plan'), tone: 'text-text-primary' };
    }
    const n = formatHoursNumber(result.seconds, props.numberFormat);
    return result.kind === 'over'
        ? { text: label('common.hours_over', { n }), tone: OVER_TONE }
        : { text: label('common.hours_left', { n }), tone: 'text-text-secondary' };
}

const rows = computed(() =>
    props.months.map((month) => {
        const current =
            props.currentMonth !== null && monthKey(month.month) === monthKey(props.currentMonth);
        const future =
            props.currentMonth !== null && monthKey(month.month) > monthKey(props.currentMonth);
        return {
            key: month.month,
            name: formatMonth(month.month),
            current,
            planned: hours(month.planned_seconds),
            consumed: future ? DASH : hours(month.consumed_seconds),
            difference: difference(month.planned_seconds, month.consumed_seconds),
        };
    })
);

const total = computed(() => {
    const planned = props.months.reduce((sum, month) => sum + month.planned_seconds, 0);
    const consumed = props.months.reduce((sum, month) => sum + month.consumed_seconds, 0);
    return {
        planned: hours(planned),
        consumed: hours(consumed),
        difference: difference(planned, consumed),
    };
});

const NUMBER_CELL = 'px-3 py-2 text-right tabular-nums';
</script>

<template>
    <div class="overflow-x-auto">
        <table class="w-full text-sm text-text-primary" data-testid="profitability-month-table">
            <thead>
                <tr class="border-b border-card-background-separator text-xs text-text-secondary">
                    <th scope="col" class="px-3 py-2 text-left font-normal">
                        {{ label('summary.month') }}
                    </th>
                    <th scope="col" class="px-3 py-2 text-right font-normal">
                        {{ label('summary.planned') }}
                    </th>
                    <th scope="col" class="px-3 py-2 text-right font-normal">
                        {{ label('summary.consumed') }}
                    </th>
                    <th scope="col" class="px-3 py-2 text-right font-normal">
                        {{ label('summary.difference') }}
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr
                    v-for="row in rows"
                    :key="row.key"
                    class="border-b border-card-background-separator"
                    data-testid="profitability-month-row"
                    :data-current="row.current ? 'true' : undefined">
                    <th
                        scope="row"
                        class="px-3 py-2 text-left font-normal whitespace-nowrap"
                        :class="row.current ? 'border-l-2 border-text-primary' : ''">
                        {{ row.name }}
                        <span v-if="row.current" class="text-text-secondary">{{
                            label('common.this_month_suffix')
                        }}</span>
                    </th>
                    <td :class="NUMBER_CELL">{{ row.planned }}</td>
                    <td :class="NUMBER_CELL" data-testid="profitability-month-consumed">
                        {{ row.consumed }}
                    </td>
                    <td
                        :class="[NUMBER_CELL, row.difference.tone]"
                        data-testid="profitability-month-difference">
                        {{ row.difference.text }}
                    </td>
                </tr>
            </tbody>
            <tfoot>
                <tr class="font-semibold" data-testid="profitability-month-total">
                    <th scope="row" class="px-3 py-2 text-left font-semibold">
                        {{ label('common.total') }}
                    </th>
                    <td :class="NUMBER_CELL">{{ total.planned }}</td>
                    <td :class="NUMBER_CELL">{{ total.consumed }}</td>
                    <td :class="[NUMBER_CELL, total.difference.tone]">
                        {{ total.difference.text }}
                    </td>
                </tr>
            </tfoot>
        </table>
    </div>
</template>
