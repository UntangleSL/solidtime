/**
 * BRAND-04 contrast gate (Phase 3.2, D-07). Evaluates every theme x accent combination of the
 * shipped stylesheets (untangle-theme.css + accent-presets.css) against the thresholds of the
 * "Contrast" table of 03.2-UI-SPEC.md. Every case is its own test, named
 * "<preset> <mode>: <role>", so a failure says exactly what broke.
 *
 * Out of the AA promise on purpose (not asserted): the meeting border tint (decorative, the bar
 * is the 3:1 cue), billing-only CTAs (`bg-accent-500 text-white`, unreachable without the
 * Billing extension) and the semantic status colours. The Phase 3 neutral ghost uses neutral
 * tokens only and is covered by the neutral rows.
 */
import { describe, expect, it } from 'vitest';
import chroma from 'chroma-js';
import { colors as projectColors } from '@/packages/ui/src/utils/color';
import { ACCENT_IDS } from './accentPresets';
import {
    composite,
    contrastRatio,
    expandVars,
    findCustomPropertyDeclarations,
    normaliseFormula,
    parseColor,
    parseCssBlocks,
    relativeLuminance,
    resolveColor,
    resolveTokens,
    toHex,
    withAlpha,
    type Rgba,
    type ThemeMode,
} from './contrast';
import { readShippedCss, readSourceTree } from './sourceFiles';

const themeCss = readShippedCss('untangle-theme.css');
const presetsCss = readShippedCss('accent-presets.css');
const blocks = parseCssBlocks(themeCss);
for (const [selector, props] of parseCssBlocks(presetsCss)) {
    blocks.set(selector, { ...(blocks.get(selector) ?? {}), ...props });
}

const MODES: ThemeMode[] = ['light', 'dark'];
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const TEXT = 4.5;
const NON_TEXT = 3.0;

type Tokens = Record<string, string>;
const tokensFor = (mode: ThemeMode, preset: string): Tokens => resolveTokens(blocks, mode, preset);
const token = (tokens: Tokens, name: string): Rgba => resolveColor(`var(${name})`, tokens);
const step = (tokens: Tokens, n: number): Rgba =>
    resolveColor(`rgb(var(--color-accent-${n}))`, tokens);
const fromHex = (hex: string): Rgba => parseColor(hex);

interface Case {
    name: string;
    fg: Rgba;
    bg: Rgba;
    min: number;
}

/** Each case as a [title, case] row; the title carries the measured ratio for the report. */
function rows(cases: Case[]): [string, Case][] {
    return cases.map((c) => [
        `${c.name} >= ${c.min} (measured ${contrastRatio(c.fg, c.bg).toFixed(2)})`,
        c,
    ]);
}

function assertCase(c: Case): void {
    const ratio = contrastRatio(c.fg, c.bg);
    expect(
        ratio,
        `${c.name}: ${ratio.toFixed(2)} < ${c.min} (fg ${toHex(composite(c.fg, c.bg))}, bg ${toHex(c.bg)})`
    ).toBeGreaterThanOrEqual(c.min);
}

