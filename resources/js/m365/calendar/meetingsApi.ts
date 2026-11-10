import axios from 'axios';
import type { OutlookMeetingsResponse, OutlookSyncResponse } from '@/m365/types';

// The fork routes are web-group routes (session cookie + XSRF), so they use the global axios
// instance and never the generated OpenAPI client, which must not know about fork routes.

export interface MeetingsRange {
    start: string;
    end: string;
}

function numberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export interface MeetingsReadOptions {
    // Also returns the meetings the user dismissed (flagged dismissed: true)
    include_dismissed?: boolean;
}

export async function fetchMeetings(
    url: string,
    range: MeetingsRange,
    options: MeetingsReadOptions = {}
): Promise<OutlookMeetingsResponse> {
    const response = await axios.get<OutlookMeetingsResponse>(url, {
        params: {
            start: range.start,
            end: range.end,
            ...(options.include_dismissed === true ? { include_dismissed: 1 } : {}),
        },
    });
    const body = response.data;

    return {
        data: Array.isArray(body?.data) ? body.data : [],
        sync: {
            last_synced_at: body?.sync?.last_synced_at ?? null,
            retry_after: numberOrNull(body?.sync?.retry_after),
        },
    };
}

export async function postSync(
    url: string,
    body: MeetingsRange & { force: boolean }
): Promise<OutlookSyncResponse> {
    const response = await axios.post<OutlookSyncResponse>(url, {
        start: body.start,
        end: body.end,
        force: body.force,
    });
    const data = response.data;

    return {
        status: data.status,
        retry_after: numberOrNull(data.retry_after),
        last_synced_at: data.last_synced_at ?? null,
        truncated: data.truncated === true,
    };
}

// Dismisses one occurrence for the session user (idempotent; the server answers 404 for any id that
// is not the user's own).
export async function dismissMeeting(meetingsUrl: string, id: string): Promise<void> {
    await axios.post(`${meetingsUrl}/${encodeURIComponent(id)}/dismiss`);
}

// Restores a dismissed occurrence (idempotent, same ownership rule).
export async function restoreMeeting(meetingsUrl: string, id: string): Promise<void> {
    await axios.delete(`${meetingsUrl}/${encodeURIComponent(id)}/dismiss`);
}
