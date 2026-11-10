import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import OutlookGhostDetail from './OutlookGhostDetail.vue';
import type { OutlookCalendarLabels, OutlookMeeting } from '@/m365/types';

const labels = {
    no_subject: '(No subject)',
    eyebrow: 'Outlook meeting',
    eyebrow_dismissed: 'Outlook meeting · Dismissed',
    dismiss: 'Dismiss meeting',
    restore: 'Restore meeting',
} as OutlookCalendarLabels;

function meeting(overrides: Partial<OutlookMeeting> = {}): OutlookMeeting {
    return {
        id: 'm-1',
        subject: 'Weekly sync',
        start: '2026-10-27T09:00:00Z',
        end: '2026-10-27T10:00:00Z',
        organizer_name: 'Ada Lovelace',
        is_organizer: false,
        is_online_meeting: false,
        web_link: null,
        dismissed: false,
        ...overrides,
    };
}

let wrapper: VueWrapper | null = null;

// The panel is portaled to document.body, so it is mounted open and queried from the body.
function mountOpen(m: OutlookMeeting, canAct = true) {
    wrapper = mount(OutlookGhostDetail, {
        attachTo: document.body,
        props: { meeting: m, labels, canAct, open: true },
        slots: { default: '<div class="trigger">ghost</div>' },
    });
    return wrapper;
}

function panel(): HTMLElement {
    const el = document.body.querySelector<HTMLElement>('[data-testid="outlook-ghost-detail"]');
    expect(el).not.toBeNull();
    return el as HTMLElement;
}

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
});

describe('OutlookGhostDetail', () => {
    it('renders the eyebrow, the subject and the time row', async () => {
        mountOpen(meeting());
        await nextTick();

        const text = panel().textContent ?? '';
        expect(text).toContain('Outlook meeting');
        expect(text).not.toContain('Dismissed');
        expect(text).toContain('Weekly sync');
        expect(text).toContain('Oct 27');
        expect(text).toContain('–');
    });

    it('falls back to the no-subject label', async () => {
        mountOpen(meeting({ subject: '   ' }));
        await nextTick();

        expect(panel().textContent).toContain('(No subject)');
    });

    it('labels the panel with the subject element', async () => {
        mountOpen(meeting());
        await nextTick();

        const labelledBy = panel().getAttribute('aria-labelledby');
        expect(labelledBy).toBeTruthy();
        expect(document.getElementById(labelledBy as string)?.textContent?.trim()).toBe(
            'Weekly sync'
        );
    });

    it('emits dismiss from the Dismiss meeting button', async () => {
        const w = mountOpen(meeting());
        await nextTick();

        const button = document.body.querySelector<HTMLElement>(
            '[data-testid="outlook-detail-action"]'
        );
        expect(button?.textContent?.trim()).toBe('Dismiss meeting');
        button?.click();

        expect(w.emitted('dismiss')).toHaveLength(1);
        expect(w.emitted('restore')).toBeUndefined();
    });

    it('shows the dismissed eyebrow and emits restore for a dismissed meeting', async () => {
        const w = mountOpen(meeting({ dismissed: true }));
        await nextTick();

        expect(panel().textContent).toContain('Outlook meeting · Dismissed');
        const button = document.body.querySelector<HTMLElement>(
            '[data-testid="outlook-detail-action"]'
        );
        expect(button?.textContent?.trim()).toBe('Restore meeting');
        button?.click();

        expect(w.emitted('restore')).toHaveLength(1);
        expect(w.emitted('dismiss')).toBeUndefined();
    });

    it('renders no action button when it cannot act', async () => {
        mountOpen(meeting(), false);
        await nextTick();

        expect(document.body.querySelector('[data-testid="outlook-detail-action"]')).toBeNull();
    });
});
