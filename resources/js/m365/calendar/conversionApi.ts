import axios from 'axios';
import type {
    OutlookConversionFields,
    OutlookConversionResult,
    OutlookConversionStatus,
    OutlookSeriesConfirmFields,
} from '@/m365/types';

// Meeting conversion (Phase 4). Like meetingsApi.ts, the fork route is a web-group route (session
// cookie + XSRF), so it uses the global axios instance and never the generated OpenAPI client.

// Either explicit entry fields (forms), or { use_series_assignment: true } alone to confirm
// pre-assigned meetings with their own series assignment (Phase 5).
export type OutlookConversionBody = (OutlookConversionFields | OutlookSeriesConfirmFields) & {
    meeting_ids: string[];
};

const STATUSES: readonly OutlookConversionStatus[] = ['created', 'existing', 'failed'];

function isStatus(value: unknown): value is OutlookConversionStatus {
    return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

function nonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value : null;
}

// Defensive parsing: a row without a meeting id or with an unknown status is reported as failed
// (key 'invalid_response') so the caller never takes it for a success.
function parseResult(raw: unknown, fallbackId: string): OutlookConversionResult {
    const row = (raw ?? {}) as Record<string, unknown>;
    const meetingId = nonEmptyString(row.meeting_id);
    const status = row.status;
    if (meetingId === null || !isStatus(status)) {
        return {
            meeting_id: meetingId ?? fallbackId,
            status: 'failed',
            time_entry_id: null,
            error: { key: 'invalid_response', message: '' },
        };
    }

    const error = (row.error ?? null) as Record<string, unknown> | null;
    return {
        meeting_id: meetingId,
        status,
        time_entry_id: nonEmptyString(row.time_entry_id),
        error:
            status === 'failed'
                ? {
                      key: nonEmptyString(error?.key) ?? 'failed',
                      message: typeof error?.message === 'string' ? error.message : '',
                  }
                : null,
    };
}

// POST the conversion and return one result per row of the answer, in the server's order. A
// failed whole request (network, 4xx, 5xx) rejects; map it with failedResults + conversionErrorMessage.
export async function postConversion(
    url: string,
    body: OutlookConversionBody
): Promise<OutlookConversionResult[]> {
    const response = await axios.post<{ results?: unknown }>(url, body);
    const results = response.data?.results;
    if (!Array.isArray(results)) {
        return failedResults(body.meeting_ids, '', 'invalid_response');
    }

    return results.map((raw, index) => parseResult(raw, body.meeting_ids[index] ?? ''));
}

// One failed result per id (a whole request that did not reach a per-meeting answer).
export function failedResults(
    ids: string[],
    message: string,
    key = 'request_failed'
): OutlookConversionResult[] {
    return ids.map((id) => ({
        meeting_id: id,
        status: 'failed',
        time_entry_id: null,
        error: { key, message },
    }));
}

// Series actions (Phase 5), keyed by a meeting id under the meetings URL like dismiss/restore. The
// server answers 404 for any meeting that is not the user's own or has no series; every helper
// rejects when the request fails.
function ignoreUrl(meetingsUrl: string, id: string): string {
    return `${meetingsUrl}/${encodeURIComponent(id)}/series/ignore`;
}

export async function ignoreSeries(meetingsUrl: string, id: string): Promise<void> {
    await axios.post(ignoreUrl(meetingsUrl, id));
}

export async function unignoreSeries(meetingsUrl: string, id: string): Promise<void> {
    await axios.delete(ignoreUrl(meetingsUrl, id));
}

// Drops the series pre-assignment; existing time entries are never touched.
export async function forgetSeries(meetingsUrl: string, id: string): Promise<void> {
    await axios.delete(`${meetingsUrl}/${encodeURIComponent(id)}/series/assignment`);
}

// The server's validation message of a 422 (already localized), else the fallback copy.
export function conversionErrorMessage(error: unknown, fallback: string): string {
    const response = (error as { response?: { status?: number; data?: unknown } } | null)?.response;
    if (response?.status === 422) {
        const message = (response.data as { message?: unknown } | undefined)?.message;
        if (typeof message === 'string' && message.trim() !== '') return message;
    }
    return fallback;
}

// Out-of-sync resolve actions and the D-03 move (Phase 6). Same web-route rules as above: global
// axios, ids encoded into one path segment, and every helper rejects when the request fails.
export type OutlookFlagActionResult =
    { status: 'ok' } | { status: 'failed'; message: string } | { status: 'stale' };

// Keep the logged entry as it is and clear its flag.
export async function keepFlag(outOfSyncUrl: string, entryId: string): Promise<void> {
    await axios.post(`${outOfSyncUrl}/${encodeURIComponent(entryId)}/keep`);
}

// Move the logged entry to the meeting's current times.
export async function adjustFlag(outOfSyncUrl: string, entryId: string): Promise<void> {
    await axios.post(`${outOfSyncUrl}/${encodeURIComponent(entryId)}/adjust`);
}

// Move the entry logged for this meeting's earlier slot onto the meeting's new slot (D-03).
export async function moveEntry(organizationMeetingsUrl: string, meetingId: string): Promise<void> {
    await axios.post(`${organizationMeetingsUrl}/${encodeURIComponent(meetingId)}/move-entry`);
}

// Maps a failed resolve or move to what the UI shows (UI-SPEC "Error messages"): 404 / 409 mean
// the flag or entry changed elsewhere (stale, the caller refreshes); otherwise the server's 422
// validation message, then the forbidden copy for a 403, then the retry copy. A failure is never
// mapped to ok, whatever the status.
export function flagActionFailure(
    error: unknown,
    messages: { forbidden: string; retry: string }
): OutlookFlagActionResult {
    const response = (error as { response?: { status?: number; data?: unknown } } | null)?.response;
    const status = response?.status;
    if (status === 404 || status === 409) return { status: 'stale' };
    if (status === 422) {
        return { status: 'failed', message: conversionErrorMessage(error, messages.retry) };
    }
    if (status === 403) return { status: 'failed', message: messages.forbidden };
    return { status: 'failed', message: messages.retry };
}