describe('contrast helpers', () => {
    const tokens: Tokens = { '--a': '0, 245, 212', '--bg': '#1c1c1c' };

    it('resolves rgb()/rgba() over triplets, var() fallbacks and transparent', () => {
        expect(resolveColor('rgb(var(--a))', tokens)).toEqual({ r: 0, g: 245, b: 212, a: 1 });
        expect(resolveColor('rgba(var(--a), 0.45)', tokens).a).toBeCloseTo(0.45);
        expect(resolveColor('rgb(var(--missing, 2, 187, 166))', tokens)).toEqual({
            r: 2,
            g: 187,
            b: 166,
            a: 1,
        });
        expect(resolveColor('transparent', tokens).a).toBe(0);
        expect(() => expandVars('var(--missing)', tokens)).toThrow();
    });

    it('evaluates color-mix in srgb per channel, keeping the colour over transparent', () => {
        const mixed = resolveColor('color-mix(in srgb, rgb(var(--a)) 20%, var(--bg))', tokens);
        expect(mixed.g).toBeCloseTo(245 * 0.2 + 28 * 0.8);
        const wash = resolveColor('color-mix(in srgb, rgb(var(--a)) 8%, transparent)', tokens);
        expect([wash.r, wash.g, wash.b]).toEqual([0, 245, 212]);
        expect(wash.a).toBeCloseTo(0.08);
    });

    it('implements the WCAG 2.x formulas', () => {
        expect(relativeLuminance(fromHex('#ffffff'))).toBeCloseTo(1);
        expect(contrastRatio(fromHex('#000000'), fromHex('#ffffff'))).toBeCloseTo(21);
        // Brand anchor quoted by the UI-SPEC: text-teal on the light page is 4.97:1.
        expect(contrastRatio(fromHex('#007c6b'), fromHex('#f9fcfd'))).toBeCloseTo(4.97, 1);
        // Same formula as chroma-js.
        expect(contrastRatio(fromHex('#3d4142'), fromHex('#eef4f5'))).toBeCloseTo(
            chroma.contrast('#3d4142', '#eef4f5'),
            2
        );
    });

    it('normalises formulas and finds declarations, not consumption sites', () => {
        expect(
            normaliseFormula('color-mix( in srgb,rgb(var(--x, 1, 2, 3)) 16%,  var(--y,#fff))')
        ).toBe('color-mix(in srgb, rgb(var(--x)) 16%, var(--y))');
        const source = `
            .m365-meeting { --m365-meeting-bg: color-mix(in srgb, rgb(var(--color-accent-500)) 16%,
                var(--color-bg-primary)); background: var(--m365-meeting-bg, red); }
            const style = { '--m365-lane-bg': 'transparent' };
            el.style.getPropertyValue('--m365-meeting-bar');
        `;
        const found = findCustomPropertyDeclarations(source, /^--m365-(meeting|lane)/);
        expect(found.map((d) => d.name)).toEqual(['--m365-meeting-bg', '--m365-lane-bg']);
        expect(normaliseFormula(found[0]!.value)).toBe(
            'color-mix(in srgb, rgb(var(--color-accent-500)) 16%, var(--color-bg-primary))'
        );
    });
});

