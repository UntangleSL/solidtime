import axios from 'axios';
import type {
    OutlookConversionFields,
    OutlookConversionResult,
    OutlookConversionStatus,
} from '@/m365/types';

// Meeting conversion (Phase 4). Like meetingsApi.ts, the fork route is a web-group route (session
// cookie + XSRF), so it uses the global axios instance and never the generated OpenAPI client.

export type OutlookConversionBody = OutlookConversionFields & { meeting_ids: string[] };

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

// The server's validation message of a 422 (already localized), else the fallback copy.
export function conversionErrorMessage(error: unknown, fallback: string): string {
    const response = (error as { response?: { status?: number; data?: unknown } } | null)?.response;
    if (response?.status === 422) {
        const message = (response.data as { message?: unknown } | undefined)?.message;
        if (typeof message === 'string' && message.trim() !== '') return message;
    }
    return fallback;
}
