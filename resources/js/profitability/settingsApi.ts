import axios from 'axios';
import { computed, type ComputedRef } from 'vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { formatCents } from '@/packages/ui/src/utils/money';
import { formatDate, getLocalizedDayJs } from '@/packages/ui/src/utils/time';
import { getOrganizationCurrencyString } from '@/utils/money';
import { useOrganizationQuery } from '@/utils/useOrganizationQuery';
import { getCurrentOrganizationId } from '@/utils/useUser';
import { formatHours } from './format';
import { useProfitabilityProps } from './labels';

// Client of the Owner/Admin settings endpoints (08-03 managers, 08-05 people and absence projects),
// all under `{organization_url}/settings`. Web-group routes (session + XSRF) through the global
// axios, never the generated API client. Every other scope gets a 404 from the server (D-12, D-16);
// the Settings tab only exists when the server lists the `settings` view.

export type SettingsSection = 'people' | 'managers' | 'absence';

export interface SettingsCostRate {
    id: string;
    effective_from: string;
    hourly_cost_cents: number;
}

export interface SettingsWorkWeek {
    id: string;
    effective_from: string;
    weekly_seconds: number;
    target_percent: number;
}

export interface SettingsPerson {
    member_id: string;
    name: string;
    role: string;
    is_placeholder: boolean;
    // Current values (the row in force today); null while the person has none.
    hourly_cost_cents: number | null;
    weekly_seconds: number | null;
    target_percent: number | null;
    since: string | null;
    // Histories, newest first.
    cost_rates: SettingsCostRate[];
    work_weeks: SettingsWorkWeek[];
}

export interface SettingsManager {
    member_id: string;
    name: string;
}

export interface SettingsClient {
    id: string;
    name: string;
    account_managers: SettingsManager[];
}

export interface SettingsProject {
    id: string;
    name: string;
    client_id: string | null;
    client_name: string | null;
    project_managers: SettingsManager[];
}

export interface SettingsMember {
    member_id: string;
    name: string;
    role: string;
}

export interface ManagersSettings {
    clients: SettingsClient[];
    projects: SettingsProject[];
    members: SettingsMember[];
}

export interface AbsenceProjectOption {
    id: string;
    name: string;
    client_name: string | null;
    is_archived: boolean;
}

