import axios from 'axios';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { getCurrentOrganizationId } from '@/utils/useUser';
import { useProfitabilityProps, type RangeKey } from './labels';

// Client of the People view (08-11, GET {organization_url}/views/people?range=), Owner/Admin only:
// every other scope gets a 404 and the page never lists the tab (D-16). Web-group route (session +
// XSRF) through the global axios, never the generated API client.

export interface PeopleViewRow {
    member_id: string;
    name: string;
    is_placeholder: boolean;
    /** The working week in force today; null when no row is in force today. */
    weekly_seconds: number | null;
    /** Null when the person has no working week in force within the range (no denominator). */
    available_seconds: number | null;
    absence_seconds: number;
    billable_seconds: number;
    internal_seconds: number;
    /** billable / available as a ratio (0.68), unrounded; null without available hours. */
    chargeability: number | null;
    /** The target in force at the (capped) range end, in percent (75). */
    target_percent: number | null;
    /** chargeability * 100 - target, in percentage points, unrounded. */
    gap_points: number | null;
    status: 'on_track' | 'below_target' | null;
}

export interface PeopleViewRange {
    key: string;
    from: string;
    to: string;
    capped_to: string;
    contains_today: boolean;
}

export interface PeopleViewTeam {
    billable_seconds: number;
    available_seconds: number;
    absence_seconds: number;
    /** Only people with a working week count toward the ratio and the weighted target (08-11). */
    chargeability: number | null;
    target_percent: number | null;
}

export interface PeopleView {
    data: PeopleViewRow[];
    meta: {
        range: PeopleViewRange | null;
        team: PeopleViewTeam;
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

function seconds(value: unknown): number {
    return isNumber(value) ? value : 0;
}

function nullableNumber(value: unknown): number | null {
    return isNumber(value) ? value : null;
}

function status(value: unknown): PeopleViewRow['status'] {
    return value === 'on_track' || value === 'below_target' ? value : null;
}

/** One person, or null without a member id or name. Unknown figures stay null, never 0. */
export function parsePeopleViewRow(value: unknown): PeopleViewRow | null {
    if (!isRecord(value) || !isString(value.member_id) || !isString(value.name)) return null;
    return {
        member_id: value.member_id,
        name: value.name,
        is_placeholder: value.is_placeholder === true,
        weekly_seconds: nullableNumber(value.weekly_seconds),
        available_seconds: nullableNumber(value.available_seconds),
        absence_seconds: seconds(value.absence_seconds),
        billable_seconds: seconds(value.billable_seconds),
        internal_seconds: seconds(value.internal_seconds),
        chargeability: nullableNumber(value.chargeability),
        target_percent: nullableNumber(value.target_percent),
        gap_points: nullableNumber(value.gap_points),
        status: status(value.status),
    };
}

function parseRange(value: unknown): PeopleViewRange | null {
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

function parseTeam(value: unknown): PeopleViewTeam {
    const raw = isRecord(value) ? value : {};
    return {
        billable_seconds: seconds(raw.billable_seconds),
        available_seconds: seconds(raw.available_seconds),
        absence_seconds: seconds(raw.absence_seconds),
        chargeability: nullableNumber(raw.chargeability),
        target_percent: nullableNumber(raw.target_percent),
    };
}

/** The whole response body, or null when `data` is not a list. */
export function parsePeopleView(value: unknown): PeopleView | null {
    if (!isRecord(value) || !Array.isArray(value.data)) return null;
    const rows = value.data
        .map(parsePeopleViewRow)
        .filter((row): row is PeopleViewRow => row !== null);
    const meta = isRecord(value.meta) ? value.meta : {};
    return { data: rows, meta: { range: parseRange(meta.range), team: parseTeam(meta.team) } };
}

export async function fetchPeopleView(
    organizationUrl: string,
    range: RangeKey
): Promise<PeopleView> {
    const response = await axios.get(`${organizationUrl}/views/people`, { params: { range } });
    const view = parsePeopleView(response.data);
    if (view === null) {
        throw new Error('Malformed people view');
    }
    return view;
}

/**
 * The People view for one range (UI-D12 key `['profitability', orgId, 'people', range]`). The
 * previous range's rows stay on screen while the next one loads (refetch state). Disabled until the
 * shared prop carries the organization URL.
 */
export function usePeopleViewQuery(range: MaybeRefOrGetter<RangeKey>) {
    const profitability = useProfitabilityProps();
    const organizationUrl = computed(() => profitability.value.organization_url ?? null);
    return useQuery({
        queryKey: computed(() => [
            'profitability',
            getCurrentOrganizationId() ?? null,
            'people',
            toValue(range),
        ]),
        queryFn: () => fetchPeopleView(organizationUrl.value as string, toValue(range)),
        enabled: computed(() => organizationUrl.value !== null),
        placeholderData: keepPreviousData,
        retry: 1,
        retryDelay: 300,
        staleTime: 1000 * 30,
    });
}
