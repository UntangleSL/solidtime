import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
    GHOST_MAX_LANES,
    GHOST_MIN_COLUMN_WIDTH,
    GHOST_MIN_HEIGHT,
    ghostBlockWidthPx,
    ghostColumnStyle,
    ghostLaneWidth,
    layoutGhostsForDay,
    maxGhostColumns,
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

describe('maxGhostColumns', () => {
    it('derives the column count from the measured lane width (56px per column)', () => {
        expect(GHOST_MIN_COLUMN_WIDTH).toBe(56);
        expect(maxGhostColumns(113, false)).toBe(2);
        expect(maxGhostColumns(88, false)).toBe(1);
        expect(maxGhostColumns(159, false)).toBe(2);
        expect(maxGhostColumns(168, false)).toBe(3);
        expect(maxGhostColumns(300, false)).toBe(3);
        expect(maxGhostColumns(420, true)).toBe(4);
        expect(maxGhostColumns(300, true)).toBe(4);
        expect(maxGhostColumns(200, true)).toBe(3);
        expect(maxGhostColumns(40, true)).toBe(1);
    });

    it('falls back to one column for an unusable measurement', () => {
        for (const isDayView of [false, true]) {
            expect(maxGhostColumns(0, isDayView)).toBe(1);
            expect(maxGhostColumns(Number.NaN, isDayView)).toBe(1);
            expect(maxGhostColumns(-20, isDayView)).toBe(1);
        }
    });
});

describe('cascade of extra overlapping meetings', () => {
    function sameTime(count: number) {
        return Array.from({ length: count }, (_, index) =>
            meeting(`m${index}`, '2026-10-27T09:00:00Z', '2026-10-27T10:00:00Z')
        );
    }

    it('puts extras in the last column with cascade depth 1, 2, 3', () => {
        const boxes = layoutGhostsForDay(sameTime(5), '2026-10-27', FULL_DAY, identity, 2);

        expect(boxes.map((b) => b.meeting.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
        expect(boxes.map((b) => b.lane)).toEqual([0, 1, 1, 1, 1]);
        expect(boxes.map((b) => b.cascade)).toEqual([0, 0, 1, 2, 3]);
        expect(boxes.every((b) => b.lanes === 2)).toBe(true);
    });

    it('keeps the cascade at depth 3 beyond three extras', () => {
        const boxes = layoutGhostsForDay(sameTime(7), '2026-10-27', FULL_DAY, identity, 2);

        expect(boxes.map((b) => b.cascade)).toEqual([0, 0, 1, 2, 3, 3, 3]);
    });

    it('lets back-to-back meetings share a column without cascade', () => {
        const boxes = layoutGhostsForDay(
            [
                meeting('a', '2026-10-27T09:00:00Z', '2026-10-27T10:00:00Z'),
                meeting('b', '2026-10-27T10:00:00Z', '2026-10-27T11:00:00Z'),
                meeting('c', '2026-10-27T11:00:00Z', '2026-10-27T12:00:00Z'),
            ],
            '2026-10-27',
            FULL_DAY,
            identity,
            1
        );

        expect(boxes.map((b) => [b.meeting.id, b.lane, b.lanes, b.cascade])).toEqual([
            ['a', 0, 1, 0],
            ['b', 0, 1, 0],
            ['c', 0, 1, 0],
        ]);
    });

    it('with one column every overlap after the first cascades', () => {
        const boxes = layoutGhostsForDay(sameTime(3), '2026-10-27', FULL_DAY, identity, 1);

        expect(boxes.map((b) => [b.lane, b.cascade])).toEqual([
            [0, 0],
            [0, 1],
            [0, 2],
        ]);
    });

    it('defaults to GHOST_MAX_LANES columns when no maximum is given', () => {
        const boxes = layoutGhostsForDay(sameTime(4), '2026-10-27', FULL_DAY, identity);

        expect(boxes.map((b) => b.lane)).toEqual([0, 1, 2, 2]);
        expect(boxes.map((b) => b.cascade)).toEqual([0, 0, 0, 1]);
        expect(boxes.every((b) => b.lanes === GHOST_MAX_LANES)).toBe(true);
    });
});

describe('ghostColumnStyle', () => {
    it('splits the lane into equal columns inside 2px gutters with 2px gaps', () => {
        expect(ghostColumnStyle(0, 1, 0)).toEqual({ left: '2px', width: 'calc(100% - 4px)' });

        expect(ghostColumnStyle(0, 2, 0)).toEqual({ left: '2px', width: 'calc(50% - 3px)' });
        expect(ghostColumnStyle(1, 2, 0)).toEqual({
            left: 'calc(50% + 1px)',
            width: 'calc(50% - 3px)',
        });

        expect(ghostColumnStyle(0, 3, 0)).toEqual({
            left: '2px',
            width: 'calc(33.3333% - 2.6667px)',
        });
        expect(ghostColumnStyle(1, 3, 0).left).toBe('calc(33.3333% + 1.3333px)');
        expect(ghostColumnStyle(2, 3, 0).left).toBe('calc(66.6667% + 0.6667px)');

        expect(ghostColumnStyle(0, 4, 0)).toEqual({ left: '2px', width: 'calc(25% - 2.5px)' });
        expect(ghostColumnStyle(1, 4, 0).left).toBe('calc(25% + 1.5px)');
        expect(ghostColumnStyle(2, 4, 0).left).toBe('calc(50% + 1px)');
        expect(ghostColumnStyle(3, 4, 0).left).toBe('calc(75% + 0.5px)');
    });

    it('shifts a cascaded block right by 8px per depth and narrows it as much', () => {
        expect(ghostColumnStyle(0, 1, 1)).toEqual({ left: '10px', width: 'calc(100% - 12px)' });
        expect(ghostColumnStyle(0, 1, 3)).toEqual({ left: '26px', width: 'calc(100% - 28px)' });
        expect(ghostColumnStyle(1, 2, 1)).toEqual({
            left: 'calc(50% + 9px)',
            width: 'calc(50% - 11px)',
        });
        expect(ghostColumnStyle(1, 2, 2)).toEqual({
            left: 'calc(50% + 17px)',
            width: 'calc(50% - 19px)',
        });
        expect(ghostColumnStyle(2, 3, 3)).toEqual({
            left: 'calc(66.6667% + 24.6667px)',
            width: 'calc(33.3333% - 26.6667px)',
        });
        expect(ghostColumnStyle(3, 4, 1)).toEqual({
            left: 'calc(75% + 8.5px)',
            width: 'calc(25% - 10.5px)',
        });
    });

    it('gives the matching pixel width for a measured lane', () => {
        expect(ghostBlockWidthPx(113, 2, 0)).toBe(53.5);
        expect(ghostBlockWidthPx(160, 1, 0)).toBe(156);
        expect(ghostBlockWidthPx(160, 1, 2)).toBe(140);
        expect(ghostBlockWidthPx(420, 4, 0)).toBe(102.5);
        expect(ghostBlockWidthPx(10, 1, 3)).toBe(0);
    });
});

describe('ghostLaneWidth', () => {
    it('reserves half the week column and a 260-420px day panel', () => {
        expect(ghostLaneWidth(false)).toBe('min(max(88px, 50%), calc(100% - 52px))');
        expect(ghostLaneWidth(true)).toBe('min(420px, max(260px, 38%))');
    });
});
