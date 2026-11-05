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

export async function fetchMeetings(
    url: string,
    range: MeetingsRange
): Promise<OutlookMeetingsResponse> {
    const response = await axios.get<OutlookMeetingsResponse>(url, {
        params: { start: range.start, end: range.end },
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
