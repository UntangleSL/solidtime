// Why a project is prefilled, as one short line under the project field (D-07, RULE-05: the user
// sees why). The copy stays server-side (microsoft365.calendar.reason_*); names and domains come
// from the user's own meeting history and are filled in as plain text with fillLabel (never HTML).
import { AtSign, Clock, Repeat, TextSearch, User, Users } from '@lucide/vue';
import type { OutlookCalendarLabels, OutlookSuggestionReason } from '../types';
import { fillLabel } from './labels';

export type PrefillReason =
    | { kind: 'series' }
    | { kind: 'last_used' }
    | { kind: 'batch'; count: number; total: number }
    | OutlookSuggestionReason;

export type PrefillReasonKind = PrefillReason['kind'];

function countLabel(count: number, one: string, many: string): string {
    return count === 1 ? one : many;
}

export function reasonLabel(reason: PrefillReason, labels: OutlookCalendarLabels): string {
    switch (reason.kind) {
        case 'series':
            return labels.reason_series;
        case 'last_used':
            return labels.reason_last_used;
        case 'batch':
            return fillLabel(labels.reason_batch, {
                count: String(reason.count),
                total: String(reason.total),
            });
        case 'domain':
            return fillLabel(
                countLabel(reason.count, labels.reason_domain_one, labels.reason_domain_many),
                { count: String(reason.count), domain: reason.value ?? '' }
            );
        case 'person':
            return fillLabel(
                countLabel(reason.count, labels.reason_person_one, labels.reason_person_many),
                { count: String(reason.count), name: reason.value ?? '' }
            );
        case 'organizer':
            return fillLabel(
                countLabel(reason.count, labels.reason_organizer_one, labels.reason_organizer_many),
                { count: String(reason.count), name: reason.value ?? '' }
            );
        case 'subject':
            return fillLabel(
                countLabel(reason.count, labels.reason_subject_one, labels.reason_subject_many),
                { count: String(reason.count) }
            );
    }
}

const ICONS = {
    series: Repeat,
    domain: AtSign,
    person: Users,
    organizer: User,
    subject: TextSearch,
    last_used: Clock,
    batch: Users,
} as const;

export function reasonIcon(kind: PrefillReasonKind): (typeof ICONS)[PrefillReasonKind] {
    return ICONS[kind];
}
