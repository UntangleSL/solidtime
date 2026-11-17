import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import {
    conversionErrorMessage,
    failedResults,
    forgetSeries,
    ignoreSeries,
    postConversion,
    unignoreSeries,
} from './conversionApi';

vi.mock('axios', () => ({
    default: { post: vi.fn(), delete: vi.fn() },
}));

const axiosPost = vi.mocked(axios.post);
const axiosDelete = vi.mocked(axios.delete);
const URL = 'https://app.example.test/m365/organizations/org-1/meetings/time-entries';
const MEETINGS_URL = 'https://app.example.test/m365/meetings';

const body = {
    meeting_ids: ['m-1', 'm-2'],
    project_id: 'p-1',
    task_id: null,
    tags: ['t-1'],
    billable: true,
};

beforeEach(() => {
    axiosPost.mockReset();
    axiosDelete.mockReset();
});

describe('confirming pre-assigned meetings', () => {
    it('posts only the meeting ids and use_series_assignment, and parses the results', async () => {
        axiosPost.mockResolvedValue({
            data: {
                results: [
                    { meeting_id: 'm-1', status: 'created', time_entry_id: 'te-1', error: null },
                ],
            },
        });

        const confirmBody = { meeting_ids: ['m-1'], use_series_assignment: true as const };
        const results = await postConversion(URL, confirmBody);

        expect(axiosPost).toHaveBeenCalledWith(URL, {
            meeting_ids: ['m-1'],
            use_series_assignment: true,
        });
        expect(results).toEqual([
            { meeting_id: 'm-1', status: 'created', time_entry_id: 'te-1', error: null },
        ]);
    });
});

describe('series actions', () => {
    it('ignores a series with a POST on the encoded meeting id', async () => {
        axiosPost.mockResolvedValue({ data: {} });
        await ignoreSeries(MEETINGS_URL, 'a b');
        expect(axiosPost).toHaveBeenCalledWith(`${MEETINGS_URL}/a%20b/series/ignore`);
    });

    it('stops ignoring a series with a DELETE on the same url', async () => {
        axiosDelete.mockResolvedValue({ data: {} });
        await unignoreSeries(MEETINGS_URL, 'a b');
        expect(axiosDelete).toHaveBeenCalledWith(`${MEETINGS_URL}/a%20b/series/ignore`);
    });

    it('forgets a series with a DELETE on its assignment', async () => {
        axiosDelete.mockResolvedValue({ data: {} });
        await forgetSeries(MEETINGS_URL, 'a b');
        expect(axiosDelete).toHaveBeenCalledWith(`${MEETINGS_URL}/a%20b/series/assignment`);
    });

    it('encodes ids that contain slashes so they stay one path segment', async () => {
        axiosPost.mockResolvedValue({ data: {} });
        await ignoreSeries(MEETINGS_URL, 'AAMk/x==');
        expect(axiosPost).toHaveBeenCalledWith(`${MEETINGS_URL}/AAMk%2Fx%3D%3D/series/ignore`);
    });

    it('rejects when the request fails', async () => {
        axiosPost.mockRejectedValue(new Error('404'));
        axiosDelete.mockRejectedValue(new Error('404'));
        await expect(ignoreSeries(MEETINGS_URL, 'm-1')).rejects.toThrow('404');
        await expect(unignoreSeries(MEETINGS_URL, 'm-1')).rejects.toThrow('404');
        await expect(forgetSeries(MEETINGS_URL, 'm-1')).rejects.toThrow('404');
    });
});

describe('postConversion', () => {
    it('posts the body as JSON to the given url and returns the results in order', async () => {
        axiosPost.mockResolvedValue({
            data: {
                results: [
                    { meeting_id: 'm-1', status: 'created', time_entry_id: 'te-1', error: null },
                    {
                        meeting_id: 'm-2',
                        status: 'failed',
                        time_entry_id: null,
                        error: { key: 'forbidden', message: "You can't add time to this project." },
                    },
                ],
            },
        });

        const results = await postConversion(URL, body);

        expect(axiosPost).toHaveBeenCalledWith(URL, body);
        expect(results).toEqual([
            { meeting_id: 'm-1', status: 'created', time_entry_id: 'te-1', error: null },
            {
                meeting_id: 'm-2',
                status: 'failed',
                time_entry_id: null,
                error: { key: 'forbidden', message: "You can't add time to this project." },
            },
        ]);
    });

    it('keeps an existing result as a success with its entry id', async () => {
        axiosPost.mockResolvedValue({
            data: {
                results: [
                    { meeting_id: 'm-1', status: 'existing', time_entry_id: 'te-9', error: null },
                ],
            },
        });

        const results = await postConversion(URL, { ...body, meeting_ids: ['m-1'] });

        expect(results).toEqual([
            { meeting_id: 'm-1', status: 'existing', time_entry_id: 'te-9', error: null },
        ]);
    });

    it('turns an unknown status or a missing meeting id into a failed invalid_response', async () => {
        axiosPost.mockResolvedValue({
            data: {
                results: [
                    { meeting_id: 'm-1', status: 'done', time_entry_id: 'te-1' },
                    { status: 'created', time_entry_id: 'te-2' },
                ],
            },
        });

        const results = await postConversion(URL, body);

        expect(results.map((r) => [r.meeting_id, r.status, r.error?.key])).toEqual([
            ['m-1', 'failed', 'invalid_response'],
            ['m-2', 'failed', 'invalid_response'],
        ]);
    });

    it('treats a body without a results array as failed for every id', async () => {
        axiosPost.mockResolvedValue({ data: {} });

        const results = await postConversion(URL, body);

        expect(results.map((r) => [r.meeting_id, r.status, r.error?.key])).toEqual([
            ['m-1', 'failed', 'invalid_response'],
            ['m-2', 'failed', 'invalid_response'],
        ]);
    });

    it('rejects when the request itself fails', async () => {
        axiosPost.mockRejectedValue(new Error('Network Error'));

        await expect(postConversion(URL, body)).rejects.toThrow('Network Error');
    });
});

describe('failedResults', () => {
    it('gives one failed result per id with key request_failed', () => {
        expect(failedResults(['a', 'b'], 'Could not create the time entry.')).toEqual([
            {
                meeting_id: 'a',
                status: 'failed',
                time_entry_id: null,
                error: { key: 'request_failed', message: 'Could not create the time entry.' },
            },
            {
                meeting_id: 'b',
                status: 'failed',
                time_entry_id: null,
                error: { key: 'request_failed', message: 'Could not create the time entry.' },
            },
        ]);
    });

    it('accepts another key', () => {
        expect(failedResults(['a'], 'x', 'other')[0]?.error?.key).toBe('other');
    });
});

describe('conversionErrorMessage', () => {
    const fallback = 'Could not create the time entry. Try again in a moment.';

    it('returns the message of a 422 body', () => {
        const error = {
            response: {
                status: 422,
                data: { message: 'The task does not belong to the project.' },
            },
        };

        expect(conversionErrorMessage(error, fallback)).toBe(
            'The task does not belong to the project.'
        );
    });

    it.each([
        ['a 422 without a message', { response: { status: 422, data: {} } }],
        ['a 422 with an empty message', { response: { status: 422, data: { message: ' ' } } }],
        ['a 500 with a message', { response: { status: 500, data: { message: 'Server Error' } } }],
        ['a 403', { response: { status: 403, data: { message: 'This action is unauthorized.' } } }],
        ['a network error', new Error('Network Error')],
        ['null', null],
    ])('falls back for %s', (_name, error) => {
        expect(conversionErrorMessage(error, fallback)).toBe(fallback);
    });
});
