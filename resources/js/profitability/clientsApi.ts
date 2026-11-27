import axios from 'axios';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { getCurrentOrganizationId } from '@/utils/useUser';
import { useProfitabilityProps, type RangeKey } from './labels';

// Client of the Clients view (08-14, GET {organization_url}/views/clients?range=). Web-group route
// (session + XSRF) through the global axios, never the generated API client. The endpoint answers
// only scopes with money (Owner/Admin, account managers), so every row carries the money keys.

export interface ClientsViewProject {
    project_id: string;
    name: string;
    color: string;
    client_id: string | null;
    archived: boolean;
    hours_sold_seconds: number;
    consumed_seconds: number;
    amount_cents: number;
    cost_cents: number;
    margin_cents: number;
    /** margin / amount x 100, unrounded; null when the amount is 0. */
    margin_percent: number | null;
    unpriced_cost_seconds: number;
    status: string | null;
}

export interface ClientsViewClient {
    /** null for the "No client" bucket (Owner/Admin only, always last). */
    client_id: string | null;
    name: string | null;
    project_count: number;
    hours_sold_seconds: number;
    consumed_seconds: number;
    amount_cents: number;
    cost_cents: number;
    margin_cents: number;
    margin_percent: number | null;
    unpriced_cost_seconds: number;
    /** Worst project status of the client. */
    status: string | null;
    projects: ClientsViewProject[];
}

export interface ClientsViewTotals {
    hours_sold_seconds: number;
    consumed_seconds: number;
    amount_cents: number;
    cost_cents: number;
    margin_cents: number;
    margin_percent: number | null;
    unpriced_cost_seconds: number;
}

export interface ClientsViewRange {
    key: string;
    from: string;
    to: string;
    capped_to: string;
    contains_today: boolean;
}

