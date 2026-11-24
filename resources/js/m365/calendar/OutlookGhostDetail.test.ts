import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import OutlookGhostDetail from './OutlookGhostDetail.vue';
import OutlookMeetingSummary from './OutlookMeetingSummary.vue';
import { safeHttpsUrl } from './safeUrl';
import type { OutlookAssignment, OutlookCalendarLabels, OutlookMeeting } from '@/m365/types';

const labels = {
    no_subject: '(No subject)',
    eyebrow: 'Outlook meeting',
    eyebrow_dismissed: 'Outlook meeting · Dismissed',
    organized_by: 'Organized by :name',
    you_organize: 'You are the organizer',
    online: 'Online meeting',
    open_in_outlook: 'Open in Outlook',
    opens_new_tab: '(opens in a new tab)',
    dismiss: 'Dismiss',
    restore: 'Restore',
    create_entry: 'Create time entry',
    edit: 'Edit',
    confirm: 'Confirm',
    confirm_failed: 'Could not confirm this meeting',
    preassigned_eyebrow: 'Pre-assigned · Same series',
    why_series: 'You logged this series to :project on :date.',
    tags_one: '1 Tag',
    tags_many: ':count Tags',
    billable: 'Billable',
    non_billable: 'Non-Billable',
    more_actions: 'More actions',
    ignore_series: 'Always ignore this series',
    unignore_series: 'Stop ignoring this series',
    forget_series: 'Forget this series',
    // Phase 6 (D-03)
    moved_eyebrow: 'Moved in Outlook · Already logged',
    moved_body:
        'You logged it on :when. Create a new entry for this session, or move that one here.',
    move_entry_here: 'Move my entry here',
} as OutlookCalendarLabels;

// The form talks to the Outlook context and the query caches; here only its events matter.
const FormStub = defineComponent({
    name: 'OutlookConvertForm',
    emits: ['done', 'cancel', 'busy'],
    setup(_props, { emit }) {
        return () =>
            h('div', { 'data-testid': 'outlook-convert-form' }, [
                h('button', { 'data-testid': 'stub-busy', onClick: () => emit('busy', true) }),
                h('button', { 'data-testid': 'stub-idle', onClick: () => emit('busy', false) }),
                h('button', {
                    'data-testid': 'stub-done',
                    onClick: () =>
                        emit('done', [
                            {
                                meeting_id: 'm-1',
                                status: 'created',
                                time_entry_id: 'te-1',
                                error: null,
                            },
                        ]),
                }),
                h('button', { 'data-testid': 'stub-cancel', onClick: () => emit('cancel') }),
            ]);
    },
});

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

const assignment: OutlookAssignment = {
    project_id: 'p-1',
    project_name: 'Acme Website',
    project_color: '#ef5350',
    client_name: 'Acme',
    task_id: null,
    task_name: null,
    tags: [],
    billable: true,
    converted_at: '2026-11-10T09:00:00Z',
};

function preassigned(overrides: Partial<OutlookMeeting> = {}): OutlookMeeting {
    return meeting({ series_key: 'series-1', assignment, ...overrides });
}

let wrapper: VueWrapper | null = null;

