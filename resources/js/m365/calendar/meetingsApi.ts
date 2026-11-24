import axios from 'axios';
import type {
    OutlookAutoAdjusted,
    OutlookFlagKind,
    OutlookMeeting,
    OutlookMeetingsResponse,
    OutlookMovedFrom,
    OutlookOutOfSyncItem,
    OutlookSyncResponse,
} from '@/m365/types';

// The fork routes are web-group routes (session cookie + XSRF), so they use the global axios
// instance and never the generated OpenAPI client, which must not know about fork routes.

export interface MeetingsRange {
    start: string;
    end: string;
}

function numberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Anything other than an array of strings becomes an empty list (the ids only decide whether the
// Outlook icon renders on an entry).
function stringList(value: unknown): string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
        ? [...value]
        : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
    return typeof value === 'string';
}

function stringOrNull(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

const FLAG_KINDS: readonly OutlookFlagKind[] = ['moved', 'cancelled', 'removed'];

function isFlagKind(value: unknown): value is OutlookFlagKind {
    return FLAG_KINDS.includes(value as OutlookFlagKind);
}

// One flagged entry, or null when a required field is missing or the kind is unknown (a kind added
// on the server later is dropped instead of being shown with the wrong text).
function parseOutOfSyncItem(value: unknown): OutlookOutOfSyncItem | null {
    if (!isRecord(value)) return null;
    const { time_entry_id, kind, meeting_start, meeting_end, entry_start } = value;
    if (
        !isString(time_entry_id) ||
        !isFlagKind(kind) ||
        !isString(meeting_start) ||
        !isString(meeting_end) ||
        !isString(entry_start)
    ) {
        return null;
    }
    return {
        time_entry_id,
        kind,
        meeting_start,
        meeting_end,
        new_start: stringOrNull(value.new_start),
        new_end: stringOrNull(value.new_end),
        all_day: value.all_day === true,
        entry_start,
        entry_end: stringOrNull(value.entry_end),
        description: isString(value.description) ? value.description : '',
    };
}

function parseOutOfSync(value: unknown): { items: OutlookOutOfSyncItem[] } {
    const items = isRecord(value) && Array.isArray(value.items) ? value.items : [];
    return {
        items: items
            .map(parseOutOfSyncItem)
            .filter((item): item is OutlookOutOfSyncItem => item !== null),
    };
}

const AUTO_ADJUSTED_FIELDS = [
    'time_entry_id',
    'at',
    'from_start',
    'from_end',
    'to_start',
    'to_end',
] as const;

function parseAutoAdjusted(value: unknown): OutlookAutoAdjusted[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter(
            (item): item is Record<string, string> =>
                isRecord(item) && AUTO_ADJUSTED_FIELDS.every((field) => isString(item[field]))
        )
        .map((item) => ({
            time_entry_id: item.time_entry_id as string,
            at: item.at as string,
            from_start: item.from_start as string,
            from_end: item.from_end as string,
            to_start: item.to_start as string,
            to_end: item.to_end as string,
        }));
}

function parseMovedFrom(value: unknown): OutlookMovedFrom | null {
    if (
        !isRecord(value) ||
        !isString(value.time_entry_id) ||
        !isString(value.entry_start) ||
        !isString(value.entry_end)
    ) {
        return null;
    }
    return {
        time_entry_id: value.time_entry_id,
        entry_start: value.entry_start,
        entry_end: value.entry_end,
    };
}

// Meetings pass through unchanged, except a moved_from the server sent, which is kept only when
// well formed (null otherwise). A meeting without the field keeps its shape.
function parseMeetings(value: unknown): OutlookMeeting[] {
    if (!Array.isArray(value)) return [];
    return value.map((meeting: OutlookMeeting) =>
        isRecord(meeting) && meeting.moved_from !== undefined
            ? { ...meeting, moved_from: parseMovedFrom(meeting.moved_from) }
            : meeting
    );
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
        data: parseMeetings(body?.data),
        sync: {
            last_synced_at: body?.sync?.last_synced_at ?? null,
            retry_after: numberOrNull(body?.sync?.retry_after),
        },
        linked_time_entry_ids: stringList(body?.linked_time_entry_ids),
        out_of_sync: parseOutOfSync(body?.out_of_sync),
        auto_adjusted: parseAutoAdjusted(body?.auto_adjusted),
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
        // How many entries this sync moved silently with their meeting (D-04); 0 when absent.
        auto_adjusted:
            typeof data.auto_adjusted === 'number' &&
            Number.isFinite(data.auto_adjusted) &&
            data.auto_adjusted > 0
                ? Math.floor(data.auto_adjusted)
                : 0,
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
