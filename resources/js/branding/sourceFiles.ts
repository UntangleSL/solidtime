/**
 * Test-only helpers (Node): read shipped source files from disk so the branding gates test
 * the real files, never a copy. Not imported by application code.
 *
 * A Vite `?raw` import / `import.meta.glob(..., { query: '?raw' })` is not usable for
 * stylesheets here: Vitest blanks every `.css` module (query included) unless `test.css` is
 * enabled in the shared config. Vite also rewrites `new URL(<template>, import.meta.url)`
 * into an asset lookup, hence the explicit path resolution.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ShippedStylesheet = 'untangle-theme.css' | 'accent-presets.css' | 'app.css';

const JS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CSS_DIR = resolve(JS_DIR, '../css');

export function readShippedCss(file: ShippedStylesheet): string {
    return readFileSync(resolve(CSS_DIR, file), 'utf8');
}

/**
 * Every file under resources/js/<dir> (recursive) whose extension is in `extensions`, keyed
 * by its path relative to resources/js. A missing directory yields an empty map.
 */
export function readSourceTree(dir: string, extensions: string[]): Map<string, string> {
    const root = resolve(JS_DIR, dir);
    const files = new Map<string, string>();
    let entries: string[];
    try {
        entries = readdirSync(root, { recursive: true, encoding: 'utf8' });
    } catch {
        return files;
    }
    for (const entry of entries) {
        if (!extensions.some((ext) => entry.endsWith(ext))) continue;
        const path = resolve(root, entry);
        files.set(relative(JS_DIR, path).replace(/\\/g, '/'), readFileSync(path, 'utf8'));
    }
    return files;
}