export interface ClientsView {
    data: ClientsViewClient[];
    meta: {
        range: ClientsViewRange | null;
        totals: ClientsViewTotals;
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
    return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function int(value: unknown): number {
    return isNumber(value) ? value : 0;
}

function percent(value: unknown): number | null {
    return isNumber(value) ? value : null;
}

/** margin / amount x 100, null without an amount (the server rule, for totals it did not send). */
export function marginPercent(amountCents: number, marginCents: number): number | null {
    return amountCents === 0 ? null : (marginCents / amountCents) * 100;
}

/** One project row, or null without a project id or name. */
export function parseClientsViewProject(value: unknown): ClientsViewProject | null {
    if (!isRecord(value) || !isString(value.project_id) || !isString(value.name)) return null;
    return {
        project_id: value.project_id,
        name: value.name,
        color: isString(value.color) ? value.color : '',
        client_id: isString(value.client_id) ? value.client_id : null,
        archived: value.archived === true,
        hours_sold_seconds: int(value.hours_sold_seconds),
        consumed_seconds: int(value.consumed_seconds),
        amount_cents: int(value.amount_cents),
        cost_cents: int(value.cost_cents),
        margin_cents: int(value.margin_cents),
        margin_percent: percent(value.margin_percent),
        unpriced_cost_seconds: int(value.unpriced_cost_seconds),
        status: isString(value.status) ? value.status : null,
    };
}

/** One client row. The "No client" bucket has client_id and name null; any other row needs both. */
export function parseClientsViewClient(value: unknown): ClientsViewClient | null {
    if (!isRecord(value)) return null;
    const clientId = isString(value.client_id) ? value.client_id : null;
    const name = isString(value.name) ? value.name : null;
    if (value.client_id !== null && clientId === null) return null;
    if (clientId !== null && name === null) return null;
    const projects = Array.isArray(value.projects)
        ? value.projects
              .map(parseClientsViewProject)
              .filter((project): project is ClientsViewProject => project !== null)
        : [];
    return {
        client_id: clientId,
        name: clientId === null ? null : name,
        project_count: isNumber(value.project_count) ? value.project_count : projects.length,
        hours_sold_seconds: int(value.hours_sold_seconds),
        consumed_seconds: int(value.consumed_seconds),
        amount_cents: int(value.amount_cents),
        cost_cents: int(value.cost_cents),
        margin_cents: int(value.margin_cents),
        margin_percent: percent(value.margin_percent),
        unpriced_cost_seconds: int(value.unpriced_cost_seconds),
        status: isString(value.status) ? value.status : null,
        projects,
    };
}

function parseRange(value: unknown): ClientsViewRange | null {
    if (!isRecord(value) || !isString(value.key) || !isString(value.from) || !isString(value.to)) {
        return null;
    }
    return {
        key: value.key,
        from: value.from,
        to: value.to,
        capped_to: isString(value.capped_to) ? value.capped_to : value.to,
        contains_today: value.contains_today === true,
    };
}

/** The totals the server sent, or the sums of the client rows when they are missing. */
function parseTotals(value: unknown, clients: ClientsViewClient[]): ClientsViewTotals {
    const sum = (pick: (client: ClientsViewClient) => number) =>
        clients.reduce((total, client) => total + pick(client), 0);
    if (!isRecord(value)) {
        const amount = sum((client) => client.amount_cents);
        const margin = sum((client) => client.margin_cents);
        return {
            hours_sold_seconds: sum((client) => client.hours_sold_seconds),
            consumed_seconds: sum((client) => client.consumed_seconds),
            amount_cents: amount,
            cost_cents: sum((client) => client.cost_cents),
            margin_cents: margin,
            margin_percent: marginPercent(amount, margin),
            unpriced_cost_seconds: sum((client) => client.unpriced_cost_seconds),
        };
    }
    const amount = int(value.amount_cents);
    const margin = int(value.margin_cents);
    return {
        hours_sold_seconds: int(value.hours_sold_seconds),
        consumed_seconds: int(value.consumed_seconds),
        amount_cents: amount,
        cost_cents: int(value.cost_cents),
        margin_cents: margin,
        margin_percent: 'margin_percent' in value ? percent(value.margin_percent) : null,
        unpriced_cost_seconds: int(value.unpriced_cost_seconds),
    };
}

/** The whole response body, or null when `data` is not a list. */
export function parseClientsView(value: unknown): ClientsView | null {
    if (!isRecord(value) || !Array.isArray(value.data)) return null;
    const clients = value.data
        .map(parseClientsViewClient)
        .filter((client): client is ClientsViewClient => client !== null);
    const meta = isRecord(value.meta) ? value.meta : {};
    return {
        data: clients,
        meta: { range: parseRange(meta.range), totals: parseTotals(meta.totals, clients) },
    };
}

export async function fetchClientsView(
    organizationUrl: string,
    range: RangeKey
): Promise<ClientsView> {
    const response = await axios.get(`${organizationUrl}/views/clients`, { params: { range } });
    const view = parseClientsView(response.data);
    if (view === null) {
        throw new Error('Malformed clients view');
    }
    return view;
}

/**
 * The Clients view for one range (UI-D12 key `['profitability', orgId, 'clients', range]`). The
 * previous range's figures stay on screen while the next one loads (refetch state). Disabled until
 * the shared prop carries the organization URL.
 */
export function useClientsViewQuery(range: MaybeRefOrGetter<RangeKey>) {
    const profitability = useProfitabilityProps();
    const organizationUrl = computed(() => profitability.value.organization_url ?? null);
    return useQuery({
        queryKey: computed(() => [
            'profitability',
            getCurrentOrganizationId() ?? null,
            'clients',
            toValue(range),
        ]),
        queryFn: () => fetchClientsView(organizationUrl.value as string, toValue(range)),
        enabled: computed(() => organizationUrl.value !== null),
        placeholderData: keepPreviousData,
        retry: 1,
        retryDelay: 300,
        staleTime: 1000 * 30,
    });
}

// Table sort (pure, shared by client rows and their project rows)

export const CLIENT_SORT_COLUMNS = [
    'name',
    'sold',
    'consumed',
    'amount',
    'cost',
    'margin',
    'margin_pct',
    'status',
] as const;

export type ClientSortColumn = (typeof CLIENT_SORT_COLUMNS)[number];

export type ClientSortDirection = 'asc' | 'desc';

export function isClientSortColumn(value: unknown): value is ClientSortColumn {
    return typeof value === 'string' && (CLIENT_SORT_COLUMNS as readonly string[]).includes(value);
}

/** Columns whose first click sorts descending (the larger figure is the interesting one). */
export const CLIENT_DESC_FIRST: ReadonlySet<ClientSortColumn> = new Set<ClientSortColumn>([
    'sold',
    'consumed',
    'amount',
    'cost',
    'status',
]);

/** Default: margin ascending, so losses come first (UI-SPEC "View: Clients"). */
export const DEFAULT_CLIENT_SORT = {
    sortColumn: 'margin' as ClientSortColumn,
    sortDirection: 'asc' as ClientSortDirection,
};

// Worst first when descending: Over, At risk, On track, Not started, Closed
const SEVERITY: Record<string, number> = {
    over: 5,
    at_risk: 4,
    on_track: 3,
    not_started: 2,
    closed: 1,
};

type SortableRow = Pick<
    ClientsViewClient,
    | 'hours_sold_seconds'
    | 'consumed_seconds'
    | 'amount_cents'
    | 'cost_cents'
    | 'margin_cents'
    | 'margin_percent'
    | 'status'
> & { name: string | null };

function sortValue(row: SortableRow, column: ClientSortColumn): string | number | null {
    switch (column) {
        case 'name':
            return row.name === null ? null : row.name.toLocaleLowerCase();
        case 'sold':
            return row.hours_sold_seconds;
        case 'consumed':
            return row.consumed_seconds;
        case 'amount':
            return row.amount_cents;
        case 'cost':
            return row.cost_cents;
        case 'margin':
            return row.margin_cents;
        case 'margin_pct':
            return row.margin_percent;
        case 'status':
            return row.status === null ? null : (SEVERITY[row.status] ?? null);
    }
}

function compareNames(a: string | null, b: string | null): number {
    return (a ?? '').localeCompare(b ?? '', undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Rows sorted by one column; empty values (null margin %, no status) last in both directions, ties
 * by name. With `pinNoClient` (client rows) the row with `client_id === null`, the "No client"
 * bucket, is always last (UI-SPEC); project rows pass false.
 */
export function sortClientRows<T extends SortableRow & { client_id: string | null }>(
    rows: readonly T[],
    column: ClientSortColumn,
    direction: ClientSortDirection,
    pinNoClient = true
): T[] {
    const sign = direction === 'asc' ? 1 : -1;
    const isBucket = (row: T) => pinNoClient && row.client_id === null;
    return [...rows].sort((a, b) => {
        const bucketA = isBucket(a);
        const bucketB = isBucket(b);
        if (bucketA !== bucketB) return bucketA ? 1 : -1;
        const valueA = sortValue(a, column);
        const valueB = sortValue(b, column);
        if (valueA === null && valueB !== null) return 1;
        if (valueB === null && valueA !== null) return -1;
        if (valueA !== null && valueB !== null && valueA !== valueB) {
            if (typeof valueA === 'string' || typeof valueB === 'string') {
                return sign * compareNames(String(valueA), String(valueB));
            }
            return sign * (valueA < valueB ? -1 : 1);
        }
        return compareNames(a.name, b.name);
    });
}

const MINUS = '−';

/** A 0..100 margin percent as an integer with a real minus ("68 %", "−12 %"); null -> "--". */
export function formatMarginPercent(value: number | null): string {
    if (value === null) return '--';
    const rounded = Math.round(value);
    if (rounded === 0) return '0 %';
    return rounded < 0 ? `${MINUS}${Math.abs(rounded)} %` : `${rounded} %`;
}
