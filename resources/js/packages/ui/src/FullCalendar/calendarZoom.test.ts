import { describe, expect, it } from 'vitest';
import {
    ZOOM_SLOT_MINUTES,
    anchoredScrollTop,
    canZoom,
    createWheelZoomAccumulator,
    datesAffectingSettingsKey,
    nextZoomSlotMinutes,
    normalizeWheelDelta,
    zoomPercent,
} from './calendarZoom';
import type { CalendarSettings } from './calendarSettings';

describe('zoom ladder', () => {
    it('is the Grid Scale options from zoomed out to zoomed in', () => {
        expect([...ZOOM_SLOT_MINUTES]).toEqual([60, 30, 15, 10, 5]);
    });

    it('maps each slot size to its percent (100% = 15 min = 100 px per hour)', () => {
        expect(ZOOM_SLOT_MINUTES.map(zoomPercent)).toEqual([25, 50, 100, 150, 300]);
    });

    it('steps in towards smaller slots and out towards larger ones', () => {
        expect(nextZoomSlotMinutes(15, 1)).toBe(10);
        expect(nextZoomSlotMinutes(10, 1)).toBe(5);
        expect(nextZoomSlotMinutes(15, -1)).toBe(30);
        expect(nextZoomSlotMinutes(30, -1)).toBe(60);
    });

    it('clamps at both ends of the ladder', () => {
        expect(nextZoomSlotMinutes(5, 1)).toBe(5);
        expect(nextZoomSlotMinutes(60, -1)).toBe(60);
        expect(canZoom(5, 1)).toBe(false);
        expect(canZoom(5, -1)).toBe(true);
        expect(canZoom(60, -1)).toBe(false);
        expect(canZoom(60, 1)).toBe(true);
    });

    it('snaps an off-ladder value to the nearest step before moving', () => {
        expect(nextZoomSlotMinutes(20, 1)).toBe(10);
        expect(nextZoomSlotMinutes(20, -1)).toBe(30);
        expect(nextZoomSlotMinutes(45, -1)).toBe(60);
    });
});

describe('normalizeWheelDelta', () => {
    it('keeps pixel deltas and converts lines and pages to pixels', () => {
        expect(normalizeWheelDelta({ deltaY: -100, deltaMode: 0 })).toBe(-100);
        expect(normalizeWheelDelta({ deltaY: 3, deltaMode: 1 })).toBe(120);
        expect(normalizeWheelDelta({ deltaY: -1, deltaMode: 2 })).toBe(-800);
    });
});

describe('createWheelZoomAccumulator', () => {
    it('makes one mouse notch one step; wheel up zooms in, wheel down zooms out', () => {
        const up = createWheelZoomAccumulator();
        expect(up.push(-100, 0)).toBe(1);
        const down = createWheelZoomAccumulator();
        expect(down.push(100, 0)).toBe(-1);
    });

    it('sums small pinch deltas until the 48 px threshold', () => {
        const acc = createWheelZoomAccumulator();
        expect([acc.push(-10, 0), acc.push(-10, 10), acc.push(-10, 20), acc.push(-10, 30)]).toEqual(
            [0, 0, 0, 0]
        );
        expect(acc.push(-10, 40)).toBe(1);
    });

    it('steps at most once per 100 ms', () => {
        const acc = createWheelZoomAccumulator();
        expect(acc.push(-100, 0)).toBe(1);
        expect(acc.push(-100, 50)).toBe(0);
        expect(acc.push(-100, 99)).toBe(0);
        expect(acc.push(-100, 120)).toBe(1);
    });

    it('forgets the accumulated delta after 150 ms idle', () => {
        const acc = createWheelZoomAccumulator();
        expect(acc.push(-30, 0)).toBe(0);
        expect(acc.push(-30, 200)).toBe(0);
        expect(acc.push(-30, 250)).toBe(1);
    });

    it('resets on a direction change', () => {
        const acc = createWheelZoomAccumulator();
        expect(acc.push(-30, 0)).toBe(0);
        expect(acc.push(30, 10)).toBe(0);
        expect(acc.push(-30, 20)).toBe(0);
        expect(acc.push(-30, 30)).toBe(1);
    });

    it('reset() clears a partial gesture', () => {
        const acc = createWheelZoomAccumulator();
        expect(acc.push(-40, 0)).toBe(0);
        acc.reset();
        expect(acc.push(-40, 10)).toBe(0);
    });
});

describe('anchoredScrollTop', () => {
    it('puts the anchor time back under the pointer', () => {
        // 14:00 at 10-minute slots is 84 slots * 25 px = 2100 px from midnight
        expect(anchoredScrollTop(14 * 60, 0, 10, 200)).toBe(1900);
    });

    it('accounts for the start hour', () => {
        expect(anchoredScrollTop(14 * 60, 8, 15, 100)).toBe((6 * 60 * 25) / 15 - 100);
    });

    it('never returns a negative scrollTop', () => {
        expect(anchoredScrollTop(30, 0, 60, 300)).toBe(0);
    });

    it('is the identity when the scale does not change', () => {
        const scrollTop = 1234;
        const offset = 150;
        const anchor = ((scrollTop + offset) / 25) * 15;
        expect(anchoredScrollTop(anchor, 0, 15, offset)).toBeCloseTo(scrollTop);
    });
});

describe('datesAffectingSettingsKey', () => {
    const base: CalendarSettings = {
        snapMinutes: 15,
        startHour: 0,
        endHour: 24,
        slotMinutes: 15,
        showWeekends: true,
    };

    it('ignores slotMinutes, so a zoom step does not refetch', () => {
        expect(datesAffectingSettingsKey({ ...base, slotMinutes: 5 })).toBe(
            datesAffectingSettingsKey(base)
        );
    });

    it('changes with snap, start hour, end hour and weekends', () => {
        const key = datesAffectingSettingsKey(base);
        expect(datesAffectingSettingsKey({ ...base, snapMinutes: 5 })).not.toBe(key);
        expect(datesAffectingSettingsKey({ ...base, startHour: 7 })).not.toBe(key);
        expect(datesAffectingSettingsKey({ ...base, endHour: 20 })).not.toBe(key);
        expect(datesAffectingSettingsKey({ ...base, showWeekends: false })).not.toBe(key);
    });

    it('treats a missing showWeekends as shown', () => {
        const { showWeekends: _omitted, ...withoutWeekends } = base;
        expect(datesAffectingSettingsKey(withoutWeekends)).toBe(datesAffectingSettingsKey(base));
    });
});
