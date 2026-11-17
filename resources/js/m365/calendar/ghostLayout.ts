import type { OutlookMeeting } from '@/m365/types';
import { getLocalizedDayJs, getLocalizedDayJsFromMinutes } from '@/packages/ui/src/utils/time';

// UI-SPEC: a ghost never gets shorter than 16px so a 5 minute meeting stays clickable.
export const GHOST_MIN_HEIGHT = 16;
// Default column cap when the caller passes no measured maximum (Phase 3 behaviour).
export const GHOST_MAX_LANES = 3;

// UI-SPEC 3.1 "Day column geometry": a side-by-side column is never narrower than 56px, at most 3
// columns in week view and 4 in day view; extra overlapping meetings cascade in the last column.
export const GHOST_MIN_COLUMN_WIDTH = 56;
export const GHOST_MAX_COLUMNS_WEEK = 3;
export const GHOST_MAX_COLUMNS_DAY = 4;
export const GHOST_MAX_CASCADE = 3;

// Lane geometry in px: 2px gutter at both lane edges, 2px gap between columns, 8px per cascade step.
const LANE_GUTTER = 2;
const COLUMN_GAP = 2;
const CASCADE_STEP = 8;

export interface GhostBox {
    meeting: OutlookMeeting;
    top: number;
    height: number;
    lane: number;
    lanes: number;
    // 0 for a meeting with its own column; 1..GHOST_MAX_CASCADE for extras sharing the last column.
    cascade: number;
    isClippedStart: boolean;
    isClippedEnd: boolean;
}

export interface GhostVisibleSettings {
    startHour: number;
    endHour: number;
}

// Phase 3.1 D-04 (half-lane rule, supersedes Phase 3 D-23): on every day with a meeting the day
// column splits into "My time" (left, entries) and "Outlook" (right, this lane). Week view: half the
// column, at least 88px, always leaving 52px for entries. Day view: a 260px to 420px panel.
export function ghostLaneWidth(isDayView: boolean): string {
    return isDayView ? 'min(420px, max(260px, 38%))' : 'min(max(88px, 50%), calc(100% - 52px))';
}

// Number of side-by-side columns the measured lane width allows: floor(width / 56px), clamped to
// 1..3 (week) or 1..4 (day). 113px -> 2, 88px -> 1, 420px (day) -> 4. An unusable width gives 1.
export function maxGhostColumns(laneWidthPx: number, isDayView: boolean): number {
    const cap = isDayView ? GHOST_MAX_COLUMNS_DAY : GHOST_MAX_COLUMNS_WEEK;
    if (!Number.isFinite(laneWidthPx) || laneWidthPx <= 0) return 1;
    return Math.min(cap, Math.max(1, Math.floor(laneWidthPx / GHOST_MIN_COLUMN_WIDTH)));
}

function reservedPx(lanes: number): number {
    return 2 * LANE_GUTTER + (lanes - 1) * COLUMN_GAP;
}

function cssNumber(value: number): string {
    return String(Number(value.toFixed(4)));
}

// Position of a block inside the lane as CSS strings: equal-width columns between the 2px lane
// gutters with a 2px gap, and a cascaded block shifted right (and narrowed) by 8px per depth.
// Column k of n starts at (100% - R) * k / n + 2px + 2px * k (R = both gutters + all gaps); the
// formula is expanded to a flat calc(<percent> + <px>) so no nested parentheses reach the style.
export function ghostColumnStyle(
    lane: number,
    lanes: number,
    cascade: number
): { left: string; width: string } {
    const reserved = reservedPx(lanes);
    const shift = cascade * CASCADE_STEP;
    const leftPx = LANE_GUTTER + lane * COLUMN_GAP + shift - (reserved * lane) / lanes;
    const widthPx = reserved / lanes + shift;

    const left =
        lane === 0
            ? `${cssNumber(leftPx)}px`
            : `calc(${cssNumber((100 * lane) / lanes)}% + ${cssNumber(leftPx)}px)`;
    const width = `calc(${cssNumber(100 / lanes)}% - ${cssNumber(widthPx)}px)`;

    return { left, width };
}

// Pixel width of a block for a measured lane width (same geometry as ghostColumnStyle).
export function ghostBlockWidthPx(laneWidthPx: number, lanes: number, cascade: number): number {
    return Math.max(0, (laneWidthPx - reservedPx(lanes)) / lanes - cascade * CASCADE_STEP);
}

interface PlacedGhost {
    box: GhostBox;
    startMin: number;
    endMin: number;
}

// Pixel slack so two ghosts that touch (back-to-back meetings) never count as overlapping despite
// floating point noise in minutesToPixels.
const PIXEL_EPSILON = 0.01;

