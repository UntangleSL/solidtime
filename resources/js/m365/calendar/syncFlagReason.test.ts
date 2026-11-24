import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutlookCalendarLabels, OutlookOutOfSyncItem } from '@/m365/types';
import { flagDescribed, flagReason, flagTitle, formatRange, rangePair } from './syncFlagReason';

const labels = {
    osync_reason_moved: 'Meeting moved in Outlook: :from → :to',
    osync_reason_cancelled: 'Meeting cancelled in Outlook',
    osync_reason_removed: 'Meeting removed from Outlook',
    osync_described: 'Out of sync with Outlook. :reason.',
    osync_title_moved: 'Meeting moved in Outlook',
    osync_title_cancelled: 'Meeting cancelled in Outlook',
    osync_title_removed: 'Meeting removed from Outlook',
} as OutlookCalendarLabels;

function item(overrides: Partial<OutlookOutOfSyncItem> = {}): OutlookOutOfSyncItem {
    return {
        time_entry_id: 'te-1',
        kind: 'moved',
        meeting_start: '2026-11-24T10:00:00Z',
        meeting_end: '2026-11-24T11:00:00Z',
        new_start: '2026-11-25T12:00:00Z',
        new_end: '2026-11-25T13:00:00Z',
        all_day: false,
        entry_start: '2026-11-24T10:00:00Z',
        entry_end: '2026-11-24T11:00:00Z',
        description: 'Weekly sync',
        ...overrides,
    };
}

afterEach(() => {
    vi.mocked(window.getTimezoneSetting).mockReturnValue('UTC');
    vi.mocked(window.getWeekStartSetting).mockReturnValue('monday');
});

describe('formatRange', () => {
    it('uses the weekday only, or the full date with a middle dot', () => {
        expect(
            formatRange('2026-11-24T10:00:00Z', '2026-11-24T11:00:00Z', {
                full: false,
                timeFormat: '24-hours',
            })
        ).toBe('Tue 10:00 – 11:00');
        expect(
            formatRange('2026-11-24T10:00:00Z', '2026-11-24T11:00:00Z', {
                full: true,
                timeFormat: '24-hours',
            })
        ).toBe('Tue, Nov 24 · 10:00 – 11:00');
    });

    it('follows the organization time format', () => {
        expect(
            formatRange('2026-11-24T10:00:00Z', '2026-11-24T11:00:00Z', {
                full: true,
                timeFormat: '12-hours',
            })
        ).toBe('Tue, Nov 24 · 10:00 AM – 11:00 AM');
    });

    it('shows the user time zone, not UTC', () => {
        vi.mocked(window.getTimezoneSetting).mockReturnValue('Europe/Madrid');

        expect(
            formatRange('2026-11-24T23:30:00Z', '2026-11-24T23:45:00Z', {
                full: true,
                timeFormat: '24-hours',
            })
        ).toBe('Wed, Nov 25 · 00:30 – 00:45');
    });

    it('names both days when the range crosses midnight', () => {
        expect(
            formatRange('2026-11-24T23:00:00Z', '2026-11-25T01:00:00Z', {
                full: true,
                timeFormat: '24-hours',
            })
        ).toBe('Tue, Nov 24 · 23:00 – Wed, Nov 25 · 01:00');
    });

    it('shows only the start of a running entry', () => {
        expect(
            formatRange('2026-11-24T10:00:00Z', null, { full: true, timeFormat: '24-hours' })
        ).toBe('Tue, Nov 24 · 10:00');
    });

    it('shows the day of an all-day meeting without times', () => {
        expect(
            formatRange('2026-11-24T00:00:00Z', '2026-11-25T00:00:00Z', {
                full: true,
                timeFormat: '24-hours',
                allDay: true,
            })
        ).toBe('Tue, Nov 24');
        expect(
            formatRange('2026-11-24T00:00:00Z', '2026-11-26T00:00:00Z', {
                full: false,
                timeFormat: '24-hours',
                allDay: true,
            })
        ).toBe('Tue – Wed');
    });
});

