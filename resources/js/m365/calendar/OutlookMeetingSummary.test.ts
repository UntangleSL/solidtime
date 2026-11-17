import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import OutlookMeetingSummary from './OutlookMeetingSummary.vue';
import type { OutlookCalendarLabels, OutlookMeeting } from '@/m365/types';

const labels = {
    no_subject: '(No subject)',
    eyebrow: 'Outlook meeting',
    eyebrow_dismissed: 'Outlook meeting · Dismissed',
    organized_by: 'Organized by :name',
    you_organize: 'You are the organizer',
    online: 'Online meeting',
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

function mountSummary(
    m: OutlookMeeting,
    testidPrefix: 'outlook-detail' | 'outlook-hover' = 'outlook-hover',
    slots: Record<string, string> = {}
) {
    // A wrapping element so the multi-root summary can be queried as one tree
    const Host = defineComponent({
        setup: () => () =>
            h('div', { 'data-testid': 'root' }, [
                h(
                    OutlookMeetingSummary,
                    { meeting: m, labels, testidPrefix, subjectId: 'subject-1' },
                    slots.meta
                        ? { meta: () => h('p', { 'data-testid': 'slot-meta' }, slots.meta) }
                        : {}
                ),
            ]),
    });
    wrapper = mount(Host);
    return wrapper;
}

function byId(id: string): HTMLElement | null {
    const root = wrapper?.element as HTMLElement | undefined;
    return root?.querySelector<HTMLElement>(`[data-testid="${id}"]`) ?? null;
}

afterEach(() => {
    vi.mocked(window.getTimezoneSetting).mockReturnValue('UTC');
    wrapper?.unmount();
    wrapper = null;
});

describe('OutlookMeetingSummary', () => {
    it.each(['outlook-detail', 'outlook-hover'] as const)(
        'renders the rows with the %s test id prefix',
        (prefix) => {
            mountSummary(meeting({ is_online_meeting: true }), prefix);

            expect(byId(`${prefix}-subject`)?.textContent?.trim()).toBe('Weekly sync');
            expect(byId(`${prefix}-subject`)?.id).toBe('subject-1');
            expect(byId(`${prefix}-time`)?.textContent).toMatch(/^Tue, Oct 27 · 09:00 – 10:00 · /);
            expect(byId(`${prefix}-organizer`)?.textContent).toBe('Organized by Ada Lovelace');
            expect(byId(`${prefix}-online`)?.textContent).toBe('Online meeting');
            const other = prefix === 'outlook-detail' ? 'outlook-hover' : 'outlook-detail';
            expect(wrapper?.element.querySelector(`[data-testid^="${other}-"]`)).toBeNull();
        }
    );

    it('shows the eyebrow, or the dismissed eyebrow', () => {
        mountSummary(meeting());
        expect(wrapper?.text()).toContain('Outlook meeting');
        expect(wrapper?.text()).not.toContain('Dismissed');
        wrapper?.unmount();

        mountSummary(meeting({ dismissed: true }));
        expect(wrapper?.text()).toContain('Outlook meeting · Dismissed');
    });

    it('falls back to the no-subject label', () => {
        mountSummary(meeting({ subject: '  ' }));
        expect(byId('outlook-hover-subject')?.textContent?.trim()).toBe('(No subject)');
    });

    it('shows "You are the organizer", "Organized by :name", or no organizer row', () => {
        mountSummary(meeting({ is_organizer: true }));
        expect(byId('outlook-hover-organizer')?.textContent).toBe('You are the organizer');
        wrapper?.unmount();

        mountSummary(meeting({ organizer_name: 'Grace Hopper' }));
        expect(byId('outlook-hover-organizer')?.textContent).toBe('Organized by Grace Hopper');
        wrapper?.unmount();

        mountSummary(meeting({ organizer_name: '   ' }));
        expect(byId('outlook-hover-organizer')).toBeNull();
        wrapper?.unmount();

        mountSummary(meeting({ organizer_name: null }));
        expect(byId('outlook-hover-organizer')).toBeNull();
    });

    it('shows the online row only for online meetings', () => {
        mountSummary(meeting({ is_online_meeting: false }));
        expect(byId('outlook-hover-online')).toBeNull();
        wrapper?.unmount();

        mountSummary(meeting({ is_online_meeting: true }));
        expect(byId('outlook-hover-online')).not.toBeNull();
    });

    it('shows both dates for a meeting across midnight', () => {
        vi.mocked(window.getTimezoneSetting).mockReturnValue('Europe/Madrid');
        mountSummary(meeting({ start: '2026-10-27T22:00:00Z', end: '2026-10-28T00:30:00Z' }));

        const text = byId('outlook-hover-time')?.textContent ?? '';
        expect(text).toMatch(/^Tue, Oct 27 23:00 – Wed, Oct 28 01:30 · .+/);
    });

    it('renders the subject and organizer as literal text', () => {
        mountSummary(
            meeting({ subject: '<img src=x onerror=alert(1)>', organizer_name: '<b>Eve</b>' })
        );

        expect(wrapper?.element.querySelector('img')).toBeNull();
        expect(wrapper?.element.querySelector('b')).toBeNull();
        expect(byId('outlook-hover-subject')?.textContent).toContain(
            '<img src=x onerror=alert(1)>'
        );
        expect(byId('outlook-hover-organizer')?.textContent).toBe('Organized by <b>Eve</b>');
    });

    it('renders the meta slot after the rows', () => {
        mountSummary(meeting({ is_online_meeting: true }), 'outlook-hover', {
            meta: 'meta',
        });

        const html = wrapper?.html() ?? '';
        expect(byId('slot-meta')).not.toBeNull();
        expect(html.indexOf('data-testid="slot-meta"')).toBeGreaterThan(
            html.indexOf('data-testid="outlook-hover-online"')
        );
    });

    it('emits the mounted subject element', () => {
        const w = mount(OutlookMeetingSummary, {
            props: { meeting: meeting(), labels, testidPrefix: 'outlook-detail', subjectId: 's-2' },
        });
        const emitted = w.emitted('subject-mounted');
        expect(emitted).toHaveLength(1);
        expect((emitted?.[0]?.[0] as HTMLElement).id).toBe('s-2');
        w.unmount();
    });
});
