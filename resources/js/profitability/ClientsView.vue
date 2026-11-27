<script setup lang="ts">
import { computed, ref } from 'vue';
import { Link } from '@inertiajs/vue3';
import { ChevronDown, ChevronRight, CircleAlert, Coins, TriangleAlert } from '@lucide/vue';
import Card from '@/Components/Common/Card.vue';
import StatCard from '@/Components/Common/StatCard.vue';
import TableHeading from '@/Components/Common/TableHeading.vue';
import SortableTableHeaderCell from '@/Components/Common/SortableTableHeaderCell.vue';
import LoadingSpinner from '@/packages/ui/src/LoadingSpinner.vue';
import SecondaryButton from '@/packages/ui/src/Buttons/SecondaryButton.vue';
import CardTitle from '@/packages/ui/src/CardTitle.vue';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/packages/ui/src/tooltip';
import { formatCents } from '@/packages/ui/src/utils/money';
import { getOrganizationCurrencyString } from '@/utils/money';
import { useOrganizationQuery } from '@/utils/useOrganizationQuery';
import { getCurrentOrganizationId } from '@/utils/useUser';
import { useTableSortState } from '@/utils/useTableSortState';
import ClientMarginChart from './ClientMarginChart.vue';
import RangeSelect from './RangeSelect.vue';
import StatusPill from './StatusPill.vue';
import { formatHours, formatHoursNumber } from './format';
import {
    initialRange,
    t,
    useProfitabilityProps,
    useViewToolbarTarget,
    type RangeKey,
} from './labels';
import {
    CLIENT_DESC_FIRST,
    DEFAULT_CLIENT_SORT,
    formatMarginPercent,
    isClientSortColumn,
    sortClientRows,
    useClientsViewQuery,
    type ClientSortColumn,
    type ClientSortDirection,
    type ClientsViewClient,
    type ClientsViewProject,
} from './clientsApi';
import type { ClientMarginEntry } from './clientMarginOption';

// The Clients view of the Profitability page (D-07, D-11, D-14, BUDG-06): the account manager's
// portfolio for a calendar range, money sold against cost per client, expandable into projects. The
// endpoint answers only scopes with money (Owner/Admin, account managers); a scope without it never
// gets this tab (the server's `views` list) and the endpoint is a 404 for it (08-14).
const profitability = useProfitabilityProps();
const labels = computed(() => profitability.value.labels ?? null);

function label(path: string, params?: Record<string, string | number>): string {
    return t(labels.value, path, params);
}

const { organization } = useOrganizationQuery(getCurrentOrganizationId() ?? '');
const numberFormat = computed(() => organization.value?.number_format ?? null);

const MINUS = '−';

function hours(seconds: number): string {
    return formatHours(seconds, numberFormat.value);
}

// Money keeps the organization's currency and formats (D-09); a loss is a real minus in front of the
// amount plus the loss colour (formatCents alone would write "€-1,250.00").
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

function unpricedHours(seconds: number): string {
    return formatHoursNumber(seconds, numberFormat.value);
}

// Range, kept in ?range= by RangeSelect (UI-D13)
const range = ref<RangeKey>(initialRange());

const { data, isPending, isError, isFetching, refetch } = useClientsViewQuery(range);

const hasData = computed(() => data.value !== undefined);
const clients = computed<ClientsViewClient[]>(() => data.value?.data ?? []);
const meta = computed(() => data.value?.meta ?? null);
const refreshing = computed(() => isFetching.value && hasData.value);

const rangeContainsToday = computed(() => meta.value?.range?.contains_today === true);
const rangeDate = computed(() => meta.value?.range?.capped_to ?? null);

// KPI strip from meta.totals (focal point: the Margin tile)
const kpi = computed(() => {
    const totals = meta.value?.totals;
    if (!hasData.value || !totals) return null;
    return {
        amount: money(totals.amount_cents),
        cost: money(totals.cost_cents),
        margin: money(totals.margin_cents),
        marginLoss: totals.margin_cents < 0,
        marginPct: formatMarginPercent(totals.margin_percent),
        unpriced: totals.unpriced_cost_seconds,
        sold: hours(totals.hours_sold_seconds),
        consumed: hours(totals.consumed_seconds),
    };
});

