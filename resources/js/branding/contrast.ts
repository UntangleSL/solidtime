/**
 * Pure helpers for the BRAND-04 contrast gate (Phase 3.2, D-07): a CSS custom-property block
 * parser, a resolver for the colour syntax the fork stylesheets use (hex, rgb()/rgba() over
 * `R, G, B` triplets, var() with fallbacks, color-mix(in srgb, ...), transparent) and the
 * WCAG 2.x luminance and contrast formulas. No DOM, no dependency.
 */

export type ThemeMode = 'light' | 'dark';

/** Selector (whitespace-collapsed) -> custom property -> value (whitespace-collapsed). */
export type CssBlocks = Map<string, Record<string, string>>;

/** sRGB channels 0..255 (not rounded) and alpha 0..1. */
export interface Rgba {
    r: number;
    g: number;
    b: number;
    a: number;
}

const collapse = (text: string): string => text.trim().replace(/\s+/g, ' ');

export function stripCssComments(css: string): string {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Index of the parenthesis closing the one at `open`. */
function matchingParen(text: string, open: number): number {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') {
            depth--;
            if (depth === 0) return i;
        }
    }
    throw new Error(`Unbalanced parentheses in "${text}"`);
}

/** Splits on `separator` at parenthesis depth 0. */
export function splitTopLevel(text: string, separator = ','): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (const char of text) {
        if (char === '(') depth++;
        if (char === ')') depth--;
        if (char === separator && depth === 0) {
            parts.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    parts.push(current);
    return parts.map((part) => part.trim());
}

/**
 * Parses flat CSS rules into selector -> custom properties. Comments are stripped; rules
 * without custom properties (and @font-face) are skipped; repeated selectors are merged.
 */
export function parseCssBlocks(css: string): CssBlocks {
    const blocks: CssBlocks = new Map();
    for (const match of stripCssComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = collapse(match[1]!);
        if (selector.startsWith('@font-face')) continue;
        const props: Record<string, string> = {};
        for (const declaration of splitTopLevel(match[2]!, ';')) {
            const decl = declaration.match(/^(--[\w-]+)\s*:\s*([\s\S]+)$/);
            if (decl) props[decl[1]!] = collapse(decl[2]!);
        }
        if (Object.keys(props).length === 0) continue;
        blocks.set(selector, { ...(blocks.get(selector) ?? {}), ...props });
    }
    return blocks;
}

/**
 * Tokens in effect for `<html class="<mode> accent-<presetId>">`: the html:root.<mode>
 * baseline (Untangle) overlaid with the html:root.<mode>.accent-<presetId> block, if any.
 */
export function resolveTokens(
    blocks: CssBlocks,
    mode: ThemeMode,
    presetId: string
): Record<string, string> {
    return {
        ...(blocks.get(`html:root.${mode}`) ?? {}),
        ...(blocks.get(`html:root.${mode}.accent-${presetId}`) ?? {}),
    };
}

/** Replaces every var(--x[, fallback]) with the token value, or the fallback when undefined. */
export function expandVars(value: string, tokens: Record<string, string>, depth = 0): string {
    if (depth > 20) throw new Error(`var() recursion too deep in "${value}"`);
    let out = value;
    let start = out.indexOf('var(');
    while (start !== -1) {
        const end = matchingParen(out, start + 3);
        const [name, ...rest] = splitTopLevel(out.slice(start + 4, end));
        const fallback = rest.length > 0 ? rest.join(', ') : undefined;
        const raw = tokens[name!] ?? fallback;
        if (raw === undefined) throw new Error(`Undefined custom property ${name} in "${value}"`);
        const replacement = expandVars(raw, tokens, depth + 1);
        out = out.slice(0, start) + replacement + out.slice(end + 1);
        start = out.indexOf('var(', start + replacement.length);
    }
    return out;
}

function parseNumber(text: string, scale: number): number {
    const trimmed = text.trim();
    if (trimmed.endsWith('%')) return (parseFloat(trimmed) / 100) * scale;
    const value = parseFloat(trimmed);
    if (Number.isNaN(value)) throw new Error(`Not a number: "${text}"`);
    return value;
}

function mixSrgb(first: Rgba, firstWeight: number, second: Rgba, secondWeight: number): Rgba {
    // CSS Color 5: premultiplied interpolation; weights summing under 1 scale the alpha.
    const sum = firstWeight + secondWeight;
    const p1 = firstWeight / sum;
    const p2 = secondWeight / sum;
    const alpha = first.a * p1 + second.a * p2;
    const channel = (c1: number, c2: number) =>
        alpha === 0 ? 0 : (c1 * first.a * p1 + c2 * second.a * p2) / alpha;
    return {
        r: channel(first.r, second.r),
        g: channel(first.g, second.g),
        b: channel(first.b, second.b),
        a: alpha * Math.min(1, sum),
    };
}

/** Parses a colour whose var() references are already expanded. */
export function parseColor(text: string): Rgba {
    const value = collapse(text).toLowerCase();
    if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

    const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
    if (hex) {
        let digits = hex[1]!;
        if (digits.length === 3) digits = [...digits].map((d) => d + d).join('');
        const channel = (i: number) => parseInt(digits.slice(i, i + 2), 16);
        return {
            r: channel(0),
            g: channel(2),
            b: channel(4),
            a: digits.length === 8 ? channel(6) / 255 : 1,
        };
    }

    const rgb = value.match(/^rgba?\((.*)\)$/);
    if (rgb) {
        const args = rgb[1]!
            .replace('/', ',')
            .split(/[\s,]+/)
            .filter((part) => part !== '');
        if (args.length !== 3 && args.length !== 4) throw new Error(`Bad rgb(): "${text}"`);
        return {
            r: parseNumber(args[0]!, 255),
            g: parseNumber(args[1]!, 255),
            b: parseNumber(args[2]!, 255),
            a: args[3] === undefined ? 1 : parseNumber(args[3], 1),
        };
    }

    const mix = value.match(/^color-mix\((.*)\)$/);
    if (mix) {
        const [space, ...components] = splitTopLevel(mix[1]!);
        if (space !== 'in srgb' || components.length !== 2) {
            throw new Error(`Only color-mix(in srgb, A, B) is supported: "${text}"`);
        }
        const parsed = components.map((component) => {
            const weighted = component.match(/^(.*\S)\s+([\d.]+)%$/);
            return weighted
                ? { color: parseColor(weighted[1]!), weight: parseFloat(weighted[2]!) / 100 }
                : { color: parseColor(component), weight: undefined };
        });
        const [a, b] = parsed as [(typeof parsed)[number], (typeof parsed)[number]];
        const wa = a.weight ?? (b.weight === undefined ? 0.5 : 1 - b.weight);
        const wb = b.weight ?? 1 - wa;
        return mixSrgb(a.color, wa, b.color, wb);
    }

    throw new Error(`Unsupported colour syntax: "${text}"`);
}

/** Resolves a token value (or any colour expression) against a token map. */
export function resolveColor(value: string, tokens: Record<string, string>): Rgba {
    return parseColor(expandVars(value, tokens));
}

/** `fg` (possibly translucent) composited in sRGB over an opaque `bg`. */
export function composite(fg: Rgba, bg: Rgba): Rgba {
    const a = fg.a;
    return {
        r: fg.r * a + bg.r * (1 - a),
        g: fg.g * a + bg.g * (1 - a),
        b: fg.b * a + bg.b * (1 - a),
        a: 1,
    };
}

export function withAlpha(color: Rgba, alpha: number): Rgba {
    return { ...color, a: color.a * alpha };
}

/** WCAG 2.x relative luminance of an opaque colour. */
export function relativeLuminance(color: Rgba): number {
    const linear = (channel: number) => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

/** WCAG 2.x contrast ratio; a translucent `fg` is composited over the opaque `bg` first. */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
    if (bg.a < 0.999) throw new Error('contrastRatio needs an opaque background');
    const front = fg.a < 0.999 ? composite(fg, bg) : fg;
    const l1 = relativeLuminance(front);
    const l2 = relativeLuminance(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function toHex(color: Rgba): string {
    const channel = (c: number) =>
        Math.round(Math.min(255, Math.max(0, c)))
            .toString(16)
            .padStart(2, '0');
    return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

/** Formula shape for the drift guard: var() fallbacks removed, whitespace normalised. */
export function normaliseFormula(value: string): string {
    let out = collapse(stripCssComments(value)).toLowerCase();
    let start = out.indexOf('var(');
    while (start !== -1) {
        const end = matchingParen(out, start + 3);
        const [name] = splitTopLevel(out.slice(start + 4, end));
        const replacement = `var(${name})`;
        out = out.slice(0, start) + replacement + out.slice(end + 1);
        start = out.indexOf('var(', start + replacement.length);
    }
    return out
        .replace(/\(\s+/g, '(')
        .replace(/\s+\)/g, ')')
        .replace(/\s*,\s*/g, ', ');
}

export interface CustomPropertyDeclaration {
    name: string;
    value: string;
}

/**
 * Finds custom-property declarations (`--name: value` in CSS, `'--name': 'value'` in a style
 * object) whose name matches `namePattern`. Consumption sites (`var(--name, ...)`,
 * `getPropertyValue('--name')`) are not declarations and are ignored.
 */
export function findCustomPropertyDeclarations(
    source: string,
    namePattern: RegExp
): CustomPropertyDeclaration[] {
    const found: CustomPropertyDeclaration[] = [];
    const text = stripCssComments(source);
    for (const match of text.matchAll(/(?<![\w(-])(['"]?)(--[\w-]+)\1\s*:/g)) {
        const name = match[2]!;
        if (!namePattern.test(name)) continue;
        let i = match.index! + match[0].length;
        while (i < text.length && /\s/.test(text[i]!)) i++;
        let value = '';
        const quote = text[i];
        if (quote === "'" || quote === '"' || quote === '`') {
            const close = text.indexOf(quote, i + 1);
            value = text.slice(i + 1, close === -1 ? undefined : close);
        } else {
            let depth = 0;
            for (; i < text.length; i++) {
                const char = text[i]!;
                if (char === '(') {
                    depth++;
                } else if (char === ')') {
                    if (depth === 0) break; // end of an enclosing call
                    depth--;
                } else if (depth === 0 && /[;},\n]/.test(char)) {
                    break;
                }
                value += char;
            }
        }
        found.push({ name, value: collapse(value) });
    }
    return found;
}
