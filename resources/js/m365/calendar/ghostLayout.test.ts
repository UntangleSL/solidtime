import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
    GHOST_MAX_LANES,
    GHOST_MIN_HEIGHT,
    ghostLaneWidth,
    layoutGhostsForDay,
    type GhostVisibleSettings,
} from './ghostLayout';
import type { OutlookMeeting } from '@/m365/types';

const FULL_DAY: GhostVisibleSettings = { startHour: 0, endHour: 24 };
const identity = (minutes: number) => minutes;

function meeting(id: string, start: string, end: string): OutlookMeeting {
    return {
        id,
        subject: `Meeting ${id}`,
        start,
        end,
        organizer_name: null,
        is_organizer: false,
        is_online_meeting: false,
        web_link: null,
        dismissed: false,
    };
}

describe('layoutGhostsForDay', () => {
    beforeEach(() => {
        vi.mocked(window.getTimezoneSetting).mockReturnValue('Europe/Madrid');
    });

    afterEach(() => {
        vi.mocked(window.getTimezoneSetting).mockReturnValue('UTC');
    });

    it('S2 occurrences render at 10:00 Europe/Madrid across DST', () => {
        // 2026-10-25 is the end of daylight saving time in Madrid: 08:00Z is 10:00 CEST on the
        // 20th and 09:00Z is 10:00 CET on the 27th.
        const first = layoutGhostsForDay(
            [meeting('a', '2026-10-20T08:00:00Z', '2026-10-20T09:00:00Z')],
            '2026-10-20',
            FULL_DAY,
            identity
        );
        const second = layoutGhostsForDay(
            [meeting('b', '2026-10-27T09:00:00Z', '2026-10-27T10:00:00Z')],
            '2026-10-27',
            FULL_DAY,
            identity
        );

        expect(first).toHaveLength(1);
        expect(first[0]!.top).toBe(identity(600));
        expect(first[0]!.height).toBe(60);
        expect(second).toHaveLength(1);
        expect(second[0]!.top).toBe(identity(600));
    });

    it('parses Graph style 7 digit fractional seconds', () => {
        const boxes = layoutGhostsForDay(
            [meeting('a', '2026-10-20T08:00:00.0000000Z', '2026-10-20T09:00:00.0000000Z')],
            '2026-10-20',
            FULL_DAY,
            identity
        );

        expect(boxes).toHaveLength(1);
        expect(boxes[0]!.top).toBe(600);
    });

    it('spring forward keeps local wall time', () => {
        // 2026-03-29 01:30Z is 03:30 CEST (the clocks jump at 01:00Z)
        const boxes = layoutGhostsForDay(
            [meeting('a', '2026-03-29T01:30:00Z', '2026-03-29T02:30:00Z')],
            '2026-03-29',
            FULL_DAY,
            identity
        );

        expect(boxes).toHaveLength(1);
        expect(boxes[0]!.top).toBe(210);
    });

    it('overnight meetings are clipped per day', () => {
        // 22:00 to 01:00 local (CET, UTC+1)
        const overnight = meeting('a', '2026-10-26T21:00:00Z', '2026-10-27T00:00:00Z');

        const first = layoutGhostsForDay([overnight], '2026-10-26', FULL_DAY, identity);
        const second = layoutGhostsForDay([overnight], '2026-10-27', FULL_DAY, identity);

        expect(first).toHaveLength(1);
        expect(first[0]).toMatchObject({
            top: 22 * 60,
            height: 120,
            isClippedStart: false,
            isClippedEnd: true,
        });
        expect(second).toHaveLength(1);
        expect(second[0]).toMatchObject({
            top: 0,
            height: 60,
            isClippedStart: true,
            isClippedEnd: false,
        });
    });

    it('clamps to the visible hours', () => {
        const visible: GhostVisibleSettings = { startHour: 8, endHour: 18 };
        // 07:00 to 09:00 local (CET, UTC+1) on 2026-10-27
        const early = meeting('early', '2026-10-27T06:00:00Z', '2026-10-27T08:00:00Z');
        // 19:00 to 20:00 local
        const late = meeting('late', '2026-10-27T18:00:00Z', '2026-10-27T19:00:00Z');

        const boxes = layoutGhostsForDay([early, late], '2026-10-27', visible, identity);

        expect(boxes).toHaveLength(1);
        expect(boxes[0]!.meeting.id).toBe('early');
        expect(boxes[0]!.top).toBe(0);
        expect(boxes[0]!.height).toBe(60);
    });

    it('back-to-back meetings render as two ghosts', () => {
        const boxes = layoutGhostsForDay(
            [
                meeting('a', '2026-10-27T08:00:00Z', '2026-10-27T09:00:00Z'),
                meeting('b', '2026-10-27T09:00:00Z', '2026-10-27T10:00:00Z'),
            ],
            '2026-10-27',
            FULL_DAY,
            identity
        );

        expect(boxes.map((b) => [b.meeting.id, b.lane, b.lanes])).toEqual([
            ['a', 0, 1],
            ['b', 0, 1],
        ]);
    });

    it('assigns lanes by start, end, id capped at 3', () => {
        const three = layoutGhostsForDay(
            [
                meeting('c', '2026-10-27T09:00:00Z', '2026-10-27T10:00:00Z'),
                meeting('a', '2026-10-27T09:00:00Z', '2026-10-27T10:00:00Z'),
                meeting('b', '2026-10-27T09:00:00Z', '2026-10-27T10:00:00Z'),
            ],
            '2026-10-27',
            FULL_DAY,
            identity
        );
        // identical start and end: ordered by id
        expect(three.map((b) => [b.meeting.id, b.lane, b.lanes])).toEqual([
            ['a', 0, 3],
            ['b', 1, 3],
            ['c', 2, 3],
        ]);

        const five = layoutGhostsForDay(
            [
                meeting('e', '2026-10-27T09:04:00Z', '2026-10-27T10:00:00Z'),
                meeting('d', '2026-10-27T09:03:00Z', '2026-10-27T10:00:00Z'),
                meeting('c', '2026-10-27T09:02:00Z', '2026-10-27T10:00:00Z'),
                meeting('b', '2026-10-27T09:01:00Z', '2026-10-27T10:00:00Z'),
                meeting('a', '2026-10-27T09:00:00Z', '2026-10-27T10:00:00Z'),
            ],
            '2026-10-27',
            FULL_DAY,
            identity
        );
        expect(five.map((b) => b.meeting.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(five.map((b) => b.lane)).toEqual([0, 1, 2, 2, 2]);
        expect(five.every((b) => b.lanes === GHOST_MAX_LANES)).toBe(true);
    });

    it('reuses a lane once it is free and keeps separate clusters independent', () => {
        const boxes = layoutGhostsForDay(
            [
                meeting('a', '2026-10-27T08:00:00Z', '2026-10-27T09:00:00Z'),
                meeting('b', '2026-10-27T08:30:00Z', '2026-10-27T09:30:00Z'),
                meeting('c', '2026-10-27T09:00:00Z', '2026-10-27T09:45:00Z'),
                meeting('d', '2026-10-27T12:00:00Z', '2026-10-27T13:00:00Z'),
            ],
            '2026-10-27',
            FULL_DAY,
            identity
        );

        // c starts when a ends, so it takes lane 0; d is a separate cluster with one lane
        expect(boxes.map((b) => [b.meeting.id, b.lane, b.lanes])).toEqual([
            ['a', 0, 2],
            ['b', 1, 2],
            ['c', 0, 2],
            ['d', 0, 1],
        ]);
    });

    it('short meetings get the minimum height', () => {
        const boxes = layoutGhostsForDay(
            [meeting('a', '2026-10-27T09:00:00Z', '2026-10-27T09:05:00Z')],
            '2026-10-27',
            FULL_DAY,
            identity
        );

        expect(GHOST_MIN_HEIGHT).toBe(16);
        expect(boxes[0]!.height).toBe(16);
    });

    it('draws a zero-length meeting at the minimum height when it is visible', () => {
        const visible: GhostVisibleSettings = { startHour: 8, endHour: 18 };
        const boxes = layoutGhostsForDay(
            [
                meeting('in', '2026-10-27T09:00:00Z', '2026-10-27T09:00:00Z'),
                meeting('out', '2026-10-27T03:00:00Z', '2026-10-27T03:00:00Z'),
            ],
            '2026-10-27',
            visible,
            identity
        );

        expect(boxes).toHaveLength(1);
        expect(boxes[0]!.meeting.id).toBe('in');
        expect(boxes[0]!.height).toBe(16);
    });

    it('uses minutesToPixels for the pixel positions', () => {
        // 25px per 15 minutes like the core grid
        const gridPixels = (minutes: number) => (minutes / 15) * 25;
        const boxes = layoutGhostsForDay(
            [meeting('a', '2026-10-27T09:00:00Z', '2026-10-27T10:00:00Z')],
            '2026-10-27',
            { startHour: 8, endHour: 18 },
            gridPixels
        );

        // 10:00 local with the grid starting at 08:00 is 120 minutes in
        expect(boxes[0]!.top).toBe(gridPixels(120));
        expect(boxes[0]!.height).toBe(gridPixels(60));
    });

    it('skips meetings that do not touch the day', () => {
        const boxes = layoutGhostsForDay(
            [meeting('a', '2026-10-28T09:00:00Z', '2026-10-28T10:00:00Z')],
            '2026-10-27',
            FULL_DAY,
            identity
        );

        expect(boxes).toEqual([]);
    });
});

describe('ghostLaneWidth', () => {
    it('reserves 30% (min 16px) in week view and 25% (max 240px) in day view', () => {
        expect(ghostLaneWidth(false)).toBe('max(16px, 30%)');
        expect(ghostLaneWidth(true)).toBe('min(240px, 25%)');
    });
});
