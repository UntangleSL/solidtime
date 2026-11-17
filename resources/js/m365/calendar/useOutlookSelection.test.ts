import { describe, expect, it } from 'vitest';
import type { OutlookMeeting } from '@/m365/types';
import { useOutlookSelection } from './useOutlookSelection';

function meeting(id: string, start: string): OutlookMeeting {
    return {
        id,
        subject: id,
        start,
        end: start,
        organizer_name: null,
        is_organizer: false,
        is_online_meeting: false,
        web_link: null,
        dismissed: false,
    };
}

// Two days of a week, deliberately out of order (the range follows start then id).
const candidates = [
    meeting('e', '2026-11-04T09:00:00Z'),
    meeting('a', '2026-11-03T08:00:00Z'),
    meeting('c', '2026-11-03T10:00:00Z'),
    meeting('b', '2026-11-03T10:00:00Z'),
    meeting('d', '2026-11-03T15:00:00Z'),
];

describe('useOutlookSelection', () => {
    it('toggle adds then removes an id and makes it the anchor', () => {
        const selection = useOutlookSelection();

        selection.toggle('a');
        expect(selection.selectedIds.value).toEqual(['a']);
        expect(selection.isSelected('a')).toBe(true);
        expect(selection.anchorId.value).toBe('a');

        selection.toggle('c');
        expect(selection.selectedIds.value).toEqual(['a', 'c']);
        expect(selection.anchorId.value).toBe('c');

        selection.toggle('a');
        expect(selection.selectedIds.value).toEqual(['c']);
        expect(selection.isSelected('a')).toBe(false);
        expect(selection.anchorId.value).toBe('a');
    });

    it('selectRange adds every meeting between the anchor and a later one, ordered by start then id', () => {
        const selection = useOutlookSelection();
        selection.toggle('a');

        selection.selectRange('d', candidates);

        expect(selection.selectedIds.value).toEqual(['a', 'b', 'c', 'd']);
        expect(selection.anchorId.value).toBe('a');
    });

    it('selectRange works towards an earlier meeting and across days', () => {
        const selection = useOutlookSelection();
        selection.toggle('e');

        selection.selectRange('c', candidates);

        // b and c share the start, so both are inside the inclusive span
        expect(selection.selectedIds.value).toEqual(['e', 'b', 'c', 'd']);
    });

    it('selectRange keeps ids that are already selected only once', () => {
        const selection = useOutlookSelection();
        selection.toggle('d');
        selection.toggle('a');

        selection.selectRange('d', candidates);

        expect(selection.selectedIds.value).toEqual(['d', 'a', 'b', 'c']);
    });

    it('selectRange without an anchor behaves like toggle', () => {
        const selection = useOutlookSelection();

        selection.selectRange('c', candidates);

        expect(selection.selectedIds.value).toEqual(['c']);
        expect(selection.anchorId.value).toBe('c');
    });

    it('selectRange toggles when the anchor is not among the candidates', () => {
        const selection = useOutlookSelection();
        selection.toggle('gone');

        selection.selectRange('c', candidates);

        expect(selection.selectedIds.value).toEqual(['gone', 'c']);
        expect(selection.anchorId.value).toBe('c');
    });

    it('remove drops ids and forgets a removed anchor', () => {
        const selection = useOutlookSelection();
        selection.toggle('a');
        selection.toggle('b');
        selection.toggle('c');

        selection.remove(['a', 'c', 'x']);

        expect(selection.selectedIds.value).toEqual(['b']);
        expect(selection.anchorId.value).toBeNull();
    });

    it('clear empties the selection and resets the anchor', () => {
        const selection = useOutlookSelection();
        selection.toggle('a');
        selection.toggle('b');

        selection.clear();

        expect(selection.selectedIds.value).toEqual([]);
        expect(selection.anchorId.value).toBeNull();
    });

    it('keeps instances independent', () => {
        const first = useOutlookSelection();
        const second = useOutlookSelection();

        first.toggle('a');

        expect(second.selectedIds.value).toEqual([]);
    });
});
