import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import type { OutlookMeeting } from '@/m365/types';
import { fetchMeetings } from './meetingsApi';

vi.mock('axios', () => ({
    default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const axiosGet = vi.mocked(axios.get);

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
        });
    });

    it('survives an empty body', async () => {
        respond(null);

        const result = await fetchMeetings(URL, RANGE);

        expect(result).toEqual({
            data: [],
            sync: { last_synced_at: null, retry_after: null },
            linked_time_entry_ids: [],
        });
    });
});
