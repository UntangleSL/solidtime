<script setup lang="ts">
import { computed, ref } from 'vue';
import dayjs from 'dayjs';
import { Briefcase } from '@lucide/vue';
import MainContainer from '@/packages/ui/src/MainContainer.vue';
import CardTitle from '@/packages/ui/src/CardTitle.vue';
import LoadingSpinner from '@/packages/ui/src/LoadingSpinner.vue';
import Button from '@/packages/ui/src/Buttons/Button.vue';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/packages/ui/src/select';
import Card from '@/Components/Common/Card.vue';
import StatCard from '@/Components/Common/StatCard.vue';
import { useOrganizationQuery } from '@/utils/useOrganizationQuery';
import { getCurrentOrganizationId } from '@/utils/useUser';
import BudgetMeter from './BudgetMeter.vue';
import StatusPill from './StatusPill.vue';
import { formatHours, formatPercent, formatPeriod } from './format';
import { t, useProfitabilityProps } from './labels';
import { isNotFound, useProjectSummaryQuery, type SummaryPeriodRef } from './summaryApi';

// Contract card on the project page (D-14, UI-SPEC "Project summary card"). It renders only what the
// server allows: without `project.summary_url` in the shared prop there is no markup and no request,
// and a 404 from the summary endpoint renders nothing (no empty card, no error).
const props = defineProps<{
    projectId: string;
}>();

const profitability = useProfitabilityProps();
const summaryUrl = computed(() => profitability.value.project?.summary_url ?? null);
const labels = computed(() => profitability.value.labels ?? null);

// null = the server's default period (current, else latest started, else first upcoming).
const selectedPeriodId = ref<string | null>(null);

const { data, isPending, isError, error, refetch } = useProjectSummaryQuery(
    summaryUrl,
    () => props.projectId,
    selectedPeriodId
);

const { organization } = useOrganizationQuery(getCurrentOrganizationId() ?? '');
const numberFormat = computed(() => organization.value?.number_format ?? null);

const visible = computed(
    () => summaryUrl.value !== null && !(isError.value && isNotFound(error.value))
);

const summary = computed(() => data.value ?? null);
const contract = computed(() => summary.value?.contract ?? null);
const period = computed(() => summary.value?.period ?? null);

const OVER_TONE = 'text-red-700 dark:text-red-400';

function label(path: string, params?: Record<string, string | number>): string {
    return t(labels.value, path, params);
}

function hours(seconds: number | null | undefined): string | undefined {
    return seconds == null ? undefined : formatHours(Math.abs(seconds), numberFormat.value);
}

// Calendar dates are read as local dates so no time zone moves them a day.
function date(isoDate: string): string {
    return dayjs(isoDate.slice(0, 10)).format('D MMM YYYY');
}

// Newest first, whatever order arrives; ties keep the server order.
const periodOptions = computed(() =>
    [...(summary.value?.periods ?? [])]
        .sort((a, b) => b.starts_on.localeCompare(a.starts_on))
        .map((option: SummaryPeriodRef) => ({
            id: option.id,
            text: label('summary.period_option', {
                period: formatPeriod(option.starts_on, option.ends_on),
                state: label(`period_state.${option.state}`),
            }),
        }))
);

const periodModel = computed<string | undefined>({
    get: () => selectedPeriodId.value ?? period.value?.id,
    set: (value) => {
        selectedPeriodId.value = value ?? null;
    },
});

function onPeriodChange(value: unknown) {
    if (typeof value === 'string' && value !== '') periodModel.value = value;
}

const termsLine = computed(() => {
    if (!contract.value) return '';
    const parts: string[] = [];
    if (contract.value.service) parts.push(contract.value.service);
    parts.push(label(`schedule.${contract.value.schedule}`));
    parts.push(label('summary.since', { date: date(contract.value.starts_on) }));
    if (contract.value.ends_on) {
        parts.push(label('summary.until', { date: date(contract.value.ends_on) }));
    }
    if (contract.value.archived) parts.push(label('summary.renewal_paused'));
    return parts.join(' · ');
});

const isOver = computed(() => (period.value?.still_to_consume_seconds ?? 0) < 0);

const projectionCaption = computed(() => {
    const runRate = period.value?.run_rate_seconds ?? null;
    return runRate === null
        ? label('summary.run_rate_unavailable')
        : label('summary.projection_caption', { h: hours(runRate) ?? '' });
});

