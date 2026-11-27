import axios from 'axios';
import dayjs from 'dayjs';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/vue-query';
import { getCurrentOrganizationId } from '@/utils/useUser';
import {
    fetchProjectSummary,
    type SummaryContract,
    type SummaryPeriod,
    type SummaryPeriodRef,
} from './summaryApi';

// Writes of the contract model (BUDG-01, BUDG-04): the contract terms of a project (08-04, 08-08) and
// the monthly plan of one period (08-09). Both are web-group routes (session cookie + XSRF) reached
// through the global axios, never the generated API client. The server re-checks scope and every
// invariant; nothing here is a security boundary (T-08-41, T-08-42).

export const CONTRACT_SCHEDULES = ['one_off', 'monthly', 'quarterly', 'annual'] as const;

export type ContractSchedule = (typeof CONTRACT_SCHEDULES)[number];

export function isContractSchedule(value: unknown): value is ContractSchedule {
    return typeof value === 'string' && (CONTRACT_SCHEDULES as readonly string[]).includes(value);
}

/** UI-D9: which periods an edit of a started contract changes. */
export type ApplyTo = 'current_and_following' | 'next_period';

export interface ContractTermsBody {
    service: string | null;
    schedule: ContractSchedule;
    starts_on: string;
    ends_on: string | null;
    // null is sent as is: the server answers 422 on the field (required)
    budget_seconds: number | null;
    amount_cents: number | null;
    first_period_budget_seconds?: number | null;
    first_period_amount_cents?: number | null;
    apply_to?: ApplyTo;
}

export interface PlanMonthBody {
    month: string;
    planned_seconds: number;
}

function projectUrl(organizationUrl: string, projectId: string): string {
    return `${organizationUrl}/projects/${encodeURIComponent(projectId)}`;
}

export function contractUrl(organizationUrl: string, projectId: string): string {
    return `${projectUrl(organizationUrl, projectId)}/contract`;
}

export function planUrl(organizationUrl: string, projectId: string, periodId: string): string {
    return `${projectUrl(organizationUrl, projectId)}/periods/${encodeURIComponent(periodId)}/plan`;
}

export function summaryUrl(organizationUrl: string, projectId: string): string {
    return `${projectUrl(organizationUrl, projectId)}/summary`;
}

/** PUT {organization_url}/projects/{project}/contract, 204 on success. */
export async function saveContractTerms(
    organizationUrl: string,
    projectId: string,
    body: ContractTermsBody
): Promise<void> {
    await axios.put(contractUrl(organizationUrl, projectId), body);
}

/** PUT {organization_url}/projects/{project}/periods/{period}/plan, 204 on success. */
export async function savePlan(
    organizationUrl: string,
    projectId: string,
    periodId: string,
    months: PlanMonthBody[]
): Promise<void> {
    await axios.put(planUrl(organizationUrl, projectId, periodId), { months });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The first message of each field of a Laravel 422 (`{ errors: { field: [message] } }`), or null for
 * any other failure (transport error, 5xx, 404), which the dialogs report with the save-error toast.
 */
export function validationErrors(error: unknown): Record<string, string> | null {
    if (!isRecord(error) && !(error instanceof Error)) return null;
    const response = (error as { response?: unknown }).response;
    if (!isRecord(response) || response.status !== 422) return null;
    const data = response.data;
    const errors: Record<string, string> = {};
    if (isRecord(data) && isRecord(data.errors)) {
        for (const [field, messages] of Object.entries(data.errors)) {
            const first = Array.isArray(messages) ? messages[0] : messages;
            if (typeof first === 'string') errors[field] = first;
        }
    }
    if (Object.keys(errors).length === 0 && isRecord(data) && typeof data.message === 'string') {
        errors.message = data.message;
    }
    return errors;
}

/** The query prefix every profitability read lives under (UI-D12), refreshed after each save. */
function profitabilityKey() {
    return ['profitability', getCurrentOrganizationId() ?? null];
}

export function useSaveContractTerms() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: {
            organizationUrl: string;
            projectId: string;
            body: ContractTermsBody;
        }) => saveContractTerms(input.organizationUrl, input.projectId, input.body),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: profitabilityKey() }),
    });
}

export function useSavePlan() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: {
            organizationUrl: string;
            projectId: string;
            periodId: string;
            months: PlanMonthBody[];
        }) => savePlan(input.organizationUrl, input.projectId, input.periodId, input.months),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: profitabilityKey() }),
    });
}

// Units: hours are entered in half-hour steps and sent as integer seconds; amounts are entered in
// currency units and sent as integer cents.

export function secondsFromHours(hours: number | null | undefined): number | null {
    return typeof hours === 'number' && Number.isFinite(hours) ? Math.round(hours * 3600) : null;
}

export function hoursFromSeconds(seconds: number | null | undefined): number | null {
    return typeof seconds === 'number' ? seconds / 3600 : null;
}

export function centsFromAmount(amount: number | null | undefined): number | null {
    return typeof amount === 'number' && Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

export function amountFromCents(cents: number | null | undefined): number | null {
    return typeof cents === 'number' ? cents / 100 : null;
}

// Client mirror of PeriodCalendar (D-15): a renewing contract that starts after the 1st gets a stub
// first period to the end of that month, its hours and amount prorated by days. The server prorates
// the same way when no override is sent, so the prefilled values match what it would store.

const HOUR_STEP_SECONDS = 1800;

const SCHEDULE_MONTHS: Record<ContractSchedule, number | null> = {
    one_off: null,
    monthly: 1,
    quarterly: 3,
    annual: 12,
};

function day(isoDate: string): dayjs.Dayjs {
    return dayjs(isoDate.slice(0, 10));
}

function isIsoDate(value: string | null | undefined): value is string {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) && day(value).isValid();
}

