import { describe, expect, it } from 'vitest';
import type { OutlookAssignment, OutlookMeeting, OutlookSuggestion } from '../types';
import {
    batchSeriesNote,
    isFaded,
    isPreassigned,
    isRecurring,
    quickPicks,
    resolveBatchPrefill,
    resolveSinglePrefill,
    seriesNote,
} from './suggestions';

const projects = [
    { id: 'p-a', is_archived: false },
    { id: 'p-b', is_archived: false },
    { id: 'p-c', is_archived: false },
    { id: 'p-d', is_archived: false },
    { id: 'p-old', is_archived: true },
    { id: 'last-p', is_archived: false },
];

function meeting(overrides: Partial<OutlookMeeting> = {}): OutlookMeeting {
    return {
        id: 'm-1',
        subject: 'Weekly sync',
        start: '2026-11-16T09:00:00Z',
        end: '2026-11-16T09:30:00Z',
        organizer_name: 'Ana López',
        is_organizer: false,
        is_online_meeting: true,
        web_link: null,
        dismissed: false,
        ...overrides,
    };
}

function assignment(overrides: Partial<OutlookAssignment> = {}): OutlookAssignment {
    return {
        project_id: 'p-a',
        project_name: 'Acme Website',
        project_color: '#ef5350',
        client_name: 'Acme',
        task_id: 't-1',
        task_name: 'Meetings',
        tags: ['tag-1'],
        billable: true,
        converted_at: '2026-11-09T09:30:00Z',
        ...overrides,
    };
}

function suggestion(projectId: string, confident: boolean, count = 4): OutlookSuggestion {
    return {
        project_id: projectId,
        project_name: `Project ${projectId}`,
        project_color: '#42a5f5',
        client_name: null,
        confident,
        reason: { kind: 'domain', count, value: 'client.com' },
    };
}

describe('meeting state helpers', () => {
    it('treats a series key as recurring and a null or missing one as a one-off', () => {
        expect(isRecurring(meeting({ series_key: 'series-1' }))).toBe(true);
        expect(isRecurring(meeting({ series_key: null }))).toBe(false);
        expect(isRecurring(meeting())).toBe(false);
    });

    it('fades dismissed meetings and meetings of an ignored series', () => {
        expect(isFaded(meeting())).toBe(false);
        expect(isFaded(meeting({ dismissed: true }))).toBe(true);
        expect(isFaded(meeting({ series_ignored: true }))).toBe(true);
    });

    it('is pre-assigned only with an assignment and while not faded', () => {
        expect(isPreassigned(meeting())).toBe(false);
        expect(isPreassigned(meeting({ assignment: null }))).toBe(false);
        expect(isPreassigned(meeting({ assignment: assignment() }))).toBe(true);
        expect(isPreassigned(meeting({ assignment: assignment(), dismissed: true }))).toBe(false);
        expect(isPreassigned(meeting({ assignment: assignment(), series_ignored: true }))).toBe(
            false
        );
    });
});

describe('resolveSinglePrefill', () => {
    it('prefills project, task, tags and billable from the series assignment', () => {
        const result = resolveSinglePrefill(
            meeting({ series_key: 's-1', assignment: assignment() }),
            projects,
            'last-p'
        );
        expect(result).toEqual({
            source: 'series',
            projectId: 'p-a',
            taskId: 't-1',
            tags: ['tag-1'],
            billable: true,
            reason: { kind: 'series' },
        });
    });

    it('prefills only the project of a confident top suggestion', () => {
        const top = suggestion('p-b', true);
        const result = resolveSinglePrefill(
            meeting({ suggestions: [top, suggestion('p-c', false)] }),
            projects,
            'last-p'
        );
        expect(result).toEqual({
            source: 'suggestion',
            projectId: 'p-b',
            taskId: null,
            tags: [],
            billable: null,
            reason: top.reason,
        });
    });

    it('falls back to the last used project when the top suggestion is not confident', () => {
        const result = resolveSinglePrefill(
            meeting({ suggestions: [suggestion('p-b', false)] }),
            projects,
            'last-p'
        );
        expect(result.source).toBe('last_used');
        expect(result.projectId).toBe('last-p');
        expect(result.reason).toEqual({ kind: 'last_used' });
        expect(result.billable).toBeNull();
    });

    it('prefills nothing without a last used project', () => {
        expect(resolveSinglePrefill(meeting(), projects, null)).toEqual({
            source: 'none',
            projectId: null,
            taskId: null,
            tags: [],
            billable: null,
            reason: null,
        });
    });

    it('skips a confident suggestion whose project is archived', () => {
        const result = resolveSinglePrefill(
            meeting({ suggestions: [suggestion('p-old', true)] }),
            projects,
            'last-p'
        );
        expect(result.source).toBe('last_used');
        expect(result.projectId).toBe('last-p');
    });
});

describe('quickPicks', () => {
    it('offers up to two candidates that are not the current project, in server order', () => {
        const list = [suggestion('p-a', true), suggestion('p-b', false), suggestion('p-c', false)];
        expect(quickPicks(list, 'p-a').map((pick) => pick.project_id)).toEqual(['p-b', 'p-c']);
        expect(quickPicks(list, 'p-b').map((pick) => pick.project_id)).toEqual(['p-a', 'p-c']);
        expect(quickPicks(list, null).map((pick) => pick.project_id)).toEqual(['p-a', 'p-b']);
    });

    it('offers nothing when there are no other candidates', () => {
        expect(quickPicks([], 'p-a')).toEqual([]);
        expect(quickPicks([suggestion('p-a', true)], 'p-a')).toEqual([]);
    });
});