// Table: default sort margin ascending (losses first), "No client" always last
const { tableState, handleSort } = useTableSortState(
    'profitability-clients-table',
    DEFAULT_CLIENT_SORT
);

const sortColumn = computed<ClientSortColumn>(() =>
    isClientSortColumn(tableState.value.sortColumn)
        ? tableState.value.sortColumn
        : DEFAULT_CLIENT_SORT.sortColumn
);
const sortDirection = computed<ClientSortDirection>(() =>
    tableState.value.sortDirection === 'desc' ? 'desc' : 'asc'
);

const sortState = computed(() => ({
    sortColumn: sortColumn.value,
    sortDirection: sortDirection.value,
    descFirstColumns: CLIENT_DESC_FIRST,
}));

function sortBy(column: ClientSortColumn) {
    if (column === sortColumn.value) {
        handleSort(column, sortDirection.value === 'asc' ? 'desc' : 'asc');
        return;
    }
    handleSort(column, CLIENT_DESC_FIRST.has(column) ? 'desc' : 'asc');
}

const NO_CLIENT_KEY = '__no_client__';

function clientKey(client: ClientsViewClient): string {
    return client.client_id ?? NO_CLIENT_KEY;
}

function clientName(client: ClientsViewClient): string {
    return client.name ?? label('common.no_client');
}

function projectCount(client: ClientsViewClient): string {
    return label(
        client.project_count === 1 ? 'clients.project_count_one' : 'clients.project_count',
        { count: client.project_count }
    );
}

const expanded = ref<Set<string>>(new Set());

function isExpanded(client: ClientsViewClient): boolean {
    return expanded.value.has(clientKey(client));
}

function toggle(client: ClientsViewClient) {
    const next = new Set(expanded.value);
    const key = clientKey(client);
    if (next.has(key)) {
        next.delete(key);
    } else {
        next.add(key);
    }
    expanded.value = next;
}

type DisplayRow =
    | { kind: 'client'; key: string; client: ClientsViewClient; figures: ClientsViewClient }
    | { kind: 'project'; key: string; project: ClientsViewProject; figures: ClientsViewProject };

const displayRows = computed<DisplayRow[]>(() => {
    const rows: DisplayRow[] = [];
    for (const client of sortClientRows(clients.value, sortColumn.value, sortDirection.value)) {
        const key = clientKey(client);
        rows.push({ kind: 'client', key: `client-${key}`, client, figures: client });
        if (!isExpanded(client)) continue;
        const projects = sortClientRows(
            client.projects,
            sortColumn.value,
            sortDirection.value,
            false
        );
        for (const project of projects) {
            rows.push({
                kind: 'project',
                key: `project-${key}-${project.project_id}`,
                project,
                figures: project,
            });
        }
    }
    return rows;
});

function projectHref(project: ClientsViewProject): string {
    return `/projects/${encodeURIComponent(project.project_id)}`;
}

const GRID_TEMPLATE =
    'grid-template-columns: minmax(240px, 2fr) repeat(6, minmax(120px, auto)) minmax(140px, auto);';

const CELL = 'px-4 py-3 border-b border-row-separator min-w-0';
const NUMBER_CELL = `${CELL} text-right tabular-nums text-base text-text-primary flex items-center justify-end`;
const LOSS = 'text-red-700 dark:text-red-400';
const WARNING = 'text-amber-800 dark:text-amber-400';

// "Margin by client" chart: only with two or more clients (UI-SPEC zero-one-many)
const chartClients = computed<ClientMarginEntry[]>(() =>
    clients.value.map((client) => ({
        key: clientKey(client),
        name: clientName(client),
        margin_cents: client.margin_cents,
        amount_cents: client.amount_cents,
        cost_cents: client.cost_cents,
        margin_percent: client.margin_percent,
        unpriced_cost_seconds: client.unpriced_cost_seconds,
    }))
);
const showChart = computed(() => chartClients.value.length >= 2);
const rangeLabel = computed(() => label(`ranges.${range.value}`));

