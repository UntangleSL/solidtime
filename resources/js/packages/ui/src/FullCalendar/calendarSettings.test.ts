import { describe, expect, it } from 'vitest';
import {
    CALENDAR_SETTINGS_STORAGE_KEY,
    DEFAULT_CALENDAR_SETTINGS,
    WEEKENDS_HIDDEN_DEFAULT_MIGRATION_KEY,
    migrateWeekendsHiddenDefault,
    sanitizeCalendarSettings,
} from './calendarSettings';

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

    it('hides weekends by default', () => {
        expect(DEFAULT_CALENDAR_SETTINGS.showWeekends).toBe(false);
    });

    it('fills a stored object without showWeekends with false', () => {
        expect(sanitizeCalendarSettings(VALID)).toEqual({ ...VALID, showWeekends: false });
    });

    it('coerces a non-boolean showWeekends to false', () => {
        for (const showWeekends of ['yes', 'true', 0, 1, null, {}]) {
            expect(sanitizeCalendarSettings({ ...VALID, showWeekends }).showWeekends).toBe(false);
        }
    });

    it('keeps a stored boolean showWeekends', () => {
        expect(sanitizeCalendarSettings({ ...VALID, showWeekends: true }).showWeekends).toBe(true);
        expect(sanitizeCalendarSettings({ ...VALID, showWeekends: false }).showWeekends).toBe(
            false
        );
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

function memoryStorage(initial: Record<string, string> = {}) {
    const items = new Map(Object.entries(initial));
    return {
        items,
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => {
            items.set(key, value);
        },
    };
}

describe('migrateWeekendsHiddenDefault', () => {
    const OLD_DEFAULT = { ...VALID, showWeekends: true };

    it('resets the stored pre-change default once and records that it ran', () => {
        const storage = memoryStorage({
            [CALENDAR_SETTINGS_STORAGE_KEY]: JSON.stringify(OLD_DEFAULT),
        });

        migrateWeekendsHiddenDefault(() => storage);

        expect(JSON.parse(storage.items.get(CALENDAR_SETTINGS_STORAGE_KEY)!)).toEqual({
            ...OLD_DEFAULT,
            showWeekends: false,
        });
        expect(storage.items.get(WEEKENDS_HIDDEN_DEFAULT_MIGRATION_KEY)).toBe('1');
    });

    it('keeps a choice made after the migration ran', () => {
        const storage = memoryStorage({
            [CALENDAR_SETTINGS_STORAGE_KEY]: JSON.stringify(OLD_DEFAULT),
            [WEEKENDS_HIDDEN_DEFAULT_MIGRATION_KEY]: '1',
        });

        migrateWeekendsHiddenDefault(() => storage);

        expect(JSON.parse(storage.items.get(CALENDAR_SETTINGS_STORAGE_KEY)!)).toEqual(OLD_DEFAULT);
    });

    it('leaves other settings, a stored false and an empty storage alone', () => {
        const hidden = { ...VALID, startHour: 7, showWeekends: false };
        const storage = memoryStorage({ [CALENDAR_SETTINGS_STORAGE_KEY]: JSON.stringify(hidden) });
        migrateWeekendsHiddenDefault(() => storage);
        expect(JSON.parse(storage.items.get(CALENDAR_SETTINGS_STORAGE_KEY)!)).toEqual(hidden);

        const empty = memoryStorage();
        migrateWeekendsHiddenDefault(() => empty);
        expect(empty.items.has(CALENDAR_SETTINGS_STORAGE_KEY)).toBe(false);
        expect(empty.items.get(WEEKENDS_HIDDEN_DEFAULT_MIGRATION_KEY)).toBe('1');
    });

    it('survives a corrupted value and a blocked storage', () => {
        const storage = memoryStorage({ [CALENDAR_SETTINGS_STORAGE_KEY]: '{not json' });
        expect(() => migrateWeekendsHiddenDefault(() => storage)).not.toThrow();
        expect(storage.items.get(CALENDAR_SETTINGS_STORAGE_KEY)).toBe('{not json');

        expect(() =>
            migrateWeekendsHiddenDefault(() => {
                throw new DOMException('blocked', 'SecurityError');
            })
        ).not.toThrow();
    });
});
