import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, nextTick, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import CalendarSettingsPopover from '@/packages/ui/src/FullCalendar/CalendarSettingsPopover.vue';
import CalendarToolbar from '@/packages/ui/src/FullCalendar/CalendarToolbar.vue';
import type { CalendarSettings } from '@/packages/ui/src/FullCalendar/calendarSettings';
import type { OutlookCalendarLabels } from '@/m365/types';
import OutlookDismissedSetting from './OutlookDismissedSetting.vue';
import { OUTLOOK_MEETINGS_KEY, type OutlookMeetingsContext } from './useOutlookMeetings';

const labels = {
    settings_heading: 'Outlook meetings',
    show_dismissed: 'Show dismissed meetings',
    show_dismissed_help: 'Dismissed meetings appear faded so you can restore them.',
} as OutlookCalendarLabels;

// The shared Separator (reka) is decorative: role none with a horizontal data-orientation
const SEPARATOR = '[role="dialog"] [data-orientation="horizontal"]';

const settings: CalendarSettings = { snapMinutes: 15, startHour: 0, endHour: 24, slotMinutes: 15 };

function makeContext(initial = false): OutlookMeetingsContext {
    return {
        labels: ref(labels),
        includeDismissed: ref(initial),
    } as unknown as OutlookMeetingsContext;
}

function mountSetting(context: OutlookMeetingsContext | null): VueWrapper {
    return mount(OutlookDismissedSetting, {
        global: { provide: context ? { [OUTLOOK_MEETINGS_KEY as symbol]: context } : {} },
    });
}

function dialogText(): string {
    return document.body.querySelector('[role="dialog"]')?.textContent ?? '';
}

async function settle(): Promise<void> {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await nextTick();
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('OutlookDismissedSetting', () => {
    it('renders the heading, a labelled switch and the helper text, off by default', () => {
        const wrapper = mountSetting(makeContext());

        expect(wrapper.text()).toContain('Outlook meetings');
        expect(wrapper.text()).toContain(
            'Dismissed meetings appear faded so you can restore them.'
        );
        const toggle = wrapper.get('[role="switch"]');
        expect(toggle.attributes('aria-checked')).toBe('false');
        // for/id association: the label names the switch
        const label = wrapper.get('label');
        expect(label.text()).toBe('Show dismissed meetings');
        expect(label.attributes('for')).toBe(toggle.attributes('id'));
    });

    it('turning it on flips the composable flag', async () => {
        const context = makeContext();
        const wrapper = mountSetting(context);

        await wrapper.get('[role="switch"]').trigger('click');

        expect(context.includeDismissed.value).toBe(true);
        expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('true');
        wrapper.unmount();
    });

    it('reflects a remembered on state', () => {
        const wrapper = mountSetting(makeContext(true));

        expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('true');
    });

    it('renders nothing without the Outlook context', () => {
        const wrapper = mountSetting(null);

        expect(wrapper.find('[role="switch"]').exists()).toBe(false);
        expect(wrapper.text()).toBe('');
    });
});

describe('settings popover is unchanged without fork content', () => {
    let wrapper: VueWrapper | null = null;

    afterEach(() => {
        wrapper?.unmount();
        wrapper = null;
    });

    async function openPopover(popover: VueWrapper): Promise<void> {
        await popover.get('button[aria-label="Calendar settings"]').trigger('click');
        await settle();
    }

    it('renders no Separator and no Outlook section without the slot', async () => {
        wrapper = mount(CalendarSettingsPopover, {
            attachTo: document.body,
            props: { settings },
        });
        await openPopover(wrapper);

        expect(dialogText()).toContain('Calendar Settings');
        expect(document.body.querySelector(SEPARATOR)).toBeNull();
        expect(dialogText()).not.toContain('Outlook meetings');
    });

    it('renders a Separator followed by the slot content when filled', async () => {
        wrapper = mount(CalendarSettingsPopover, {
            attachTo: document.body,
            props: { settings },
            slots: {
                'settings-extra': () => h('div', { 'data-testid': 'extra' }, 'Extra content'),
            },
        });
        await openPopover(wrapper);

        const dialog = document.body.querySelector('[role="dialog"]')!;
        const extra = dialog.querySelector('[data-testid="extra"]')!;
        const separator = extra.previousElementSibling!;
        expect(extra).not.toBeNull();
        expect(separator.matches('[data-orientation="horizontal"]')).toBe(true);
        expect(extra.parentElement).toBe(dialog);
    });

    it('the toolbar forwards settings-extra into the popover and renders none without it', async () => {
        const toolbarProps = {
            rangeLabel: 'Nov 2',
            activeView: 'timeGridWeek',
            settings,
        };

        wrapper = mount(CalendarToolbar, {
            attachTo: document.body,
            props: toolbarProps,
            slots: { 'settings-extra': () => h('div', { 'data-testid': 'extra' }, 'Forwarded') },
        });
        await openPopover(wrapper);
        expect(document.body.querySelector('[data-testid="extra"]')?.textContent).toBe('Forwarded');
        wrapper.unmount();
        document.body.innerHTML = '';

        wrapper = mount(CalendarToolbar, { attachTo: document.body, props: toolbarProps });
        await openPopover(wrapper);
        expect(document.body.querySelector('[data-testid="extra"]')).toBeNull();
        expect(document.body.querySelector(SEPARATOR)).toBeNull();
    });
});