// Clips every meeting to one calendar day in the user's timezone (like useActivityBoxes does for
// activity periods) and to the visible hours. Positions come from wall-clock minutes, so they stay
// correct on DST transition days. Overlapping ghosts are assigned lanes deterministically (start,
// then end, then id), at most maxColumns per overlap cluster (see maxGhostColumns).
export function layoutGhostsForDay(
    meetings: OutlookMeeting[],
    dayStr: string,
    settings: GhostVisibleSettings,
    minutesToPixels: (minutes: number) => number,
    maxColumns: number = GHOST_MAX_LANES
): GhostBox[] {
    const dayStart = getLocalizedDayJsFromMinutes(dayStr, 0);
    const dayEnd = getLocalizedDayJsFromMinutes(dayStr, 1440);
    const visibleStart = settings.startHour * 60;
    const visibleEnd = settings.endHour * 60;
    const placed: PlacedGhost[] = [];

    for (const meeting of meetings) {
        const start = getLocalizedDayJs(meeting.start);
        const end = getLocalizedDayJs(meeting.end);
        const isZeroLength = !end.isAfter(start);

        // Half-open overlap with the day: [start, end) against [dayStart, dayEnd). A zero-length
        // meeting is a point and belongs to the day that contains it.
        if (isZeroLength) {
            if (start.isBefore(dayStart) || !start.isBefore(dayEnd)) continue;
        } else if (!start.isBefore(dayEnd) || !end.isAfter(dayStart)) {
            continue;
        }

        const isClippedStart = start.isBefore(dayStart);
        const isClippedEnd = !end.isBefore(dayEnd);
        const startMinutes = isClippedStart ? 0 : start.hour() * 60 + start.minute();
        const endMinutes = isClippedEnd ? 1440 : end.hour() * 60 + end.minute();

        const clampedStart = Math.max(startMinutes, visibleStart);
        const clampedEnd = Math.min(endMinutes, visibleEnd);
        if (isZeroLength) {
            if (startMinutes < visibleStart || startMinutes >= visibleEnd) continue;
        } else if (clampedEnd <= clampedStart) {
            continue;
        }

        placed.push({
            startMin: clampedStart,
            endMin: Math.max(clampedEnd, clampedStart),
            box: {
                meeting,
                top: minutesToPixels(clampedStart - visibleStart),
                height: Math.max(
                    GHOST_MIN_HEIGHT,
                    minutesToPixels(Math.max(clampedEnd, clampedStart) - clampedStart)
                ),
                lane: 0,
                lanes: 1,
                cascade: 0,
                isClippedStart,
                isClippedEnd,
            },
        });
    }

    placed.sort(
        (a, b) =>
            a.startMin - b.startMin ||
            a.endMin - b.endMin ||
            compareIds(a.box.meeting.id, b.box.meeting.id)
    );

    assignLanes(
        placed.map((p) => p.box),
        Math.max(1, Math.floor(maxColumns))
    );

    return placed.map((p) => p.box);
}

function compareIds(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

// Greedy lane assignment per overlap cluster, on the drawn pixel extent (so a ghost stretched to
// the minimum height is never covered by its neighbour). A lane is free when its last ghost ends at
// or before the next one starts, so back-to-back meetings share a lane. When all maxColumns lanes
// are taken, later ghosts share the last lane in start order and cascade (depth 1, 2, 3, then 3), so
// each one stays visible and later starts paint on top.
function assignLanes(boxes: GhostBox[], maxColumns: number): void {
    let cluster: GhostBox[] = [];
    let laneBottoms: number[] = [];
    let clusterBottom = -Infinity;
    let extras = 0;

    const closeCluster = () => {
        const lanes = Math.min(laneBottoms.length, maxColumns);
        for (const box of cluster) box.lanes = lanes;
        cluster = [];
        laneBottoms = [];
        clusterBottom = -Infinity;
        extras = 0;
    };

    for (const box of boxes) {
        if (cluster.length > 0 && box.top >= clusterBottom - PIXEL_EPSILON) closeCluster();

        const bottom = box.top + box.height;
        let lane = laneBottoms.findIndex((laneBottom) => laneBottom <= box.top + PIXEL_EPSILON);
        let cascade = 0;
        if (lane === -1) {
            if (laneBottoms.length < maxColumns) {
                laneBottoms.push(bottom);
                lane = laneBottoms.length - 1;
            } else {
                lane = maxColumns - 1;
                laneBottoms[lane] = Math.max(laneBottoms[lane] ?? 0, bottom);
                extras += 1;
                cascade = Math.min(extras, GHOST_MAX_CASCADE);
            }
        } else {
            laneBottoms[lane] = bottom;
            // The last column is free again: the cascade restarts
            if (lane === maxColumns - 1) extras = 0;
        }

        box.lane = lane;
        box.cascade = cascade;
        cluster.push(box);
        clusterBottom = Math.max(clusterBottom, bottom);
    }

    closeCluster();
}
