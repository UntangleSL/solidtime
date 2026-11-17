import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppearanceProps, BrandingLabels } from './appearanceProps';
import { formatLabel, useAppearanceProps } from './appearanceProps';

const { pageProps } = vi.hoisted(() => ({
    pageProps: {} as Record<string, unknown>,
}));

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => ({ props: pageProps }),
}));

const LABEL_KEYS: (keyof BrandingLabels)[] = [
    'accent_label',
    'accent_description',
    'accent_default_name',
    'accent_reset',
    'accent_announcement',
    'accent_save_failed_title',
    'accent_save_failed_body',
    'theme_helper',
    'mode_light',
    'mode_dark',
    'icon_label',
    'icon_upload',
    'icon_replace',
    'icon_remove',
    'icon_helper',
    'icon_empty',
    'icon_pending',
    'icon_read_only',
    'icon_error_type',
    'icon_error_size',
    'icon_error_generic',
    'icon_removed',
    'icon_alt',
];

function labels(): BrandingLabels {
    const result = {} as BrandingLabels;
    for (const key of LABEL_KEYS) {
        result[key] = `label ${key}`;
    }
    return result;
}

describe('formatLabel', () => {
    it('replaces a known placeholder', () => {
        expect(formatLabel('Accent color set to :name.', { name: 'Azure' })).toBe(
            'Accent color set to Azure.'
        );
    });

    it('replaces several placeholders and repeated ones', () => {
        expect(formatLabel(':name and :name in :mode', { name: 'Ember', mode: 'dark' })).toBe(
            'Ember and Ember in dark'
        );
    });

    it('keeps unknown placeholders as written', () => {
        expect(formatLabel('Currently: :mode.', { name: 'Azure' })).toBe('Currently: :mode.');
    });

    it('returns a template without placeholders unchanged', () => {
        expect(formatLabel('Reset to Untangle', { name: 'Azure' })).toBe('Reset to Untangle');
    });
});

describe('useAppearanceProps', () => {
    beforeEach(() => {
        for (const key of Object.keys(pageProps)) {
            delete pageProps[key];
        }
    });

    it('returns the page prop when present', () => {
        const appearance: AppearanceProps = {
            theme: 'dark',
            accent: 'violet',
            accents: ['untangle', 'azure', 'indigo', 'violet', 'ember', 'graphite'],
            update_url: 'https://app.example.test/user/appearance',
            labels: labels(),
            presets: { untangle: 'Untangle', ember: 'Ember' },
        };
        pageProps.appearance = appearance;

        const props = useAppearanceProps();

        expect(props.value).toEqual(appearance);
        expect(props.value.org_icons).toBeUndefined();
    });

    it('keeps org_icons when the server sends them', () => {
        pageProps.appearance = {
            theme: null,
            accent: null,
            accents: [],
            update_url: null,
            labels: labels(),
            presets: {},
            org_icons: { 'organization-1': 'https://app.example.test/icon.png' },
        };

        expect(useAppearanceProps().value.org_icons).toEqual({
            'organization-1': 'https://app.example.test/icon.png',
        });
    });

    it('returns safe defaults when the prop is missing', () => {
        const props = useAppearanceProps();

        expect(props.value.theme).toBeNull();
        expect(props.value.accent).toBeNull();
        expect(props.value.accents).toEqual([]);
        expect(props.value.update_url).toBeNull();
        expect(props.value.presets).toEqual({});
        expect(Object.keys(props.value.labels).sort()).toEqual([...LABEL_KEYS].sort());
        for (const key of LABEL_KEYS) {
            expect(props.value.labels[key]).toBe('');
        }
    });

    it('fills labels missing from a partial prop with empty strings', () => {
        pageProps.appearance = { labels: { accent_label: 'Accent color' } };

        const props = useAppearanceProps();

        expect(props.value.labels.accent_label).toBe('Accent color');
        expect(props.value.labels.icon_alt).toBe('');
    });
});
