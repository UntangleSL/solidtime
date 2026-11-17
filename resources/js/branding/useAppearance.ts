import axios from 'axios';
import { watchDebounced } from '@vueuse/core';
import { effectScope, type ComputedRef, type EffectScope } from 'vue';
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

function normaliseTheme(value: unknown): themeOption {
    return THEMES.includes(value as themeOption) ? (value as themeOption) : DEFAULT_THEME;
}

function localPair(): AppearancePair {
    return { theme: normaliseTheme(themeSetting.value), accent: activeAccent.value };
}

function samePair(a: AppearancePair, b: AppearancePair): boolean {
    return a.theme === b.theme && a.accent === b.accent;
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

async function save(): Promise<void> {
    const updateUrl = currentProps?.value.update_url ?? null;
    if (!updateUrl) {
        return; // guests: the choice stays on this device
    }
    const next = localPair();
    if (samePair(next, lastPersisted) || (inFlight !== null && samePair(next, inFlight))) {
        return;
    }
    const accentChanged = next.accent !== lastPersisted.accent;
    inFlight = next;
    try {
        await axios.put(updateUrl, { theme: next.theme, accent: next.accent });
        lastPersisted = next;
    } catch {
        // The choice stays applied on this device. The notification copy covers the accent only;
        // a theme-only failure stays silent, like the device-only theme before this phase.
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
}

/**
 * Reconcile the server prop with this device. Server values that changed elsewhere are adopted
 * when there is no unsaved local change (no PUT); a null server value with a non-default local
 * value is seeded once (migrates the legacy localStorage theme).
 */
function reconcile(props: AppearanceProps): void {
    const snapshot = JSON.stringify([props.update_url, props.theme, props.accent]);
    if (snapshot === lastSnapshot) {
        return;
    }
    const firstReconcile = lastSnapshot === null;
    lastSnapshot = snapshot;

    const local = localPair();
    const hasUnsavedLocalChange = !firstReconcile && !samePair(local, lastPersisted);
    const serverTheme = props.theme === null ? null : normaliseTheme(props.theme);
    const serverAccent = isAccentId(props.accent) ? props.accent : null;

    // lastPersisted is set first, so the persistence watcher finds nothing to send after an adopt.
    lastPersisted = {
        theme: serverTheme ?? DEFAULT_THEME,
        accent: serverAccent ?? DEFAULT_ACCENT,
    };

    if (hasUnsavedLocalChange) {
        return; // the pending debounced save sends the local value
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
    if (!samePair(next, lastPersisted)) {
        void save(); // seed: a server value is null and this device has a non-default one
    }
}

/**
 * Server sync of the theme and accent (Phase 3.2, D-05). Called from AppLayout's onMounted right
 * after useTheme(). Changes from any source (profile, accent picker, command palette, another tab)
 * are saved once, 400 ms after the last change; nothing is sent on load or navigation.
 */
export function useAppearance(): void {
    useAccent();
    currentProps = useAppearanceProps();
    const props = currentProps.value;

    if (syncScope === null) {
        // Detached scope: the watcher outlives the layout instance that created it.
        syncScope = effectScope(true);
        syncScope.run(() => {
            watchDebounced([themeSetting, activeAccent], () => void save(), { debounce: 400 });
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
