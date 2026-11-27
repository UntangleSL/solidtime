import axios from 'axios';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { getCurrentOrganizationId } from '@/utils/useUser';

// The fork routes are web-group routes (session cookie + XSRF), so they use the global axios
// instance and never the generated API client, which must not know about fork routes.

export interface SummaryContract {
    service: string | null;
    schedule: string;
    starts_on: string;
    ends_on: string | null;
    archived: boolean;
    // Money keys exist only when the payload carries them (scopes with money, D-11).
    amount_cents?: number;
}

export interface SummaryMonth {
    month: string;
    planned_seconds: number;
    consumed_seconds: number;
}

/** One entry of `periods[]` (08-08): every period of the contract, newest first. */
export interface SummaryPeriodRef {
    id: string;
    starts_on: string;
    ends_on: string;
    state: string;
}

export interface SummaryPeriod {
    id: string;
    starts_on: string;
    ends_on: string;
    state: string;
    budget_seconds: number;
    consumed_seconds: number;
    months: SummaryMonth[];
    /** Hours sold minus consumed; negative = over the hours sold. */
    still_to_consume_seconds: number;
    /** Projected total at close if the team follows the plan from now on (decides the status). */
    remaining_plan_seconds: number;
    /** Projected total at close at the current pace; null under 5 elapsed weekdays. */
    run_rate_seconds: number | null;
    status: string;
    // Money keys (08-10) exist only for scopes with money (D-11); the projected pair is null while
    // no consumed hour has an hourly cost.
    amount_cents?: number;
    revenue_to_date_cents?: number;
    cost_cents?: number;
    margin_cents?: number;
    projected_cost_cents?: number | null;
    projected_margin_cents?: number | null;
    unpriced_cost_seconds?: number;
}

