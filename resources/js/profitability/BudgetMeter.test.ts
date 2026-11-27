import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import BudgetMeter from './BudgetMeter.vue';

const H = 3600;

const labels = {
    status: { on_track: 'On track', over: 'Over budget', closed: 'Closed' },
    summary: {
        meter_valuetext: ':consumed of :sold consumed, projected :projected, :status',
        meter_sold_tick: 'Sold :h',
    },
};

let wrapper: VueWrapper | null = null;

interface MeterProps {
    soldSeconds: number;
    consumedSeconds: number;
    projectedSeconds?: number | null;
    status: string;
    variant?: 'full' | 'compact';
    closed?: boolean;
    numberFormat?: string | null;
}

function mountMeter(props: MeterProps) {
    wrapper = mount(BudgetMeter, {
        props: { variant: 'full', labels, ...props },
        attachTo: document.body,
    });
    return wrapper;
}

function part(name: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`[data-testid="profitability-meter-${name}"]`);
}

function meter(): HTMLElement {
    const found = document.body.querySelector<HTMLElement>('[role="meter"]');
    expect(found).not.toBeNull();
    return found as HTMLElement;
}

describe('BudgetMeter', () => {
    afterEach(() => {
        wrapper?.unmount();
        wrapper = null;
        document.body.innerHTML = '';
    });

    it('scales the track to the hours sold when everything is under them', () => {
        mountMeter({
            soldSeconds: 40 * H,
            consumedSeconds: 20 * H,
            projectedSeconds: 36 * H,
            status: 'on_track',
        });

        expect(meter().getAttribute('data-scale-seconds')).toBe(String(40 * H));
        expect(part('consumed')?.style.width).toBe('50%');
        expect(part('consumed')?.className).toContain('bg-accent-400');
        expect(part('consumed')?.className).toContain('dark:bg-accent-200');
        expect(part('consumed')?.className).toContain('motion-safe:transition-[width]');
        expect(part('consumed')?.className).toContain('duration-200');

        const projected = part('projected');
        expect(projected?.style.left).toBe('50%');
        expect(projected?.style.width).toBe('40%');
        expect(projected?.className).toContain('opacity-40');
        expect(projected?.className).toContain('repeating-linear-gradient(45deg');

        expect(part('over')).toBeNull();
        expect(part('tick')?.style.left).toContain('100%');
        expect(part('tick-label')).toBeNull();
    });

    it('rescales to the consumed hours when over and labels the budget tick', () => {
        mountMeter({ soldSeconds: 40 * H, consumedSeconds: 50 * H, status: 'over' });

        expect(meter().getAttribute('data-scale-seconds')).toBe(String(50 * H));
        expect(part('consumed')?.style.width).toBe('80%');
        expect(part('tick')?.style.left).toContain('80%');
        expect(part('tick-label')?.textContent?.trim()).toBe('Sold 40 h');
        expect(part('tick-label')?.style.left).toBe('80%');

        const over = part('over');
        expect(over?.style.left).toBe('80%');
        expect(over?.style.width).toBe('20%');
        expect(over?.className).toContain('bg-red-700');
        expect(over?.className).toContain('dark:bg-red-400');
    });

    it('rescales to a projection beyond the hours sold', () => {
        mountMeter({
            soldSeconds: 40 * H,
            consumedSeconds: 30 * H,
            projectedSeconds: 50 * H,
            status: 'over',
        });
        expect(part('consumed')?.style.width).toBe('60%');
        expect(part('projected')?.style.left).toBe('60%');
        expect(part('projected')?.style.width).toBe('40%');
        expect(part('tick')?.style.left).toContain('80%');
        expect(part('tick-label')?.textContent?.trim()).toBe('Sold 40 h');
    });

    it('carries meter semantics with the valuetext copy', () => {
        mountMeter({
            soldSeconds: 40 * H,
            consumedSeconds: 20 * H,
            projectedSeconds: 36 * H,
            status: 'on_track',
        });
        const root = meter();
        expect(root.getAttribute('aria-valuemin')).toBe('0');
        expect(root.getAttribute('aria-valuemax')).toBe('40');
        expect(root.getAttribute('aria-valuenow')).toBe('20');
        expect(root.getAttribute('aria-valuetext')).toBe(
            '20 h of 40 h consumed, projected 36 h, On track'
        );
    });

    it('is h-2 in full and h-1 in compact, with a shorter tick when compact', () => {
        mountMeter({ soldSeconds: 40 * H, consumedSeconds: 20 * H, status: 'on_track' });
        expect(part('track')?.className).toContain('h-2');
        expect(part('track')?.className).toContain('rounded-full');
        expect(part('track')?.className).toContain('bg-quaternary');
        expect(part('tick')?.className).toContain('h-4');
        expect(part('tick')?.className).toContain('w-0.5');
        expect(part('tick')?.className).toContain('bg-text-primary');
        wrapper?.unmount();
        document.body.innerHTML = '';

        mountMeter({
            soldSeconds: 40 * H,
            consumedSeconds: 20 * H,
            status: 'on_track',
            variant: 'compact',
        });
        expect(part('track')?.className).toContain('h-1');
        expect(part('track')?.className).not.toContain('h-2');
        expect(part('tick')?.className).toContain('h-3');
    });

    it('omits the projected stripe for a closed period or a projection equal to consumed', () => {
        mountMeter({
            soldSeconds: 40 * H,
            consumedSeconds: 20 * H,
            projectedSeconds: 36 * H,
            status: 'closed',
            closed: true,
        });
        expect(part('projected')).toBeNull();
        expect(meter().getAttribute('aria-valuetext')).toBe(
            '20 h of 40 h consumed, projected 20 h, Closed'
        );
        wrapper?.unmount();
        document.body.innerHTML = '';

        mountMeter({
            soldSeconds: 40 * H,
            consumedSeconds: 20 * H,
            projectedSeconds: 20 * H,
            status: 'on_track',
        });
        expect(part('projected')).toBeNull();
    });

    it('draws an empty track without dividing by zero', () => {
        mountMeter({ soldSeconds: 0, consumedSeconds: 0, status: 'on_track' });
        expect(part('consumed')?.style.width).toBe('0%');
        expect(part('over')).toBeNull();
        expect(part('projected')).toBeNull();
        expect(meter().getAttribute('aria-valuemax')).toBe('0');
    });

    it('formats the hours with the organization number format', () => {
        mountMeter({
            soldSeconds: 1240 * H,
            consumedSeconds: 1500 * H,
            status: 'over',
            numberFormat: 'comma-point',
        });
        expect(part('tick-label')?.textContent?.trim()).toBe('Sold 1,240 h');
        expect(meter().getAttribute('aria-valuetext')).toBe(
            '1,500 h of 1,240 h consumed, projected 1,500 h, Over budget'
        );
    });
});
