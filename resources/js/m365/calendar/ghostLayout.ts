import type { OutlookMeeting } from '@/m365/types';
import { getLocalizedDayJs, getLocalizedDayJsFromMinutes } from '@/packages/ui/src/utils/time';

// UI-SPEC: a ghost never gets shorter than 16px so a 5 minute meeting stays clickable.
export const GHOST_MIN_HEIGHT = 16;
export const GHOST_MAX_LANES = 3;

export interface GhostBox {
    meeting: OutlookMeeting;
    top: number;
    height: number;
    lane: number;
    lanes: number;
    isClippedStart: boolean;
    isClippedEnd: boolean;
}

export interface GhostVisibleSettings {
    startHour: number;
    endHour: number;
}

// Layout decision D-23: width of the reserved right-hand Outlook lane of a day column.
export function ghostLaneWidth(isDayView: boolean): string {
    return isDayView ? 'min(240px, 25%)' : 'max(16px, 30%)';
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
// then end, then id), at most GHOST_MAX_LANES per overlap cluster.
export function layoutGhostsForDay(
    meetings: OutlookMeeting[],
    dayStr: string,
    settings: GhostVisibleSettings,
    minutesToPixels: (minutes: number) => number
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

    assignLanes(placed.map((p) => p.box));

    return placed.map((p) => p.box);
}

function compareIds(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

// Greedy lane assignment per overlap cluster, on the drawn pixel extent (so a ghost stretched to
// the minimum height is never covered by its neighbour). A lane is free when its last ghost ends at
// or before the next one starts, so back-to-back meetings share a lane. When all GHOST_MAX_LANES
// lanes are taken, later ghosts stack in the last lane in start order.
function assignLanes(boxes: GhostBox[]): void {
    let cluster: GhostBox[] = [];
    let laneBottoms: number[] = [];
    let clusterBottom = -Infinity;

    const closeCluster = () => {
        const lanes = Math.min(laneBottoms.length, GHOST_MAX_LANES);
        for (const box of cluster) box.lanes = lanes;
        cluster = [];
        laneBottoms = [];
        clusterBottom = -Infinity;
    };

    for (const box of boxes) {
        if (cluster.length > 0 && box.top >= clusterBottom - PIXEL_EPSILON) closeCluster();

        const bottom = box.top + box.height;
        let lane = laneBottoms.findIndex((laneBottom) => laneBottom <= box.top + PIXEL_EPSILON);
        if (lane === -1) {
            if (laneBottoms.length < GHOST_MAX_LANES) {
                laneBottoms.push(bottom);
                lane = laneBottoms.length - 1;
            } else {
                lane = GHOST_MAX_LANES - 1;
                laneBottoms[lane] = Math.max(laneBottoms[lane] ?? 0, bottom);
            }
        } else {
            laneBottoms[lane] = bottom;
        }

        box.lane = lane;
        cluster.push(box);
        clusterBottom = Math.max(clusterBottom, bottom);
    }

    closeCluster();
}
