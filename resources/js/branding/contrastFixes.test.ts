import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import TimeTrackerStartStop from '@/packages/ui/src/TimeTrackerStartStop.vue';
import ClientDropdownItem from '@/packages/ui/src/Client/ClientDropdownItem.vue';
import EstimatedTimeProgress from '@/packages/ui/src/EstimatedTimeProgress.vue';
import exportDataSource from '@/Pages/Teams/Partials/ExportData.vue?raw';
import goalProgressBarSource from '@/Components/Common/Goal/GoalProgressBar.vue?raw';
import estimatedTimeProgressSource from '@/packages/ui/src/EstimatedTimeProgress.vue?raw';

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

describe('light-safe accent steps', () => {
    it('renders the selected client check with a light-safe accent step', () => {
        const wrapper = mount(ClientDropdownItem, { props: { name: 'Acme', selected: true } });
        const classes = wrapper.get('svg').classes();
        expect(classes).toContain('text-accent-500');
        expect(classes).toContain('dark:text-accent-200');
        expect(classes).not.toContain('text-accent-200');
    });

    it('keeps the unselected client check on the card border colour', () => {
        const wrapper = mount(ClientDropdownItem, { props: { name: 'Acme', selected: false } });
        const classes = wrapper.get('svg').classes();
        expect(classes).toContain('text-card-border');
        expect(classes).not.toContain('text-accent-500');
    });

    it('uses a light-safe link colour for the export download link', () => {
        expect(exportDataSource).toContain(
            'text-accent-500 hover:text-accent-600 dark:text-accent-200 dark:hover:text-accent-300'
        );
        expect(exportDataSource).not.toContain('font-semibold text-accent-200 hover');
    });

    it('fills an in-progress goal with a light-safe accent step', () => {
        expect(goalProgressBarSource).toContain("return 'bg-accent-400 dark:bg-accent-200';");
        expect(goalProgressBarSource).not.toContain("return 'bg-accent-200';");
    });

    it('fills the estimate progress with a light-safe accent step when under the estimate', () => {
        expect(estimatedTimeProgressSource).toContain(
            "'bg-accent-400 dark:bg-accent-200': !isOverEstimate"
        );
        const wrapper = mount(EstimatedTimeProgress, { props: { estimated: 7200, current: 3600 } });
        const fill = wrapper.get('.h-full').classes();
        expect(fill).toContain('bg-accent-400');
        expect(fill).toContain('dark:bg-accent-200');
        expect(fill).not.toContain('bg-red-500');
    });

    it('keeps the estimate progress red when over the estimate', () => {
        const wrapper = mount(EstimatedTimeProgress, { props: { estimated: 3600, current: 7200 } });
        const fill = wrapper.get('.h-full').classes();
        expect(fill).toContain('bg-red-500');
        expect(fill).not.toContain('bg-accent-400');
    });
});
