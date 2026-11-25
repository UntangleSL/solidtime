// Pure prefill rules of the meeting conversion forms (Phase 5).
//
// Prefill order (D-02 > D-07 > Phase 4): (1) the series pre-assignment fills project, task, tags and
// billable; (2) else the server's top suggestion, only when it is marked confident, fills the
// project alone; (3) else the Phase 4 last-used project (resolvePrefillProject, passed in by the
// form); (4) else nothing. Every result names its prefill_source (D-16) so the server can measure
// how often the prefill is kept. Suggestions never pre-assign a series (D-08): only a conversion
// the user submits does.
import type {
    OutlookAssignment,
    OutlookMeeting,
    OutlookPrefillSource,
    OutlookSuggestion,
} from '../types';
import type { PrefillReason } from './suggestionReason';

interface PrefillProject {
    id: string;
    is_archived: boolean;
}

export interface Prefill {
    source: OutlookPrefillSource;
    projectId: string | null;
    taskId: string | null;
    tags: string[];
    // null means "follow the project's default" (the form keeps its Phase 4 billable watcher).
    billable: boolean | null;
    reason: PrefillReason | null;
}

export interface BatchPrefill extends Prefill {
    // Up to two other candidates, most common first (quick-pick chips).
    picks: OutlookSuggestion[];
}

// The Phase 5 meeting fields are optional (pre-Phase-5 fixtures and caches): missing reads as a
// one-off, not ignored, unassigned meeting without suggestions.
export function isRecurring(meeting: OutlookMeeting): boolean {
    return typeof meeting.series_key === 'string' && meeting.series_key !== '';
}

export function isFaded(meeting: OutlookMeeting): boolean {
    return meeting.dismissed || meeting.series_ignored === true;
}

// A meeting Outlook moved after its entry was logged (Phase 6 D-03) is not pre-assigned: the user
// chooses between a new entry and moving the logged one, so Confirm never creates a duplicate.
export function isPreassigned(meeting: OutlookMeeting): boolean {
    return (meeting.assignment ?? null) !== null && !isFaded(meeting) && !meeting.moved_from;
}

function usableProject(projectId: string, projects: readonly PrefillProject[]): boolean {
    return projects.some((project) => project.id === projectId && !project.is_archived);
}

function seriesPrefill(assignment: OutlookAssignment): Prefill {
    return {
        source: 'series',
        projectId: assignment.project_id,
        taskId: assignment.task_id,
        tags: [...assignment.tags],
        billable: assignment.billable,
        reason: { kind: 'series' },
    };
}

function fallbackPrefill(lastUsedProjectId: string | null): Prefill {
    if (lastUsedProjectId !== null) {
        return {
            source: 'last_used',
            projectId: lastUsedProjectId,
            taskId: null,
            tags: [],
            billable: null,
            reason: { kind: 'last_used' },
        };
    }
    return {
        source: 'none',
        projectId: null,
        taskId: null,
        tags: [],
        billable: null,
        reason: null,
    };
}

// The confident top suggestion when its project is loaded and not archived (else it falls through).
function confidentTop(
    meeting: OutlookMeeting,
    projects: readonly PrefillProject[]
): OutlookSuggestion | null {
    const top = meeting.suggestions?.[0];
    return top !== undefined && top.confident && usableProject(top.project_id, projects)
        ? top
        : null;
}

// `lastUsedProjectId` is the Phase 4 result of resolvePrefillProject (already checked against the
// loaded projects).
export function resolveSinglePrefill(
    meeting: OutlookMeeting,
    projects: readonly PrefillProject[],
    lastUsedProjectId: string | null
): Prefill {
    if (meeting.assignment) return seriesPrefill(meeting.assignment);

    const top = confidentTop(meeting, projects);
    if (top !== null) {
        return {
            source: 'suggestion',
            projectId: top.project_id,
            taskId: null,
            tags: [],
            billable: null,
            reason: top.reason,
        };
    }

    return fallbackPrefill(lastUsedProjectId);
}

