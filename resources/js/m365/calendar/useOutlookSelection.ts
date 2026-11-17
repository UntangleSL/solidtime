import { ref, type Ref } from 'vue';
import type { OutlookMeeting } from '@/m365/types';

// Multi-select of Outlook meetings (Phase 4, D-07, UI-SPEC section 5). Plain state, one instance per
// calendar page (created by useOutlookMeetings and shared through its context): the lane, the
// meeting menu and the floating selection bar all read and change this one selection.
export interface OutlookSelection {
    // Selected meeting ids in the order they were added.
    selectedIds: Readonly<Ref<string[]>>;
    // Start of a Shift range: the meeting toggled last.
    anchorId: Readonly<Ref<string | null>>;
    isSelected: (id: string) => boolean;
    toggle: (id: string) => void;
    // Adds every candidate whose start lies between the anchor's start and the start of `id`
    // (inclusive, ordered by start then id). Without an anchor it behaves like toggle.
    selectRange: (id: string, candidates: readonly OutlookMeeting[]) => void;
    remove: (ids: readonly string[]) => void;
    clear: () => void;
}

function byStartThenId(a: OutlookMeeting, b: OutlookMeeting): number {
    const diff = new Date(a.start).getTime() - new Date(b.start).getTime();
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function useOutlookSelection(): OutlookSelection {
    const selectedIds = ref<string[]>([]);
    const anchorId = ref<string | null>(null);

    function isSelected(id: string): boolean {
        return selectedIds.value.includes(id);
    }

    function toggle(id: string): void {
        selectedIds.value = isSelected(id)
            ? selectedIds.value.filter((item) => item !== id)
            : [...selectedIds.value, id];
        anchorId.value = id;
    }

    function selectRange(id: string, candidates: readonly OutlookMeeting[]): void {
        const sorted = [...candidates].sort(byStartThenId);
        const anchor = anchorId.value
            ? sorted.find((meeting) => meeting.id === anchorId.value)
            : undefined;
        const target = sorted.find((meeting) => meeting.id === id);
        if (!anchor || !target) {
            toggle(id);
            return;
        }

        const from = Math.min(new Date(anchor.start).getTime(), new Date(target.start).getTime());
        const to = Math.max(new Date(anchor.start).getTime(), new Date(target.start).getTime());
        const added = sorted
            .filter((meeting) => {
                const start = new Date(meeting.start).getTime();
                return start >= from && start <= to;
            })
            .map((meeting) => meeting.id)
            .filter((item) => !isSelected(item));
        if (added.length > 0) selectedIds.value = [...selectedIds.value, ...added];
    }

    function remove(ids: readonly string[]): void {
        if (ids.length === 0) return;
        const gone = new Set(ids);
        if (!selectedIds.value.some((item) => gone.has(item))) return;
        selectedIds.value = selectedIds.value.filter((item) => !gone.has(item));
        if (anchorId.value !== null && gone.has(anchorId.value)) anchorId.value = null;
    }

    function clear(): void {
        if (selectedIds.value.length > 0) selectedIds.value = [];
        anchorId.value = null;
    }

    return {
        selectedIds,
        anchorId,
        isSelected,
        toggle,
        selectRange,
        remove,
        clear,
    };
}
