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