// Up to `max` candidates whose project is not the one in the picker, in the given (server) order.
export function quickPicks(
    candidates: readonly OutlookSuggestion[],
    currentProjectId: string | null,
    max = 2
): OutlookSuggestion[] {
    const seen = new Set<string>();
    const picks: OutlookSuggestion[] = [];
    for (const candidate of candidates) {
        if (picks.length >= max) break;
        if (candidate.project_id === currentProjectId || seen.has(candidate.project_id)) continue;
        seen.add(candidate.project_id);
        picks.push(candidate);
    }
    return picks;
}

interface Tally {
    projectId: string;
    // Meetings whose assignment or confident top suggestion is this project (prefill majority).
    votes: number;
    // Meetings whose top candidate (assignment, or first suggestion of any confidence) it is.
    candidates: number;
    // Index of the earliest meeting naming it (tie-break).
    first: number;
    // A suggestion object to show as a quick pick (null when only assignments name the project).
    suggestion: OutlookSuggestion | null;
}

function byStart(meetings: readonly OutlookMeeting[]): OutlookMeeting[] {
    return [...meetings].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

// Batch form (D-08): one shared series assignment wins; else the project that is the assignment or
// confident top suggestion of at least half of the meetings ("Suggested for 2 of 3 meetings"),
// ties broken by the earliest meeting; else last used. Picks are the next most common top
// candidates (below-threshold tops included).
export function resolveBatchPrefill(
    meetings: readonly OutlookMeeting[],
    projects: readonly PrefillProject[],
    lastUsedProjectId: string | null
): BatchPrefill {
    const ordered = byStart(meetings);
    const total = ordered.length;

    const first = ordered[0];
    if (
        first?.assignment &&
        ordered.every((meeting) => meeting.assignment?.project_id === first.assignment?.project_id)
    ) {
        return { ...seriesPrefill(first.assignment), picks: [] };
    }

    const tallies = new Map<string, Tally>();
    const tally = (projectId: string, index: number): Tally => {
        let entry = tallies.get(projectId);
        if (entry === undefined) {
            entry = { projectId, votes: 0, candidates: 0, first: index, suggestion: null };
            tallies.set(projectId, entry);
        }
        return entry;
    };

    ordered.forEach((meeting, index) => {
        if (meeting.assignment) {
            const entry = tally(meeting.assignment.project_id, index);
            entry.votes++;
            entry.candidates++;
            return;
        }
        const top = meeting.suggestions?.[0];
        if (top === undefined) return;
        const entry = tally(top.project_id, index);
        entry.candidates++;
        entry.suggestion ??= top;
        if (confidentTop(meeting, projects) !== null) entry.votes++;
    });

    const all = [...tallies.values()];
    const winner = [...all]
        .filter((entry) => entry.votes > 0)
        .sort((a, b) => b.votes - a.votes || a.first - b.first)[0];

    const prefill: Prefill =
        winner !== undefined && winner.votes >= Math.ceil(total / 2)
            ? {
                  source: 'suggestion',
                  projectId: winner.projectId,
                  taskId: null,
                  tags: [],
                  billable: null,
                  reason: { kind: 'batch', count: winner.votes, total },
              }
            : fallbackPrefill(lastUsedProjectId);

    const ranked = all
        .sort((a, b) => b.candidates - a.candidates || a.first - b.first)
        .map((entry) => entry.suggestion)
        .filter((suggestion): suggestion is OutlookSuggestion => suggestion !== null);

    return { ...prefill, picks: quickPicks(ranked, prefill.projectId) };
}

// The note under the picks: 'new' when the conversion will pre-assign a recurring meeting's series
// for the first time, 'change' when it moves a pre-assigned series to another project.
export function seriesNote(
    meeting: OutlookMeeting,
    projectId: string | null
): 'new' | 'change' | null {
    if (projectId === null) return null;
    if (meeting.assignment) return meeting.assignment.project_id !== projectId ? 'change' : null;
    return isRecurring(meeting) ? 'new' : null;
}

export function batchSeriesNote(meetings: readonly OutlookMeeting[]): boolean {
    return meetings.some(isRecurring);
}
