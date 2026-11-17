/**
 * Accent presets offered to every user (Phase 3.2, D-04). The palette is fixed: no free
 * colour picker. Untangle is first and the default; its scale is the baseline of
 * resources/css/untangle-theme.css, the five others live in resources/css/accent-presets.css
 * as `html:root.<mode>.accent-<id>` blocks.
 *
 * Swatches mirror the stylesheet (light = step 400, dark = step 300); tokens.test.ts asserts
 * they are equal, so changing a scale means regenerating the CSS and updating this list.
 */

export type AccentId = 'untangle' | 'azure' | 'indigo' | 'violet' | 'ember' | 'graphite';

export interface AccentPreset {
    readonly id: AccentId;
    readonly name: string;
    readonly swatch: { readonly light: string; readonly dark: string };
}

export const ACCENT_PRESETS: readonly AccentPreset[] = [
    { id: 'untangle', name: 'Untangle', swatch: { light: '#007C6B', dark: '#00F5D4' } },
    { id: 'azure', name: 'Azure', swatch: { light: '#0474AB', dark: '#73C5FE' } },
    { id: 'indigo', name: 'Indigo', swatch: { light: '#5B61D1', dark: '#AEB9FE' } },
    { id: 'violet', name: 'Violet', swatch: { light: '#954FBA', dark: '#DEA9FE' } },
    { id: 'ember', name: 'Ember', swatch: { light: '#B55000', dark: '#FFA87C' } },
    { id: 'graphite', name: 'Graphite', swatch: { light: '#626F77', dark: '#B1BFC8' } },
];

export const ACCENT_IDS: readonly AccentId[] = ACCENT_PRESETS.map((preset) => preset.id);

export const DEFAULT_ACCENT: AccentId = 'untangle';

export function isAccentId(value: unknown): value is AccentId {
    return typeof value === 'string' && (ACCENT_IDS as readonly string[]).includes(value);
}