describe('structure of every preset x mode', () => {
    const presetModes = ACCENT_IDS.flatMap((id) => MODES.map((mode) => [id, mode] as const));

    it.each(presetModes)('%s %s defines all eleven accent steps', (id, mode) => {
        const tokens = tokensFor(mode, id);
        for (const n of STEPS) {
            expect(tokens[`--color-accent-${n}`], `step ${n}`).toMatch(
                /^\d{1,3}, \d{1,3}, \d{1,3}$/
            );
        }
        if (id !== 'untangle') {
            expect(blocks.has(`html:root.${mode}.accent-${id}`)).toBe(true);
        }
    });

    // Known exception, reported to the owner (03.2-01 SUMMARY): the UI-SPEC pins Untangle dark
    // step 300 to the brand teal #00F5D4, which is brighter than its own step 200 (#9CDFD2).
    // Values are never tuned silently, so only that one pair is exempt; every contrast row
    // that uses steps 200 and 300 is still asserted below.
    const BRAND_ANCHOR_EXEMPTION = { id: 'untangle', mode: 'dark', pair: [200, 300] } as const;

    it.each(presetModes)('%s %s darkens monotonically from step 50 to 950', (id, mode) => {
        const tokens = tokensFor(mode, id);
        const luminances = STEPS.map((n) => relativeLuminance(step(tokens, n)));
        for (let i = 1; i < luminances.length; i++) {
            const exempt =
                id === BRAND_ANCHOR_EXEMPTION.id &&
                mode === BRAND_ANCHOR_EXEMPTION.mode &&
                STEPS[i - 1] === BRAND_ANCHOR_EXEMPTION.pair[0] &&
                STEPS[i] === BRAND_ANCHOR_EXEMPTION.pair[1];
            if (exempt) continue;
            expect(luminances[i], `step ${STEPS[i]} vs ${STEPS[i - 1]}`).toBeLessThan(
                luminances[i - 1]!
            );
        }
    });

    it('limits the monotonic exemption to the brand anchor (dark 300 = #00F5D4)', () => {
        const tokens = tokensFor('dark', 'untangle');
        expect(toHex(step(tokens, 300))).toBe('#00f5d4');
        // Step 100 still sits above 300, and 400 below 200, so the scale keeps its roles.
        expect(relativeLuminance(step(tokens, 100))).toBeGreaterThan(
            relativeLuminance(step(tokens, 300))
        );
        expect(relativeLuminance(step(tokens, 400))).toBeLessThan(
            relativeLuminance(step(tokens, 200))
        );
    });

    it('keeps the Untangle anchors (dark 300 = #00F5D4, light 400 = #007C6B)', () => {
        expect(toHex(step(tokensFor('dark', 'untangle'), 300))).toBe('#00f5d4');
        expect(toHex(step(tokensFor('light', 'untangle'), 400))).toBe('#007c6b');
    });

    it('uses no pure white or black in either stylesheet', () => {
        for (const css of [themeCss, presetsCss]) {
            const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
            expect(code).not.toMatch(/#fff(fff)?\b|#000(000)?\b|255, 255, 255|\b0, 0, 0\b/i);
        }
    });
});

function neutralCases(mode: ThemeMode): Case[] {
    const t = tokensFor(mode, 'untangle');
    const surfaces: [string, string][] =
        mode === 'dark'
            ? [
                  ['content', '--color-bg-primary'],
                  ['card', '--color-bg-secondary'],
                  ['elevated', '--color-bg-elevated'],
                  ['hover', '--color-bg-tertiary'],
              ]
            : [
                  ['page', '--color-bg-primary'],
                  ['sidebar', '--color-bg-background'],
                  ['hover', '--color-bg-tertiary'],
              ];
    const cases: Case[] = [];
    for (const text of ['primary', 'secondary', 'tertiary', 'quaternary']) {
        for (const [surface, name] of surfaces) {
            cases.push({
                name: `${mode}: text-${text} on ${surface}`,
                fg: token(t, `--color-text-${text}`),
                bg: token(t, name),
                min: TEXT,
            });
        }
    }
    for (const [surface, name] of [
        ['content', '--color-bg-primary'],
        ['card', '--color-bg-secondary'],
    ] as const) {
        cases.push({
            name: `${mode}: border-quaternary (control boundary) vs ${surface}`,
            fg: token(t, '--color-border-quaternary'),
            bg: token(t, name),
            min: NON_TEXT,
        });
    }
    return cases;
}

describe('neutral ladder', () => {
    it.each(rows(MODES.flatMap(neutralCases)))('%s', (_title, c) => assertCase(c));
});

function lightAccentCases(id: string): Case[] {
    const t = tokensFor('light', id);
    const page = token(t, '--color-bg-primary');
    const surfaces: [string, Rgba][] = [
        ['page', page],
        ['sidebar', token(t, '--color-bg-background')],
        ['hover', token(t, '--color-bg-tertiary')],
    ];
    const onAccent = token(t, '--color-on-accent');
    const p = `${id} light`;
    return [
        ...surfaces.map(([s, bg]) => ({
            name: `${p}: step 400 text on ${s}`,
            fg: step(t, 400),
            bg,
            min: TEXT,
        })),
        {
            name: `${p}: step 400 at 80% (icon) over page`,
            fg: composite(withAlpha(step(t, 400), 0.8), page),
            bg: page,
            min: NON_TEXT,
        },
        ...surfaces.map(([s, bg]) => ({
            name: `${p}: step 500 text on ${s}`,
            fg: step(t, 500),
            bg,
            min: TEXT,
        })),
        { name: `${p}: step 300 graphic vs page`, fg: step(t, 300), bg: page, min: NON_TEXT },
        {
            name: `${p}: on-accent on step 500 (button rest)`,
            fg: onAccent,
            bg: step(t, 500),
            min: TEXT,
        },
        {
            name: `${p}: on-accent on step 600 (button hover)`,
            fg: onAccent,
            bg: step(t, 600),
            min: TEXT,
        },
        {
            name: `${p}: accent foreground (step 800 on step 100)`,
            fg: step(t, 800),
            bg: step(t, 100),
            min: TEXT,
        },
        {
            name: `${p}: step 400 fill vs bg-quaternary track`,
            fg: step(t, 400),
            bg: token(t, '--color-bg-quaternary'),
            min: NON_TEXT,
        },
    ];
}

function darkAccentCases(id: string): Case[] {
    const t = tokensFor('dark', id);
    const surface = {
        sidebar: token(t, '--color-bg-background'),
        content: token(t, '--color-bg-primary'),
        card: token(t, '--color-bg-secondary'),
        hover: token(t, '--color-bg-tertiary'),
        pressed: token(t, '--color-bg-quaternary'),
    };
    const p = `${id} dark`;
    const tint = composite(withAlpha(step(t, 300), 0.2), surface.card);
    return [
        ...(['sidebar', 'content', 'card', 'hover', 'pressed'] as const).map((s) => ({
            name: `${p}: step 300 text on ${s}`,
            fg: step(t, 300),
            bg: surface[s],
            min: TEXT,
        })),
        ...(['sidebar', 'content', 'card', 'hover'] as const).map((s) => ({
            name: `${p}: step 400 text on ${s}`,
            fg: step(t, 400),
            bg: surface[s],
            min: TEXT,
        })),
        { name: `${p}: step 200 on hover`, fg: step(t, 200), bg: surface.hover, min: TEXT },
        ...(['card', 'hover'] as const).map((s) => ({
            name: `${p}: step 500 (switch, ring) vs ${s}`,
            fg: step(t, 500),
            bg: surface[s],
            min: NON_TEXT,
        })),
        {
            name: `${p}: text-primary on step 300 at 20% over card (button hover)`,
            fg: token(t, '--color-text-primary'),
            bg: tint,
            min: TEXT,
        },
        {
            name: `${p}: accent foreground (step 100 on step 300 at 20% over card)`,
            fg: step(t, 100),
            bg: tint,
            min: TEXT,
        },
    ];
}

describe('accent rows per preset', () => {
    it.each(rows(ACCENT_IDS.flatMap(lightAccentCases)))('%s', (_title, c) => assertCase(c));
    it.each(rows(ACCENT_IDS.flatMap(darkAccentCases)))('%s', (_title, c) => assertCase(c));
});

function solidCases(id: string, mode: ThemeMode): Case[] {
    const t = tokensFor(mode, id);
    const onAccent = token(t, '--color-on-accent');
    const swatchStep = mode === 'light' ? 400 : 300;
    const p = `${id} ${mode}`;
    return [
        {
            name: `${p}: on-accent on accent-solid`,
            fg: onAccent,
            bg: token(t, '--theme-color-accent-solid'),
            min: TEXT,
        },
        {
            name: `${p}: on-accent on accent-solid-hover`,
            fg: onAccent,
            bg: token(t, '--theme-color-accent-solid-hover'),
            min: TEXT,
        },
        {
            name: `${p}: selected-swatch check on the swatch (step ${swatchStep})`,
            fg: onAccent,
            bg: step(t, swatchStep),
            min: TEXT,
        },
    ];
}

describe('solid accent and swatch check', () => {
    const cases = ACCENT_IDS.flatMap((id) => MODES.flatMap((mode) => solidCases(id, mode)));
    it.each(rows(cases))('%s', (_title, c) => assertCase(c));
});

const EXTREME_PROJECT_COLOURS = ['#000000', '#FFFFFF', '#FACC15', '#1E3A8A', '#00F5D4', '#6B7280'];
const BREAK_COLOUR = '#F59E0B';

function timeEntryCases(mode: ThemeMode): Case[] {
    const t = tokensFor(mode, 'untangle');
    // The calendar's own algorithm (useCalendarEvents.ts), stated as the UI-SPEC contract.
    const background = t['--color-bg-background']!;
    const text = token(t, '--color-text-primary');
    const entries: [string, number][] = [
        ...[...projectColors, ...EXTREME_PROJECT_COLOURS].map(
            (hex) => [hex, 0.65] as [string, number]
        ),
        [BREAK_COLOUR, 0.75],
    ];
    return entries.flatMap(([hex, ratio]) => {
        const fill = fromHex(chroma.mix(hex, background, ratio, 'lab').hex());
        const label = `${mode}: time entry ${hex}${hex === BREAK_COLOUR ? ' (break)' : ''}`;
        return [
            { name: `${label}, text-primary`, fg: text, bg: fill, min: TEXT },
            {
                name: `${label}, text-primary at 85%`,
                fg: withAlpha(text, 0.85),
                bg: fill,
                min: TEXT,
            },
        ];
    });
}

describe('calendar time entries over every project colour', () => {
    it.each(rows(MODES.flatMap(timeEntryCases)))('%s', (_title, c) => assertCase(c));
});

function meetingCases(id: string, mode: ThemeMode): Case[] {
    const t = tokensFor(mode, id);
    const grid = token(t, '--color-bg-primary');
    const fill = token(t, '--m365-meeting-bg');
    const hover = token(t, '--m365-meeting-bg-hover');
    const dismissed = token(t, '--m365-meeting-bg-dismissed');
    const bar = token(t, '--m365-meeting-bar');
    const lane = composite(token(t, '--m365-lane-bg'), grid);
    const subject = token(t, '--m365-meeting-text');
    const meta = token(t, '--m365-meeting-text-2');
    const tertiary = token(t, '--color-text-tertiary');
    const ring = step(t, mode === 'light' ? 700 : 200);
    const p = `${id} ${mode}: meeting`;
    return [
        { name: `${p} subject on fill`, fg: subject, bg: fill, min: TEXT },
        { name: `${p} subject on hover fill`, fg: subject, bg: hover, min: TEXT },
        { name: `${p} time/organizer on fill`, fg: meta, bg: fill, min: TEXT },
        { name: `${p} time/organizer on hover fill`, fg: meta, bg: hover, min: TEXT },
        { name: `${p} dismissed text-secondary`, fg: meta, bg: dismissed, min: TEXT },
        { name: `${p} dismissed text-tertiary`, fg: tertiary, bg: dismissed, min: TEXT },
        { name: `${p} bar vs fill`, fg: bar, bg: fill, min: NON_TEXT },
        { name: `${p} bar vs plain grid`, fg: bar, bg: grid, min: NON_TEXT },
        { name: `${p} bar vs lane wash`, fg: bar, bg: lane, min: NON_TEXT },
        { name: `${p} open ring vs hover fill`, fg: ring, bg: hover, min: NON_TEXT },
        { name: `${p} dismissed dotted border vs grid`, fg: tertiary, bg: grid, min: NON_TEXT },
        ...projectDotRingCases(t, p, fill, hover, mode),
    ];
}

/**
 * Phase 5 project dot (OutlookProjectDot): its 1px --color-text-tertiary ring keeps a 3:1 boundary
 * whatever the project colour (a teal project on the teal Untangle tint included), on the meeting
 * fill, the hover fill and the popover surface (hover card, panel, menus): --color-bg-elevated in
 * dark, the page --color-bg-primary in light (--popover in packages/ui/styles.css).
 */
function projectDotRingCases(
    t: Tokens,
    p: string,
    fill: Rgba,
    hover: Rgba,
    mode: ThemeMode
): Case[] {
    const ring = token(t, '--color-text-tertiary');
    const popover = token(t, mode === 'dark' ? '--color-bg-elevated' : '--color-bg-primary');
    return [
        { name: `${p} project dot ring vs fill`, fg: ring, bg: fill, min: NON_TEXT },
        { name: `${p} project dot ring vs hover fill`, fg: ring, bg: hover, min: NON_TEXT },
        { name: `${p} project dot ring vs popover`, fg: ring, bg: popover, min: NON_TEXT },
    ];
}

describe('Outlook meeting blocks (--m365-* formulas, Phase 3.1 style)', () => {
    const cases = ACCENT_IDS.flatMap((id) => MODES.flatMap((mode) => meetingCases(id, mode)));
    it.each(rows(cases))('%s', (_title, c) => assertCase(c));
});

/**
 * Phase 6 out-of-sync warning (06-UI-SPEC "Color"). The marker is a self-contained TriangleAlert:
 * its stroke sits on its own fill, so it reads on any project colour. The toolbar counter icon
 * sits on the outline button over the page. Hex values are the Tailwind 3.4 amber palette
 * constants, listed only for this test (markup uses the class names).
 */
const AMBER = {
    100: '#FEF3C7',
    300: '#FCD34D',
    400: '#FBBF24',
    700: '#B45309',
    950: '#451A03',
} as const;
const LIGHT_TOOLBAR = '#F9FCFD';
const DARK_TOOLBAR = '#1C1C1C';

describe('Phase 6 out-of-sync warning colours', () => {
    const cases: Case[] = [
        {
            name: 'light: marker stroke amber-700 on marker fill amber-100',
            fg: fromHex(AMBER[700]),
            bg: fromHex(AMBER[100]),
            min: NON_TEXT,
        },
        {
            name: 'dark: marker stroke amber-300 on marker fill amber-950',
            fg: fromHex(AMBER[300]),
            bg: fromHex(AMBER[950]),
            min: NON_TEXT,
        },
        {
            name: `light: counter icon amber-700 on the toolbar (${LIGHT_TOOLBAR})`,
            fg: fromHex(AMBER[700]),
            bg: fromHex(LIGHT_TOOLBAR),
            min: NON_TEXT,
        },
        {
            name: `dark: counter icon amber-400 on the toolbar (${DARK_TOOLBAR})`,
            fg: fromHex(AMBER[400]),
            bg: fromHex(DARK_TOOLBAR),
            min: NON_TEXT,
        },
    ];
    it.each(rows(cases))('%s', (_title, c) => assertCase(c));

    it('the toolbar backgrounds are the shipped page colours', () => {
        expect(toHex(token(tokensFor('light', 'untangle'), '--color-bg-primary'))).toBe(
            LIGHT_TOOLBAR.toLowerCase()
        );
        expect(toHex(token(tokensFor('dark', 'untangle'), '--color-bg-primary'))).toBe(
            DARK_TOOLBAR.toLowerCase()
        );
    });
});

describe('3.1 / 3.2 formula drift guard (resources/js/m365/calendar)', () => {
    const MEETING_PROPERTY = /^--m365-(meeting|lane)(-|$)/;
    // Read only: 3.2 never edits the Phase 3.1 calendar files.
    const sources = readSourceTree('m365/calendar', ['.vue', '.ts', '.css']);
    const ours: Record<ThemeMode, Tokens> = {
        light: blocks.get('html:root.light') ?? {},
        dark: blocks.get('html:root.dark') ?? {},
    };

    it('scans the Outlook calendar sources', () => {
        expect(sources.size).toBeGreaterThan(0);
    });

    it('every --m365-meeting/lane declaration there equals our light or dark formula', () => {
        const drift: string[] = [];
        for (const [file, source] of sources) {
            for (const { name, value } of findCustomPropertyDeclarations(
                source,
                MEETING_PROPERTY
            )) {
                // Dynamic bindings (a JS identifier as value) carry no formula to compare.
                if (!/[(#]|^transparent$/i.test(value)) continue;
                const candidates = MODES.map((mode) => ours[mode][name])
                    .filter((v): v is string => v !== undefined)
                    .map(normaliseFormula);
                if (candidates.length === 0) {
                    drift.push(`${file}: ${name} is not declared by untangle-theme.css`);
                } else if (!candidates.includes(normaliseFormula(value))) {
                    drift.push(`${file}: ${name}: ${value}`);
                }
            }
        }
        expect(drift).toEqual([]);
    });
});
