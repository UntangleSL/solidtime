import { afterEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import OutlookLaneCaption from './OutlookLaneCaption.vue';
import { OUTLOOK_MEETINGS_KEY, type OutlookMeetingsContext } from './useOutlookMeetings';
import type { OutlookCalendarLabels, OutlookConnectionState } from '@/m365/types';

// dayOverlayLane is faked, so any CSS width string works; happy-dom only keeps values it can parse
// (no min()/max()), so a calc() stands in for the real week lane string.
const WEEK_LANE = 'calc(50% - 4px)';

const labels = {
    lane_caption_time: 'My time',
    lane_caption_outlook: 'Outlook',
} as OutlookCalendarLabels;

function fakeContext(state: OutlookConnectionState | null, lane: string | null) {
    const dayOverlayLane = vi.fn((_dayStr: string, _isDayView: boolean) => lane);
    const context = {
        labels: ref(labels),
        connectionState: ref(state),
        dayOverlayLane,
    } as unknown as OutlookMeetingsContext;
    return { context, dayOverlayLane };
}

let wrapper: VueWrapper | null = null;

function mountCaption(context: OutlookMeetingsContext, isDayView = false) {
    wrapper = mount(OutlookLaneCaption, {
        props: { dayStr: '2026-10-27', isDayView },
        global: { provide: { [OUTLOOK_MEETINGS_KEY as symbol]: context } },
    });
    return wrapper;
}

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
});

describe('OutlookLaneCaption', () => {
    it('labels both halves of a day with a lane', () => {
        const { context } = fakeContext('connected', WEEK_LANE);
        const caption = mountCaption(context);

        const rows = caption.findAll('[data-testid="outlook-lane-caption"]');
        expect(rows).toHaveLength(1);
        const row = rows[0]!;
        expect(row.attributes('aria-hidden')).toBe('true');
        expect(row.classes()).toContain('h-4');
        expect(row.classes()).toContain('-mx-2');
        expect(row.text()).toContain('My time');
        expect(row.text()).toContain('Outlook');

        const outlook = row.find('[data-caption-outlook]');
        expect(outlook.exists()).toBe(true);
        expect((outlook.element as HTMLElement).style.width).toBe(WEEK_LANE);
        expect(outlook.classes()).toContain('border-l');
        expect(outlook.text()).toBe('Outlook');
        const icon = outlook.find('svg');
        expect(icon.exists()).toBe(true);
        expect(icon.classes()).toContain('text-accent-600');
        expect(icon.classes().some((name) => name.includes('calendar-days'))).toBe(true);
    });

    it('reserves an empty row on days without a lane', () => {
        const { context } = fakeContext('connected', null);
        const caption = mountCaption(context);

        const row = caption.find('[data-testid="outlook-lane-caption"]');
        expect(row.exists()).toBe(true);
        expect(row.classes()).toContain('h-4');
        expect(row.text()).toBe('');
        expect(row.find('[data-caption-outlook]').exists()).toBe(false);
    });

    it('behaves the same in the reconnect state', () => {
        const withLane = fakeContext('reconnect', WEEK_LANE);
        expect(mountCaption(withLane.context).text()).toContain('My time');
        wrapper?.unmount();

        const withoutLane = fakeContext('reconnect', null);
        const caption = mountCaption(withoutLane.context);
        expect(caption.find('[data-testid="outlook-lane-caption"]').exists()).toBe(true);
        expect(caption.text()).toBe('');
    });

    it('renders nothing when the cluster is inactive', () => {
        for (const state of ['not_connected', null] as const) {
            const { context } = fakeContext(state, WEEK_LANE);
            const caption = mountCaption(context);
            expect(caption.find('[data-testid="outlook-lane-caption"]').exists()).toBe(false);
            expect(caption.text()).toBe('');
            wrapper?.unmount();
        }
        wrapper = null;
    });

    it('renders nothing without the Outlook context', () => {
        wrapper = mount(OutlookLaneCaption, { props: { dayStr: '2026-10-27', isDayView: false } });
        expect(wrapper.find('[data-testid="outlook-lane-caption"]').exists()).toBe(false);
    });

    it('passes the day view flag to dayOverlayLane', () => {
        const { context, dayOverlayLane } = fakeContext('connected', 'min(420px, max(260px, 38%))');
        mountCaption(context, true);

        expect(dayOverlayLane).toHaveBeenCalledWith('2026-10-27', true);
    });
});
