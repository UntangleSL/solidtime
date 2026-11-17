import axios from 'axios';
import { useEventListener, watchDebounced } from '@vueuse/core';
import { effectScope, watch, type ComputedRef, type EffectScope } from 'vue';
import { themeSetting, type themeOption } from '@/utils/theme';
import { useNotificationsStore } from '@/utils/notification';
import { activeAccent, setAccent, useAccent } from './accent';
import { DEFAULT_ACCENT, isAccentId, type AccentId } from './accentPresets';
import { useAppearanceProps, type AppearanceProps } from './appearanceProps';

interface AppearancePair {
    theme: themeOption;
    accent: AccentId;
}

const THEMES: readonly themeOption[] = ['system', 'light', 'dark'];
const DEFAULT_THEME: themeOption = 'system';

/**
 * localStorage marker: this device holds a theme/accent choice the server has not confirmed yet.
 * The pre-paint script (resources/views/branding/early-theme.blade.php) reads the same key: while
 * it is present, the stored values win over the server ones, so a reload or full navigation inside
 * the save debounce (or after a failed save) never loses the latest choice.
 */
export const APPEARANCE_PENDING_KEY = 'appearance-pending';

function normaliseTheme(value: unknown): themeOption {
    return THEMES.includes(value as themeOption) ? (value as themeOption) : DEFAULT_THEME;
}

function localPair(): AppearancePair {
    return { theme: normaliseTheme(themeSetting.value), accent: activeAccent.value };
}

function samePair(a: AppearancePair, b: AppearancePair): boolean {
    return a.theme === b.theme && a.accent === b.accent;
}

function hasPendingMarker(): boolean {
    try {
        return window.localStorage.getItem(APPEARANCE_PENDING_KEY) !== null;
    } catch {
        return false;
    }
}

function setPendingMarker(pending: boolean): void {
    try {
        if (pending) {
            window.localStorage.setItem(APPEARANCE_PENDING_KEY, '1');
        } else {
            window.localStorage.removeItem(APPEARANCE_PENDING_KEY);
        }
    } catch {
        // Storage unavailable: the debounced save still runs; only the reload guard is lost.
    }
}

/*
 * Module-level state: every Inertia page mounts its own AppLayout, so useAppearance() runs on each
 * navigation. The state below makes it idempotent: one persistence watcher per page load, and the
 * server prop is reconciled only when it changes.
 */
let syncScope: EffectScope | null = null;
/** What the server holds for this user, with null read as the default (system / untangle). */
let lastPersisted: AppearancePair = { theme: DEFAULT_THEME, accent: DEFAULT_ACCENT };
/** The last server snapshot reconciled (values plus update URL, so a different user is noticed). */
let lastSnapshot: string | null = null;
/** The props of the latest layout mount; read at save time. */
let currentProps: ComputedRef<AppearanceProps> | null = null;
/** The pair of the request in flight, so a watcher run during the request does not send it twice. */
let inFlight: AppearancePair | null = null;

function updateUrl(): string | null {
    return currentProps?.value.update_url ?? null;
}

/** Keep the pending marker in step with "the local pair differs from what the server holds". */
function syncPendingMarker(): void {
    if (!updateUrl()) {
        return; // guests: the choice is device-only, nothing is pending
    }
    setPendingMarker(!samePair(localPair(), lastPersisted));
}

function readCookie(name: string): string | null {
    const prefix = `${name}=`;
    for (const part of document.cookie.split(';')) {
        const trimmed = part.trim();
        if (trimmed.startsWith(prefix)) {
            return decodeURIComponent(trimmed.slice(prefix.length));
        }
    }
    return null;
}

/**
 * PUT the pair. `keepalive` is used while the page is being hidden or unloaded: a fetch with
 * keepalive outlives the page, an axios request does not. Same headers axios sends for this web
 * route (session cookie plus the XSRF-TOKEN cookie echoed as X-XSRF-TOKEN).
 */
async function sendPair(url: string, pair: AppearancePair, keepalive: boolean): Promise<void> {
    if (keepalive && typeof window.fetch === 'function') {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
        };
        const xsrf = readCookie('XSRF-TOKEN');
        if (xsrf !== null) {
            headers['X-XSRF-TOKEN'] = xsrf;
        }
        const response = await window.fetch(url, {
            method: 'PUT',
            keepalive: true,
            credentials: 'same-origin',
            headers,
            body: JSON.stringify(pair),
        });
        if (!response.ok) {
            throw new Error(`Appearance save failed with status ${response.status}`);
        }
        return;
    }
    await axios.put(url, { theme: pair.theme, accent: pair.accent });
}

