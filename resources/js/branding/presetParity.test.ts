/**
 * Every list of accent preset ids must stay aligned: the PHP enum (server validation), the TS list
 * (picker and palette), the stylesheet (Untangle baseline plus one block per other preset) and the
 * preset names in the copy. Reads the real shipped files.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACCENT_IDS, DEFAULT_ACCENT } from './accentPresets';
import { readShippedCss } from './sourceFiles';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function readRepoFile(path: string): string {
    return readFileSync(resolve(REPO_ROOT, path), 'utf8');
}

function enumIds(): string[] {
    const php = readRepoFile('app/Appearance/AccentPreset.php');
    return [...php.matchAll(/case \w+ = '([a-z]+)';/g)].map((m) => m[1] as string);
}

function cssIds(): string[] {
    const css = readShippedCss('accent-presets.css');
    const lightBlocks = [...css.matchAll(/html:root\.light\.accent-([a-z]+) \{/g)].map(
        (m) => m[1] as string
    );
    return [DEFAULT_ACCENT, ...lightBlocks];
}

function cssDarkIds(): string[] {
    const css = readShippedCss('accent-presets.css');
    return [...css.matchAll(/html:root\.dark\.accent-([a-z]+) \{/g)].map((m) => m[1] as string);
}

function langPresetKeys(locale: 'en' | 'es'): string[] {
    const php = readRepoFile(`lang/${locale}/branding.php`);
    const block = php.match(/'presets' => \[([\s\S]*?)\]/);
    expect(block, `presets array in lang/${locale}/branding.php`).not.toBeNull();
    return [...(block?.[1] ?? '').matchAll(/'([a-z]+)' =>/g)].map((m) => m[1] as string);
}

describe('accent preset parity', () => {
    it('the PHP enum matches the TS list', () => {
        expect(enumIds()).toEqual([...ACCENT_IDS]);
    });

    it('the stylesheet has the Untangle baseline plus one block per other preset, in order', () => {
        expect(cssIds()).toEqual([...ACCENT_IDS]);
        expect(cssDarkIds()).toEqual(ACCENT_IDS.filter((id) => id !== DEFAULT_ACCENT));
    });

    it('the copy names every preset, in order', () => {
        expect(langPresetKeys('en')).toEqual([...ACCENT_IDS]);
        expect(langPresetKeys('es')).toEqual([...ACCENT_IDS]);
    });
});