const meterCaption = computed(() => {
    if (!period.value) return '';
    const sold = period.value.budget_seconds;
    const consumed = period.value.consumed_seconds;
    return label('summary.meter_caption', {
        consumed: hours(consumed) ?? '',
        sold: hours(sold) ?? '',
        pct: sold > 0 ? formatPercent(consumed / sold) : '--',
    });
});
</script>

<template>
    <MainContainer v-if="visible" class="pt-6" data-testid="profitability-summary-card">
        <CardTitle :title="label('summary.title')" :icon="Briefcase">
            <template v-if="periodOptions.length > 0" #actions>
                <div class="flex flex-wrap items-center justify-end gap-2">
                    <Select :model-value="periodModel" @update:model-value="onPeriodChange">
                        <SelectTrigger
                            size="sm"
                            class="min-w-0 max-w-full"
                            :aria-label="label('summary.period_select')"
                            data-testid="profitability-summary-period">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem
                                v-for="option in periodOptions"
                                :key="option.id"
                                :value="option.id"
                                data-testid="profitability-summary-period-option">
                                {{ option.text }}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </template>
        </CardTitle>
        <Card>
            <div
                v-if="isPending"
                class="min-h-[160px] flex items-center justify-center py-12"
                data-testid="profitability-summary-loading"
                aria-busy="true">
                <LoadingSpinner />
            </div>
            <div
                v-else-if="isError || !summary"
                class="p-4 sm:p-6 flex flex-wrap items-center gap-3 text-sm text-text-secondary"
                data-testid="profitability-summary-error">
                <span>{{ label('common.load_error') }}</span>
                <Button type="button" variant="ghost" size="sm" @click="refetch()">
                    {{ label('common.try_again') }}
                </Button>
            </div>
            <div
                v-else-if="summary.contract === null"
                class="py-12 px-4 flex flex-col items-center text-center gap-1"
                data-testid="profitability-summary-empty">
                <p class="text-base font-semibold text-text-primary">
                    {{ label('summary.empty_title') }}
                </p>
                <p class="text-sm text-text-secondary">
                    {{
                        summary.can_edit_terms
                            ? label('summary.empty_body_editor')
                            : label('summary.empty_body_pm')
                    }}
                </p>
            </div>
            <div v-else class="p-4 sm:p-6 space-y-6">
                <p
                    class="text-sm text-text-secondary break-words"
                    data-testid="profitability-summary-terms">
                    {{ termsLine }}
                </p>
                <dl class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard :title="label('kpi.hours_sold')">
                        <span class="tabular-nums" data-testid="profitability-summary-sold">{{
                            hours(period?.budget_seconds) ?? '--'
                        }}</span>
                    </StatCard>
                    <StatCard :title="label('kpi.consumed')">
                        <span class="tabular-nums" data-testid="profitability-summary-consumed">{{
                            hours(period?.consumed_seconds) ?? '--'
                        }}</span>
                    </StatCard>
                    <StatCard :title="label(isOver ? 'kpi.over_by' : 'kpi.still_to_consume')">
                        <span
                            class="tabular-nums"
                            :class="isOver ? OVER_TONE : ''"
                            data-testid="profitability-summary-still">
                            {{ hours(period?.still_to_consume_seconds) ?? '--' }}
                        </span>
                    </StatCard>
                    <StatCard :title="label('kpi.projected_at_close')">
                        <span class="tabular-nums" data-testid="profitability-summary-projected">{{
                            hours(period?.remaining_plan_seconds) ?? '--'
                        }}</span>
                        <span
                            v-if="period"
                            class="block pt-1 text-xs font-normal text-text-secondary"
                            data-testid="profitability-summary-projection-caption">
                            {{ projectionCaption }}
                        </span>
                    </StatCard>
                </dl>
                <div v-if="period" class="space-y-2">
                    <BudgetMeter
                        :sold-seconds="period.budget_seconds"
                        :consumed-seconds="period.consumed_seconds"
                        :projected-seconds="period.remaining_plan_seconds"
                        :status="period.status"
                        variant="full"
                        :closed="period.state === 'closed'"
                        :labels="labels"
                        :number-format="numberFormat" />
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <span
                            class="text-xs text-text-secondary tabular-nums"
                            data-testid="profitability-summary-meter-caption">
                            {{ meterCaption }}
                        </span>
                        <StatusPill :status="period.status" :labels="labels" />
                    </div>
                </div>
            </div>
        </Card>
    </MainContainer>
</template>
