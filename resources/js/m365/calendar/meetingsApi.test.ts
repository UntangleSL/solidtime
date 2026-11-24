import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import type { OutlookMeeting, OutlookOutOfSyncItem, OutlookSyncResponse } from '@/m365/types';
import { fetchMeetings, postSync } from './meetingsApi';

vi.mock('axios', () => ({
    default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const axiosGet = vi.mocked(axios.get);
const axiosPost = vi.mocked(axios.post);

const URL = 'https://app.example.test/m365/meetings';
const RANGE = { start: '2026-11-02T00:00:00Z', end: '2026-11-09T00:00:00Z' };

const MEETING: OutlookMeeting = {
    id: 'm-1',
    subject: 'Weekly',
    start: '2026-11-03T09:00:00Z',
    end: '2026-11-03T10:00:00Z',
    organizer_name: 'Org',
    is_organizer: false,
    is_online_meeting: false,
    web_link: null,
    dismissed: false,
};

function respond(body: unknown): void {
    axiosGet.mockResolvedValue({ data: body });
}

beforeEach(() => {
    axiosGet.mockReset();
    axiosPost.mockReset();
});

describe('fetchMeetings', () => {
    it('sends the range and include_dismissed only when asked', async () => {
        respond({ data: [] });

        await fetchMeetings(URL, RANGE);
        await fetchMeetings(URL, RANGE, { include_dismissed: true });

        expect(axiosGet.mock.calls[0]).toEqual([URL, { params: RANGE }]);
        expect(axiosGet.mock.calls[1]).toEqual([
            URL,
            { params: { ...RANGE, include_dismissed: 1 } },
        ]);
    });

    it('returns the meetings, the sync info and the linked entry ids', async () => {
        respond({
            data: [MEETING],
            sync: { last_synced_at: '2026-11-05T10:00:00Z', retry_after: 30 },
            linked_time_entry_ids: ['te-1', 'te-2'],
        });

        const result = await fetchMeetings(URL, RANGE);

        expect(result).toEqual({
            data: [MEETING],
            sync: { last_synced_at: '2026-11-05T10:00:00Z', retry_after: 30 },
            linked_time_entry_ids: ['te-1', 'te-2'],
            out_of_sync: { items: [] },
            auto_adjusted: [],
        });
    });

    it('treats a missing linked_time_entry_ids as an empty list', async () => {
        respond({ data: [MEETING], sync: { last_synced_at: null, retry_after: null } });

        const result = await fetchMeetings(URL, RANGE);

        expect(result.linked_time_entry_ids).toEqual([]);
        expect(result.data).toEqual([MEETING]);
    });

    it.each([
        ['a string', 'te-1'],
        ['an object', { id: 'te-1' }],
        ['null', null],
        ['an array with a non-string', ['te-1', 2]],
        ['an array with null', [null]],
    ])('turns %s into an empty list', async (_label, value) => {
        respond({ data: [], linked_time_entry_ids: value });

        const result = await fetchMeetings(URL, RANGE);

        expect(result.linked_time_entry_ids).toEqual([]);
    });

    it('keeps the defensive parsing of data and sync', async () => {
        respond({ data: 'nope', sync: { retry_after: 'soon' } });

        const result = await fetchMeetings(URL, RANGE);

        expect(result).toEqual({
            data: [],
            sync: { last_synced_at: null, retry_after: null },
            linked_time_entry_ids: [],
            out_of_sync: { items: [] },
            auto_adjusted: [],
        });
    });

    it('survives an empty body', async () => {
        respond(null);

        const result = await fetchMeetings(URL, RANGE);

        expect(result).toEqual({
            data: [],
            sync: { last_synced_at: null, retry_after: null },
            linked_time_entry_ids: [],
            out_of_sync: { items: [] },
            auto_adjusted: [],
        });
    });
});

const MOVED: OutlookOutOfSyncItem = {
    time_entry_id: 'te-1',
    kind: 'moved',
    meeting_start: '2026-11-24T10:00:00Z',
    meeting_end: '2026-11-24T11:00:00Z',
    new_start: '2026-11-25T12:00:00Z',
    new_end: '2026-11-25T13:00:00Z',
    all_day: false,
    entry_start: '2026-11-24T10:00:00Z',
    entry_end: '2026-11-24T11:00:00Z',
    description: 'Weekly sync',
};

const CANCELLED: OutlookOutOfSyncItem = {
    time_entry_id: 'te-2',
    kind: 'cancelled',
    meeting_start: '2026-11-26T09:00:00Z',
    meeting_end: '2026-11-26T09:30:00Z',
    new_start: null,
    new_end: null,
    all_day: false,
    entry_start: '2026-11-26T09:00:00Z',
    entry_end: '2026-11-26T09:30:00Z',
    description: '',
};

const ADJUSTED = {
    time_entry_id: 'te-3',
    at: '2026-11-23T08:00:00Z',
    from_start: '2026-11-24T10:00:00Z',
    from_end: '2026-11-24T11:00:00Z',
    to_start: '2026-11-25T12:00:00Z',
    to_end: '2026-11-25T13:00:00Z',
};

describe('fetchMeetings out-of-sync fields', () => {
    it('keeps the moved and cancelled flags and drops an unknown kind or a missing id', async () => {
        const { time_entry_id: _id, ...withoutId } = CANCELLED;
        respond({
            data: [],
            out_of_sync: {
                items: [
                    MOVED,
                    CANCELLED,
                    { ...MOVED, time_entry_id: 'te-9', kind: 'renamed' },
                    withoutId,
                ],
            },
        });

        const result = await fetchMeetings(URL, RANGE);

        expect(result.out_of_sync).toEqual({ items: [MOVED, CANCELLED] });
    });

    it('fills the optional item fields with safe defaults', async () => {
        respond({
            data: [],
            out_of_sync: {
                items: [
                    {
                        time_entry_id: 'te-4',
                        kind: 'removed',
                        meeting_start: '2026-11-24T10:00:00Z',
                        meeting_end: '2026-11-24T11:00:00Z',
                        entry_start: '2026-11-24T10:00:00Z',
                        all_day: 'yes',
                        description: 42,
                    },
                ],
            },
        });

        const result = await fetchMeetings(URL, RANGE);

        expect(result.out_of_sync?.items).toEqual([
            {
                time_entry_id: 'te-4',
                kind: 'removed',
                meeting_start: '2026-11-24T10:00:00Z',
                meeting_end: '2026-11-24T11:00:00Z',
                new_start: null,
                new_end: null,
                all_day: false,
                entry_start: '2026-11-24T10:00:00Z',
                entry_end: null,
                description: '',
            },
        ]);
    });

    it.each([
        ['missing', undefined],
        ['null', null],
        ['an array', [MOVED]],
        ['items not an array', { items: 'te-1' }],
        ['items with non-objects', { items: ['te-1', null, 3] }],
    ])('turns an out_of_sync that is %s into an empty list', async (_label, value) => {
        respond({ data: [], out_of_sync: value });

        const result = await fetchMeetings(URL, RANGE);

        expect(result.out_of_sync).toEqual({ items: [] });
    });

    it('keeps well-formed auto_adjusted entries and drops the rest', async () => {
        respond({
            data: [],
            auto_adjusted: [ADJUSTED, { ...ADJUSTED, to_end: null }, 'te-3', null],
        });

        const result = await fetchMeetings(URL, RANGE);

        expect(result.auto_adjusted).toEqual([ADJUSTED]);
    });

    it.each([
        ['missing', undefined],
        ['an object', { 'te-3': ADJUSTED }],
        ['a string', 'te-3'],
    ])('turns an auto_adjusted that is %s into an empty list', async (_label, value) => {
        respond({ data: [], auto_adjusted: value });

        const result = await fetchMeetings(URL, RANGE);

        expect(result.auto_adjusted).toEqual([]);
    });

    it('keeps a well-formed moved_from and turns a malformed one into null', async () => {
        const movedFrom = {
            time_entry_id: 'te-1',
            entry_start: '2026-11-24T10:00:00Z',
            entry_end: '2026-11-24T11:00:00Z',
        };
        respond({
            data: [
                { ...MEETING, id: 'm-1', moved_from: movedFrom },
                { ...MEETING, id: 'm-2', moved_from: { time_entry_id: 'te-1' } },
                { ...MEETING, id: 'm-3', moved_from: 'te-1' },
                { ...MEETING, id: 'm-4', moved_from: null },
                { ...MEETING, id: 'm-5' },
            ],
        });

        const result = await fetchMeetings(URL, RANGE);

        expect(result.data.map((meeting) => meeting.moved_from)).toEqual([
            movedFrom,
            null,
            null,
            null,
            undefined,
        ]);
        expect(result.data[4]).toEqual({ ...MEETING, id: 'm-5' });
        expect(Object.prototype.hasOwnProperty.call(result.data[4], 'moved_from')).toBe(false);
    });
});

describe('postSync', () => {
    const BODY = { ...RANGE, force: true };

    function answer(overrides: Partial<Record<keyof OutlookSyncResponse, unknown>> = {}): void {
        axiosPost.mockResolvedValue({
            data: {
                status: 'ok',
                retry_after: null,
                last_synced_at: '2026-11-05T10:00:00Z',
                truncated: false,
                ...overrides,
            },
        });
    }

    it('posts the range and the force flag', async () => {
        answer();

        await postSync(URL, BODY);

        expect(axiosPost).toHaveBeenCalledWith(URL, BODY);
    });

    it('returns how many entries the sync adjusted', async () => {
        answer({ auto_adjusted: 3 });

        const result = await postSync(URL, BODY);

        expect(result).toEqual({
            status: 'ok',
            retry_after: null,
            last_synced_at: '2026-11-05T10:00:00Z',
            truncated: false,
            auto_adjusted: 3,
        });
    });

    it.each([
        ['absent', undefined],
        ['a string', '3'],
        ['null', null],
        ['negative', -1],
        ['not finite', Number.NaN],
    ])('returns 0 adjusted entries when the value is %s', async (_label, value) => {
        answer({ auto_adjusted: value });

        const result = await postSync(URL, BODY);

        expect(result.auto_adjusted).toBe(0);
    });
});
