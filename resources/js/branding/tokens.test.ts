import { describe, expect, it } from 'vitest';
import chroma from 'chroma-js';
import { readShippedCss } from './shippedCss';

const themeCss = readShippedCss('untangle-theme.css');
const appCss = readShippedCss('app.css');

type Blocks = Map<string, Record<string, string>>;

/** Minimal block parser (selector -> custom properties); comments stripped. */
function parseBlocks(css: string): Blocks {
    const blocks: Blocks = new Map();
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1]!.trim().replace(/\s+/g, ' ');
        const props: Record<string, string> = {};
        for (const decl of match[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
            props[decl[1]!] = decl[2]!.trim().replace(/\s+/g, ' ');
        }
        if (Object.keys(props).length === 0) continue;
        blocks.set(selector, { ...(blocks.get(selector) ?? {}), ...props });
    }
    return blocks;
}

const blocks = parseBlocks(themeCss);
const dark = blocks.get('html:root.dark') ?? {};
const light = blocks.get('html:root.light') ?? {};
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

const DARK_LADDER: Record<string, string> = {
    '--color-bg-background': '#141414',
    '--color-bg-primary': '#1C1C1C',
    '--color-bg-secondary': '#262626',
    '--color-bg-elevated': '#2C2C2C',
    '--color-bg-tertiary': '#303030',
    '--color-bg-quaternary': '#3A3A3A',
    '--color-text-primary': '#F9FCFD',
    '--color-text-secondary': '#D9DCDD',
    '--color-text-tertiary': '#ABAEAE',
    '--color-text-quaternary': '#959898',
    '--color-border-primary': '#2F2F2F',
    '--color-border-secondary': '#373838',
    '--color-border-tertiary': '#444546',
    '--color-border-quaternary': '#6F7272',
    '--color-input-border-active': 'rgba(249, 252, 253, 0.45)',
    '--theme-color-ring': 'rgba(249, 252, 253, 0.55)',
    '--theme-color-default-background': 'var(--color-bg-primary)',
};

const LIGHT_LADDER: Record<string, string> = {
    '--color-bg-background': '#EEF4F5',
    '--color-bg-primary': '#F9FCFD',
    '--color-bg-secondary': '#F9FCFD',
    '--color-bg-tertiary': '#EDF3F4',
    '--color-bg-quaternary': '#DDE5E6',
    '--color-text-primary': '#1C1C1C',
    '--color-text-secondary': '#3D4142',
    '--color-text-tertiary': '#565B5C',
    '--color-text-quaternary': '#646A6B',
    '--color-border-primary': '#E6ECED',
    '--color-border-secondary': '#DDDDDD',
    '--color-border-tertiary': '#D2D9DA',
    '--color-border-quaternary': '#8B9091',
    '--color-input-border-active': 'rgba(28, 28, 28, 0.6)',
    '--theme-color-ring': 'rgba(28, 28, 28, 0.75)',
    '--theme-color-default-background': '#F9FCFD',
};

const MEETING_COLOUR_PROPS = [
    '--m365-meeting-bg',
    '--m365-meeting-bg-hover',
    '--m365-meeting-bg-dismissed',
    '--m365-meeting-border',
    '--m365-meeting-bar',
    '--m365-lane-bg',
];
const MEETING_PROPS = [...MEETING_COLOUR_PROPS, '--m365-meeting-text', '--m365-meeting-text-2'];

function lines(css: string): string[] {
    return css.split(/\r?\n/);
}

describe('untangle-theme.css (BRAND-01)', () => {
    it('dark mode carries the Untangle neutral ladder', () => {
        for (const [token, value] of Object.entries(DARK_LADDER)) {
            expect(dark[token]?.toLowerCase(), token).toBe(value.toLowerCase());
        }
    });

    it('light mode carries the Untangle neutral ladder', () => {
        for (const [token, value] of Object.entries(LIGHT_LADDER)) {
            expect(light[token]?.toLowerCase(), token).toBe(value.toLowerCase());
        }
        // --color-bg-elevated is dark-only (light falls back to secondary).
        expect(light['--color-bg-elevated']).toBeUndefined();
    });

    it('both modes carry the eleven-step Untangle baseline scale with the brand anchors', () => {
        for (const props of [dark, light]) {
            for (const step of STEPS) {
                expect(props[`--color-accent-${step}`], `step ${step}`).toMatch(
                    /^\d{1,3}, \d{1,3}, \d{1,3}$/
                );
            }
        }
        expect(dark['--color-accent-300']).toBe('0, 245, 212');
        expect(light['--color-accent-400']).toBe('0, 124, 107');
    });

    it('declares the new accent tokens and the Outlook meeting properties in both modes', () => {
        for (const props of [dark, light]) {
            for (const token of [
                '--color-on-accent',
                '--theme-color-accent-solid',
                '--theme-color-accent-solid-hover',
                ...MEETING_PROPS,
            ]) {
                expect(props[token], token).toBeTruthy();
            }
            for (const token of MEETING_COLOUR_PROPS) {
                const vars = [...props[token]!.matchAll(/var\(([^()]*)\)/g)].map((m) => m[1]!);
                expect(vars.length, token).toBeGreaterThan(0);
                for (const inner of vars) {
                    expect(inner, `${token} var() without a literal fallback`).toContain(',');
                }
            }
        }
        expect(dark['--m365-meeting-text']).toBe('var(--color-text-primary)');
        expect(light['--m365-meeting-text-2']).toBe('var(--color-text-secondary)');
    });

    it('scopes every block to html:root.<mode> and never uses pure white or black', () => {
        expect(blocks.size).toBeGreaterThan(0);
        for (const selector of blocks.keys()) {
            expect(selector).toMatch(/^html:root\.(light|dark)\b/);
        }
        const code = themeCss.replace(/\/\*[\s\S]*?\*\//g, '');
        expect(code).not.toMatch(/#fff(fff)?\b|#000(000)?\b|255, 255, 255|\b0, 0, 0\b/i);
        for (const props of [dark, light]) {
            for (const token of ['--color-bg-background', '--color-bg-primary']) {
                expect(props[token], token).toMatch(/^#[0-9a-f]{6}$/i);
                expect(chroma.valid(props[token]!), token).toBe(true);
            }
        }
    });

    it('is imported right after styles.css and ships no Syne (owner override D-10)', () => {
        const appLines = lines(appCss).map((l) => l.trim());
        const stylesIdx = appLines.indexOf("@import '../js/packages/ui/styles.css';");
        const themeIdx = appLines.indexOf("@import './untangle-theme.css';");
        const fontFaceIdx = appLines.findIndex((l) => l.startsWith('@font-face'));
        expect(stylesIdx).toBeGreaterThanOrEqual(0);
        expect(themeIdx).toBe(stylesIdx + 1);
        expect(fontFaceIdx).toBeGreaterThan(themeIdx);
        expect(themeCss).not.toMatch(/@font-face/);
        expect(themeCss).not.toMatch(/syne/i);
        expect(appCss).not.toMatch(/syne/i);
    });
});