describe('rangePair', () => {
    it('uses the weekday only when both starts fall in the same week', () => {
        expect(
            rangePair(
                { start: '2026-11-24T10:00:00Z', end: '2026-11-24T11:00:00Z' },
                { start: '2026-11-29T12:00:00Z', end: '2026-11-29T13:00:00Z' },
                '24-hours'
            )
        ).toEqual({ from: 'Tue 10:00 – 11:00', to: 'Sun 12:00 – 13:00' });
    });

    it('uses the full form across weeks, following the user week start', () => {
        vi.mocked(window.getWeekStartSetting).mockReturnValue('sunday');

        expect(
            rangePair(
                { start: '2026-11-24T10:00:00Z', end: '2026-11-24T11:00:00Z' },
                { start: '2026-11-29T12:00:00Z', end: '2026-11-29T13:00:00Z' },
                '24-hours'
            )
        ).toEqual({
            from: 'Tue, Nov 24 · 10:00 – 11:00',
            to: 'Sun, Nov 29 · 12:00 – 13:00',
        });
    });
});

describe('flagReason', () => {
    it('names both ranges of a meeting moved within the week', () => {
        expect(flagReason(item(), labels, '24-hours')).toBe(
            'Meeting moved in Outlook: Tue 10:00 – 11:00 → Wed 12:00 – 13:00'
        );
    });

    it('uses the full dates when the meeting moved to another week', () => {
        expect(
            flagReason(
                item({ new_start: '2026-12-01T10:00:00Z', new_end: '2026-12-01T11:00:00Z' }),
                labels,
                '24-hours'
            )
        ).toBe(
            'Meeting moved in Outlook: Tue, Nov 24 · 10:00 – 11:00 → Tue, Dec 1 · 10:00 – 11:00'
        );
    });

    it('follows the 12-hour format', () => {
        expect(flagReason(item(), labels, '12-hours')).toBe(
            'Meeting moved in Outlook: Tue 10:00 AM – 11:00 AM → Wed 12:00 PM – 01:00 PM'
        );
    });

    it('names a cancelled and a removed meeting', () => {
        expect(
            flagReason(
                item({ kind: 'cancelled', new_start: null, new_end: null }),
                labels,
                '24-hours'
            )
        ).toBe('Meeting cancelled in Outlook');
        expect(
            flagReason(
                item({ kind: 'removed', new_start: null, new_end: null }),
                labels,
                '24-hours'
            )
        ).toBe('Meeting removed from Outlook');
    });

    it('falls back to the title when a moved flag has no new times', () => {
        expect(flagReason(item({ new_start: null }), labels, '24-hours')).toBe(
            'Meeting moved in Outlook'
        );
    });
});

describe('flagTitle', () => {
    it('maps each kind to its title', () => {
        expect(flagTitle('moved', labels)).toBe('Meeting moved in Outlook');
        expect(flagTitle('cancelled', labels)).toBe('Meeting cancelled in Outlook');
        expect(flagTitle('removed', labels)).toBe('Meeting removed from Outlook');
    });
});

describe('flagDescribed', () => {
    it('wraps the reason in the out-of-sync sentence', () => {
        expect(flagDescribed(item({ kind: 'cancelled' }), labels, '24-hours')).toBe(
            'Out of sync with Outlook. Meeting cancelled in Outlook.'
        );
        expect(flagDescribed(item(), labels, '24-hours')).toBe(
            'Out of sync with Outlook. Meeting moved in Outlook: Tue 10:00 – 11:00 → Wed 12:00 – 13:00.'
        );
    });

    it('never doubles the period of a reason that ends with one', () => {
        const spanish = {
            ...labels,
            osync_reason_cancelled: 'Reunión cancelada en Outlook.',
            osync_described: 'Desincronizado con Outlook. :reason.',
        } as OutlookCalendarLabels;

        expect(flagDescribed(item({ kind: 'cancelled' }), spanish, '24-hours')).toBe(
            'Desincronizado con Outlook. Reunión cancelada en Outlook.'
        );
    });
});