async function save(options: { keepalive?: boolean } = {}): Promise<void> {
    const url = updateUrl();
    if (!url) {
        return; // guests: the choice stays on this device
    }
    const next = localPair();
    if (samePair(next, lastPersisted) || (inFlight !== null && samePair(next, inFlight))) {
        return;
    }
    const accentChanged = next.accent !== lastPersisted.accent;
    inFlight = next;
    let saved = false;
    try {
        await sendPair(url, next, options.keepalive === true);
        lastPersisted = next;
        saved = true;
    } catch {
        // The choice stays applied on this device and the pending marker stays set, so the next
        // page load sends it again. The notification copy covers the accent only; a theme-only
        // failure stays silent, like the device-only theme before this phase.
        if (accentChanged) {
            const labels = currentProps?.value.labels;
            useNotificationsStore().addNotification(
                'error',
                labels?.accent_save_failed_title ?? '',
                labels?.accent_save_failed_body || undefined
            );
        }
    } finally {
        if (inFlight === next) {
            inFlight = null;
        }
    }
    if (saved) {
        syncPendingMarker();
        if (!samePair(localPair(), lastPersisted)) {
            // The pair changed while the request was in flight (for example back to the old value,
            // which the debounced save skipped because it matched the server before this request).
            void save();
        }
    }
}

/** Send a pending change right away when the page is hidden or unloaded (reload, tab close). */
function flushPending(): void {
    if (!updateUrl() || !hasPendingMarker()) {
        return;
    }
    void save({ keepalive: true });
}

/**
 * Reconcile the server prop with this device. Server values that changed elsewhere are adopted
 * when there is no unsaved local change (no PUT); an unsaved local change (also one left by an
 * earlier page load, see APPEARANCE_PENDING_KEY) is kept and sent; a null server value with a
 * non-default local value is seeded once (migrates the legacy localStorage theme).
 */
function reconcile(props: AppearanceProps): void {
    const snapshot = JSON.stringify([props.update_url, props.theme, props.accent]);
    if (snapshot === lastSnapshot) {
        return;
    }
    const firstReconcile = lastSnapshot === null;
    lastSnapshot = snapshot;

    const local = localPair();
    // On the first reconcile of a page load only the marker knows whether the stored values are a
    // choice the server never received (the pre-paint script already kept them).
    const hasUnsavedLocalChange = firstReconcile
        ? hasPendingMarker()
        : !samePair(local, lastPersisted);
    const serverTheme = props.theme === null ? null : normaliseTheme(props.theme);
    const serverAccent = isAccentId(props.accent) ? props.accent : null;

    // lastPersisted is set first, so the persistence watcher finds nothing to send after an adopt.
    lastPersisted = {
        theme: serverTheme ?? DEFAULT_THEME,
        accent: serverAccent ?? DEFAULT_ACCENT,
    };

    if (hasUnsavedLocalChange) {
        // Keep the local choice and send it now (idempotent with a pending debounced save).
        syncPendingMarker();
        void save();
        return;
    }

    const next: AppearancePair = {
        theme: serverTheme ?? local.theme,
        accent: serverAccent ?? local.accent,
    };
    if (next.theme !== local.theme) {
        themeSetting.value = next.theme;
    }
    if (next.accent !== local.accent) {
        setAccent(next.accent);
    }
    syncPendingMarker();
    if (!samePair(next, lastPersisted)) {
        void save(); // seed: a server value is null and this device has a non-default one
    }
}

/**
 * Server sync of the theme and accent (Phase 3.2, D-05). Called from AppLayout's onMounted right
 * after useTheme(). Changes from any source (profile, accent picker, command palette, another tab)
 * are saved once, 400 ms after the last change; nothing is sent on load or navigation unless an
 * earlier change never reached the server. The pending marker is set synchronously on every
 * change, and a pending change is flushed with a keepalive request when the page is hidden.
 */
export function useAppearance(): void {
    useAccent();
    currentProps = useAppearanceProps();
    const props = currentProps.value;

    if (syncScope === null) {
        // Detached scope: the watchers and listeners outlive the layout instance that created them.
        syncScope = effectScope(true);
        syncScope.run(() => {
            watch([themeSetting, activeAccent], syncPendingMarker, { flush: 'sync' });
            watchDebounced([themeSetting, activeAccent], () => void save(), { debounce: 400 });
            useEventListener(window, 'pagehide', flushPending);
            useEventListener(document, 'visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    flushPending();
                }
            });
        });
    }

    if (!props.update_url) {
        return;
    }
    reconcile(props);
}

/**
 * Stop the persistence watcher and forget the reconciled state. Test isolation only: the app keeps
 * one watcher for the life of the page.
 */
export function disposeAppearanceSync(): void {
    syncScope?.stop();
    syncScope = null;
    lastSnapshot = null;
    currentProps = null;
    inFlight = null;
    lastPersisted = { theme: DEFAULT_THEME, accent: DEFAULT_ACCENT };
}
