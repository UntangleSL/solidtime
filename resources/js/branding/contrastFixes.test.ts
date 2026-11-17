import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import TimeTrackerStartStop from '@/packages/ui/src/TimeTrackerStartStop.vue';

const SOLID_FILL = 'bg-[color:var(--theme-color-accent-solid)]';
const SOLID_HOVER = 'hover:bg-[color:var(--theme-color-accent-solid-hover)]';
const SOLID_FOCUS = 'focus:bg-[color:var(--theme-color-accent-solid-hover)]';
const ON_ACCENT_TEXT = 'text-[color:var(--color-on-accent)]';

function timerClasses(variant: 'primary' | 'break', active: boolean): string[] {
    const wrapper = mount(TimeTrackerStartStop, {
        props: { variant, active, size: 'base' },
    });
    return wrapper.get('[data-testid="timer_button"]').classes();
}

function expectSolidAccentInactive(classes: string[]) {
    expect(classes).toContain(SOLID_FILL);
    expect(classes).toContain(SOLID_HOVER);
    expect(classes).toContain(SOLID_FOCUS);
    expect(classes).toContain(ON_ACCENT_TEXT);
    expect(classes).not.toContain('text-white');
    expect(classes).not.toContain('bg-accent-300/70');
    expect(classes).not.toContain('focus:bg-accent-700');
}

describe('TimeTrackerStartStop contrast classes', () => {
    it('draws the stopped primary timer with the solid accent fill and on-accent icon', () => {
        expectSolidAccentInactive(timerClasses('primary', false));
    });

    it('draws the stopped break timer with the solid accent fill and on-accent icon', () => {
        expectSolidAccentInactive(timerClasses('break', false));
    });

    it('keeps the running primary timer red with a white icon', () => {
        const classes = timerClasses('primary', true);
        expect(classes).toContain('bg-red-400/80');
        expect(classes).toContain('text-white');
        expect(classes).not.toContain(SOLID_FILL);
        expect(classes).not.toContain(ON_ACCENT_TEXT);
    });

    it('draws the active break timer amber with a dark #1C1C1C icon', () => {
        const classes = timerClasses('break', true);
        expect(classes).toContain('bg-amber-500/80');
        expect(classes).toContain('text-[#1C1C1C]');
        expect(classes).not.toContain('text-white');
        expect(classes).not.toContain(SOLID_FILL);
    });

    it('keeps exactly one text colour on every timer state', () => {
        const textColour = /^text-(white|\[#1C1C1C\]|\[color:var\(--color-on-accent\)\])$/;
        for (const variant of ['primary', 'break'] as const) {
            for (const active of [true, false]) {
                const colours = timerClasses(variant, active).filter((c) => textColour.test(c));
                expect(colours, `${variant}/${String(active)}`).toHaveLength(1);
            }
        }
    });
});