describe('resolveBatchPrefill', () => {
    it('uses the earliest assignment when every meeting is pre-assigned to the same project', () => {
        const result = resolveBatchPrefill(
            [
                meeting({
                    id: 'm-2',
                    start: '2026-11-17T09:00:00Z',
                    assignment: assignment({ task_id: 't-late', billable: false }),
                }),
                meeting({
                    id: 'm-1',
                    start: '2026-11-16T09:00:00Z',
                    assignment: assignment({ task_id: 't-early' }),
                }),
            ],
            projects,
            'last-p'
        );
        expect(result.source).toBe('series');
        expect(result.projectId).toBe('p-a');
        expect(result.taskId).toBe('t-early');
        expect(result.billable).toBe(true);
        expect(result.reason).toEqual({ kind: 'series' });
        expect(result.picks).toEqual([]);
    });

    it('prefills the project of at least half of the meetings with a batch reason', () => {
        const result = resolveBatchPrefill(
            [
                meeting({ id: 'm-1', start: '2026-11-16T09:00:00Z', assignment: assignment() }),
                meeting({
                    id: 'm-2',
                    start: '2026-11-16T10:00:00Z',
                    suggestions: [suggestion('p-a', true), suggestion('p-c', false)],
                }),
                meeting({
                    id: 'm-3',
                    start: '2026-11-16T11:00:00Z',
                    suggestions: [suggestion('p-b', false)],
                }),
            ],
            projects,
            'last-p'
        );
        expect(result.source).toBe('suggestion');
        expect(result.projectId).toBe('p-a');
        expect(result.taskId).toBeNull();
        expect(result.tags).toEqual([]);
        expect(result.billable).toBeNull();
        expect(result.reason).toEqual({ kind: 'batch', count: 2, total: 3 });
        expect(result.picks.map((pick) => pick.project_id)).toEqual(['p-b']);
    });

    it('breaks a tie by the earliest meeting', () => {
        const result = resolveBatchPrefill(
            [
                meeting({
                    id: 'm-late',
                    start: '2026-11-16T11:00:00Z',
                    suggestions: [suggestion('p-b', true)],
                }),
                meeting({
                    id: 'm-early',
                    start: '2026-11-16T09:00:00Z',
                    suggestions: [suggestion('p-c', true)],
                }),
            ],
            projects,
            'last-p'
        );
        expect(result.projectId).toBe('p-c');
        expect(result.reason).toEqual({ kind: 'batch', count: 1, total: 2 });
        expect(result.picks.map((pick) => pick.project_id)).toEqual(['p-b']);
    });

    it('falls back to last used below half and offers the most common candidates as picks', () => {
        const result = resolveBatchPrefill(
            [
                meeting({
                    id: 'm-1',
                    start: '2026-11-16T09:00:00Z',
                    suggestions: [suggestion('p-b', true)],
                }),
                meeting({
                    id: 'm-2',
                    start: '2026-11-16T10:00:00Z',
                    suggestions: [suggestion('p-c', false)],
                }),
                meeting({
                    id: 'm-3',
                    start: '2026-11-16T11:00:00Z',
                    suggestions: [suggestion('p-c', false)],
                }),
                meeting({
                    id: 'm-4',
                    start: '2026-11-16T12:00:00Z',
                    suggestions: [suggestion('p-d', false)],
                }),
                meeting({ id: 'm-5', start: '2026-11-16T13:00:00Z' }),
            ],
            projects,
            'last-p'
        );
        expect(result.source).toBe('last_used');
        expect(result.projectId).toBe('last-p');
        expect(result.reason).toEqual({ kind: 'last_used' });
        expect(result.picks.map((pick) => pick.project_id)).toEqual(['p-c', 'p-b']);
    });

    it('prefills nothing when no meeting has a candidate and nothing was used last', () => {
        const result = resolveBatchPrefill(
            [meeting({ id: 'm-1' }), meeting({ id: 'm-2' })],
            projects,
            null
        );
        expect(result.source).toBe('none');
        expect(result.projectId).toBeNull();
        expect(result.reason).toBeNull();
        expect(result.picks).toEqual([]);
    });
});

describe('series notes', () => {
    it("says 'new' for a recurring meeting without an assignment once a project is chosen", () => {
        expect(seriesNote(meeting({ series_key: 's-1' }), 'p-a')).toBe('new');
        expect(seriesNote(meeting({ series_key: 's-1' }), null)).toBeNull();
        expect(seriesNote(meeting(), 'p-a')).toBeNull();
    });

    it("says 'change' only when the project differs from the pre-assignment", () => {
        const preassigned = meeting({ series_key: 's-1', assignment: assignment() });
        expect(seriesNote(preassigned, 'p-b')).toBe('change');
        expect(seriesNote(preassigned, 'p-a')).toBeNull();
    });

    it('shows the batch note when any selected meeting is recurring', () => {
        expect(batchSeriesNote([meeting(), meeting({ series_key: 's-1' })])).toBe(true);
        expect(batchSeriesNote([meeting(), meeting({ series_key: null })])).toBe(false);
    });
});