export interface AbsenceSettings {
    project_ids: string[];
    projects: AbsenceProjectOption[];
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

function numberOrNull(value: unknown): number | null {
    return isNumber(value) ? value : null;
}

function list<T>(value: unknown, parse: (item: unknown) => T | null): T[] {
    if (!Array.isArray(value)) return [];
    return value.map(parse).filter((item): item is T => item !== null);
}

function parseCostRate(value: unknown): SettingsCostRate | null {
    if (
        !isRecord(value) ||
        !isString(value.id) ||
        !isString(value.effective_from) ||
        !isNumber(value.hourly_cost_cents)
    ) {
        return null;
    }
    return {
        id: value.id,
        effective_from: value.effective_from,
        hourly_cost_cents: value.hourly_cost_cents,
    };
}

function parseWorkWeek(value: unknown): SettingsWorkWeek | null {
    if (
        !isRecord(value) ||
        !isString(value.id) ||
        !isString(value.effective_from) ||
        !isNumber(value.weekly_seconds) ||
        !isNumber(value.target_percent)
    ) {
        return null;
    }
    return {
        id: value.id,
        effective_from: value.effective_from,
        weekly_seconds: value.weekly_seconds,
        target_percent: value.target_percent,
    };
}

function newestFirst<T extends { effective_from: string }>(rows: T[]): T[] {
    return [...rows].sort((a, b) => b.effective_from.localeCompare(a.effective_from));
}

/** One person row, or null without a member id or name. Histories come back newest first. */
export function parsePerson(value: unknown): SettingsPerson | null {
    if (!isRecord(value) || !isString(value.member_id) || !isString(value.name)) return null;
    const role = isString(value.role) ? value.role : '';
    return {
        member_id: value.member_id,
        name: value.name,
        role,
        is_placeholder: value.is_placeholder === true || role === 'placeholder',
        hourly_cost_cents: numberOrNull(value.hourly_cost_cents),
        weekly_seconds: numberOrNull(value.weekly_seconds),
        target_percent: numberOrNull(value.target_percent),
        since: isString(value.since) ? value.since : null,
        cost_rates: newestFirst(list(value.cost_rates, parseCostRate)),
        work_weeks: newestFirst(list(value.work_weeks, parseWorkWeek)),
    };
}

/** The people list (`{ data: [...] }`), or null when `data` is not a list. */
export function parsePeople(value: unknown): SettingsPerson[] | null {
    if (!isRecord(value) || !Array.isArray(value.data)) return null;
    return list(value.data, parsePerson);
}

function parseManager(value: unknown): SettingsManager | null {
    if (!isRecord(value) || !isString(value.member_id) || !isString(value.name)) return null;
    return { member_id: value.member_id, name: value.name };
}

function parseClient(value: unknown): SettingsClient | null {
    if (!isRecord(value) || !isString(value.id) || !isString(value.name)) return null;
    return {
        id: value.id,
        name: value.name,
        account_managers: list(value.account_managers, parseManager),
    };
}

function parseProject(value: unknown): SettingsProject | null {
    if (!isRecord(value) || !isString(value.id) || !isString(value.name)) return null;
    return {
        id: value.id,
        name: value.name,
        client_id: isString(value.client_id) ? value.client_id : null,
        client_name: isString(value.client_name) ? value.client_name : null,
        project_managers: list(value.project_managers, parseManager),
    };
}

function parseMember(value: unknown): SettingsMember | null {
    if (!isRecord(value) || !isString(value.member_id) || !isString(value.name)) return null;
    return {
        member_id: value.member_id,
        name: value.name,
        role: isString(value.role) ? value.role : '',
    };
}

/** The managers payload (`{ data: { clients, projects, members } }`), or null when malformed. */
export function parseManagers(value: unknown): ManagersSettings | null {
    if (!isRecord(value) || !isRecord(value.data)) return null;
    return {
        clients: list(value.data.clients, parseClient),
        projects: list(value.data.projects, parseProject),
        members: list(value.data.members, parseMember),
    };
}

function parseAbsenceProject(value: unknown): AbsenceProjectOption | null {
    if (!isRecord(value) || !isString(value.id) || !isString(value.name)) return null;
    return {
        id: value.id,
        name: value.name,
        client_name: isString(value.client_name) ? value.client_name : null,
        is_archived: value.is_archived === true,
    };
}

/** The absence payload (`{ data: { project_ids, projects } }`), or null when malformed. */
export function parseAbsence(value: unknown): AbsenceSettings | null {
    if (!isRecord(value) || !isRecord(value.data)) return null;
    return {
        project_ids: Array.isArray(value.data.project_ids)
            ? value.data.project_ids.filter(isString)
            : [],
        projects: list(value.data.projects, parseAbsenceProject),
    };
}

// Units: costs are typed in currency units and travel as cents; working weeks are typed in hours
// and travel as seconds (08-05 requests).

export function unitsToCents(units: number): number {
    return Math.round(units * 100);
}

export function hoursToSeconds(hours: number): number {
    return Math.round(hours * 3600);
}

/**
 * The calendar date ("YYYY-MM-DD") of a DatePicker value. The picker holds a timestamp localized
 * to the user's time zone; the date the user picked is its local date, never its UTC date.
 */
export function pickerDate(value: string | null): string | null {
    if (!value) return null;
    const date = getLocalizedDayJs(value);
    return date.isValid() ? date.format('YYYY-MM-DD') : null;
}

/** The DatePicker value of the first day of the current month (default effective date). */
export function firstDayOfCurrentMonth(): string {
    return getLocalizedDayJs().startOf('month').format();
}

function segment(id: string): string {
    return encodeURIComponent(id);
}

function settingsUrl(organizationUrl: string, path: string): string {
    return `${organizationUrl}/settings/${path}`;
}

export async function fetchPeople(organizationUrl: string): Promise<SettingsPerson[]> {
    const response = await axios.get(settingsUrl(organizationUrl, 'people'));
    const people = parsePeople(response.data);
    if (people === null) throw new Error('Malformed people settings');
    return people;
}

export interface CostRateInput {
    effective_from: string;
    hourly_cost_cents: number;
}

export async function addCostRate(
    organizationUrl: string,
    memberId: string,
    input: CostRateInput
): Promise<void> {
    await axios.post(settingsUrl(organizationUrl, `people/${segment(memberId)}/cost-rates`), input);
}

export async function deleteCostRate(
    organizationUrl: string,
    memberId: string,
    rateId: string
): Promise<void> {
    await axios.delete(
        settingsUrl(organizationUrl, `people/${segment(memberId)}/cost-rates/${segment(rateId)}`)
    );
}

export interface WorkWeekInput {
    effective_from: string;
    weekly_seconds: number;
    target_percent: number;
}

export async function addWorkWeek(
    organizationUrl: string,
    memberId: string,
    input: WorkWeekInput
): Promise<void> {
    await axios.post(settingsUrl(organizationUrl, `people/${segment(memberId)}/work-weeks`), input);
}

export async function deleteWorkWeek(
    organizationUrl: string,
    memberId: string,
    weekId: string
): Promise<void> {
    await axios.delete(
        settingsUrl(organizationUrl, `people/${segment(memberId)}/work-weeks/${segment(weekId)}`)
    );
}

export async function fetchManagers(organizationUrl: string): Promise<ManagersSettings> {
    const response = await axios.get(settingsUrl(organizationUrl, 'managers'));
    const managers = parseManagers(response.data);
    if (managers === null) throw new Error('Malformed managers settings');
    return managers;
}

export async function addProjectManager(
    organizationUrl: string,
    projectId: string,
    memberId: string
): Promise<void> {
    await axios.post(settingsUrl(organizationUrl, `projects/${segment(projectId)}/managers`), {
        member_id: memberId,
    });
}

export async function removeProjectManager(
    organizationUrl: string,
    projectId: string,
    memberId: string
): Promise<void> {
    await axios.delete(
        settingsUrl(organizationUrl, `projects/${segment(projectId)}/managers/${segment(memberId)}`)
    );
}

export async function addAccountManager(
    organizationUrl: string,
    clientId: string,
    memberId: string
): Promise<void> {
    await axios.post(
        settingsUrl(organizationUrl, `clients/${segment(clientId)}/account-managers`),
        { member_id: memberId }
    );
}

export async function removeAccountManager(
    organizationUrl: string,
    clientId: string,
    memberId: string
): Promise<void> {
    await axios.delete(
        settingsUrl(
            organizationUrl,
            `clients/${segment(clientId)}/account-managers/${segment(memberId)}`
        )
    );
}

export async function fetchAbsence(organizationUrl: string): Promise<AbsenceSettings> {
    const response = await axios.get(settingsUrl(organizationUrl, 'absence-projects'));
    const absence = parseAbsence(response.data);
    if (absence === null) throw new Error('Malformed absence settings');
    return absence;
}

/** Replaces the marked set (08-05 PUT semantics: the body is the whole set). */
export async function updateAbsence(organizationUrl: string, projectIds: string[]): Promise<void> {
    await axios.put(settingsUrl(organizationUrl, 'absence-projects'), {
        project_ids: projectIds,
    });
}

/**
 * The first message per field of a Laravel 422 (`{ errors: { field: [message] } }`), or null for
 * any other failure (network, 5xx, 404): those get the generic Save error toast instead.
 */
export function validationErrors(error: unknown): Record<string, string> | null {
    if (!isRecord(error) || !isRecord(error.response) || error.response.status !== 422) {
        return null;
    }
    const data = error.response.data;
    const errors = isRecord(data) && isRecord(data.errors) ? data.errors : {};
    const fields: Record<string, string> = {};
    for (const [field, messages] of Object.entries(errors)) {
        const first = Array.isArray(messages) ? messages.find(isString) : undefined;
        if (first !== undefined) fields[field] = first;
    }
    if (Object.keys(fields).length === 0 && isRecord(data) && isString(data.message)) {
        fields.message = data.message;
    }
    return fields;
}

/** The first 422 message of a set of fields (or any field), for a single error line. */
export function firstValidationMessage(
    error: unknown,
    preferred: readonly string[] = []
): string | null {
    const fields = validationErrors(error);
    if (fields === null) return null;
    for (const field of preferred) {
        const message = fields[field];
        if (message !== undefined) return message;
    }
    return Object.values(fields)[0] ?? null;
}

export function settingsQueryKey(organizationId: string | null, section: SettingsSection) {
    return ['profitability', organizationId, 'settings', section] as const;
}

/** The organization URL of the shared prop, or null until the page carries it. */
export function useSettingsOrganizationUrl(): ComputedRef<string | null> {
    const profitability = useProfitabilityProps();
    return computed(() => profitability.value.organization_url ?? null);
}

function useSettingsQuery<T>(section: SettingsSection, fetcher: (url: string) => Promise<T>) {
    const organizationUrl = useSettingsOrganizationUrl();
    return useQuery({
        queryKey: computed(() => settingsQueryKey(getCurrentOrganizationId() ?? null, section)),
        queryFn: () => fetcher(organizationUrl.value as string),
        enabled: computed(() => organizationUrl.value !== null),
        retry: 1,
        retryDelay: 300,
        staleTime: 1000 * 30,
    });
}

export function usePeopleSettingsQuery() {
    return useSettingsQuery('people', fetchPeople);
}

export function useManagersSettingsQuery() {
    return useSettingsQuery('managers', fetchManagers);
}

export function useAbsenceSettingsQuery() {
    return useSettingsQuery('absence', fetchAbsence);
}

/**
 * Formats of the settings cards with the organization's number, currency and date formats: money
 * "€45.00", dates in the organization date format, decimal hours "40 h".
 */
export function useSettingsFormat() {
    const { organization } = useOrganizationQuery(getCurrentOrganizationId() ?? '');
    const numberFormat = computed(() => organization.value?.number_format ?? null);
    return {
        numberFormat,
        money(cents: number): string {
            return (
                formatCents(
                    cents,
                    getOrganizationCurrencyString(),
                    organization.value?.currency_format ?? 'iso-code-before-with-space',
                    organization.value?.currency_symbol,
                    organization.value?.number_format
                ) ?? ''
            );
        },
        date(isoDate: string): string {
            return formatDate(isoDate.slice(0, 10), organization.value?.date_format);
        },
        hours(seconds: number): string {
            return formatHours(seconds, numberFormat.value);
        },
    };
}

/**
 * After every settings write: costs, working weeks, managers and absence projects change margins,
 * chargeability and scopes, so the whole `['profitability', orgId]` tree is refetched.
 */
export function useInvalidateProfitability(): () => Promise<void> {
    const queryClient = useQueryClient();
    return () =>
        queryClient.invalidateQueries({
            queryKey: ['profitability', getCurrentOrganizationId() ?? null],
        });
}
