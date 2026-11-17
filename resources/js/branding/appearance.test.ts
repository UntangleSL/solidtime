import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

const { state, put, addNotification } = vi.hoisted(() => ({
    state: { props: {} as Record<string, unknown> },
    put: vi.fn(),
    addNotification: vi.fn(),
}));

vi.mock('axios', () => ({ default: { put } }));
vi.mock('@/utils/notification', () => ({
    useNotificationsStore: () => ({ addNotification }),
}));
vi.mock('@inertiajs/vue3', () => ({
    usePage: () => ({
        get props() {
            return state.props;
        },
    }),
}));

const UPDATE_URL = '/user/appearance';

function setProps(
    theme: string | null,
    accent: string | null,
    updateUrl: string | null = UPDATE_URL
) {
    state.props = {
        appearance: {
            theme,
            accent,
            accents: ['untangle', 'azure', 'indigo', 'violet', 'ember', 'graphite'],
            update_url: updateUrl,
            labels: {
                accent_save_failed_title: "Couldn't save your accent color.",
                accent_save_failed_body: 'It is applied on this device only. Try again later.',
            },
            presets: {},
        },
    };
}

let dispose: (() => void) | null = null;

async function loadModules() {
    const accent = await import('./accent');
    const theme = await import('@/utils/theme');
    const appearance = await import('./useAppearance');
    dispose = appearance.disposeAppearanceSync;
    return { ...accent, ...theme, ...appearance };
}

/** Let Vue's pre-flush watchers and resolved axios promises run. */
async function flush() {
    await nextTick();
    await Promise.resolve();
    await nextTick();
}

function accentClasses(): string[] {
    return [...document.documentElement.classList].filter((c) => c.startsWith('accent-'));
}

beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.documentElement.className = '';
    put.mockReset();
    put.mockResolvedValue({ data: {} });
    addNotification.mockReset();
    setProps('system', 'untangle');
});

afterEach(() => {
    // vi.resetModules() gives each test fresh modules, but the previous test's watcher would still
    // react to localStorage sync events; stop it.
    dispose?.();
    dispose = null;
    vi.useRealTimers();
});

describe('accent state', () => {
    it('test_apply_accent_class_swaps_only_the_accent_class', async () => {
        const { applyAccentClass } = await loadModules();
        const root = document.documentElement;
        root.className = 'dark accent-azure keep';

        applyAccentClass(root, 'violet');

        expect([...root.classList].sort()).toEqual(['accent-violet', 'dark', 'keep']);
        expect(accentClasses()).toHaveLength(1);
    });

    it('test_unknown_stored_accent_falls_back', async () => {
        localStorage.setItem('accent', 'rose');
        const { activeAccent, useAccent } = await loadModules();

        expect(activeAccent.value).toBe('untangle');
        useAccent();
        expect(accentClasses()).toEqual(['accent-untangle']);
    });

    it('test_css_variable_consumers_recompute_on_accent_change', async () => {
        const { setAccent } = await loadModules();
        const { useCssVariable } = await import('@/packages/ui/src/utils/useCssVariable');
        const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation(
            () =>
                ({
                    getPropertyValue: (name: string) =>
                        name === '--theme-color-chart' &&
                        document.documentElement.classList.contains('accent-ember')
                            ? '255, 168, 124'
                            : '0, 245, 212',
                }) as unknown as CSSStyleDeclaration
        );

        let chartColor: { value: string } = { value: '' };
        const Consumer = defineComponent({
            setup() {
                chartColor = useCssVariable('--theme-color-chart');
                return () => h('div');
            },
        });
        const wrapper = mount(Consumer);
        expect(chartColor.value).toBe('0, 245, 212');

        setAccent('ember');
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(chartColor.value).toBe('255, 168, 124');
        wrapper.unmount();
        spy.mockRestore();
    });
});

