import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import AccentPicker from './AccentPicker.vue';
import { activeAccent, setAccent } from './accent';
import { ACCENT_PRESETS, type AccentId } from './accentPresets';
import { themeSetting } from '@/utils/theme';

const { state } = vi.hoisted(() => ({
    state: { props: {} as Record<string, unknown> },
}));

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => ({
        get props() {
            return state.props;
        },
    }),
}));

state.props = {
    appearance: {
        theme: 'system',
        accent: 'untangle',
        accents: ['untangle', 'azure', 'indigo', 'violet', 'ember', 'graphite'],
        update_url: '/user/appearance',
        labels: {
            accent_label: 'Accent color',
            accent_description: ':name. Used for buttons, links and selected items.',
            accent_default_name: ':name (default)',
            accent_reset: 'Reset to Untangle',
            accent_announcement: 'Accent color set to :name.',
        },
        presets: {
            untangle: 'Untangle',
            azure: 'Azure',
            indigo: 'Indigo',
            violet: 'Violet',
            ember: 'Ember',
            graphite: 'Graphite',
        },
    },
};

let wrapper: VueWrapper | null = null;

function mountPicker(): VueWrapper {
    wrapper = mount(AccentPicker, { attachTo: document.body });
    return wrapper;
}

function radio(w: VueWrapper, id: AccentId) {
    return w.get(`[role="radio"][data-accent-id="${id}"]`);
}

/** jsdom/happy-dom report background colours as rgb(); compare in that form. */
function rgb(hex: string): string {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function normaliseColor(value: string): string {
    return value.startsWith('#') ? rgb(value) : value.replace(/\s+/g, ' ');
}

beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    themeSetting.value = 'light';
    setAccent('untangle');
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
});

describe('AccentPicker', () => {
    it('renders a labelled radiogroup with six radios in preset order', () => {
        const w = mountPicker();
        const group = w.get('[role="radiogroup"]');
        const labelId = group.attributes('aria-labelledby');
        expect(labelId).toBeTruthy();
        expect(w.get(`#${labelId}`).text()).toBe('Accent color');

        const radios = w.findAll('[role="radio"]');
        expect(radios.map((r) => r.attributes('aria-label'))).toEqual([
            'Untangle',
            'Azure',
            'Indigo',
            'Violet',
            'Ember',
            'Graphite',
        ]);
    });

    it('fills each swatch with the preset colour for the active mode', async () => {
        const w = mountPicker();
        for (const preset of ACCENT_PRESETS) {
            const style = radio(w, preset.id).attributes('style') ?? '';
            expect(
                normaliseColor(style.replace(/^background-color:\s*/, '').replace(/;$/, ''))
            ).toBe(rgb(preset.swatch.light));
        }

        themeSetting.value = 'dark';
        await nextTick();
        for (const preset of ACCENT_PRESETS) {
            const style = radio(w, preset.id).attributes('style') ?? '';
            expect(
                normaliseColor(style.replace(/^background-color:\s*/, '').replace(/;$/, ''))
            ).toBe(rgb(preset.swatch.dark));
        }
    });

    it('marks only the selected radio as checked, focusable and with a check', () => {
        setAccent('violet');
        const w = mountPicker();
        for (const preset of ACCENT_PRESETS) {
            const r = radio(w, preset.id);
            const selected = preset.id === 'violet';
            expect(r.attributes('aria-checked')).toBe(selected ? 'true' : 'false');
            expect(r.attributes('tabindex')).toBe(selected ? '0' : '-1');
            expect(r.find('[data-testid="accent-check"]').exists()).toBe(selected);
        }
    });

    it('selects on click, swaps the html class and announces the change', async () => {
        const w = mountPicker();
        await radio(w, 'azure').trigger('click');

        expect(activeAccent.value).toBe('azure');
        expect(document.documentElement.classList.contains('accent-azure')).toBe(true);
        expect(document.documentElement.classList.contains('accent-untangle')).toBe(false);
        expect(w.get('[aria-live="polite"]').text()).toBe('Accent color set to Azure.');
    });

    it('moves and selects with arrow keys (wrapping), Home, End and Space', async () => {
        setAccent('graphite');
        const w = mountPicker();

        await radio(w, 'graphite').trigger('keydown', { key: 'ArrowRight' });
        expect(activeAccent.value).toBe('untangle');

        await radio(w, 'untangle').trigger('keydown', { key: 'ArrowLeft' });
        expect(activeAccent.value).toBe('graphite');

        await radio(w, 'graphite').trigger('keydown', { key: 'ArrowUp' });
        expect(activeAccent.value).toBe('ember');

        await radio(w, 'ember').trigger('keydown', { key: 'ArrowDown' });
        expect(activeAccent.value).toBe('graphite');

        await radio(w, 'graphite').trigger('keydown', { key: 'Home' });
        expect(activeAccent.value).toBe('untangle');

        await radio(w, 'untangle').trigger('keydown', { key: 'End' });
        expect(activeAccent.value).toBe('graphite');

        await radio(w, 'indigo').trigger('keydown', { key: ' ' });
        expect(activeAccent.value).toBe('indigo');
        await nextTick();
        expect(document.activeElement).toBe(radio(w, 'indigo').element);
    });

    it('describes the selected preset, marking the default', async () => {
        const w = mountPicker();
        const description = () => w.get('[data-slot="field-description"]').text();
        expect(description()).toBe(
            'Untangle (default). Used for buttons, links and selected items.'
        );

        await radio(w, 'ember').trigger('click');
        expect(description()).toBe('Ember. Used for buttons, links and selected items.');
    });

    it('shows Reset to Untangle only for another preset and resets when clicked', async () => {
        const w = mountPicker();
        expect(w.find('[data-testid="accent-reset"]').exists()).toBe(false);

        await radio(w, 'violet').trigger('click');
        const reset = w.get('[data-testid="accent-reset"]');
        expect(reset.text()).toBe('Reset to Untangle');

        await reset.trigger('click');
        expect(activeAccent.value).toBe('untangle');
        expect(document.documentElement.classList.contains('accent-untangle')).toBe(true);
        expect(w.find('[data-testid="accent-reset"]').exists()).toBe(false);
    });
});
