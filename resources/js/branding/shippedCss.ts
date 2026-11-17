/**
 * Test-only helper (Node): reads a shipped stylesheet from resources/css so the branding
 * gates test the real file, never a copy. Not imported by application code.
 *
 * A Vite `?raw` import is not usable here: Vitest blanks every `.css` module (query
 * included) unless `test.css` is enabled in the shared config, and Vite rewrites
 * `new URL(<template>, import.meta.url)` into an asset lookup.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ShippedStylesheet = 'untangle-theme.css' | 'accent-presets.css' | 'app.css';

const CSS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../css');

export function readShippedCss(file: ShippedStylesheet): string {
    return readFileSync(resolve(CSS_DIR, file), 'utf8');
}
