<script setup lang="ts">
import { computed, ref } from 'vue';
import { Link, router } from '@inertiajs/vue3';
import { CircleAlert, Ellipsis, Info, Plus, TriangleAlert } from '@lucide/vue';
import Card from '@/Components/Common/Card.vue';
import StatCard from '@/Components/Common/StatCard.vue';
import TableHeading from '@/Components/Common/TableHeading.vue';
import SortableTableHeaderCell from '@/Components/Common/SortableTableHeaderCell.vue';
import {
    Badge,
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/packages/ui/src';
import LoadingSpinner from '@/packages/ui/src/LoadingSpinner.vue';
import PrimaryButton from '@/packages/ui/src/Buttons/PrimaryButton.vue';
import SecondaryButton from '@/packages/ui/src/Buttons/SecondaryButton.vue';
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
import { getOrganizationCurrencyString } from '@/utils/money';
import { useOrganizationQuery } from '@/utils/useOrganizationQuery';
import { getCurrentOrganizationId } from '@/utils/useUser';
import {
    useSortableTable,
    type SortableColumnDef,
    type SortDirection,
} from '@/utils/useSortableTable';
import { useTableSortState, type TableSortState } from '@/utils/useTableSortState';
import BudgetMeter from './BudgetMeter.vue';
import ContractEditor from './ContractEditor.vue';
import PlanGrid from './PlanGrid.vue';
import StatusPill from './StatusPill.vue';
import { formatHours, formatHoursNumber, formatPeriod } from './format';
import {
    readQueryParam,
    replaceQueryParam,
    t,
    useProfitabilityProps,
    useViewToolbarTarget,
} from './labels';
import {
    isContractFilter,
    useProjectsViewQuery,
    type ContractFilter,
    type ProjectsViewRow,
} from './projectsApi';

// The by-project view of the Profitability page (D-14, BUDG-04, BUDG-06). It renders what the payload
// carries and nothing more (UI-SPEC "Access and Money Rendering Contract"): money columns, tiles and
// cells exist only when a row carries the money keys (`'amount_cents' in row`); a row without them in
// a mixed table gets an empty cell labelled "Not available", never 0, a dash or a lock (D-11).
const profitability = useProfitabilityProps();
const labels = computed(() => profitability.value.labels ?? null);

function label(path: string, params?: Record<string, string | number>): string {
    return t(labels.value, path, params);
}

const { organization } = useOrganizationQuery(getCurrentOrganizationId() ?? '');
const numberFormat = computed(() => organization.value?.number_format ?? null);

function hours(seconds: number): string {
    return formatHours(seconds, numberFormat.value);
}

function money(cents: number): string {
    return (
        formatCents(
            cents,
            getOrganizationCurrencyString(),
            organization.value?.currency_format,
            organization.value?.currency_symbol,
            organization.value?.number_format
        ) ?? ''
    );
}

// Contract filter, kept in ?contract= (UI-D13)
const initialContract = readQueryParam('contract');
const contract = ref<ContractFilter>(
    isContractFilter(initialContract) ? initialContract : 'active'
);

function setContract(value: unknown) {
    if (!isContractFilter(value)) return;
    contract.value = value;
    replaceQueryParam('contract', value);
}

const { data, isPending, isError, isFetching, refetch } = useProjectsViewQuery(contract);

const hasData = computed(() => data.value !== undefined);
const rows = computed<ProjectsViewRow[]>(() => data.value?.data ?? []);
const meta = computed(() => data.value?.meta ?? null);
const refreshing = computed(() => isFetching.value && hasData.value);

function hasMoney(row: ProjectsViewRow): boolean {
    return 'amount_cents' in row;
}

// The `money` label group reaches exactly the scopes that can set contract terms (Owner/Admin and
// account managers, 08-02); with no rows it is the only signal left for the editor empty state.
const canEditTermsSomewhere = computed(
    () =>
        rows.value.some((row) => row.can_edit_terms) ||
        (labels.value !== null && typeof labels.value.money === 'object')
);

const filterOptions = computed(() => {
    const options: { value: ContractFilter; text: string }[] = [
        { value: 'active', text: label('projects.filter.active') },
    ];
    if (canEditTermsSomewhere.value || contract.value === 'without') {
        options.push({ value: 'without', text: label('projects.filter.without_terms') });
    }
    options.push(
        { value: 'ended', text: label('projects.filter.ended') },
        { value: 'all', text: label('projects.filter.all') }
    );
    return options;
});

// KPI totals: rows currently listed, current periods only (08-10)
const currentRows = computed(() => rows.value.filter((row) => row.period?.state === 'current'));

function sum(list: ProjectsViewRow[], pick: (row: ProjectsViewRow) => number): number {
    return list.reduce((total, row) => total + pick(row), 0);
}

const kpi = computed(() => {
    if (!hasData.value) return null;
    const list = currentRows.value;
    return {
        sold: hours(sum(list, (row) => row.budget_seconds)),
        consumed: hours(sum(list, (row) => row.consumed_seconds)),
        still: hours(sum(list, (row) => Math.max(row.budget_seconds - row.consumed_seconds, 0))),
        atRisk: list.filter((row) => row.status === 'at_risk' || row.status === 'over').length,
    };
});

const showMoney = computed(() => rows.value.some(hasMoney));

const moneyKpi = computed(() => {
    if (!showMoney.value) return null;
    const list = currentRows.value.filter(hasMoney);
    const unpriced = sum(list, (row) => row.unpriced_cost_seconds ?? 0);
    const projectedKnown = list.every((row) => typeof row.projected_margin_cents === 'number');
    const margin = sum(list, (row) => row.margin_cents ?? 0);
    const projected = sum(list, (row) => row.projected_margin_cents ?? 0);
    return {
        amount: money(sum(list, (row) => row.amount_cents ?? 0)),
        cost: money(sum(list, (row) => row.cost_cents ?? 0)),
        margin: money(margin),
        marginLoss: margin < 0,
        // Unknown while no consumed hour has a cost: "--", never a guess
        projected: projectedKnown ? money(projected) : null,
        projectedLoss: projectedKnown && projected < 0,
        unpriced,
    };
});

const moneyCaption = computed(() => {
    if (!showMoney.value || meta.value === null) return null;
    if (meta.value.money_rows >= meta.value.total_rows) return null;
    return label('money.totals_caption', {
        n: meta.value.money_rows,
        total: meta.value.total_rows,
    });
});

// D-05 data-quality notice, Owner/Admin only: the key is present only for them
const legacySeconds = computed(() => meta.value?.nonbillable_legacy_seconds ?? 0);

// Table and sort
type SortColumn =
    | 'name'
    | 'period'
    | 'sold'
    | 'consumed'
    | 'still'
    | 'projected'
    | 'status'
    | 'amount'
    | 'cost'
    | 'margin';

const SORT_COLUMNS: readonly SortColumn[] = [
    'name',
    'period',
    'sold',
    'consumed',
    'still',
    'projected',
    'status',
    'amount',
    'cost',
    'margin',
];

// Worst first when sorted descending: Over, At risk, On track, Not started (closed and no contract last)
const SEVERITY: Record<string, number> = { over: 4, at_risk: 3, on_track: 2, not_started: 1 };

const DEFAULT_SORT: TableSortState<SortColumn> = { sortColumn: 'status', sortDirection: 'desc' };
const { tableState, handleSort } = useTableSortState('profitability-projects-table', DEFAULT_SORT);

const sortColumn = computed<SortColumn>(() =>
    SORT_COLUMNS.includes(tableState.value.sortColumn) ? tableState.value.sortColumn : 'status'
);
const sortDirection = computed<SortDirection>(() =>
    tableState.value.sortDirection === 'asc' ? 'asc' : 'desc'
);

function withPeriod<T>(row: ProjectsViewRow, value: T): T | undefined {
    return row.period ? value : undefined;
}

const columns = computed<SortableColumnDef<ProjectsViewRow, SortColumn>[]>(() => [
    { id: 'name', accessorFn: (row) => row.name.toLowerCase() },
    { id: 'period', accessorFn: (row) => row.period?.starts_on },
    { id: 'sold', sortDescFirst: true, accessorFn: (row) => withPeriod(row, row.budget_seconds) },
    {
        id: 'consumed',
        sortDescFirst: true,
        accessorFn: (row) => withPeriod(row, row.consumed_seconds),
    },
    {
        id: 'still',
        sortDescFirst: true,
        accessorFn: (row) => withPeriod(row, row.budget_seconds - row.consumed_seconds),
    },
    {
        id: 'projected',
        sortDescFirst: true,
        accessorFn: (row) => withPeriod(row, row.remaining_plan_seconds),
    },
    {
        id: 'status',
        sortDescFirst: true,
        accessorFn: (row) => (row.status === null ? undefined : SEVERITY[row.status]),
    },
    { id: 'amount', sortDescFirst: true, accessorFn: (row) => row.amount_cents },
    { id: 'cost', sortDescFirst: true, accessorFn: (row) => row.cost_cents },
    { id: 'margin', sortDescFirst: true, accessorFn: (row) => row.margin_cents },
]);

const { sortedRows, descFirstColumns, nextDirection } = useSortableTable({
    data: () => rows.value,
    columns: () => columns.value,
    sortColumn: () => sortColumn.value,
    sortDirection: () => sortDirection.value,
    tieBreakColumn: 'name',
});

const sortState = computed(() => ({
    sortColumn: sortColumn.value,
    sortDirection: sortDirection.value,
    descFirstColumns: descFirstColumns.value,
}));

function sortBy(column: SortColumn) {
    handleSort(column, nextDirection(column));
}

const gridTemplate = computed(() => {
    const money = showMoney.value
        ? ' minmax(130px, auto) minmax(130px, auto) minmax(140px, auto)'
        : '';
    return (
        'grid-template-columns: minmax(220px, 2fr) minmax(180px, auto) minmax(100px, auto)' +
        ' minmax(130px, auto) minmax(130px, auto) minmax(130px, auto) minmax(130px, auto)' +
        money +
        ' 56px;'
    );
});

function projectHref(row: ProjectsViewRow): string {
    return `/projects/${encodeURIComponent(row.project_id)}`;
}

function openProject(row: ProjectsViewRow) {
    router.visit(projectHref(row));
}

function displayStatus(row: ProjectsViewRow): string | null {
    if (row.status !== null) return row.status;
    return row.schedule === null ? 'no_contract' : null;
}

function isOver(row: ProjectsViewRow): boolean {
    return row.consumed_seconds > row.budget_seconds;
}

const CELL =
    'px-4 py-3 border-b border-row-separator transition-colors group-hover:bg-tertiary cursor-pointer min-w-0';
const NUMBER_CELL = `${CELL} text-right tabular-nums text-base text-text-primary flex flex-col items-end justify-center gap-1`;
const LOSS = 'text-red-700 dark:text-red-400';
const WARNING = 'text-amber-800 dark:text-amber-400';

const emptyState = computed(() => {
    if (!hasData.value || rows.value.length > 0) return null;
    if (contract.value === 'without' || contract.value === 'ended') return 'filter';
    return canEditTermsSomewhere.value ? 'editor' : 'pm';
});

// Editors (08-16): "Set contract terms" in the toolbar (with a project picker), and per row "Set" or
// "Edit contract terms" and "Plan months", each only where the row's flags allow it and never for a
// closed period (D-03). The server re-checks every write (T-08-41).
const organizationUrl = computed(() => profitability.value.organization_url ?? null);

interface EditorTarget {
    mode: 'set' | 'edit';
    projectId: string | null;
    projectName: string | null;
}

const editor = ref<EditorTarget | null>(null);
const editorOpen = ref(false);

const canOpenEditors = computed(() => organizationUrl.value !== null);
const canSetTermsFromToolbar = computed(() => canOpenEditors.value && canEditTermsSomewhere.value);

function openTerms(row: ProjectsViewRow | null) {
    editor.value =
        row === null
            ? { mode: 'set', projectId: null, projectName: null }
            : {
                  mode: row.schedule === null ? 'set' : 'edit',
                  projectId: row.project_id,
                  projectName: row.name,
              };
    editorOpen.value = true;
}

function canEditRowTerms(row: ProjectsViewRow): boolean {
    return canOpenEditors.value && row.can_edit_terms && row.period?.state !== 'closed';
}

function canPlanRow(row: ProjectsViewRow): boolean {
    return (
        canOpenEditors.value &&
        row.can_edit_plan &&
        row.period !== null &&
        row.period.state !== 'closed'
    );
}

interface PlanTarget {
    projectId: string;
    projectName: string;
    periodId: string;
}

const plan = ref<PlanTarget | null>(null);
const planOpen = ref(false);

function openPlan(row: ProjectsViewRow) {
    if (!row.period) return;
    plan.value = { projectId: row.project_id, projectName: row.name, periodId: row.period.id };
    planOpen.value = true;
}

const toolbarTarget = useViewToolbarTarget();
const teleportTo = computed(() => toolbarTarget?.value ?? null);
</script>

<template>
    <div data-testid="profitability-projects-view" class="space-y-6">
        <Teleport :to="teleportTo ?? 'body'" :disabled="teleportTo === null">
            <div class="flex items-center gap-3" data-testid="profitability-projects-toolbar">
                <LoadingSpinner
                    v-if="refreshing"
                    class="h-4 w-4 m-0"
                    data-testid="profitability-projects-refreshing" />
                <span class="text-sm text-text-secondary">{{
                    label('projects.filter_label')
                }}</span>
                <PrimaryButton
                    v-if="canSetTermsFromToolbar"
                    type="button"
                    :icon="Plus"
                    data-testid="profitability-projects-set-terms"
                    @click="openTerms(null)">
                    {{ label('summary.set_terms') }}
                </PrimaryButton>
                <Select :model-value="contract" @update:model-value="setContract">
                    <SelectTrigger
                        class="w-56"
                        :aria-label="label('projects.filter_label')"
                        data-testid="profitability-contract-filter">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem
                            v-for="option in filterOptions"
                            :key="option.value"
                            :value="option.value">
                            {{ option.text }}
                        </SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </Teleport>

        <Card v-if="isError" data-testid="profitability-projects-error">
            <div class="p-4 sm:p-6 flex flex-wrap items-center gap-3 text-sm text-text-secondary">
                <CircleAlert class="size-4 shrink-0" aria-hidden="true" />
                <span>{{ label('common.load_error') }}</span>
                <SecondaryButton @click="refetch()">{{
                    label('common.try_again')
                }}</SecondaryButton>
            </div>
        </Card>

        <template v-else>
            <dl class="grid grid-cols-2 lg:grid-cols-4 gap-4 tabular-nums">
                <StatCard :title="label('kpi.hours_sold')" :value="kpi?.sold" />
                <StatCard :title="label('kpi.hours_consumed')" :value="kpi?.consumed" />
                <StatCard :title="label('kpi.still_to_consume')" :value="kpi?.still" />
                <StatCard :title="label('kpi.projects_at_risk')">
                    <span
                        v-if="kpi"
                        class="inline-flex items-center gap-2"
                        data-testid="profitability-kpi-at-risk">
                        {{ kpi.atRisk }}
                        <TriangleAlert
                            v-if="kpi.atRisk > 0"
                            :class="['size-4', WARNING]"
                            aria-hidden="true" />
                    </span>
                </StatCard>
            </dl>

            <div v-if="moneyKpi" class="space-y-2" data-testid="profitability-money-kpis">
                <dl class="grid grid-cols-2 lg:grid-cols-4 gap-4 tabular-nums">
                    <StatCard :title="label('money.kpi.amount_sold')" :value="moneyKpi.amount" />
                    <StatCard :title="label('money.kpi.cost_to_date')" :value="moneyKpi.cost" />
                    <StatCard :title="label('money.kpi.margin_to_date')">
                        <span
                            v-if="moneyKpi.unpriced > 0"
                            :class="['inline-flex items-center gap-2', WARNING]"
                            :aria-label="
                                label('money.incomplete_aria', {
                                    n: formatHoursNumber(moneyKpi.unpriced, numberFormat),
                                })
                            ">
                            <TriangleAlert class="size-4" aria-hidden="true" />
                            {{ label('money.incomplete') }}
                        </span>
                        <span v-else :class="moneyKpi.marginLoss ? LOSS : ''">{{
                            moneyKpi.margin
                        }}</span>
                    </StatCard>
                    <StatCard :title="label('money.kpi.projected_margin')">
                        <span
                            v-if="moneyKpi.unpriced > 0"
                            :class="['inline-flex items-center gap-2', WARNING]"
                            :aria-label="
                                label('money.incomplete_aria', {
                                    n: formatHoursNumber(moneyKpi.unpriced, numberFormat),
                                })
                            ">
                            <TriangleAlert class="size-4" aria-hidden="true" />
                            {{ label('money.incomplete') }}
                        </span>
                        <span v-else :class="moneyKpi.projectedLoss ? LOSS : ''">{{
                            moneyKpi.projected ?? '--'
                        }}</span>
                    </StatCard>
                </dl>
                <p
                    v-if="moneyCaption"
                    class="text-xs text-text-secondary"
                    data-testid="profitability-money-caption">
                    {{ moneyCaption }}
                </p>
            </div>

            <Card v-if="legacySeconds > 0" data-testid="profitability-legacy-notice">
                <div class="px-4 py-3 flex items-start gap-2 text-sm text-text-secondary">
                    <Info class="size-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <p>{{ label('admin.legacy_nonbillable', { h: hours(legacySeconds) }) }}</p>
                </div>
            </Card>

            <Card>
                <div
                    v-if="isPending"
                    class="flex justify-center items-center py-12"
                    data-testid="profitability-projects-loading"
                    aria-busy="true">
                    <LoadingSpinner />
                </div>
                <div
                    v-else-if="emptyState === 'filter'"
                    class="py-12 px-4 flex flex-col items-center text-center gap-3"
                    data-testid="profitability-projects-empty-filter">
                    <p class="text-sm text-text-secondary">{{ label('projects.empty_filter') }}</p>
                    <SecondaryButton size="small" @click="setContract('all')">
                        {{ label('common.show_all') }}
                    </SecondaryButton>
                </div>
                <div
                    v-else-if="emptyState !== null"
                    class="py-12 px-4 flex flex-col items-center text-center gap-1"
                    :data-testid="`profitability-projects-empty-${emptyState}`">
                    <p class="text-base font-semibold text-text-primary">
                        {{
                            emptyState === 'editor'
                                ? label('projects.empty_editor_title')
                                : label('projects.empty_pm_title')
                        }}
                    </p>
                    <p class="text-sm text-text-secondary max-w-md">
                        {{
                            emptyState === 'editor'
                                ? label('projects.empty_editor_body')
                                : label('projects.empty_pm_body')
                        }}
                    </p>
                    <PrimaryButton
                        v-if="emptyState === 'editor' && canSetTermsFromToolbar"
                        type="button"
                        class="mt-4"
                        :icon="Plus"
                        data-testid="profitability-projects-empty-set-terms"
                        @click="openTerms(null)">
                        {{ label('summary.set_terms') }}
                    </PrimaryButton>
                </div>
                <div v-else class="overflow-x-auto">
                    <div
                        class="grid min-w-full w-max lg:w-full"
                        :style="gridTemplate"
                        data-testid="profitability-projects-table">
                        <TableHeading>
                            <SortableTableHeaderCell
                                class="px-4 sticky left-0 z-10"
                                column="name"
                                v-bind="sortState"
                                @sort="sortBy">
                                {{ label('projects.columns.project') }}
                            </SortableTableHeaderCell>
                            <SortableTableHeaderCell
                                class="px-4"
                                column="period"
                                v-bind="sortState"
                                @sort="sortBy">
                                {{ label('projects.columns.period') }}
                            </SortableTableHeaderCell>
                            <SortableTableHeaderCell
                                class="px-4 justify-end"
                                column="sold"
                                v-bind="sortState"
                                @sort="sortBy">
                                {{ label('projects.columns.sold') }}
                            </SortableTableHeaderCell>
                            <SortableTableHeaderCell
                                class="px-4 justify-end"
                                column="consumed"
                                v-bind="sortState"
                                @sort="sortBy">
                                {{ label('projects.columns.consumed') }}
                            </SortableTableHeaderCell>
                            <SortableTableHeaderCell
                                class="px-4 justify-end"
                                column="still"
                                v-bind="sortState"
                                @sort="sortBy">
                                {{ label('projects.columns.still_to_consume') }}
                            </SortableTableHeaderCell>
                            <SortableTableHeaderCell
                                class="px-4 justify-end"
                                column="projected"
                                v-bind="sortState"
                                @sort="sortBy">
                                {{ label('projects.columns.projected_at_close') }}
                            </SortableTableHeaderCell>
                            <SortableTableHeaderCell
                                class="px-4"
                                column="status"
                                v-bind="sortState"
                                @sort="sortBy">
                                {{ label('projects.columns.status') }}
                            </SortableTableHeaderCell>
                            <template v-if="showMoney">
                                <SortableTableHeaderCell
                                    class="px-4 justify-end"
                                    column="amount"
                                    v-bind="sortState"
                                    @sort="sortBy">
                                    {{ label('money.columns.amount') }}
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
                            </template>
                            <div></div>
                        </TableHeading>

                        <div
                            v-for="row in sortedRows"
                            :key="row.project_id"
                            role="row"
                            class="contents group"
                            data-testid="profitability-projects-row"
                            :data-project-id="row.project_id"
                            @click="openProject(row)">
                            <div
                                role="cell"
                                :class="[CELL, 'sticky left-0 z-10 bg-card-background']">
                                <div class="flex items-center gap-2 min-w-0">
                                    <span
                                        class="w-3 h-3 rounded-full shrink-0"
                                        :style="{ backgroundColor: row.color }"></span>
                                    <Link
                                        :href="projectHref(row)"
                                        class="truncate text-base text-text-primary hover:underline"
                                        :title="row.name"
                                        @click.stop>
                                        {{ row.name }}
                                    </Link>
                                </div>
                                <div
                                    class="truncate text-xs text-text-secondary pl-5"
                                    :title="row.client_name ?? label('common.no_client')">
                                    {{ row.client_name ?? label('common.no_client') }}
                                </div>
                            </div>
                            <div role="cell" :class="[CELL, 'text-sm text-text-primary']">
                                <template v-if="row.period">
                                    <div class="flex items-center gap-2 tabular-nums">
                                        <span class="whitespace-nowrap">{{
                                            formatPeriod(row.period.starts_on, row.period.ends_on)
                                        }}</span>
                                        <Badge>{{
                                            label(`period_state.${row.period.state}`)
                                        }}</Badge>
                                    </div>
                                    <div
                                        v-if="row.schedule"
                                        class="text-xs text-text-secondary pt-1">
                                        {{ label(`schedule.${row.schedule}`) }}
                                    </div>
                                </template>
                            </div>
                            <div role="cell" :class="NUMBER_CELL">
                                <template v-if="row.period">{{
                                    hours(row.budget_seconds)
                                }}</template>
                            </div>
                            <div role="cell" :class="NUMBER_CELL">
                                <template v-if="row.period">
                                    <span>{{ hours(row.consumed_seconds) }}</span>
                                    <BudgetMeter
                                        class="w-24"
                                        variant="compact"
                                        :sold-seconds="row.budget_seconds"
                                        :consumed-seconds="row.consumed_seconds"
                                        :projected-seconds="row.remaining_plan_seconds"
                                        :status="row.status ?? 'not_started'"
                                        :closed="row.period.state === 'closed'"
                                        :labels="labels"
                                        :number-format="numberFormat" />
                                </template>
                            </div>
                            <div role="cell" :class="NUMBER_CELL">
                                <template v-if="row.period">
                                    <span
                                        v-if="isOver(row)"
                                        :class="LOSS"
                                        data-testid="profitability-hours-over">
                                        {{
                                            label('common.hours_over', {
                                                n: formatHoursNumber(
                                                    row.consumed_seconds - row.budget_seconds,
                                                    numberFormat
                                                ),
                                            })
                                        }}
                                    </span>
                                    <span v-else>{{ hours(row.still_to_consume_seconds) }}</span>
                                </template>
                            </div>
                            <div role="cell" :class="NUMBER_CELL">
                                <template v-if="row.period">{{
                                    hours(row.remaining_plan_seconds)
                                }}</template>
                            </div>
                            <div role="cell" :class="[CELL, 'flex items-center']">
                                <StatusPill
                                    v-if="displayStatus(row)"
                                    :status="displayStatus(row) as string"
                                    :labels="labels" />
                            </div>
                            <template v-if="showMoney">
                                <template v-if="hasMoney(row)">
                                    <div role="cell" :class="NUMBER_CELL">
                                        {{ money(row.amount_cents ?? 0) }}
                                    </div>
                                    <div role="cell" :class="NUMBER_CELL">
                                        {{ money(row.cost_cents ?? 0) }}
                                    </div>
                                    <div role="cell" :class="NUMBER_CELL">
                                        <TooltipProvider
                                            v-if="(row.unpriced_cost_seconds ?? 0) > 0"
                                            :delay-duration="300">
                                            <Tooltip>
                                                <TooltipTrigger as-child>
                                                    <span
                                                        tabindex="0"
                                                        :class="[
                                                            'inline-flex items-center gap-1',
                                                            WARNING,
                                                        ]"
                                                        data-testid="profitability-margin-incomplete"
                                                        :aria-label="
                                                            label('money.incomplete_aria', {
                                                                n: formatHoursNumber(
                                                                    row.unpriced_cost_seconds ?? 0,
                                                                    numberFormat
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
                                                                n: formatHoursNumber(
                                                                    row.unpriced_cost_seconds ?? 0,
                                                                    numberFormat
                                                                ),
                                                            })
                                                        }}
                                                    </p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                        <span
                                            v-else
                                            :class="(row.margin_cents ?? 0) < 0 ? LOSS : ''">
                                            {{ money(row.margin_cents ?? 0) }}
                                        </span>
                                    </div>
                                </template>
                                <template v-else>
                                    <div
                                        v-for="column in ['amount', 'cost', 'margin']"
                                        :key="column"
                                        role="cell"
                                        :class="NUMBER_CELL"
                                        :aria-label="label('common.not_available')"
                                        data-testid="profitability-money-not-available"></div>
                                </template>
                            </template>
                            <div
                                role="cell"
                                :class="[CELL, 'flex items-center justify-end px-2']"
                                @click.stop>
                                <DropdownMenu>
                                    <DropdownMenuTrigger as-child>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            class="h-8 w-8"
                                            :aria-label="
                                                label('projects.actions_aria', {
                                                    project: row.name,
                                                })
                                            "
                                            data-testid="profitability-projects-actions">
                                            <Ellipsis aria-hidden="true" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" class="min-w-[160px]">
                                        <DropdownMenuItem
                                            class="cursor-pointer"
                                            @click="openProject(row)">
                                            {{ label('projects.open_project') }}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            v-if="canEditRowTerms(row)"
                                            class="cursor-pointer"
                                            data-testid="profitability-projects-edit-terms"
                                            @click="openTerms(row)">
                                            {{
                                                row.schedule === null
                                                    ? label('summary.set_terms')
                                                    : label('summary.edit_terms')
                                            }}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            v-if="canPlanRow(row)"
                                            class="cursor-pointer"
                                            data-testid="profitability-projects-plan-months"
                                            @click="openPlan(row)">
                                            {{ label('summary.plan_months') }}
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </div>
                    </div>
                </div>
            </Card>
        </template>

        <ContractEditor
            v-if="editor"
            :key="`${editor.mode}-${editor.projectId ?? 'picker'}`"
            v-model:show="editorOpen"
            :mode="editor.mode"
            :project-id="editor.projectId"
            :project-name="editor.projectName" />
        <PlanGrid
            v-if="plan"
            :key="`${plan.projectId}-${plan.periodId}`"
            v-model:show="planOpen"
            :project-id="plan.projectId"
            :period-id="plan.periodId"
            :project-name="plan.projectName" />
    </div>
</template>
