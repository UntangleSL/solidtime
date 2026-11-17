import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR_SETTINGS, sanitizeCalendarSettings } from './calendarSettings';

const VALID = { snapMinutes: 15, startHour: 0, endHour: 24, slotMinutes: 15 };

describe('sanitizeCalendarSettings', () => {
    it('returns the defaults for a non-object', () => {
        for (const raw of [null, undefined, 'abc', 42, true, []]) {
            expect(sanitizeCalendarSettings(raw)).toEqual(DEFAULT_CALENDAR_SETTINGS);
        }
    });

    it('returns a copy, never the shared defaults object', () => {
        const result = sanitizeCalendarSettings(null);
        expect(result).not.toBe(DEFAULT_CALENDAR_SETTINGS);
    });

    it('fills a stored object without showWeekends with true', () => {
        expect(sanitizeCalendarSettings(VALID)).toEqual({ ...VALID, showWeekends: true });
    });

    it('coerces a non-boolean showWeekends to true', () => {
        for (const showWeekends of ['no', 'false', 0, 1, null, {}]) {
            expect(sanitizeCalendarSettings({ ...VALID, showWeekends }).showWeekends).toBe(true);
        }
    });

    it('replaces slotMinutes and snapMinutes outside the option lists with 15', () => {
        for (const value of ['abc', 0, 7, NaN, -15, Infinity, '15']) {
            const result = sanitizeCalendarSettings({
                ...VALID,
                slotMinutes: value,
                snapMinutes: value,
            });
            expect(result.slotMinutes).toBe(15);
            expect(result.snapMinutes).toBe(15);
        }
        // Valid options outside the other list: 1 is a snap option, not a grid scale
        const mixed = sanitizeCalendarSettings({ ...VALID, snapMinutes: 1, slotMinutes: 1 });
        expect(mixed.snapMinutes).toBe(1);
        expect(mixed.slotMinutes).toBe(15);
    });

    it('keeps valid hours and repairs invalid ones', () => {
        expect(sanitizeCalendarSettings({ ...VALID, startHour: 8, endHour: 18 })).toMatchObject({
            startHour: 8,
            endHour: 18,
        });
        expect(sanitizeCalendarSettings({ ...VALID, startHour: 30 }).startHour).toBe(0);
        expect(sanitizeCalendarSettings({ ...VALID, endHour: 0 }).endHour).toBe(24);
        expect(sanitizeCalendarSettings({ ...VALID, endHour: -1 }).endHour).toBe(24);
        expect(sanitizeCalendarSettings({ ...VALID, startHour: 8.5, endHour: 17.5 })).toMatchObject(
            { startHour: 0, endHour: 24 }
        );
        expect(sanitizeCalendarSettings({ ...VALID, startHour: '8', endHour: '18' })).toMatchObject(
            { startHour: 0, endHour: 24 }
        );
        // Inverted or equal hours fall back to the full day
        expect(sanitizeCalendarSettings({ ...VALID, startHour: 18, endHour: 8 })).toMatchObject({
            startHour: 0,
            endHour: 24,
        });
        expect(sanitizeCalendarSettings({ ...VALID, startHour: 9, endHour: 9 })).toMatchObject({
            startHour: 0,
            endHour: 24,
        });
    });

    it('keeps a fully valid object as is', () => {
        const stored = {
            snapMinutes: 5,
            startHour: 7,
            endHour: 20,
            slotMinutes: 30,
            showWeekends: false,
        };
        expect(sanitizeCalendarSettings(stored)).toEqual(stored);
    });

    it('drops unknown keys', () => {
        const result = sanitizeCalendarSettings({ ...VALID, injected: '<b>x</b>', slotHeight: 0 });
        expect(Object.keys(result).sort()).toEqual(
            ['endHour', 'showWeekends', 'slotMinutes', 'snapMinutes', 'startHour'].sort()
        );
    });
});
