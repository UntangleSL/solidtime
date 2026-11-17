import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { CalendarSettings } from './calendarSettings';
import { SLOT_HEIGHT } from './calendarTypes';
import { useWheelZoom } from './useWheelZoom';

const SCROLLER_TOP = 100;
const SCROLLER_HEIGHT = 600;

interface Harness {
    wrapper: VueWrapper;
    root: HTMLElement;
    scroller: HTMLElement;
    settings: Ref<CalendarSettings>;
    zoom: ReturnType<typeof useWheelZoom>;
}

let current: Harness | null = null;

// The listener attaches in a post-flush watcher once the root ref is set, hence async
async function mountHarness(
    options: { slotMinutes?: number; scrollTop?: number; interacting?: () => boolean } = {}
): Promise<Harness> {
    const settings = ref<CalendarSettings>({
        snapMinutes: 15,
        startHour: 0,
        endHour: 24,
        slotMinutes: options.slotMinutes ?? 15,
        showWeekends: true,
    });
    let zoom: ReturnType<typeof useWheelZoom> | null = null;

    const Host = defineComponent({
        setup() {
            const rootRef = ref<HTMLElement | null>(null);
            const scrollerRef = ref<HTMLElement | null>(null);
            zoom = useWheelZoom({
                rootRef,
                scrollerRef,
                calendarSettings: settings,
                isInteracting: options.interacting ?? (() => false),
                pixelsToMinutesFromMidnight: (px) =>
                    (px / SLOT_HEIGHT) * settings.value.slotMinutes + settings.value.startHour * 60,
            });
            return () =>
                h('div', { ref: rootRef, class: 'fc' }, [
                    h('div', { class: 'fc-header-scroll' }),
                    h('div', { ref: scrollerRef, class: 'fc-scroller' }),
                ]);
        },
    });

    const wrapper = mount(Host, { attachTo: document.body });
    const root = wrapper.get('.fc').element as HTMLElement;
    const scroller = wrapper.get('.fc-scroller').element as HTMLElement;
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({
        top: SCROLLER_TOP,
        bottom: SCROLLER_TOP + SCROLLER_HEIGHT,
        height: SCROLLER_HEIGHT,
        left: 0,
        right: 800,
        width: 800,
        x: 0,
        y: SCROLLER_TOP,
        toJSON: () => ({}),
    });
    scroller.scrollTop = options.scrollTop ?? 0;
    await nextTick();

    current = { wrapper, root, scroller, settings, zoom: zoom! };
    return current;
}

function wheel(
    target: HTMLElement,
    init: { deltaY: number; ctrlKey?: boolean; metaKey?: boolean; clientY?: number }
): WheelEvent {
    const event = new WheelEvent('wheel', {
        deltaY: init.deltaY,
        ctrlKey: init.ctrlKey ?? false,
        metaKey: init.metaKey ?? false,
        clientY: init.clientY ?? SCROLLER_TOP + 200,
        cancelable: true,
        bubbles: true,
    });
    // happy-dom's WheelEvent drops the modifier keys and clientY of its init dict; browsers keep them
    Object.defineProperty(event, 'ctrlKey', { value: init.ctrlKey ?? false });
    Object.defineProperty(event, 'metaKey', { value: init.metaKey ?? false });
    Object.defineProperty(event, 'clientY', { value: init.clientY ?? SCROLLER_TOP + 200 });
    target.dispatchEvent(event);
    return event;
}

afterEach(() => {
    current?.wrapper.unmount();
    current = null;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('useWheelZoom wheel path', () => {
    it('Ctrl + wheel up zooms in one step and keeps the time under the pointer', async () => {
        // 15-minute slots: 100 px per hour; scrollTop 1200 + pointer offset 200 = 14:00
        const { scroller, settings } = await mountHarness({ scrollTop: 1200 });

        const event = wheel(scroller, { deltaY: -100, ctrlKey: true, clientY: SCROLLER_TOP + 200 });
        expect(event.defaultPrevented).toBe(true);
        expect(settings.value.slotMinutes).toBe(10);

        await nextTick();
        // 10-minute slots: 150 px per hour, so 14:00 is at 2100 px, minus the 200 px offset
        expect(scroller.scrollTop).toBe(1900);
    });

    it('treats Cmd (metaKey) like Ctrl', async () => {
        const { scroller, settings } = await mountHarness();
        const event = wheel(scroller, { deltaY: -100, metaKey: true });
        expect(event.defaultPrevented).toBe(true);
        expect(settings.value.slotMinutes).toBe(10);
    });

    it('Ctrl + wheel down zooms out', async () => {
        const { root, settings } = await mountHarness();
        const event = wheel(root, { deltaY: 100, ctrlKey: true });
        expect(event.defaultPrevented).toBe(true);
        expect(settings.value.slotMinutes).toBe(30);
    });

    it('leaves a plain wheel alone so it scrolls natively', async () => {
        const { scroller, settings } = await mountHarness({ scrollTop: 300 });
        const event = wheel(scroller, { deltaY: -100 });
        expect(event.defaultPrevented).toBe(false);
        await nextTick();
        expect(settings.value.slotMinutes).toBe(15);
        expect(scroller.scrollTop).toBe(300);
    });

    it('prevents the page zoom but does nothing at the end of the ladder', async () => {
        const { scroller, settings } = await mountHarness({ slotMinutes: 5 });
        const event = wheel(scroller, { deltaY: -100, ctrlKey: true });
        expect(event.defaultPrevented).toBe(true);
        expect(settings.value.slotMinutes).toBe(5);
    });

    it('prevents the page zoom but never steps during a drag, resize or selection', async () => {
        const { scroller, settings } = await mountHarness({ interacting: () => true });
        const event = wheel(scroller, { deltaY: -100, ctrlKey: true });
        expect(event.defaultPrevented).toBe(true);
        expect(settings.value.slotMinutes).toBe(15);
    });

    it('exposes the zoom percent and whether each direction is possible', async () => {
        const { zoom, settings } = await mountHarness({ slotMinutes: 10 });
        expect(zoom.zoomPercent.value).toBe(150);
        expect(zoom.canZoomIn.value).toBe(true);
        settings.value = { ...settings.value, slotMinutes: 5 };
        expect(zoom.zoomPercent.value).toBe(300);
        expect(zoom.canZoomIn.value).toBe(false);
        expect(zoom.canZoomOut.value).toBe(true);
    });

    it('removes the listener on unmount', async () => {
        const { wrapper, root, settings } = await mountHarness();
        wrapper.unmount();
        current = null;
        const event = wheel(root, { deltaY: -100, ctrlKey: true });
        expect(event.defaultPrevented).toBe(false);
        expect(settings.value.slotMinutes).toBe(15);
    });
});
