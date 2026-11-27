import axios from 'axios';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import { useQuery } from '@tanstack/vue-query';
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

export interface SummaryPeriod {
    id: string;
    starts_on: string;
    ends_on: string;
    state: string;
    budget_seconds: number;
    consumed_seconds: number;
    months: SummaryMonth[];
    amount_cents?: number;
}

export interface ProjectSummary {
    project_id: string;
    can_edit_terms: boolean;
    can_edit_plan: boolean;
    contract: SummaryContract | null;
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
    const period: SummaryPeriod = {
        id: value.id,
        starts_on: value.starts_on,
        ends_on: value.ends_on,
        state: isString(value.state) ? value.state : 'current',
        budget_seconds: value.budget_seconds,
        consumed_seconds: value.consumed_seconds,
        months: months.map(parseMonth).filter((month): month is SummaryMonth => month !== null),
    };
    return copyMoney(period, value, 'amount_cents');
}

/** The `data` object of the summary JSON, or null when it has no project id. */
export function parseProjectSummary(value: unknown): ProjectSummary | null {
    if (!isRecord(value) || !isString(value.project_id)) return null;
    return {
        project_id: value.project_id,
        can_edit_terms: value.can_edit_terms === true,
        can_edit_plan: value.can_edit_plan === true,
        contract: parseContract(value.contract),
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
    });
}