// The panel is portaled to document.body, so it is mounted open and queried from the body.
function mountOpen(
    m: OutlookMeeting,
    canAct = true,
    slots: Record<string, string> = {},
    mode: 'detail' | 'form' = 'detail',
    extra: { confirming?: boolean; confirmError?: string | null; moving?: boolean } = {}
) {
    wrapper = mount(OutlookGhostDetail, {
        attachTo: document.body,
        props: { meeting: m, labels, canAct, open: true, mode, ...extra },
        slots: { default: '<div class="trigger">ghost</div>', ...slots },
        global: { stubs: { OutlookConvertForm: FormStub } },
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

    it('renders its rows through OutlookMeetingSummary', async () => {
        const w = mountOpen(meeting({ is_online_meeting: true }));
        await nextTick();

        const summary = w.findComponent(OutlookMeetingSummary);
        expect(summary.exists()).toBe(true);
        expect(summary.props('testidPrefix')).toBe('outlook-detail');
        // The Phase 3 ids stay the panel's contract, the hover-card ids never appear here
        for (const id of [
            'outlook-detail-time',
            'outlook-detail-organizer',
            'outlook-detail-online',
        ]) {
            expect(panel().querySelector(`[data-testid="${id}"]`)).not.toBeNull();
        }
        expect(panel().querySelector('[data-testid^="outlook-hover-"]')).toBeNull();
        // The dialog stays labelled by the summary's subject heading
        const subject = panel().querySelector('[data-testid="outlook-detail-subject"]');
        expect(subject?.id).toBeTruthy();
        expect(panel().getAttribute('aria-labelledby')).toBe(subject?.id);
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
            expect(panel().textContent?.trim().endsWith('Create time entry')).toBe(true);
        });
    });

    describe('Create time entry (Phase 4)', () => {
        function createButton(): HTMLElement | null {
            return document.body.querySelector<HTMLElement>(
                '[data-testid="outlook-detail-create"]'
            );
        }

        function pointerDownOn(target: Element) {
            target.dispatchEvent(
                new PointerEvent('pointerdown', {
                    bubbles: true,
                    cancelable: true,
                    button: 0,
                    pointerType: 'mouse',
                })
            );
        }

        async function settle() {
            await nextTick();
            await new Promise((resolve) => setTimeout(resolve, 20));
            await nextTick();
        }

        it('renders the primary action after Dismiss and emits create', async () => {
            const w = mountOpen(meeting());
            await nextTick();

            const button = createButton();
            expect(button?.textContent?.trim()).toBe('Create time entry');
            expect(button?.querySelector('svg.lucide-clock-plus')).not.toBeNull();
            const html = panel().innerHTML;
            expect(html.indexOf('outlook-detail-create')).toBeGreaterThan(
                html.indexOf('outlook-detail-action')
            );
            button!.click();

            expect(w.emitted('create')).toHaveLength(1);
            expect(w.emitted('dismiss')).toBeUndefined();
        });

        it('is offered for a dismissed meeting too', async () => {
            mountOpen(meeting({ dismissed: true }));
            await nextTick();

            expect(createButton()).not.toBeNull();
        });

        it('is hidden, not disabled, when it cannot act', async () => {
            mountOpen(meeting(), false);
            await nextTick();

            expect(createButton()).toBeNull();
        });

        it('form mode widens the same popover to w-96 and renders the form instead of the details', async () => {
            mountOpen(meeting(), true, {}, 'form');
            await nextTick();

            expect(panel().className).toContain('w-96');
            expect(panel().className).not.toContain('w-80');
            expect(panel().getAttribute('data-mode')).toBe('form');
            expect(panel().querySelector('[data-testid="outlook-convert-form"]')).not.toBeNull();
            expect(panel().querySelector('[data-testid="outlook-detail-subject"]')).toBeNull();
            expect(createButton()).toBeNull();
        });

        it('detail mode is w-96 as well, so switching to the form never resizes the panel', async () => {
            mountOpen(meeting());
            await nextTick();

            expect(panel().className).toContain('w-96');
            expect(panel().className).not.toContain('w-80');
            expect(panel().getAttribute('data-mode')).toBe('detail');
        });

        it('never shows the form when it cannot act', async () => {
            mountOpen(meeting(), false, {}, 'form');
            await nextTick();

            expect(panel().querySelector('[data-testid="outlook-convert-form"]')).toBeNull();
        });

        it('relays converted and cancel-form from the form', async () => {
            const w = mountOpen(meeting(), true, {}, 'form');
            await nextTick();

            document.body.querySelector<HTMLElement>('[data-testid="stub-done"]')!.click();
            document.body.querySelector<HTMLElement>('[data-testid="stub-cancel"]')!.click();

            expect(w.emitted('converted')).toEqual([
                [[{ meeting_id: 'm-1', status: 'created', time_entry_id: 'te-1', error: null }]],
            ]);
            expect(w.emitted('cancel-form')).toHaveLength(1);
        });

        it('an outside pointer closes the form, except while it is busy', async () => {
            const outside = document.createElement('div');
            document.body.appendChild(outside);
            const w = mountOpen(meeting(), true, {}, 'form');
            await settle();

            document.body.querySelector<HTMLElement>('[data-testid="stub-busy"]')!.click();
            await nextTick();
            pointerDownOn(outside);
            await settle();
            expect(w.emitted('update:open')).toBeUndefined();

            document.body.querySelector<HTMLElement>('[data-testid="stub-idle"]')!.click();
            await nextTick();
            pointerDownOn(outside);
            await settle();
            expect(w.emitted('update:open')).toEqual([[false]]);
        });

        it('ignores Escape while busy', async () => {
            const w = mountOpen(meeting(), true, {}, 'form');
            await settle();

            document.body.querySelector<HTMLElement>('[data-testid="stub-busy"]')!.click();
            await nextTick();
            document.body.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
            );
            await settle();

            expect(w.emitted('update:open')).toBeUndefined();
        });

        it('a pointer inside a nested picker layer never closes the form', async () => {
            const layer = document.createElement('div');
            layer.setAttribute('data-reka-popper-content-wrapper', '');
            const option = document.createElement('div');
            option.setAttribute('role', 'option');
            layer.appendChild(option);
            document.body.appendChild(layer);
            const w = mountOpen(meeting(), true, {}, 'form');
            await settle();

            pointerDownOn(option);
            await settle();

            expect(w.emitted('update:open')).toBeUndefined();
        });
    });

    describe('pre-assigned meeting (Phase 5)', () => {
        function byTestId(id: string): HTMLElement | null {
            return document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        }

        async function settle() {
            await nextTick();
            await new Promise((resolve) => setTimeout(resolve, 20));
            await nextTick();
        }

        it('shows the full pre-assignment with the why line after the summary', async () => {
            mountOpen(preassigned());
            await nextTick();

            const block = byTestId('outlook-detail-preassignment');
            expect(block).not.toBeNull();
            expect(block!.textContent).toContain('Pre-assigned · Same series');
            expect(block!.textContent).toContain('Acme Website');
            expect(block!.textContent).toContain('Acme');
            expect(block!.textContent).toContain('Billable');
            expect(byTestId('outlook-detail-why')?.textContent?.trim()).toBe(
                'You logged this series to Acme Website on Tue, Nov 10.'
            );
            const html = panel().innerHTML;
            expect(html.indexOf('outlook-detail-preassignment')).toBeGreaterThan(
                html.indexOf('outlook-detail-time')
            );
        });

        it('offers Edit and Confirm instead of Dismiss and Create time entry', async () => {
            mountOpen(preassigned());
            await nextTick();

            const edit = byTestId('outlook-detail-edit');
            const confirm = byTestId('outlook-detail-confirm');
            expect(edit?.textContent?.trim()).toBe('Edit');
            expect(edit?.querySelector('svg.lucide-pencil')).not.toBeNull();
            expect(confirm?.textContent?.trim()).toBe('Confirm');
            expect(confirm?.querySelector('svg.lucide-check')).not.toBeNull();
            const html = panel().innerHTML;
            expect(html.indexOf('outlook-detail-confirm')).toBeGreaterThan(
                html.indexOf('outlook-detail-edit')
            );
            expect(byTestId('outlook-detail-create')).toBeNull();
            expect(byTestId('outlook-detail-action')).toBeNull();
        });

        it('Confirm emits confirm once; Edit emits create', async () => {
            const w = mountOpen(preassigned());
            await nextTick();

            byTestId('outlook-detail-confirm')!.click();
            expect(w.emitted('confirm')).toHaveLength(1);
            expect(w.emitted('create')).toBeUndefined();

            byTestId('outlook-detail-edit')!.click();
            expect(w.emitted('create')).toHaveLength(1);
            expect(w.emitted('confirm')).toHaveLength(1);
        });

        it('while confirming the button shows its spinner and emits nothing more', async () => {
            const w = mountOpen(preassigned(), true, {}, 'detail', { confirming: true });
            await nextTick();

            const confirm = byTestId('outlook-detail-confirm') as HTMLButtonElement;
            expect(confirm.disabled).toBe(true);
            expect(confirm.querySelector('svg.animate-spin')).not.toBeNull();
            confirm.click();
            expect(w.emitted('confirm')).toBeUndefined();
        });

        it('while confirming neither Escape nor an outside pointer closes the panel', async () => {
            const outside = document.createElement('div');
            document.body.appendChild(outside);
            const w = mountOpen(preassigned(), true, {}, 'detail', { confirming: true });
            await settle();

            document.body.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
            );
            outside.dispatchEvent(
                new PointerEvent('pointerdown', {
                    bubbles: true,
                    cancelable: true,
                    button: 0,
                    pointerType: 'mouse',
                })
            );
            await settle();

            expect(w.emitted('update:open')).toBeUndefined();
        });

        it('shows the confirm failure inline as an alert under the footer', async () => {
            mountOpen(preassigned(), true, {}, 'detail', {
                confirmError: 'This project is archived.',
            });
            await nextTick();

            const alert = panel().querySelector<HTMLElement>('[role="alert"]');
            expect(alert?.textContent?.trim()).toBe('This project is archived.');
            expect(alert?.className).toContain('text-destructive');
            expect(alert?.querySelector('svg.lucide-circle-x')).not.toBeNull();
            const html = panel().innerHTML;
            expect(html.indexOf('role="alert"')).toBeGreaterThan(
                html.indexOf('outlook-detail-confirm')
            );
        });

        it('renders no alert without a failure', async () => {
            mountOpen(preassigned());
            await nextTick();

            expect(panel().querySelector('[role="alert"]')).toBeNull();
        });

        it('without canAct shows no pre-assignment and no Edit or Confirm', async () => {
            mountOpen(preassigned(), false);
            await nextTick();

            expect(byTestId('outlook-detail-preassignment')).toBeNull();
            expect(byTestId('outlook-detail-edit')).toBeNull();
            expect(byTestId('outlook-detail-confirm')).toBeNull();
        });

        it('a dismissed occurrence is not pre-assigned: no pre-assignment, no Confirm', async () => {
            mountOpen(preassigned({ dismissed: true }));
            await nextTick();

            expect(byTestId('outlook-detail-preassignment')).toBeNull();
            expect(byTestId('outlook-detail-confirm')).toBeNull();
            expect(byTestId('outlook-detail-create')).not.toBeNull();
        });
    });

    describe('footer variants and More actions (Phase 5)', () => {
        function byTestId(id: string): HTMLElement | null {
            return document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        }

        async function settle() {
            await nextTick();
            await new Promise((resolve) => setTimeout(resolve, 20));
            await nextTick();
        }

        // Found through its test hook, like the browser tests do: the hook must render inside the
        // open menu (the shared DropdownMenuContent drops attributes passed to it).
        async function openMenu() {
            byTestId('outlook-detail-more')!.click();
            await settle();
            const hook = byTestId('outlook-detail-more-menu');
            expect(hook).not.toBeNull();
            const menu = hook!.closest<HTMLElement>('[role="menu"]');
            expect(menu).not.toBeNull();
            expect(document.body.querySelectorAll('[role="menu"]')).toHaveLength(1);
            return menu!;
        }

        function itemIds(menu: HTMLElement): string[] {
            return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
                (item) => item.getAttribute('data-testid') ?? ''
            );
        }

        const recurring = (overrides: Partial<OutlookMeeting> = {}) =>
            meeting({ series_key: 'series-1', ...overrides });

        it('a pre-assigned meeting focuses Confirm on open', async () => {
            mountOpen(preassigned());
            await settle();

            expect(document.activeElement).toBe(byTestId('outlook-detail-confirm'));
        });

        it('other meetings keep the default focus (not Confirm)', async () => {
            mountOpen(recurring());
            await settle();

            expect(byTestId('outlook-detail-confirm')).toBeNull();
            expect(document.activeElement).not.toBe(document.body);
        });

        it('pre-assigned: More actions on the left, Edit and Confirm pushed right', async () => {
            mountOpen(preassigned());
            await nextTick();

            const more = byTestId('outlook-detail-more')!;
            expect(more.getAttribute('aria-label')).toBe('More actions');
            expect(more.querySelector('svg.lucide-ellipsis')).not.toBeNull();
            const html = panel().innerHTML;
            expect(html.indexOf('outlook-detail-more')).toBeLessThan(
                html.indexOf('outlook-detail-edit')
            );
            expect(byTestId('outlook-detail-edit')!.parentElement!.className).toContain('ml-auto');
            expect(byTestId('outlook-detail-action')).toBeNull();
        });

        it('pre-assigned menu: Dismiss, Always ignore, Forget (like the right-click menu)', async () => {
            mountOpen(preassigned());
            await settle();

            const menu = await openMenu();
            expect(itemIds(menu)).toEqual([
                'outlook-more-dismiss',
                'outlook-more-ignore-series',
                'outlook-more-forget-series',
            ]);
            expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(0);
            expect(menu.textContent).toContain('Dismiss');
            expect(menu.textContent).toContain('Always ignore this series');
            expect(menu.textContent).toContain('Forget this series');
            expect(
                menu.querySelector('[data-testid="outlook-more-dismiss"] svg.lucide-eye-off')
            ).not.toBeNull();
            expect(
                menu.querySelector(
                    '[data-testid="outlook-more-ignore-series"] svg.lucide-calendar-off'
                )
            ).not.toBeNull();
            expect(
                menu.querySelector('[data-testid="outlook-more-forget-series"] svg.lucide-unlink')
            ).not.toBeNull();
        });

        it('opening the menu does not close the panel', async () => {
            const w = mountOpen(preassigned());
            await settle();

            await openMenu();

            expect(w.emitted('update:open')).toBeUndefined();
            expect(
                document.body.querySelector('[data-testid="outlook-ghost-detail"]')
            ).not.toBeNull();
        });

        it.each([
            ['outlook-more-dismiss', 'dismiss'],
            ['outlook-more-ignore-series', 'ignore-series'],
            ['outlook-more-forget-series', 'forget-series'],
        ])('%s emits %s and does not close the panel itself', async (testId, event) => {
            const w = mountOpen(preassigned());
            await settle();
            await openMenu();

            byTestId(testId)!.click();
            await settle();

            expect(w.emitted(event)).toHaveLength(1);
            expect(w.emitted('update:open')).toBeUndefined();
        });

        it('recurring without assignment: More actions (Dismiss, Always ignore) and Create', async () => {
            const w = mountOpen(recurring());
            await settle();

            expect(byTestId('outlook-detail-action')).toBeNull();
            expect(byTestId('outlook-detail-create')).not.toBeNull();
            expect(byTestId('outlook-detail-confirm')).toBeNull();
            const html = panel().innerHTML;
            expect(html.indexOf('outlook-detail-more')).toBeLessThan(
                html.indexOf('outlook-detail-create')
            );

            const menu = await openMenu();
            expect(itemIds(menu)).toEqual(['outlook-more-dismiss', 'outlook-more-ignore-series']);
            expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(0);
            byTestId('outlook-more-ignore-series')!.click();
            await settle();
            expect(w.emitted('ignore-series')).toHaveLength(1);
        });

        it('an occurrence of an ignored series offers Stop ignoring instead of Always ignore', async () => {
            const w = mountOpen(recurring({ series_ignored: true, dismissed: true }));
            await settle();

            expect(byTestId('outlook-detail-action')).toBeNull();
            const menu = await openMenu();
            expect(itemIds(menu)).toEqual(['outlook-more-restore', 'outlook-more-unignore-series']);
            expect(menu.textContent).toContain('Stop ignoring this series');
            expect(
                menu.querySelector('[data-testid="outlook-more-unignore-series"] svg.lucide-undo-2')
            ).not.toBeNull();

            byTestId('outlook-more-unignore-series')!.click();
            await settle();
            expect(w.emitted('unignore-series')).toHaveLength(1);
        });

        it('a single meeting shows More actions with Dismiss only, and Create', async () => {
            mountOpen(meeting());
            await settle();

            expect(byTestId('outlook-detail-more')).not.toBeNull();
            expect(byTestId('outlook-detail-action')).toBeNull();
            expect(byTestId('outlook-detail-create')).not.toBeNull();
            const menu = await openMenu();
            expect(itemIds(menu)).toEqual(['outlook-more-dismiss']);
        });

        it('emits dismiss from the More actions menu, with no Dismiss button in the footer', async () => {
            const w = mountOpen(meeting());
            await settle();

            expect(document.body.querySelector('[data-testid="outlook-detail-action"]')).toBeNull();
            const menu = await openMenu();
            expect(menu.textContent).toContain('Dismiss');
            byTestId('outlook-more-dismiss')!.click();
            await settle();

            expect(w.emitted('dismiss')).toHaveLength(1);
            expect(w.emitted('restore')).toBeUndefined();
        });

        it('shows the dismissed eyebrow and emits restore for a dismissed meeting', async () => {
            const w = mountOpen(meeting({ dismissed: true }));
            await settle();

            expect(panel().textContent).toContain('Outlook meeting · Dismissed');
            const menu = await openMenu();
            expect(itemIds(menu)).toEqual(['outlook-more-restore']);
            byTestId('outlook-more-restore')!.click();
            await settle();

            expect(w.emitted('restore')).toHaveLength(1);
            expect(w.emitted('dismiss')).toBeUndefined();
        });

        it('without canAct there is no More actions', async () => {
            mountOpen(preassigned(), false);
            await nextTick();

            expect(byTestId('outlook-detail-more')).toBeNull();
        });
    });

    describe('moved meeting (Phase 6, D-03)', () => {
        const movedFrom = {
            time_entry_id: 'te-1',
            entry_start: '2026-11-24T10:00:00Z',
            entry_end: '2026-11-24T11:00:00Z',
        };

        function moved(overrides: Partial<OutlookMeeting> = {}): OutlookMeeting {
            return meeting({ moved_from: movedFrom, ...overrides });
        }

        function byTestId(id: string): HTMLElement | null {
            return document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        }

        async function settle() {
            await nextTick();
            await new Promise((resolve) => setTimeout(resolve, 20));
            await nextTick();
        }

        it('renders the moved block after the summary and link, before the footer', async () => {
            mountOpen(moved({ web_link: 'https://outlook.office.com/calendar/item/1' }));
            await nextTick();

            expect(byTestId('outlook-moved-block')).not.toBeNull();
            expect(byTestId('outlook-moved-eyebrow')?.textContent?.trim()).toBe(
                'Moved in Outlook · Already logged'
            );
            expect(byTestId('outlook-moved-body')?.textContent?.trim()).toBe(
                'You logged it on Tue, Nov 24 · 10:00 – 11:00. Create a new entry for this session, or move that one here.'
            );
            expect(byTestId('outlook-detail-move-entry')?.textContent?.trim()).toBe(
                'Move my entry here'
            );
            const html = panel().innerHTML;
            expect(html.indexOf('outlook-moved-block')).toBeGreaterThan(
                html.indexOf('outlook-detail-link')
            );
            expect(html.indexOf('outlook-moved-block')).toBeLessThan(
                html.indexOf('outlook-detail-create')
            );
        });

        it('a pre-assigned moved meeting shows the block after the pre-assignment', async () => {
            mountOpen(moved({ series_key: 'series-1', assignment }));
            await nextTick();

            const html = panel().innerHTML;
            expect(html.indexOf('outlook-moved-block')).toBeGreaterThan(
                html.indexOf('outlook-detail-preassignment')
            );
            expect(html.indexOf('outlook-moved-block')).toBeLessThan(
                html.indexOf('outlook-detail-confirm')
            );
            // The footer keeps Edit and Confirm
            expect(byTestId('outlook-detail-edit')).not.toBeNull();
            expect(byTestId('outlook-detail-confirm')).not.toBeNull();
        });

        it('the block sits before the separator', async () => {
            mountOpen(moved());
            await nextTick();

            const block = byTestId('outlook-moved-block')!;
            const separator = panel().querySelector('[data-orientation="horizontal"]');
            expect(separator).not.toBeNull();
            expect(
                block.compareDocumentPosition(separator!) & Node.DOCUMENT_POSITION_FOLLOWING
            ).toBeTruthy();
        });

        it('keeps the footer: More actions and Create time entry, which stays the default', async () => {
            mountOpen(moved());
            await settle();

            expect(byTestId('outlook-detail-more')).not.toBeNull();
            const create = byTestId('outlook-detail-create') as HTMLButtonElement;
            expect(create).not.toBeNull();
            expect(create.disabled).toBe(false);
            // No Dismiss button in the footer: Dismiss / Restore stay in More actions
            expect(byTestId('outlook-detail-dismiss')).toBeNull();
            // The move button lives in the body, not in the footer row
            expect(create.parentElement?.contains(byTestId('outlook-detail-move-entry'))).toBe(
                false
            );
            // Create time entry stays the default: focus lands on it, never on the move button
            expect(document.activeElement).toBe(create);
            expect(document.activeElement).not.toBe(byTestId('outlook-detail-move-entry'));
        });

        it('Move my entry here emits move-entry once and nothing else', async () => {
            const w = mountOpen(moved());
            await nextTick();

            byTestId('outlook-detail-move-entry')!.click();

            expect(w.emitted('move-entry')).toHaveLength(1);
            expect(w.emitted('create')).toBeUndefined();
            expect(w.emitted('confirm')).toBeUndefined();
        });

        it('while moving the button spins, Create and More actions are disabled', async () => {
            const w = mountOpen(moved(), true, {}, 'detail', { moving: true });
            await nextTick();

            const move = byTestId('outlook-detail-move-entry') as HTMLButtonElement;
            expect(move.disabled).toBe(true);
            expect(move.querySelector('svg.animate-spin')).not.toBeNull();
            const create = byTestId('outlook-detail-create') as HTMLButtonElement;
            expect(create.disabled).toBe(true);
            expect((byTestId('outlook-detail-more') as HTMLButtonElement).disabled).toBe(true);

            move.click();
            create.click();
            expect(w.emitted('move-entry')).toBeUndefined();
            expect(w.emitted('create')).toBeUndefined();
        });

        it('while moving a pre-assigned meeting Confirm and Edit are disabled', async () => {
            const w = mountOpen(moved({ series_key: 'series-1', assignment }), true, {}, 'detail', {
                moving: true,
            });
            await nextTick();

            const confirm = byTestId('outlook-detail-confirm') as HTMLButtonElement;
            expect(confirm.disabled).toBe(true);
            expect((byTestId('outlook-detail-edit') as HTMLButtonElement).disabled).toBe(true);
            confirm.click();
            expect(w.emitted('confirm')).toBeUndefined();
        });

        it('while confirming the move button is disabled', async () => {
            const w = mountOpen(moved({ series_key: 'series-1', assignment }), true, {}, 'detail', {
                confirming: true,
            });
            await nextTick();

            const move = byTestId('outlook-detail-move-entry') as HTMLButtonElement;
            expect(move.disabled).toBe(true);
            expect(move.querySelector('svg.animate-spin')).toBeNull();
            move.click();
            expect(w.emitted('move-entry')).toBeUndefined();
        });

        it('while moving neither Escape nor an outside pointer closes the panel', async () => {
            const outside = document.createElement('div');
            document.body.appendChild(outside);
            const w = mountOpen(moved(), true, {}, 'detail', { moving: true });
            await settle();

            document.body.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
            );
            outside.dispatchEvent(
                new PointerEvent('pointerdown', {
                    bubbles: true,
                    cancelable: true,
                    button: 0,
                    pointerType: 'mouse',
                })
            );
            await settle();

            expect(w.emitted('update:open')).toBeUndefined();
        });

        it('a move failure shows in the existing alert line', async () => {
            mountOpen(moved(), true, {}, 'detail', {
                confirmError: 'Could not move the time entry',
            });
            await nextTick();

            const alert = byTestId('outlook-detail-alert');
            expect(alert?.getAttribute('role')).toBe('alert');
            expect(alert?.textContent?.trim()).toBe('Could not move the time entry');
        });

        it('without canAct there is no moved block and no move button', async () => {
            mountOpen(moved(), false);
            await nextTick();

            expect(byTestId('outlook-moved-block')).toBeNull();
            expect(byTestId('outlook-detail-move-entry')).toBeNull();
        });

        it('in form mode the moved block is not shown', async () => {
            mountOpen(moved(), true, {}, 'form');
            await nextTick();

            expect(byTestId('outlook-convert-form')).not.toBeNull();
            expect(byTestId('outlook-moved-block')).toBeNull();
        });

        it('a meeting without moved_from renders exactly what it rendered before', async () => {
            mountOpen(meeting({ moved_from: null }));
            await nextTick();
            const withNull = panel().innerHTML;
            wrapper?.unmount();
            document.body.innerHTML = '';

            mountOpen(meeting());
            await nextTick();
            const without = panel().innerHTML;

            expect(byTestId('outlook-moved-block')).toBeNull();
            expect(byTestId('outlook-detail-move-entry')).toBeNull();
            // Only generated ids may differ between two mounts
            const strip = (html: string) => html.replace(/(id|aria-[a-z]+)="[^"]*"/g, '');
            expect(strip(withNull)).toBe(strip(without));
        });
    });
});
