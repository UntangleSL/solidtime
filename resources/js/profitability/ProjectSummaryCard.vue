<script setup lang="ts">
import { computed, ref } from 'vue';
import dayjs from 'dayjs';
import { Briefcase, TriangleAlert } from '@lucide/vue';
import MainContainer from '@/packages/ui/src/MainContainer.vue';
import CardTitle from '@/packages/ui/src/CardTitle.vue';
import LoadingSpinner from '@/packages/ui/src/LoadingSpinner.vue';
import Button from '@/packages/ui/src/Buttons/Button.vue';
import PrimaryButton from '@/packages/ui/src/Buttons/PrimaryButton.vue';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/packages/ui/src/select';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/packages/ui/src/tooltip';
import { formatCents } from '@/packages/ui/src/utils/money';
import Card from '@/Components/Common/Card.vue';
import StatCard from '@/Components/Common/StatCard.vue';
import { getOrganizationCurrencyString } from '@/utils/money';
import { useOrganizationQuery } from '@/utils/useOrganizationQuery';
import { getCurrentOrganizationId } from '@/utils/useUser';
import BudgetMeter from './BudgetMeter.vue';
import ContractEditor from './ContractEditor.vue';
import PeriodMonthTable from './PeriodMonthTable.vue';
import PlannedVsConsumedChart from './PlannedVsConsumedChart.vue';
import StatusPill from './StatusPill.vue';
import { formatHours, formatHoursNumber, formatPercent, formatPeriod } from './format';
import { t, useProfitabilityProps } from './labels';
import { monthDifference } from './plannedVsConsumedOption';
import { isNotFound, useProjectSummaryQuery, type SummaryPeriodRef } from './summaryApi';
import { projectNameFromCache } from './contractsApi';
import { useQueryClient } from '@tanstack/vue-query';

// Contract card on the project page (D-14, UI-SPEC "Project summary card"). It renders only what the
// server allows: without `project.summary_url` in the shared prop there is no markup and no request,
// and a 404 from the summary endpoint renders nothing (no empty card, no error). Money is rendered
// only when the period carries `amount_cents` (scopes with money, D-11): the card never decides who
// may see money.
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
const isClosed = computed(() => period.value?.state === 'closed');
const isUpcoming = computed(() => period.value?.state === 'upcoming');

// Today's month marks the month table and the chart; a closed or upcoming period has no such month.
const todayMonth = dayjs().format('YYYY-MM-01');

const OVER_TONE = 'text-red-700 dark:text-red-400';
const MINUS = '−';
const EMPTY = '--';

function label(path: string, params?: Record<string, string | number>): string {
    return t(labels.value, path, params);
}

function hours(seconds: number | null | undefined): string | undefined {
    return seconds == null ? undefined : formatHours(Math.abs(seconds), numberFormat.value);
}

