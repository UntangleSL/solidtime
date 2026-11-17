import { computed, nextTick, ref, type Ref } from 'vue';
import { tryOnScopeDispose, useEventListener } from '@vueuse/core';
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

/** How long the "Zoom 150%" pill stays after a zoom change. */
export const ZOOM_INDICATOR_MS = 1200;

/** Safari pinch: one step once the scale moved this far from the last step's scale. */
const GESTURE_ZOOM_IN_RATIO = 1.25;
const GESTURE_ZOOM_OUT_RATIO = 0.8;

/** Safari's non-standard GestureEvent (gesturestart / gesturechange), only the fields used here. */
interface GestureLikeEvent extends Event {
    scale: number;
    clientY?: number;
}

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

    // Transient "Zoom 150%" pill: shown after every effective change, the timer restarts per step
    const indicatorVisible = ref(false);
    const indicatorPercent = ref(zoomPercent.value);
    let indicatorTimer: ReturnType<typeof setTimeout> | null = null;

    function clearIndicatorTimer(): void {
        if (indicatorTimer !== null) {
            clearTimeout(indicatorTimer);
            indicatorTimer = null;
        }
    }

    function showIndicator(percent: number): void {
        indicatorPercent.value = percent;
        indicatorVisible.value = true;
        clearIndicatorTimer();
        indicatorTimer = setTimeout(() => {
            indicatorVisible.value = false;
            indicatorTimer = null;
        }, ZOOM_INDICATOR_MS);
    }

    tryOnScopeDispose(clearIndicatorTimer);

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
        showIndicator(percentOf(next));

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

    // Safari pinch arrives as gesture events, not as a ctrl wheel (best effort, no WebKit in CI)
    let gestureBaseline = 1;

    function onGestureStart(event: Event): void {
        event.preventDefault();
        gestureBaseline = 1;
    }

    function onGestureChange(event: Event): void {
        event.preventDefault();
        if (isInteracting()) return;
        const gesture = event as GestureLikeEvent;
        if (typeof gesture.scale !== 'number' || gesture.scale <= 0) return;
        const ratio = gesture.scale / gestureBaseline;
        const clientY = typeof gesture.clientY === 'number' ? gesture.clientY : undefined;
        if (ratio >= GESTURE_ZOOM_IN_RATIO) {
            gestureBaseline = gesture.scale;
            void stepZoom(1, clientY);
        } else if (ratio <= GESTURE_ZOOM_OUT_RATIO) {
            gestureBaseline = gesture.scale;
            void stepZoom(-1, clientY);
        }
    }

    useEventListener(rootRef, 'gesturestart', onGestureStart, { passive: false });
    useEventListener(rootRef, 'gesturechange', onGestureChange, { passive: false });

    /** Button steps anchor at the vertical centre of the visible grid. */
    function zoomIn(): Promise<boolean> {
        if (isInteracting()) return Promise.resolve(false);
        return stepZoom(1);
    }

    function zoomOut(): Promise<boolean> {
        if (isInteracting()) return Promise.resolve(false);
        return stepZoom(-1);
    }

    return {
        stepZoom,
        zoomIn,
        zoomOut,
        zoomPercent,
        canZoomIn,
        canZoomOut,
        indicatorVisible,
        indicatorPercent,
    };
}
