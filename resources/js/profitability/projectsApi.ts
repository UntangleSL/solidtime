import axios from 'axios';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { getCurrentOrganizationId } from '@/utils/useUser';
import { useProfitabilityProps } from './labels';

// Client of the by-project view (08-10, GET {organization_url}/views/projects?contract=). Web-group
// route (session + XSRF) through the global axios, never the generated API client.

export const CONTRACT_FILTERS = ['active', 'without', 'ended', 'all'] as const;

export type ContractFilter = (typeof CONTRACT_FILTERS)[number];

export function isContractFilter(value: unknown): value is ContractFilter {
    return typeof value === 'string' && (CONTRACT_FILTERS as readonly string[]).includes(value);
}

export interface ProjectsViewPeriod {
    id: string;
    starts_on: string;
    ends_on: string;
    state: string;
}

export interface ProjectsViewRow {
    project_id: string;
    name: string;
    color: string;
    client_id: string | null;
    client_name: string | null;
    archived: boolean;
    schedule: string | null;
    period: ProjectsViewPeriod | null;
    budget_seconds: number;
    consumed_seconds: number;
    still_to_consume_seconds: number;
    remaining_plan_seconds: number;
    run_rate_seconds: number | null;
    status: string | null;
    can_edit_terms: boolean;
    can_edit_plan: boolean;
    // Money keys exist only on rows the caller has money for (D-11); absent means "do not render".
    amount_cents?: number;
    revenue_to_date_cents?: number;
    cost_cents?: number;
    margin_cents?: number;
    // Present for money rows; null while no consumed hour has an hourly cost (unknown, not 0).
    projected_cost_cents?: number | null;
    projected_margin_cents?: number | null;
    unpriced_cost_seconds?: number;
}

export interface ProjectsViewMeta {
    total_rows: number;
    money_rows: number;
    // Owner/Admin only: organization-wide legacy non-billable seconds behind the D-05 notice.
    nonbillable_legacy_seconds?: number;
}

export interface ProjectsView {
    data: ProjectsViewRow[];
    meta: ProjectsViewMeta;
}

const MONEY_KEYS = [
    'amount_cents',
    'revenue_to_date_cents',
    'cost_cents',
    'margin_cents',
    'unpriced_cost_seconds',
] as const;

const NULLABLE_MONEY_KEYS = ['projected_cost_cents', 'projected_margin_cents'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
    return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function seconds(value: unknown): number {
    return isNumber(value) ? value : 0;
}

function parsePeriod(value: unknown): ProjectsViewPeriod | null {
    if (
        !isRecord(value) ||
        !isString(value.id) ||
        !isString(value.starts_on) ||
        !isString(value.ends_on)
    ) {
        return null;
    }
    return {
        id: value.id,
        starts_on: value.starts_on,
        ends_on: value.ends_on,
        state: isString(value.state) ? value.state : 'current',
    };
}

/** One row, or null without a project id or name. Money keys are copied only when present. */
export function parseProjectsViewRow(value: unknown): ProjectsViewRow | null {
    if (!isRecord(value) || !isString(value.project_id) || !isString(value.name)) return null;
    const row: ProjectsViewRow = {
        project_id: value.project_id,
        name: value.name,
        color: isString(value.color) ? value.color : '',
        client_id: isString(value.client_id) ? value.client_id : null,
        client_name: isString(value.client_name) ? value.client_name : null,
        archived: value.archived === true,
        schedule: isString(value.schedule) ? value.schedule : null,
        period: parsePeriod(value.period),
        budget_seconds: seconds(value.budget_seconds),
        consumed_seconds: seconds(value.consumed_seconds),
        still_to_consume_seconds: seconds(value.still_to_consume_seconds),
        remaining_plan_seconds: seconds(value.remaining_plan_seconds),
        run_rate_seconds: isNumber(value.run_rate_seconds) ? value.run_rate_seconds : null,
        status: isString(value.status) ? value.status : null,
        can_edit_terms: value.can_edit_terms === true,
        can_edit_plan: value.can_edit_plan === true,
    };
    // An absent key stays absent; a malformed one is dropped rather than shown as 0.
    const target = row as unknown as Record<string, unknown>;
    for (const key of MONEY_KEYS) {
        if (key in value && isNumber(value[key])) target[key] = value[key];
    }
    // The projections are null while unknown: keep the null, it renders as "--".
    if ('amount_cents' in row) {
        for (const key of NULLABLE_MONEY_KEYS) {
            if (key in value && (value[key] === null || isNumber(value[key]))) {
                target[key] = value[key];
            }
        }
    }
    return row;
}

function parseMeta(value: unknown, rows: ProjectsViewRow[]): ProjectsViewMeta {
    const raw = isRecord(value) ? value : {};
    const meta: ProjectsViewMeta = {
        total_rows: isNumber(raw.total_rows) ? raw.total_rows : rows.length,
        money_rows: isNumber(raw.money_rows)
            ? raw.money_rows
            : rows.filter((row) => 'amount_cents' in row).length,
    };
    if ('nonbillable_legacy_seconds' in raw && isNumber(raw.nonbillable_legacy_seconds)) {
        meta.nonbillable_legacy_seconds = raw.nonbillable_legacy_seconds;
    }
    return meta;
}

/** The whole response body, or null when `data` is not a list. */
export function parseProjectsView(value: unknown): ProjectsView | null {
    if (!isRecord(value) || !Array.isArray(value.data)) return null;
    const rows = value.data
        .map(parseProjectsViewRow)
        .filter((row): row is ProjectsViewRow => row !== null);
    return { data: rows, meta: parseMeta(value.meta, rows) };
}

export async function fetchProjectsView(
    organizationUrl: string,
    contract: ContractFilter
): Promise<ProjectsView> {
    const response = await axios.get(`${organizationUrl}/views/projects`, {
        params: { contract },
    });
    const view = parseProjectsView(response.data);
    if (view === null) {
        throw new Error('Malformed projects view');
    }
    return view;
}

/**
 * The by-project view for one contract filter (UI-D12 key `['profitability', orgId, 'projects',
 * contract]`). The previous filter's rows stay on screen while the next one loads (refetch state).
 * Disabled until the shared prop carries the organization URL.
 */
export function useProjectsViewQuery(contract: MaybeRefOrGetter<ContractFilter>) {
    const profitability = useProfitabilityProps();
    const organizationUrl = computed(() => profitability.value.organization_url ?? null);
    return useQuery({
        queryKey: computed(() => [
            'profitability',
            getCurrentOrganizationId() ?? null,
            'projects',
            toValue(contract),
        ]),
        queryFn: () => fetchProjectsView(organizationUrl.value as string, toValue(contract)),
        enabled: computed(() => organizationUrl.value !== null),
        placeholderData: keepPreviousData,
        retry: 1,
        retryDelay: 300,
        staleTime: 1000 * 30,
    });
}
