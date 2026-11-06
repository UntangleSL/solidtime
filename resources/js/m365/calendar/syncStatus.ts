import type { OutlookCalendarLabels, OutlookSyncResponse } from '@/m365/types';
import type { TimeFormat } from '@/packages/ui/src/utils/time';
import { formatTime, getLocalizedDayJs } from '@/packages/ui/src/utils/time';
import { fillLabel } from './labels';

export type SyncStatusKind = 'syncing' | 'synced' | 'empty' | 'unavailable' | 'no_mailbox' | 'none';

export interface SyncStatus {
    kind: SyncStatusKind;
    text: string;
    // Extra sentence for the tooltip (null when there is nothing to add to the text).
    tooltip: string | null;
    // True only for the amber "unavailable" state; every other state is quiet.
    warning: boolean;
}

export interface SyncStatusInput {
    isSyncing: boolean;
    lastSync: OutlookSyncResponse | null;
    readFailed: boolean;
    syncedAt: string | null;
    visibleCount: number;
    labels: OutlookCalendarLabels;
    timeFormat: TimeFormat;
    now: Date;
}

// Same day (user timezone) shows only the time, any other day the short date and the time.
function formatSyncedAt(syncedAt: string, timeFormat: TimeFormat, now: Date): string {
    const synced = getLocalizedDayJs(syncedAt);
    const time = formatTime(syncedAt, timeFormat);
    if (synced.isSame(getLocalizedDayJs(now.toISOString()), 'day')) return time;
    return `${synced.format('D MMM')} ${time}`;
}

// "Last synced 14:32" on its own, for the states that have no sync status line (reconnect).
export function describeLastSynced(
    syncedAt: string,
    labels: OutlookCalendarLabels,
    timeFormat: TimeFormat,
    now: Date
): string {
    return fillLabel(labels.last_synced, { time: formatSyncedAt(syncedAt, timeFormat, now) });
}

// Pure mapping from the sync state to the quiet status line. A failed read, a throttled or an
// unavailable answer (and the synthetic unavailable answer of a rejected request) is "unavailable";
// it is never a reconnect, which only the connection state decides.
export function describeSyncStatus(input: SyncStatusInput): SyncStatus {
    const { labels } = input;

    if (input.isSyncing) {
        return { kind: 'syncing', text: labels.syncing, tooltip: null, warning: false };
    }

    const status = input.lastSync?.status;
    if (input.readFailed || status === 'throttled' || status === 'unavailable') {
        return {
            kind: 'unavailable',
            text: labels.unavailable,
            tooltip: input.visibleCount > 0 ? labels.unavailable_cached_hint : null,
            warning: true,
        };
    }

    if (status === 'no_mailbox') {
        return { kind: 'no_mailbox', text: labels.no_mailbox, tooltip: null, warning: false };
    }

    if (input.syncedAt) {
        const synced = fillLabel(labels.last_synced, {
            time: formatSyncedAt(input.syncedAt, input.timeFormat, input.now),
        });
        if (input.visibleCount === 0) {
            return {
                kind: 'empty',
                text: `${labels.empty} · ${synced}`,
                tooltip: labels.empty_hint,
                warning: false,
            };
        }
        return { kind: 'synced', text: synced, tooltip: null, warning: false };
    }

    return { kind: 'none', text: '', tooltip: null, warning: false };
}
