import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import CalendarSettingsPopover from './CalendarSettingsPopover.vue';
import type { CalendarSettings } from './calendarSettings';

const settings: CalendarSettings = { snapMinutes: 5, startHour: 7, endHour: 20, slotMinutes: 30 };

async function settle(): Promise<void> {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await nextTick();
}

function dialog(): HTMLElement {
    const element = document.body.querySelector<HTMLElement>('[role="dialog"]');
    if (!element) throw new Error('settings popover is not open');
    return element;
}

function weekendSwitch(): HTMLElement {
    const element = dialog().querySelector<HTMLElement>('[data-testid="calendar-weekends-switch"]');
    if (!element) throw new Error('weekend switch not rendered');
    return element;
}

describe('CalendarSettingsPopover weekend switch', () => {
    let wrapper: VueWrapper | null = null;

    afterEach(() => {
        wrapper?.unmount();
        wrapper = null;
        document.body.innerHTML = '';
    });

    async function open(props: { settings: CalendarSettings }): Promise<VueWrapper> {
        wrapper = mount(CalendarSettingsPopover, { attachTo: document.body, props });
        await wrapper.get('button[aria-label="Calendar settings"]').trigger('click');
        await settle();
        return wrapper;
    }

    it('shows the weekend switch first, on by default', async () => {
        await open({ settings });

        const fields = dialog().querySelectorAll('[data-slot="field"]');
        expect(fields.length).toBe(5);
        expect(fields[0]!.textContent).toContain('Show weekends');
        expect(fields[1]!.textContent).toContain('Snap Interval');

        const toggle = weekendSwitch();
        expect(toggle.id).toBe('calendar-weekends');
        expect(toggle.getAttribute('role')).toBe('switch');
        expect(toggle.getAttribute('aria-checked')).toBe('true');
        expect(dialog().querySelector('label[for="calendar-weekends"]')?.textContent?.trim()).toBe(
            'Show weekends'
        );
    });

    it('reflects a stored false as an unchecked switch', async () => {
        await open({ settings: { ...settings, showWeekends: false } });

        expect(weekendSwitch().getAttribute('aria-checked')).toBe('false');
    });

    it('emits showWeekends false and keeps the other fields', async () => {
        const popover = await open({ settings });

        weekendSwitch().click();
        await settle();

        const events = popover.emitted('update:settings');
        expect(events).toHaveLength(1);
        expect(events![0]![0]).toEqual({ ...settings, showWeekends: false });
    });

    it('emits showWeekends true when turned back on', async () => {
        const popover = await open({ settings: { ...settings, showWeekends: false } });

        weekendSwitch().click();
        await settle();

        expect(popover.emitted('update:settings')![0]![0]).toEqual({
            ...settings,
            showWeekends: true,
        });
    });

    it('shows the helper text', async () => {
        await open({ settings });

        const helper = dialog().querySelector('[data-slot="field-description"]');
        expect(helper?.textContent?.trim()).toBe('Applies to the week view.');
    });

    it('renders no Separator without fork content', async () => {
        await open({ settings });

        expect(dialog().querySelector('[data-orientation="horizontal"]')).toBeNull();
    });
});