// Money keeps the organization's currency and formats (D-09: nothing is converted). The sign is a
// real minus in front of the amount, the loss colour is added by the tile.
function money(cents: number): string {
    const formatted =
        formatCents(
            Math.abs(cents),
            organization.value?.currency ?? getOrganizationCurrencyString(),
            organization.value?.currency_format ?? 'iso-code-before-with-space',
            organization.value?.currency_symbol,
            organization.value?.number_format
        ) ?? '';
    return cents < 0 ? `${MINUS}${formatted}` : formatted;
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

interface Tile {
    key: string;
    title: string;
    value: string;
    tone?: string;
    caption?: string;
}

// Hours KPIs per period state (UI-SPEC "Card states", D-03, D-04).
const hourTiles = computed<Tile[]>(() => {
    const current = period.value;
    if (!current) return [];
    const sold: Tile = {
        key: 'sold',
        title: label('kpi.hours_sold'),
        value: hours(current.budget_seconds) ?? EMPTY,
    };
    const consumed: Tile = {
        key: 'consumed',
        title: label('kpi.consumed'),
        value: isUpcoming.value ? EMPTY : (hours(current.consumed_seconds) ?? EMPTY),
    };

    if (isClosed.value) {
        const result = monthDifference(current.budget_seconds, current.consumed_seconds);
        const n = formatHoursNumber(result.seconds, numberFormat.value);
        return [
            sold,
            consumed,
            {
                key: 'result',
                title: label('kpi.result'),
                value:
                    result.kind === 'over'
                        ? label('common.hours_over', { n })
                        : result.kind === 'left'
                          ? label('common.hours_unused', { n })
                          : label('common.on_plan'),
                tone: result.kind === 'over' ? OVER_TONE : undefined,
            },
        ];
    }

    const over = !isUpcoming.value && current.still_to_consume_seconds < 0;
    return [
        sold,
        consumed,
        {
            key: 'still',
            title: label(over ? 'kpi.over_by' : 'kpi.still_to_consume'),
            value: isUpcoming.value ? EMPTY : (hours(current.still_to_consume_seconds) ?? EMPTY),
            tone: over ? OVER_TONE : undefined,
        },
        {
            key: 'projected',
            title: label('kpi.projected_at_close'),
            value: isUpcoming.value ? EMPTY : (hours(current.remaining_plan_seconds) ?? EMPTY),
            caption: isUpcoming.value
                ? undefined
                : current.run_rate_seconds === null
                  ? label('summary.run_rate_unavailable')
                  : label('summary.projection_caption', {
                        h: hours(current.run_rate_seconds) ?? '',
                    }),
        },
    ];
});

const hasMoney = computed(() => period.value !== null && 'amount_cents' in period.value);
const unpricedSeconds = computed(() => period.value?.unpriced_cost_seconds ?? 0);
const incomplete = computed(() => unpricedSeconds.value > 0);
const incompleteHours = computed(() =>
    formatHoursNumber(unpricedSeconds.value, numberFormat.value)
);

interface MoneyTile {
    key: string;
    title: string;
    cents: number | null | undefined;
    /** Margin tiles read "Incomplete" while some hours have no hourly cost. */
    margin?: boolean;
}

// Money KPIs (D-07, D-19); absent entirely without the money keys.
const moneyTiles = computed<MoneyTile[]>(() => {
    const current = period.value;
    if (!current || !hasMoney.value) return [];
    if (isClosed.value) {
        return [
            {
                key: 'final_margin',
                title: label('money.kpi.final_margin'),
                cents: current.margin_cents,
                margin: true,
            },
        ];
    }
    const upcoming = isUpcoming.value;
    return [
        { key: 'amount', title: label('money.kpi.amount_sold'), cents: current.amount_cents },
        {
            key: 'cost',
            title: label('money.kpi.cost_to_date'),
            cents: upcoming ? null : current.cost_cents,
        },
        {
            key: 'margin',
            title: label('money.kpi.margin_to_date'),
            cents: upcoming ? null : current.margin_cents,
            margin: !upcoming,
        },
        {
            key: 'projected_margin',
            title: label('money.kpi.projected_margin'),
            cents: upcoming ? null : current.projected_margin_cents,
            margin: !upcoming,
        },
    ];
});

const pillStatus = computed(() => {
    if (isClosed.value) return 'closed';
    if (isUpcoming.value) return 'not_started';
    return period.value?.status ?? 'on_track';
});

// Editors (08-16). They exist only when the payload allows them (can_edit_terms / can_edit_plan) and
// the shared prop carries the organization URL the writes go to; the server re-checks both.
const organizationUrl = computed(() => profitability.value.organization_url ?? null);
const queryClient = useQueryClient();
const projectName = ref<string | null>(null);
const editorOpen = ref(false);
const editorMounted = ref(false);

const canSetTerms = computed(
    () =>
        organizationUrl.value !== null &&
        summary.value?.can_edit_terms === true &&
        summary.value.contract === null
);

function openEditor() {
    projectName.value = projectNameFromCache(queryClient, props.projectId);
    editorMounted.value = true;
    editorOpen.value = true;
}

const meterCaption = computed(() => {
    if (!period.value) return '';
    const sold = period.value.budget_seconds;
    const consumed = period.value.consumed_seconds;
    return label('summary.meter_caption', {
        consumed: hours(consumed) ?? '',
        sold: hours(sold) ?? '',
        pct: sold > 0 ? formatPercent(consumed / sold) : EMPTY,
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
                <PrimaryButton
                    v-if="canSetTerms"
                    type="button"
                    class="mt-4"
                    data-testid="profitability-summary-set-terms"
                    @click="openEditor">
                    {{ label('summary.set_terms') }}
                </PrimaryButton>
            </div>
            <div v-else class="p-4 sm:p-6 space-y-6">
                <p
                    class="text-sm text-text-secondary break-words"
                    data-testid="profitability-summary-terms">
                    {{ termsLine }}
                </p>
                <dl
                    v-if="hourTiles.length > 0"
                    class="grid grid-cols-2 lg:grid-cols-4 gap-4"
                    data-testid="profitability-summary-hours">
                    <StatCard v-for="tile in hourTiles" :key="tile.key" :title="tile.title">
                        <span
                            class="tabular-nums"
                            :class="tile.tone"
                            :data-testid="`profitability-summary-${tile.key}`">
                            {{ tile.value }}
                        </span>
                        <span
                            v-if="tile.caption"
                            class="block pt-1 text-xs font-normal text-text-secondary"
                            data-testid="profitability-summary-projection-caption">
                            {{ tile.caption }}
                        </span>
                    </StatCard>
                </dl>
                <dl
                    v-if="moneyTiles.length > 0"
                    class="grid grid-cols-2 lg:grid-cols-4 gap-4"
                    data-testid="profitability-summary-money">
                    <StatCard v-for="tile in moneyTiles" :key="tile.key" :title="tile.title">
                        <TooltipProvider v-if="tile.margin && incomplete" :delay-duration="300">
                            <Tooltip>
                                <TooltipTrigger as-child>
                                    <span
                                        tabindex="0"
                                        class="inline-flex items-center gap-1 text-amber-800 dark:text-amber-400"
                                        :aria-label="
                                            label('money.incomplete_aria', { n: incompleteHours })
                                        "
                                        :data-testid="`profitability-summary-money-${tile.key}`"
                                        data-incomplete="true">
                                        <TriangleAlert class="size-4 shrink-0" aria-hidden="true" />
                                        <span>{{ label('money.incomplete') }}</span>
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>
                                        {{
                                            label('money.incomplete_tooltip', {
                                                n: incompleteHours,
                                            })
                                        }}
                                    </p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        <span
                            v-else
                            class="tabular-nums"
                            :class="tile.cents != null && tile.cents < 0 ? OVER_TONE : ''"
                            :data-testid="`profitability-summary-money-${tile.key}`">
                            {{ tile.cents == null ? EMPTY : money(tile.cents) }}
                        </span>
                    </StatCard>
                </dl>
                <div v-if="period" class="space-y-2">
                    <BudgetMeter
                        :sold-seconds="period.budget_seconds"
                        :consumed-seconds="period.consumed_seconds"
                        :projected-seconds="period.remaining_plan_seconds"
                        :status="pillStatus"
                        variant="full"
                        :closed="isClosed"
                        :labels="labels"
                        :number-format="numberFormat" />
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <span
                            class="text-xs text-text-secondary tabular-nums"
                            data-testid="profitability-summary-meter-caption">
                            {{ meterCaption }}
                        </span>
                        <StatusPill :status="pillStatus" :labels="labels" />
                    </div>
                </div>
                <PlannedVsConsumedChart
                    v-if="period && period.months.length >= 2"
                    :months="period.months"
                    :current-month="todayMonth"
                    :starts-on="period.starts_on"
                    :ends-on="period.ends_on"
                    :labels="labels"
                    :number-format="numberFormat" />
                <PeriodMonthTable
                    v-if="period && period.months.length > 0"
                    :months="period.months"
                    :current-month="todayMonth"
                    :labels="labels"
                    :number-format="numberFormat" />
            </div>
        </Card>
        <ContractEditor
            v-if="editorMounted"
            v-model:show="editorOpen"
            :project-id="projectId"
            :project-name="projectName" />
    </MainContainer>
</template>
