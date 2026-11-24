import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import OutlookMovedMeeting from './OutlookMovedMeeting.vue';
import type { OutlookCalendarLabels, OutlookMeeting } from '@/m365/types';

const labels = {
    moved_eyebrow: 'Moved in Outlook · Already logged',
    moved_body:
        'You logged it on :when. Create a new entry for this session, or move that one here.',
    moved_hover_note: 'Moved in Outlook. You logged it on :date.',
    move_entry_here: 'Move my entry here',
} as OutlookCalendarLabels;

function meeting(overrides: Partial<OutlookMeeting> = {}): OutlookMeeting {
    return {
        id: 'm-1',
        subject: 'Weekly sync',
        start: '2026-11-26T15:00:00Z',
        end: '2026-11-26T16:00:00Z',
        organizer_name: 'Ada Lovelace',
        is_organizer: false,
        is_online_meeting: false,
        web_link: null,
        dismissed: false,
        moved_from: {
            time_entry_id: 'te-1',
            entry_start: '2026-11-24T10:00:00Z',
            entry_end: '2026-11-24T11:00:00Z',
        },
        ...overrides,
    };
}

let wrapper: VueWrapper | null = null;

function mountMoved(
    m: OutlookMeeting,
    variant: 'block' | 'note',
    extra: { pending?: boolean; disabled?: boolean; timeFormat?: '12-hours' | '24-hours' } = {}
) {
    const { timeFormat, ...props } = extra;
    wrapper = mount(OutlookMovedMeeting, {
        attachTo: document.body,
        props: { meeting: m, labels, variant, ...props },
        global: timeFormat
            ? { provide: { organization: computed(() => ({ time_format: timeFormat })) } }
            : {},
    });
    return wrapper;
}

function byTestId(id: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

afterEach(() => {
    vi.mocked(window.getTimezoneSetting).mockReturnValue('UTC');
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
});

describe('OutlookMovedMeeting block', () => {
    it('renders the eyebrow, the body with the logged range and the move button', () => {
        mountMoved(meeting(), 'block');

        const block = byTestId('outlook-moved-block');
        expect(block).not.toBeNull();
        expect(block!.className).toContain('mt-4');
        expect(block!.className).toContain('space-y-2');

        const eyebrow = byTestId('outlook-moved-eyebrow');
        expect(eyebrow?.textContent?.trim()).toBe('Moved in Outlook · Already logged');
        expect(eyebrow?.querySelector('svg.lucide-calendar-clock')).not.toBeNull();
        expect(eyebrow?.className).toContain('text-xs');
        expect(eyebrow?.className).toContain('text-text-tertiary');

        const body = byTestId('outlook-moved-body');
        expect(body?.textContent?.trim()).toBe(
            'You logged it on Tue, Nov 24 · 10:00 – 11:00. Create a new entry for this session, or move that one here.'
        );
        expect(body?.className).toContain('tabular-nums');
        expect(body?.className).toContain('text-text-secondary');

        const button = byTestId('outlook-detail-move-entry') as HTMLButtonElement;
        expect(button.tagName).toBe('BUTTON');
        expect(button.getAttribute('type')).toBe('button');
        expect(button.textContent?.trim()).toBe('Move my entry here');
        expect(button.querySelector('svg.lucide-move-right')).not.toBeNull();
        expect(button.disabled).toBe(false);
        // Neutral outline sm, never accent (creating a new entry stays the default)
        expect(button.className).toContain('h-8');
        expect(button.className).toContain('border');
        expect(button.className).not.toMatch(/\baccent-/);
        expect(button.className).not.toContain('bg-button-primary-background');
    });

    it('the button is described by the body', () => {
        mountMoved(meeting(), 'block');

        const button = byTestId('outlook-detail-move-entry')!;
        const body = byTestId('outlook-moved-body')!;
        expect(body.id).toBeTruthy();
        expect(button.getAttribute('aria-describedby')).toBe(body.id);
    });

    it('shows the range in the user time zone and the organization time format', () => {
        vi.mocked(window.getTimezoneSetting).mockReturnValue('Europe/Madrid');
        mountMoved(meeting(), 'block', { timeFormat: '12-hours' });

        expect(byTestId('outlook-moved-body')?.textContent).toContain(
            'You logged it on Tue, Nov 24 · 11:00 AM – 12:00 PM.'
        );
    });

    it('clicking the button emits move once', () => {
        const w = mountMoved(meeting(), 'block');

        byTestId('outlook-detail-move-entry')!.click();

        expect(w.emitted('move')).toHaveLength(1);
    });

    it('while pending the button shows its spinner, is disabled and emits nothing', () => {
        const w = mountMoved(meeting(), 'block', { pending: true });

        const button = byTestId('outlook-detail-move-entry') as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        expect(button.getAttribute('aria-busy')).toBe('true');
        expect(button.querySelector('svg.animate-spin')).not.toBeNull();
        expect(button.querySelector('svg.lucide-move-right')).toBeNull();
        expect(button.textContent?.trim()).toBe('Move my entry here');
        button.click();
        expect(w.emitted('move')).toBeUndefined();
    });

    it('disabled (another action runs) emits nothing and shows no spinner', () => {
        const w = mountMoved(meeting(), 'block', { disabled: true });

        const button = byTestId('outlook-detail-move-entry') as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        expect(button.querySelector('svg.animate-spin')).toBeNull();
        button.click();
        expect(w.emitted('move')).toBeUndefined();
    });

    it('renders nothing without moved_from', () => {
        mountMoved(meeting({ moved_from: null }), 'block');

        expect(byTestId('outlook-moved-block')).toBeNull();
        expect(byTestId('outlook-detail-move-entry')).toBeNull();
    });

    it('renders meeting values as literal text', () => {
        mountMoved(meeting(), 'block');

        expect(byTestId('outlook-moved-block')!.querySelector('script, img')).toBeNull();
    });
});

describe('OutlookMovedMeeting note', () => {
    it('renders one line with the logged date', () => {
        mountMoved(meeting(), 'note');

        const note = byTestId('outlook-hover-moved-note');
        expect(note?.tagName).toBe('P');
        expect(note?.textContent?.trim()).toBe('Moved in Outlook. You logged it on Tue, Nov 24.');
        expect(note?.querySelector('svg.lucide-calendar-clock')).not.toBeNull();
        expect(note?.className).toContain('mt-2');
        expect(note?.className).toContain('text-xs');
        expect(note?.className).toContain('text-text-tertiary');
        expect(byTestId('outlook-moved-block')).toBeNull();
        expect(byTestId('outlook-detail-move-entry')).toBeNull();
    });

    it('names the local date of the logged entry', () => {
        vi.mocked(window.getTimezoneSetting).mockReturnValue('Pacific/Auckland');
        mountMoved(
            meeting({
                moved_from: {
                    time_entry_id: 'te-1',
                    entry_start: '2026-11-24T12:00:00Z',
                    entry_end: '2026-11-24T13:00:00Z',
                },
            }),
            'note'
        );

        expect(byTestId('outlook-hover-moved-note')?.textContent).toContain('Wed, Nov 25');
    });

    it('renders nothing without moved_from', () => {
        mountMoved(meeting({ moved_from: undefined }), 'note');

        expect(byTestId('outlook-hover-moved-note')).toBeNull();
    });
});