describe('useAppearance', () => {
    it('test_no_put_on_mount', async () => {
        vi.useFakeTimers();
        localStorage.setItem('theme', 'dark');
        localStorage.setItem('accent', 'violet');
        setProps('dark', 'violet');
        const { useAppearance } = await loadModules();

        useAppearance();
        await flush();
        await vi.advanceTimersByTimeAsync(1000);

        expect(put).not.toHaveBeenCalled();
        expect(accentClasses()).toEqual(['accent-violet']);
    });

    it('test_one_debounced_put_with_both_values', async () => {
        vi.useFakeTimers();
        const { useAppearance, setAccent } = await loadModules();
        useAppearance();
        await flush();

        setAccent('azure');
        await vi.advanceTimersByTimeAsync(100);
        setAccent('indigo');
        await vi.advanceTimersByTimeAsync(100);
        setAccent('ember');
        await vi.advanceTimersByTimeAsync(399);
        expect(put).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(10);

        expect(put).toHaveBeenCalledTimes(1);
        expect(put).toHaveBeenCalledWith(UPDATE_URL, { theme: 'system', accent: 'ember' });
    });

    it('test_theme_change_is_saved_too', async () => {
        vi.useFakeTimers();
        const { useAppearance, themeSetting } = await loadModules();
        useAppearance();
        await flush();

        themeSetting.value = 'light';
        await vi.advanceTimersByTimeAsync(500);

        expect(put).toHaveBeenCalledTimes(1);
        expect(put).toHaveBeenCalledWith(UPDATE_URL, { theme: 'light', accent: 'untangle' });
    });

    it('test_second_mount_adds_no_second_watcher', async () => {
        vi.useFakeTimers();
        const { useAppearance, setAccent } = await loadModules();
        useAppearance();
        useAppearance();
        await flush();

        setAccent('graphite');
        await vi.advanceTimersByTimeAsync(500);

        expect(put).toHaveBeenCalledTimes(1);
    });

    it('test_seed_migrates_legacy_local_values_once', async () => {
        vi.useFakeTimers();
        localStorage.setItem('theme', 'dark');
        setProps(null, null);
        const { useAppearance } = await loadModules();

        useAppearance();
        await flush();
        await vi.advanceTimersByTimeAsync(500);
        expect(put).toHaveBeenCalledTimes(1);
        expect(put).toHaveBeenCalledWith(UPDATE_URL, { theme: 'dark', accent: 'untangle' });

        useAppearance();
        await flush();
        await vi.advanceTimersByTimeAsync(500);
        expect(put).toHaveBeenCalledTimes(1);
    });

    it('test_server_change_adopted_without_put', async () => {
        vi.useFakeTimers();
        const { useAppearance, activeAccent } = await loadModules();
        useAppearance();
        await flush();

        setProps('system', 'azure');
        useAppearance();
        await flush();
        await vi.advanceTimersByTimeAsync(1000);

        expect(activeAccent.value).toBe('azure');
        expect(accentClasses()).toEqual(['accent-azure']);
        expect(localStorage.getItem('accent')).toBe('azure');
        expect(put).not.toHaveBeenCalled();
    });

    it('test_pending_local_change_is_not_overwritten', async () => {
        vi.useFakeTimers();
        setProps('system', 'violet');
        localStorage.setItem('accent', 'violet');
        const { useAppearance, setAccent, activeAccent } = await loadModules();
        useAppearance();
        await flush();

        setAccent('ember');
        await vi.advanceTimersByTimeAsync(100);
        setProps('system', 'indigo');
        useAppearance();
        await flush();

        expect(activeAccent.value).toBe('ember');
        await vi.advanceTimersByTimeAsync(500);
        expect(put).toHaveBeenCalledTimes(1);
        expect(put).toHaveBeenCalledWith(UPDATE_URL, { theme: 'system', accent: 'ember' });
        expect(accentClasses()).toEqual(['accent-ember']);
    });

    it('test_guest_never_puts', async () => {
        vi.useFakeTimers();
        localStorage.setItem('theme', 'dark');
        setProps(null, null, null);
        const { useAppearance, setAccent, themeSetting } = await loadModules();
        useAppearance();
        await flush();

        setAccent('azure');
        themeSetting.value = 'light';
        await vi.advanceTimersByTimeAsync(1000);

        expect(put).not.toHaveBeenCalled();
        expect(accentClasses()).toEqual(['accent-azure']);
    });

    it('test_accent_save_failure_notifies_and_keeps_the_choice', async () => {
        vi.useFakeTimers();
        put.mockRejectedValue(new Error('network'));
        const { useAppearance, setAccent, activeAccent } = await loadModules();
        useAppearance();
        await flush();

        setAccent('violet');
        await vi.advanceTimersByTimeAsync(500);
        await flush();

        expect(put).toHaveBeenCalledTimes(1);
        expect(addNotification).toHaveBeenCalledWith(
            'error',
            "Couldn't save your accent color.",
            'It is applied on this device only. Try again later.'
        );
        expect(activeAccent.value).toBe('violet');
        expect(accentClasses()).toEqual(['accent-violet']);
    });

    it('test_theme_only_failure_is_silent', async () => {
        vi.useFakeTimers();
        put.mockRejectedValue(new Error('network'));
        const { useAppearance, themeSetting } = await loadModules();
        useAppearance();
        await flush();

        themeSetting.value = 'dark';
        await vi.advanceTimersByTimeAsync(500);
        await flush();

        expect(put).toHaveBeenCalledTimes(1);
        expect(addNotification).not.toHaveBeenCalled();
        expect(themeSetting.value).toBe('dark');
    });
});