/** $numerator / $denominator rounded half away from zero (PeriodCalendar::roundDiv). */
function roundDiv(numerator: number, denominator: number): number {
    const sign = numerator < 0 ? -1 : 1;
    return sign * Math.floor((2 * Math.abs(numerator) + denominator) / (2 * denominator));
}

/** True when the contract renews and starts after the 1st, so its first period is a stub. */
export function isStubStart(schedule: ContractSchedule, startsOn: string | null): boolean {
    return SCHEDULE_MONTHS[schedule] !== null && isIsoDate(startsOn) && day(startsOn).date() !== 1;
}

/** Days of a stub starting on startsOn (to the end of its month, inclusive) and days of the month. */
export function stubDays(startsOn: string): { days: number; of: number } {
    const start = day(startsOn);
    const of = start.daysInMonth();
    return { days: of - start.date() + 1, of };
}

/** Last day of the stub period that starts on startsOn. */
export function stubEnd(startsOn: string): string {
    return day(startsOn).endOf('month').format('YYYY-MM-DD');
}

/** Per-period hours prorated to the stub, rounded to the nearest half hour. */
export function prorateSeconds(
    perPeriod: number,
    schedule: ContractSchedule,
    startsOn: string
): number {
    const months = SCHEDULE_MONTHS[schedule];
    if (months === null) return perPeriod;
    const stub = stubDays(startsOn);
    return (
        roundDiv(perPeriod * stub.days, months * stub.of * HOUR_STEP_SECONDS) * HOUR_STEP_SECONDS
    );
}

/** Per-period amount prorated like the hours, rounded to the cent. */
export function prorateCents(
    perPeriod: number,
    schedule: ContractSchedule,
    startsOn: string
): number {
    const months = SCHEDULE_MONTHS[schedule];
    if (months === null) return perPeriod;
    const stub = stubDays(startsOn);
    return roundDiv(perPeriod * stub.days, months * stub.of);
}

/** Today's local calendar date, "YYYY-MM-DD". */
export function todayIso(): string {
    return dayjs().format('YYYY-MM-DD');
}

/**
 * What the contract editor needs to edit existing terms. The summary does not carry the contract's
 * per-period template, so the hours and amount come from the newest full (non-stub) period: every
 * edit rewrites the upcoming periods with the template, and the materializer always keeps one period
 * after today, so that period carries the current terms.
 */
export interface ExistingTerms {
    contract: SummaryContract;
    schedule: ContractSchedule;
    budgetSeconds: number | null;
    amountCents: number | null;
    /** A period has started: schedule and start are locked and apply_to is required (08-08). */
    started: boolean;
    current: SummaryPeriodRef | null;
    /** Start of the first period after the current one (the "From the next period" choice). */
    nextStartsOn: string | null;
}

function isStubPeriod(schedule: ContractSchedule, period: SummaryPeriodRef): boolean {
    return SCHEDULE_MONTHS[schedule] !== null && day(period.starts_on).date() !== 1;
}

/** The newest period that carries the full template (renewing: starts on the 1st), or null. */
export function templatePeriod(
    schedule: ContractSchedule,
    periods: SummaryPeriodRef[]
): SummaryPeriodRef | null {
    const newestFirst = [...periods].sort((a, b) => b.starts_on.localeCompare(a.starts_on));
    return newestFirst.find((period) => !isStubPeriod(schedule, period)) ?? null;
}

/** The start of the period after the current one: the earliest upcoming one, else the day after. */
export function nextPeriodStart(
    periods: SummaryPeriodRef[],
    current: SummaryPeriodRef | null
): string | null {
    const upcoming = periods
        .filter((period) => period.state === 'upcoming')
        .sort((a, b) => a.starts_on.localeCompare(b.starts_on));
    if (upcoming[0]) return upcoming[0].starts_on;
    return current ? day(current.ends_on).add(1, 'day').format('YYYY-MM-DD') : null;
}

export async function loadExistingTerms(
    organizationUrl: string,
    projectId: string,
    today: string = todayIso()
): Promise<ExistingTerms | null> {
    const url = summaryUrl(organizationUrl, projectId);
    const summary = await fetchProjectSummary(url);
    const contract = summary.contract;
    if (contract === null || !isContractSchedule(contract.schedule)) return null;
    const schedule = contract.schedule;

    const template = templatePeriod(schedule, summary.periods);
    let source: SummaryPeriod | null = summary.period;
    if (template !== null && template.id !== summary.period?.id) {
        source = (await fetchProjectSummary(url, template.id)).period;
    }

    const current = summary.periods.find((period) => period.state === 'current') ?? null;
    return {
        contract,
        schedule,
        budgetSeconds: source?.budget_seconds ?? null,
        amountCents: source?.amount_cents ?? null,
        started: contract.starts_on.slice(0, 10) <= today,
        current,
        nextStartsOn: nextPeriodStart(summary.periods, current),
    };
}

/**
 * A project's name from the core projects query cache (`['projects', orgId]`), which the project page
 * has already filled. Read from the cache only: the fork never calls the generated API client.
 */
export function projectNameFromCache(queryClient: QueryClient, projectId: string): string | null {
    const cached = queryClient.getQueryData(['projects', getCurrentOrganizationId()]);
    if (!isRecord(cached) || !Array.isArray(cached.data)) return null;
    const match = cached.data.find(
        (project: unknown) => isRecord(project) && project.id === projectId
    ) as Record<string, unknown> | undefined;
    return match && typeof match.name === 'string' ? match.name : null;
}
