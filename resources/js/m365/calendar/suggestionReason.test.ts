import { describe, expect, it } from 'vitest';
import { AtSign, Clock, Repeat, TextSearch, User, Users } from '@lucide/vue';
import type { OutlookCalendarLabels } from '../types';
import { reasonIcon, reasonLabel } from './suggestionReason';

const labels = {
    reason_series: 'Same series',
    reason_last_used: 'Last used',
    reason_domain_one: 'Like 1 meeting with @:domain',
    reason_domain_many: 'Like :count meetings with @:domain',
    reason_person_one: 'Like 1 meeting with :name',
    reason_person_many: 'Like :count meetings with :name',
    reason_organizer_one: 'Like 1 meeting organized by :name',
    reason_organizer_many: 'Like :count meetings organized by :name',
    reason_subject_one: 'Like 1 meeting with a similar subject',
    reason_subject_many: 'Like :count meetings with a similar subject',
    reason_batch: 'Suggested for :count of :total meetings',
} as OutlookCalendarLabels;

describe('reasonLabel', () => {
    it('names the series and the last used project', () => {
        expect(reasonLabel({ kind: 'series' }, labels)).toBe('Same series');
        expect(reasonLabel({ kind: 'last_used' }, labels)).toBe('Last used');
    });

    it('uses the singular and plural domain copy with the @ from the copy', () => {
        expect(reasonLabel({ kind: 'domain', count: 1, value: 'client.com' }, labels)).toBe(
            'Like 1 meeting with @client.com'
        );
        expect(reasonLabel({ kind: 'domain', count: 4, value: 'client.com' }, labels)).toBe(
            'Like 4 meetings with @client.com'
        );
    });

    it('names the person and the organizer', () => {
        expect(reasonLabel({ kind: 'person', count: 4, value: 'Ana López' }, labels)).toBe(
            'Like 4 meetings with Ana López'
        );
        expect(reasonLabel({ kind: 'person', count: 1, value: 'Ana López' }, labels)).toBe(
            'Like 1 meeting with Ana López'
        );
        expect(reasonLabel({ kind: 'organizer', count: 2, value: 'Ana López' }, labels)).toBe(
            'Like 2 meetings organized by Ana López'
        );
        expect(reasonLabel({ kind: 'organizer', count: 1, value: 'Ana López' }, labels)).toBe(
            'Like 1 meeting organized by Ana López'
        );
    });

    it('describes a similar subject without a value', () => {
        expect(reasonLabel({ kind: 'subject', count: 3, value: null }, labels)).toBe(
            'Like 3 meetings with a similar subject'
        );
        expect(reasonLabel({ kind: 'subject', count: 1, value: null }, labels)).toBe(
            'Like 1 meeting with a similar subject'
        );
    });

    it('counts the meetings of a batch suggestion', () => {
        expect(reasonLabel({ kind: 'batch', count: 2, total: 3 }, labels)).toBe(
            'Suggested for 2 of 3 meetings'
        );
    });

    it('inserts placeholder-like and HTML-like values as plain text', () => {
        expect(reasonLabel({ kind: 'person', count: 2, value: ':count <b>x</b>' }, labels)).toBe(
            'Like 2 meetings with :count <b>x</b>'
        );
        expect(
            reasonLabel({ kind: 'domain', count: 2, value: '<img src=x onerror=alert(1)>' }, labels)
        ).toBe('Like 2 meetings with @<img src=x onerror=alert(1)>');
    });
});

describe('reasonIcon', () => {
    it('maps every reason kind to its icon', () => {
        expect(reasonIcon('series')).toBe(Repeat);
        expect(reasonIcon('domain')).toBe(AtSign);
        expect(reasonIcon('person')).toBe(Users);
        expect(reasonIcon('organizer')).toBe(User);
        expect(reasonIcon('subject')).toBe(TextSearch);
        expect(reasonIcon('last_used')).toBe(Clock);
        expect(reasonIcon('batch')).toBe(Users);
    });
});