describe('useAppearance: a pending local choice survives a reload', () => {
    const PENDING = 'appearance-pending';

    it('test_marker_is_set_synchronously_on_change_and_cleared_after_the_put', async () => {
        vi.useFakeTimers();
        const { useAppearance, themeSetting } = await loadModules();
        useAppearance();
        await flush();
        expect(localStorage.getItem(PENDING)).toBeNull();

        themeSetting.value = 'light';
        expect(localStorage.getItem(PENDING)).toBe('1');

        await vi.advanceTimersByTimeAsync(500);
        await flush();

        expect(put).toHaveBeenCalledWith(UPDATE_URL, { theme: 'light', accent: 'untangle' });
        expect(localStorage.getItem(PENDING)).toBeNull();
    });

    it('test_changing_back_to_the_server_value_clears_the_marker', async () => {
        vi.useFakeTimers();
        const { useAppearance, themeSetting } = await loadModules();
        useAppearance();
        await flush();

        themeSetting.value = 'dark';
        expect(localStorage.getItem(PENDING)).toBe('1');
        themeSetting.value = 'system';
        expect(localStorage.getItem(PENDING)).toBeNull();

        await vi.advanceTimersByTimeAsync(500);
        expect(put).not.toHaveBeenCalled();
    });

    it('test_reload_with_marker_keeps_local_values_and_sends_them', async () => {
        vi.useFakeTimers();
        // Previous page: picked light, reloaded before the debounced PUT; the server still has dark.
        localStorage.setItem('theme', 'light');
        localStorage.setItem('accent', 'ember');
        localStorage.setItem(PENDING, '1');
        setProps('dark', 'violet');
        const { useAppearance, themeSetting, activeAccent } = await loadModules();

        useAppearance();
        await flush();

        expect(themeSetting.value).toBe('light');
        expect(activeAccent.value).toBe('ember');
        expect(put).toHaveBeenCalledTimes(1);
        expect(put).toHaveBeenCalledWith(UPDATE_URL, { theme: 'light', accent: 'ember' });
        expect(localStorage.getItem(PENDING)).toBeNull();

        await vi.advanceTimersByTimeAsync(1000);
        expect(put).toHaveBeenCalledTimes(1);
    });

    it('test_reload_with_marker_and_matching_server_clears_it_without_put', async () => {
        vi.useFakeTimers();
        localStorage.setItem('theme', 'light');
        localStorage.setItem(PENDING, '1');
        setProps('light', 'untangle');
        const { useAppearance } = await loadModules();

        useAppearance();
        await flush();
        await vi.advanceTimersByTimeAsync(1000);

        expect(put).not.toHaveBeenCalled();
        expect(localStorage.getItem(PENDING)).toBeNull();
    });

    it('test_load_without_marker_adopts_the_server_value_from_another_device', async () => {
        vi.useFakeTimers();
        localStorage.setItem('theme', 'light');
        localStorage.setItem('accent', 'ember');
        setProps('dark', 'violet');
        const { useAppearance, themeSetting, activeAccent } = await loadModules();

        useAppearance();
        await flush();
        await vi.advanceTimersByTimeAsync(1000);

        expect(themeSetting.value).toBe('dark');
        expect(activeAccent.value).toBe('violet');
        expect(put).not.toHaveBeenCalled();
        expect(localStorage.getItem(PENDING)).toBeNull();
    });

    it('test_failed_put_keeps_the_marker', async () => {
        vi.useFakeTimers();
        put.mockRejectedValue(new Error('network'));
        const { useAppearance, themeSetting } = await loadModules();
        useAppearance();
        await flush();

        themeSetting.value = 'dark';
        await vi.advanceTimersByTimeAsync(500);
        await flush();

        expect(put).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(PENDING)).toBe('1');
    });

    it('test_change_back_while_a_put_is_in_flight_is_sent_after_it', async () => {
        vi.useFakeTimers();
        let resolveFirst: (value: unknown) => void = () => undefined;
        put.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveFirst = resolve;
                })
        );
        const { useAppearance, themeSetting } = await loadModules();
        useAppearance();
        await flush();

        themeSetting.value = 'dark';
        await vi.advanceTimersByTimeAsync(500);
        expect(put).toHaveBeenCalledTimes(1);

        // Back to the value the server held before the request: the debounce skips it.
        themeSetting.value = 'system';
        await vi.advanceTimersByTimeAsync(500);
        expect(put).toHaveBeenCalledTimes(1);

        resolveFirst({ data: {} });
        await flush();

        expect(put).toHaveBeenCalledTimes(2);
        expect(put).toHaveBeenLastCalledWith(UPDATE_URL, { theme: 'system', accent: 'untangle' });
        await flush();
        expect(localStorage.getItem(PENDING)).toBeNull();
    });

    it('test_pagehide_flushes_a_pending_change_with_keepalive', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
        vi.stubGlobal('fetch', fetchMock);
        document.cookie = 'XSRF-TOKEN=abc%3D%3D';
        try {
            const { useAppearance, themeSetting } = await loadModules();
            useAppearance();
            await flush();

            themeSetting.value = 'light';
            window.dispatchEvent(new Event('pagehide'));
            await flush();

            expect(fetchMock).toHaveBeenCalledTimes(1);
            const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toBe(UPDATE_URL);
            expect(init.method).toBe('PUT');
            expect(init.keepalive).toBe(true);
            expect(JSON.parse(init.body as string)).toEqual({ theme: 'light', accent: 'untangle' });
            expect((init.headers as Record<string, string>)['X-XSRF-TOKEN']).toBe('abc==');
            expect(localStorage.getItem(PENDING)).toBeNull();

            // The debounced save finds nothing left to send.
            await vi.advanceTimersByTimeAsync(1000);
            expect(put).not.toHaveBeenCalled();
            expect(fetchMock).toHaveBeenCalledTimes(1);
        } finally {
            document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
            vi.unstubAllGlobals();
        }
    });

    it('test_pagehide_without_a_pending_change_sends_nothing', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
        vi.stubGlobal('fetch', fetchMock);
        try {
            const { useAppearance } = await loadModules();
            useAppearance();
            await flush();

            window.dispatchEvent(new Event('pagehide'));
            await flush();

            expect(fetchMock).not.toHaveBeenCalled();
            expect(put).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('test_guest_never_sets_the_marker_or_flushes', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
        vi.stubGlobal('fetch', fetchMock);
        try {
            setProps(null, null, null);
            const { useAppearance, themeSetting } = await loadModules();
            useAppearance();
            await flush();

            themeSetting.value = 'light';
            window.dispatchEvent(new Event('pagehide'));
            await flush();

            expect(localStorage.getItem(PENDING)).toBeNull();
            expect(fetchMock).not.toHaveBeenCalled();
            expect(put).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
