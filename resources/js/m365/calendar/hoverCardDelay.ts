import { computed, ref } from 'vue';

// Hover card timing (03.1-UI-SPEC section 2, D-05). A card opens after the pointer rests on a
// meeting for HOVER_OPEN_DELAY_MS and closes HOVER_CLOSE_DELAY_MS after it leaves. While a card is
// open, and for HOVER_INSTANT_WINDOW_MS after one closed, the next meeting opens its card at once,
// so scanning across a week feels immediate. The state is module level so it spans every day column.
export const HOVER_OPEN_DELAY_MS = 400;
export const HOVER_CLOSE_DELAY_MS = 120;
export const HOVER_INSTANT_WINDOW_MS = 300;

const cardOpen = ref(false);
const recentlyClosed = ref(false);
let windowTimer: ReturnType<typeof setTimeout> | null = null;

function clearWindowTimer(): void {
    if (windowTimer !== null) {
        clearTimeout(windowTimer);
        windowTimer = null;
    }
}

/** A hover card became visible. */
export function noteHoverCardOpened(): void {
    clearWindowTimer();
    cardOpen.value = true;
    recentlyClosed.value = false;
}

/** A hover card closed: the instant window starts (again, on repeated closes). */
export function noteHoverCardClosed(): void {
    clearWindowTimer();
    cardOpen.value = false;
    recentlyClosed.value = true;
    windowTimer = setTimeout(() => {
        recentlyClosed.value = false;
        windowTimer = null;
    }, HOVER_INSTANT_WINDOW_MS);
}

/** Open delay for the next hover card: 0 inside the instant window, 400 ms otherwise. */
export const hoverOpenDelay = computed(() =>
    cardOpen.value || recentlyClosed.value ? 0 : HOVER_OPEN_DELAY_MS
);

/** Test helper: back to the idle state (no card open, no instant window). */
export function resetHoverCardDelay(): void {
    clearWindowTimer();
    cardOpen.value = false;
    recentlyClosed.value = false;
}
