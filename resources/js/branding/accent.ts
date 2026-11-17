import { useStorage } from '@vueuse/core';
import { computed, watch } from 'vue';
import { ACCENT_IDS, DEFAULT_ACCENT, isAccentId, type AccentId } from './accentPresets';

/**
 * The accent preset of this device (Phase 3.2, D-04). Stored raw under localStorage `accent`, the
 * same key the pre-paint script reads, so a reload starts with the right colours.
 *
 * The accent is applied as one `accent-<id>` class on <html>. A class (not an attribute) on
 * purpose: useCssVariable only observes `class` mutations, so charts and calendar colours
 * recompute when the accent switches.
 */
export const accentSetting = useStorage<string>('accent', DEFAULT_ACCENT);

/** The stored accent when it is a known preset, otherwise the default (unknown values never reach a class name). */
export const activeAccent = computed<AccentId>(() =>
    isAccentId(accentSetting.value) ? accentSetting.value : DEFAULT_ACCENT
);

/** Swap the accent class on `root`: removes every `accent-<preset>` class and adds `accent-<id>`, nothing else. */
export function applyAccentClass(root: HTMLElement, id: AccentId): void {
    for (const presetId of ACCENT_IDS) {
        if (presetId !== id) {
            root.classList.remove(`accent-${presetId}`);
        }
    }
    root.classList.add(`accent-${id}`);
}

/** Select an accent on this device: stores it and swaps the class immediately (no animation). */
export function setAccent(id: AccentId): void {
    accentSetting.value = id;
    applyAccentClass(document.documentElement, id);
}

let watching = false;

/**
 * Apply the current accent class and keep it in sync with the stored value (for example when
 * another tab writes localStorage). Safe to call on every layout mount: one watcher per page load.
 */
export function useAccent(): void {
    applyAccentClass(document.documentElement, activeAccent.value);
    if (watching) {
        return;
    }
    watching = true;
    watch(activeAccent, (id) => applyAccentClass(document.documentElement, id));
}