const isEmpty = computed(() => hasData.value && clients.value.length === 0);

const toolbarTarget = useViewToolbarTarget();
const teleportTo = computed(() => toolbarTarget?.value ?? null);
</script>

<template>
    <div data-testid="profitability-clients-view" class="space-y-6">
        <Teleport :to="teleportTo ?? 'body'" :disabled="teleportTo === null">
            <div class="flex items-start gap-3" data-testid="profitability-clients-toolbar">
                <LoadingSpinner
                    v-if="refreshing"
                    class="h-4 w-4 m-0 mt-2.5"
                    data-testid="profitability-clients-refreshing" />
                <RangeSelect
                    v-model="range"
                    :contains-today="rangeContainsToday"
                    :date="rangeDate" />
            </div>
        </Teleport>

        <Card v-if="isError" data-testid="profitability-clients-error">
            <div class="p-4 sm:p-6 flex flex-wrap items-center gap-3 text-sm text-text-secondary">
                <CircleAlert class="size-4 shrink-0" aria-hidden="true" />
                <span>{{ label('common.load_error') }}</span>
                <SecondaryButton @click="refetch()">{{
                    label('common.try_again')
                }}</SecondaryButton>
            </div>
        </Card>

        <template v-else>
            <div class="space-y-4" data-testid="profitability-clients-kpis">
                <dl class="grid grid-cols-2 lg:grid-cols-4 gap-4 tabular-nums">
                    <StatCard :title="label('money.kpi.amount_sold')" :value="kpi?.amount" />
                    <StatCard :title="label('money.kpi.cost')" :value="kpi?.cost" />
                    <StatCard :title="label('money.kpi.margin')">
                        <span
                            v-if="kpi && kpi.unpriced > 0"
                            :class="['inline-flex items-center gap-2', WARNING]"
                            data-testid="profitability-clients-kpi-margin-incomplete"
                            :aria-label="
                                label('money.incomplete_aria', { n: unpricedHours(kpi.unpriced) })
                            ">
                            <TriangleAlert class="size-4" aria-hidden="true" />
                            {{ label('money.incomplete') }}
                        </span>
                        <span
                            v-else
                            :class="kpi?.marginLoss ? LOSS : ''"
                            data-testid="profitability-clients-kpi-margin"
                            >{{ kpi?.margin ?? '--' }}</span
                        >
                    </StatCard>
                    <StatCard :title="label('money.kpi.margin_pct')">
                        <span
                            v-if="kpi && kpi.unpriced > 0"
                            :class="['inline-flex items-center gap-2', WARNING]"
                            :aria-label="
                                label('money.incomplete_aria', { n: unpricedHours(kpi.unpriced) })
                            ">
                            <TriangleAlert class="size-4" aria-hidden="true" />
                            {{ label('money.incomplete') }}
                        </span>
                        <span v-else :class="kpi?.marginLoss ? LOSS : ''">{{
                            kpi?.marginPct ?? '--'
                        }}</span>
                    </StatCard>
                </dl>
                <dl class="grid grid-cols-2 lg:grid-cols-4 gap-4 tabular-nums">
                    <StatCard :title="label('kpi.hours_sold')" :value="kpi?.sold" />
                    <StatCard :title="label('kpi.hours_consumed')" :value="kpi?.consumed" />
                </dl>
            </div>

            <Card v-if="showChart" data-testid="profitability-client-margin-card">
                <div class="px-4 pt-2 pb-4">
                    <CardTitle :title="label('money.margin_chart_title')" :icon="Coins" />
                    <ClientMarginChart
                        :clients="chartClients"
                        :range-label="rangeLabel"
                        :labels="labels"
                        :number-format="numberFormat"
                        :format-money="money" />
                </div>
            </Card>

            <Card>
                <div
                    v-if="isPending"
                    class="flex justify-center items-center py-12"
                    data-testid="profitability-clients-loading"
                    aria-busy="true">
                    <LoadingSpinner />
                </div>
                <div
                    v-else-if="isEmpty"
                    class="py-12 px-4 flex flex-col items-center text-center gap-1"
                    data-testid="profitability-clients-empty">
                    <p class="text-base font-semibold text-text-primary">
                        {{ label('clients.empty_title') }}
                    </p>
                    <p class="text-sm text-text-secondary max-w-md">
                        {{ label('clients.empty_body') }}
                    </p>
                </div>
                <div v-else class="overflow-x-auto">
                    <div
                        class="grid min-w-full w-max lg:w-full"
                        :style="GRID_TEMPLATE"
                        role="table"
                        data-testid="profitability-clients-table">
                        <TableHeading>
                            <SortableTableHeaderCell
                                class="px-4 sticky left-0 z-10"
                                column="name"
                                v-bind="sortState"
                                @sort="sortBy">
                                {{ label('clients.columns.client') }}
                            </SortableTableHeaderCell>
                            <SortableTableHeaderCell
                                class="px-4 justify-end"
                                column="sold"
                                v-bind="sortState"
                                @sort="sortBy">
                                {{ label('clients.columns.hours_sold') }}
                            </SortableTableHeaderCell>
                            <SortableTableHeaderCell
                                class="px-4 justify-end"
                                column="consumed"
                                v-bind="sortState"
                                @sort="sortBy">
                                {{ label('clients.columns.hours_consumed') }}
                            </SortableTableHeaderCell>
                            <SortableTableHeaderCell
                                class="px-4 justify-end"
                                column="amount"
                                v-bind="sortState"
                                @sort="sortBy">
                                {{ label('money.columns.amount_sold') }}
                            </SortableTableHeaderCell>
                            <SortableTableHeaderCell
                                class="px-4 justify-end"
                                column="cost"
                                v-bind="sortState"
                                @sort="sortBy">
                                {{ label('money.columns.cost') }}
                            </SortableTableHeaderCell>
                            <SortableTableHeaderCell
                                class="px-4 justify-end"
                                column="margin"
                                v-bind="sortState"
                                @sort="sortBy">
                                {{ label('money.columns.margin') }}
                            </SortableTableHeaderCell>
                            <SortableTableHeaderCell
                                class="px-4 justify-end"
                                column="margin_pct"
                                v-bind="sortState"
                                @sort="sortBy">
                                {{ label('money.columns.margin_pct') }}
                            </SortableTableHeaderCell>
                            <SortableTableHeaderCell
                                class="px-4"
                                column="status"
                                v-bind="sortState"
                                @sort="sortBy">
                                {{ label('clients.columns.status') }}
                            </SortableTableHeaderCell>
                        </TableHeading>

                        <div
                            v-for="row in displayRows"
                            :key="row.key"
                            role="row"
                            class="contents group"
                            :data-testid="
                                row.kind === 'client'
                                    ? 'profitability-clients-row'
                                    : 'profitability-clients-project-row'
                            "
                            :data-client-id="
                                row.kind === 'client' ? (row.client.client_id ?? '') : undefined
                            "
                            :data-project-id="
                                row.kind === 'project' ? row.project.project_id : undefined
                            ">
                            <div
                                role="cell"
                                :class="[
                                    CELL,
                                    'sticky left-0 z-10 bg-card-background transition-colors group-hover:bg-tertiary',
                                ]">
                                <div v-if="row.kind === 'client'" class="flex items-start gap-2">
                                    <button
                                        v-if="row.client.projects.length > 0"
                                        type="button"
                                        class="shrink-0 size-6 inline-flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        :aria-expanded="isExpanded(row.client)"
                                        :aria-label="
                                            label(
                                                isExpanded(row.client)
                                                    ? 'clients.collapse_aria'
                                                    : 'clients.expand_aria',
                                                { client: clientName(row.client) }
                                            )
                                        "
                                        data-testid="profitability-clients-toggle"
                                        @click="toggle(row.client)">
                                        <ChevronDown
                                            v-if="isExpanded(row.client)"
                                            class="size-4"
                                            aria-hidden="true" />
                                        <ChevronRight v-else class="size-4" aria-hidden="true" />
                                    </button>
                                    <span v-else class="shrink-0 size-6"></span>
                                    <div class="min-w-0">
                                        <div
                                            class="truncate text-base text-text-primary"
                                            :title="clientName(row.client)"
                                            data-testid="profitability-clients-name">
                                            {{ clientName(row.client) }}
                                        </div>
                                        <div class="truncate text-xs text-text-secondary">
                                            {{ projectCount(row.client) }}
                                        </div>
                                    </div>
                                </div>
                                <div v-else class="flex items-center gap-2 min-w-0 pl-6">
                                    <span class="shrink-0 size-6"></span>
                                    <span
                                        class="w-3 h-3 rounded-full shrink-0"
                                        :style="{ backgroundColor: row.project.color }"></span>
                                    <Link
                                        :href="projectHref(row.project)"
                                        class="truncate text-base text-text-primary hover:underline"
                                        :title="row.project.name">
                                        {{ row.project.name }}
                                    </Link>
                                </div>
                            </div>
                            <div role="cell" :class="NUMBER_CELL">
                                {{ hours(row.figures.hours_sold_seconds) }}
                            </div>
                            <div role="cell" :class="NUMBER_CELL">
                                {{ hours(row.figures.consumed_seconds) }}
                            </div>
                            <div role="cell" :class="NUMBER_CELL">
                                {{ money(row.figures.amount_cents) }}
                            </div>
                            <div role="cell" :class="NUMBER_CELL">
                                {{ money(row.figures.cost_cents) }}
                            </div>
                            <div role="cell" :class="NUMBER_CELL">
                                <TooltipProvider
                                    v-if="row.figures.unpriced_cost_seconds > 0"
                                    :delay-duration="300">
                                    <Tooltip>
                                        <TooltipTrigger as-child>
                                            <span
                                                tabindex="0"
                                                :class="['inline-flex items-center gap-1', WARNING]"
                                                data-testid="profitability-clients-margin-incomplete"
                                                :aria-label="
                                                    label('money.incomplete_aria', {
                                                        n: unpricedHours(
                                                            row.figures.unpriced_cost_seconds
                                                        ),
                                                    })
                                                ">
                                                <TriangleAlert
                                                    class="size-3.5"
                                                    aria-hidden="true" />
                                                {{ label('money.incomplete') }}
                                            </span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>
                                                {{
                                                    label('money.incomplete_tooltip', {
                                                        n: unpricedHours(
                                                            row.figures.unpriced_cost_seconds
                                                        ),
                                                    })
                                                }}
                                            </p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                                <span
                                    v-else
                                    :class="row.figures.margin_cents < 0 ? LOSS : ''"
                                    data-testid="profitability-clients-margin">
                                    {{ money(row.figures.margin_cents) }}
                                </span>
                            </div>
                            <div role="cell" :class="NUMBER_CELL">
                                <span
                                    :class="
                                        row.figures.unpriced_cost_seconds === 0 &&
                                        (row.figures.margin_percent ?? 0) < 0
                                            ? LOSS
                                            : ''
                                    "
                                    data-testid="profitability-clients-margin-pct">
                                    {{
                                        row.figures.unpriced_cost_seconds > 0
                                            ? '--'
                                            : formatMarginPercent(row.figures.margin_percent)
                                    }}
                                </span>
                            </div>
                            <div role="cell" :class="[CELL, 'flex items-center']">
                                <StatusPill
                                    v-if="row.figures.status !== null"
                                    :status="row.figures.status"
                                    :labels="labels" />
                            </div>
                        </div>
                    </div>
                </div>
            </Card>
        </template>
    </div>
</template>
