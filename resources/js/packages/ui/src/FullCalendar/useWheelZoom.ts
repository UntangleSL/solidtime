import { computed, nextTick, type Ref } from 'vue';
import { useEventListener } from '@vueuse/core';
import type { CalendarSettings } from './calendarSettings';
import {
    anchoredScrollTop,
    canZoom,
    createWheelZoomAccumulator,
    nextZoomSlotMinutes,
    normalizeWheelDelta,
    zoomPercent as percentOf,
    type ZoomDirection,
} from './calendarZoom';

export interface UseWheelZoomOptions {
    /** The `.fc` root: grid, time axis and sticky header, so Ctrl+wheel there never page-zooms. */
    rootRef: Ref<HTMLElement | null>;
    scrollerRef: Ref<HTMLElement | null>;
    calendarSettings: Ref<CalendarSettings>;
    /** True while a drag, resize or slot selection is in progress: zoom input is ignored then. */
    isInteracting: () => boolean;
    pixelsToMinutesFromMidnight: (px: number) => number;
}

/**
 * Ctrl/Cmd + wheel (and trackpad pinch, which Chromium and Firefox report as a ctrl wheel) over
 * the calendar zooms one Grid Scale step at a time, keeping the time under the pointer in place.
 * A plain wheel is left alone so it keeps scrolling natively.
 */
export function useWheelZoom(options: UseWheelZoomOptions) {
    const { rootRef, scrollerRef, calendarSettings, isInteracting, pixelsToMinutesFromMidnight } =
        options;

    const accumulator = createWheelZoomAccumulator();

    const zoomPercent = computed(() => percentOf(calendarSettings.value.slotMinutes));
    const canZoomIn = computed(() => canZoom(calendarSettings.value.slotMinutes, 1));
    const canZoomOut = computed(() => canZoom(calendarSettings.value.slotMinutes, -1));

    /**
     * One step in `direction`, anchored at `clientY` (default: the scroller's vertical centre).
     * Resolves to true when the zoom changed, false at the end of the ladder.
     */
    async function stepZoom(direction: ZoomDirection, clientY?: number): Promise<boolean> {
        const current = calendarSettings.value;
        const next = nextZoomSlotMinutes(current.slotMinutes, direction);
        if (next === current.slotMinutes) return false;

        const scroller = scrollerRef.value;
        let anchorMinutes: number | null = null;
        let pointerOffset = 0;
        if (scroller) {
            const rect = scroller.getBoundingClientRect();
            const y = clientY ?? rect.top + rect.height / 2;
            pointerOffset = Math.min(Math.max(y - rect.top, 0), rect.height);
            // Read with the old scale, before the settings change
            anchorMinutes = pixelsToMinutesFromMidnight(scroller.scrollTop + pointerOffset);
        }

        calendarSettings.value = { ...current, slotMinutes: next };

        // The grid only grows after the render, so scrollTop must be set afterwards
        await nextTick();
        if (scroller && anchorMinutes !== null) {
            scroller.scrollTop = anchoredScrollTop(
                anchorMinutes,
                calendarSettings.value.startHour,
                next,
                pointerOffset
            );
        }
        return true;
    }

    function onWheel(event: WheelEvent): void {
        if (!(event.ctrlKey || event.metaKey)) return; // plain wheel: native scroll
        event.preventDefault(); // never let the browser zoom the page over the calendar
        if (isInteracting()) return; // in-flight pixel maths must not change scale
        const direction = accumulator.push(normalizeWheelDelta(event), event.timeStamp);
        if (direction === 0) return;
        void stepZoom(direction, event.clientY);
    }

    useEventListener(rootRef, 'wheel', onWheel, { passive: false });

    return { stepZoom, zoomPercent, canZoomIn, canZoomOut };
}
