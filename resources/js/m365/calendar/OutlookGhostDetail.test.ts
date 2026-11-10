import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import OutlookGhostDetail from './OutlookGhostDetail.vue';
import { safeHttpsUrl } from './safeUrl';
import type { OutlookCalendarLabels, OutlookMeeting } from '@/m365/types';

const labels = {
    no_subject: '(No subject)',
    eyebrow: 'Outlook meeting',
    eyebrow_dismissed: 'Outlook meeting · Dismissed',
    organized_by: 'Organized by :name',
    you_organize: 'You are the organizer',
    online: 'Online meeting',
    open_in_outlook: 'Open in Outlook',
    opens_new_tab: '(opens in a new tab)',
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
function mountOpen(m: OutlookMeeting, canAct = true, slots: Record<string, string> = {}) {
    wrapper = mount(OutlookGhostDetail, {
        attachTo: document.body,
        props: { meeting: m, labels, canAct, open: true },
        slots: { default: '<div class="trigger">ghost</div>', ...slots },
    });
    return wrapper;
}

function panel(): HTMLElement {
    const el = document.body.querySelector<HTMLElement>('[data-testid="outlook-ghost-detail"]');
    expect(el).not.toBeNull();
    return el as HTMLElement;
}

afterEach(() => {
    vi.mocked(window.getTimezoneSetting).mockReturnValue('UTC');
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
    describe('time row', () => {
        it('shows the date, the 24-hour range and the duration in the user timezone', async () => {
            vi.mocked(window.getTimezoneSetting).mockReturnValue('Europe/Madrid');
            mountOpen(meeting());
            await nextTick();

            const text = document.body.querySelector(
                '[data-testid="outlook-detail-time"]'
            )?.textContent;
            expect(text).toMatch(/^Tue, Oct 27 · 10:00 – 11:00 · .+/);
        });

        it('shows both dates for a meeting across midnight', async () => {
            vi.mocked(window.getTimezoneSetting).mockReturnValue('Europe/Madrid');
            mountOpen(meeting({ start: '2026-10-26T21:00:00Z', end: '2026-10-27T00:00:00Z' }));
            await nextTick();

            const text = document.body.querySelector(
                '[data-testid="outlook-detail-time"]'
            )?.textContent;
            expect(text).toMatch(/^Mon, Oct 26 22:00 – Tue, Oct 27 01:00 · .+/);
        });
    });

    describe('organizer and online rows', () => {
        it('says you are the organizer', async () => {
            mountOpen(meeting({ is_organizer: true }));
            await nextTick();

            expect(panel().textContent).toContain('You are the organizer');
            expect(panel().textContent).not.toContain('Organized by');
        });

        it('names another organizer', async () => {
            mountOpen(meeting({ organizer_name: 'Test User B' }));
            await nextTick();

            expect(panel().textContent).toContain('Organized by Test User B');
        });

        it('has no organizer row without a name', async () => {
            mountOpen(meeting({ organizer_name: null }));
            await nextTick();

            expect(
                document.body.querySelector('[data-testid="outlook-detail-organizer"]')
            ).toBeNull();
        });

        it('shows the online row only for an online meeting and never a location', async () => {
            mountOpen(meeting({ is_online_meeting: true }));
            await nextTick();

            expect(panel().textContent).toContain('Online meeting');
            expect(panel().textContent?.toLowerCase()).not.toContain('location');

            wrapper?.unmount();
            document.body.innerHTML = '';
            mountOpen(meeting({ is_online_meeting: false }));
            await nextTick();

            expect(panel().textContent).not.toContain('Online meeting');
        });
    });

    describe('Open in Outlook link', () => {
        it('renders a hardened anchor for an https link', async () => {
            mountOpen(meeting({ web_link: 'https://outlook.example.test/x' }));
            await nextTick();

            const anchor = panel().querySelector('a');
            expect(anchor?.getAttribute('href')).toBe('https://outlook.example.test/x');
            expect(anchor?.getAttribute('target')).toBe('_blank');
            expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
            expect(anchor?.textContent).toContain('Open in Outlook');
            expect(anchor?.querySelector('.sr-only')?.textContent).toBe('(opens in a new tab)');
        });

        it.each([
            ['a javascript: link', 'javascript:alert(1)'],
            ['an http: link', 'http://outlook.example.test/x'],
            ['a malformed link', 'not a url'],
            ['no link', null],
        ])('renders no anchor for %s', async (_name, link) => {
            mountOpen(meeting({ web_link: link }));
            await nextTick();

            expect(panel().querySelector('a')).toBeNull();
        });

        it('safeHttpsUrl only lets https URLs through', () => {
            expect(safeHttpsUrl('https://a.example.test/x?y=1')).toBe(
                'https://a.example.test/x?y=1'
            );
            expect(safeHttpsUrl('javascript:alert(1)')).toBeNull();
            expect(safeHttpsUrl('data:text/html,<b>x</b>')).toBeNull();
            expect(safeHttpsUrl('http://a.example.test')).toBeNull();
            expect(safeHttpsUrl('//a.example.test')).toBeNull();
            expect(safeHttpsUrl('')).toBeNull();
            expect(safeHttpsUrl(null)).toBeNull();
        });
    });

    it('renders the subject and organizer as literal text', async () => {
        mountOpen(
            meeting({
                subject: '<img src=x onerror=alert(1)>',
                organizer_name: '<b>Eve</b>',
            })
        );
        await nextTick();

        expect(panel().querySelector('img')).toBeNull();
        expect(panel().querySelector('b')).toBeNull();
        expect(panel().textContent).toContain('<img src=x onerror=alert(1)>');
        expect(panel().textContent).toContain('Organized by <b>Eve</b>');
    });

    describe('extension slots', () => {
        it('renders meta, actions and footer-note content in their positions', async () => {
            mountOpen(meeting({ is_online_meeting: true }), true, {
                meta: '<p data-testid="slot-meta">meta</p>',
                actions: '<button data-testid="slot-actions">act</button>',
                'footer-note': '<span data-testid="slot-note">note</span>',
            });
            await nextTick();

            const html = panel().innerHTML;
            const at = (id: string) => html.indexOf('data-testid="' + id + '"');
            expect(at('slot-meta')).toBeGreaterThan(at('outlook-detail-online'));
            expect(at('slot-actions')).toBeGreaterThan(at('outlook-detail-action'));
            expect(at('slot-note')).toBeGreaterThan(at('slot-actions'));
        });

        it('renders nothing for empty slots', async () => {
            mountOpen(meeting());
            await nextTick();

            expect(panel().querySelector('[data-testid^="slot-"]')).toBeNull();
            expect(panel().textContent?.trim().endsWith('Dismiss meeting')).toBe(true);
        });
    });
});