export interface ProjectSummary {
    project_id: string;
    can_edit_terms: boolean;
    can_edit_plan: boolean;
    contract: SummaryContract | null;
    periods: SummaryPeriodRef[];
    period: SummaryPeriod | null;
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

// Copies a money key only when it is present and numeric: an absent key stays absent (the element is
// not rendered), and a malformed one is dropped rather than shown as 0.
function copyMoney<T extends object>(target: T, raw: Record<string, unknown>, key: string): T {
    if (key in raw && isNumber(raw[key])) {
        (target as Record<string, unknown>)[key] = raw[key];
    }
    return target;
}

// The projected pair is a known `null` (nothing priced yet), which is not the same as absent.
function copyNullableMoney<T extends object>(
    target: T,
    raw: Record<string, unknown>,
    key: string
): T {
    if (key in raw && (raw[key] === null || isNumber(raw[key]))) {
        (target as Record<string, unknown>)[key] = raw[key];
    }
    return target;
}

const PERIOD_MONEY_KEYS = [
    'amount_cents',
    'revenue_to_date_cents',
    'cost_cents',
    'margin_cents',
    'unpriced_cost_seconds',
] as const;

const PERIOD_NULLABLE_MONEY_KEYS = ['projected_cost_cents', 'projected_margin_cents'] as const;

// The server merges the money part as one block (08-10): without 'amount_cents' in the payload no
// money key is read at all, so a stray key can never make a money tile appear.
function copyPeriodMoney(period: SummaryPeriod, raw: Record<string, unknown>): SummaryPeriod {
    if (!('amount_cents' in raw) || !isNumber(raw.amount_cents)) return period;
    for (const key of PERIOD_MONEY_KEYS) copyMoney(period, raw, key);
    for (const key of PERIOD_NULLABLE_MONEY_KEYS) copyNullableMoney(period, raw, key);
    return period;
}

function parseContract(value: unknown): SummaryContract | null {
    if (!isRecord(value) || !isString(value.schedule) || !isString(value.starts_on)) return null;
    const contract: SummaryContract = {
        service: isString(value.service) ? value.service : null,
        schedule: value.schedule,
        starts_on: value.starts_on,
        ends_on: isString(value.ends_on) ? value.ends_on : null,
        archived: value.archived === true,
    };
    return copyMoney(contract, value, 'amount_cents');
}

function parseMonth(value: unknown): SummaryMonth | null {
    if (!isRecord(value) || !isString(value.month)) return null;
    return {
        month: value.month,
        planned_seconds: isNumber(value.planned_seconds) ? value.planned_seconds : 0,
        consumed_seconds: isNumber(value.consumed_seconds) ? value.consumed_seconds : 0,
    };
}

function parsePeriodRef(value: unknown): SummaryPeriodRef | null {
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

const DEFAULT_STATUS: Record<string, string> = {
    upcoming: 'not_started',
    closed: 'closed',
};

function parsePeriod(value: unknown): SummaryPeriod | null {
    if (
        !isRecord(value) ||
        !isString(value.id) ||
        !isString(value.starts_on) ||
        !isString(value.ends_on) ||
        !isNumber(value.budget_seconds) ||
        !isNumber(value.consumed_seconds)
    ) {
        return null;
    }
    const months = Array.isArray(value.months) ? value.months : [];
    const state = isString(value.state) ? value.state : 'current';
    const period: SummaryPeriod = {
        id: value.id,
        starts_on: value.starts_on,
        ends_on: value.ends_on,
        state,
        budget_seconds: value.budget_seconds,
        consumed_seconds: value.consumed_seconds,
        months: months.map(parseMonth).filter((month): month is SummaryMonth => month !== null),
        still_to_consume_seconds: isNumber(value.still_to_consume_seconds)
            ? value.still_to_consume_seconds
            : value.budget_seconds - value.consumed_seconds,
        remaining_plan_seconds: isNumber(value.remaining_plan_seconds)
            ? value.remaining_plan_seconds
            : value.consumed_seconds,
        run_rate_seconds: isNumber(value.run_rate_seconds) ? value.run_rate_seconds : null,
        status: isString(value.status) ? value.status : (DEFAULT_STATUS[state] ?? 'on_track'),
    };
    return copyPeriodMoney(period, value);
}

/** The `data` object of the summary JSON, or null when it has no project id. */
export function parseProjectSummary(value: unknown): ProjectSummary | null {
    if (!isRecord(value) || !isString(value.project_id)) return null;
    return {
        project_id: value.project_id,
        can_edit_terms: value.can_edit_terms === true,
        can_edit_plan: value.can_edit_plan === true,
        contract: parseContract(value.contract),
        periods: (Array.isArray(value.periods) ? value.periods : [])
            .map(parsePeriodRef)
            .filter((period): period is SummaryPeriodRef => period !== null),
        period: parsePeriod(value.period),
    };
}

/** True for an HTTP 404 (no scope, foreign project, non-billable without contract). */
export function isNotFound(error: unknown): boolean {
    if (!isRecord(error) && !(error instanceof Error)) return false;
    const response = (error as { response?: unknown }).response;
    return isRecord(response) && response.status === 404;
}

export async function fetchProjectSummary(url: string, periodId?: string | null) {
    const response = await axios.get(url, {
        params: periodId ? { period: periodId } : undefined,
    });
    const summary = parseProjectSummary(isRecord(response.data) ? response.data.data : null);
    if (summary === null) {
        throw new Error('Malformed project summary');
    }
    return summary;
}

/**
 * The summary of one project (UI-D12 key `['profitability', orgId, 'summary', projectId, periodId]`,
 * so a save that invalidates `['profitability', orgId]` refreshes the card). Disabled without a URL:
 * the server sets it only for projects the user may view (08-02), so no request leaves otherwise.
 */
export function useProjectSummaryQuery(
    url: MaybeRefOrGetter<string | null | undefined>,
    projectId: MaybeRefOrGetter<string>,
    periodId: MaybeRefOrGetter<string | null | undefined> = null
) {
    return useQuery({
        queryKey: computed(() => [
            'profitability',
            getCurrentOrganizationId() ?? null,
            'summary',
            toValue(projectId),
            toValue(periodId) ?? null,
        ]),
        queryFn: () => fetchProjectSummary(toValue(url) as string, toValue(periodId)),
        enabled: computed(() => Boolean(toValue(url))),
        // A 404 is an answer (nothing to show), not a failure worth retrying.
        retry: (failureCount, error) => !isNotFound(error) && failureCount < 1,
        retryDelay: 300,
        staleTime: 1000 * 30,
        // Switching periods keeps the shown period until the next one arrives (no layout jump).
        placeholderData: keepPreviousData,
    });
}
