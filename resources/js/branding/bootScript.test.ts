/**
 * Executes the pre-paint script exactly as shipped in
 * resources/views/branding/early-theme.blade.php (never a copy) under stubbed matchMedia and
 * localStorage, and checks that its theme resolution equals resources/js/utils/theme.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Preference = 'light' | 'dark' | 'none';
type Payload = { theme?: unknown; accent?: unknown; accents?: unknown };

declare global {
    interface Window {
        __APPEARANCE__?: Payload;
    }
}

const ACCENTS = ['untangle', 'azure', 'indigo', 'violet', 'ember', 'graphite'];
const BLADE_PATH = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../views/branding/early-theme.blade.php'
);
const blade = readFileSync(BLADE_PATH, 'utf8');
const logicMatch = blade.match(/<script data-early-theme>([\s\S]*?)<\/script>/);
const logic: string = logicMatch?.[1] ?? '';

const root = document.documentElement;
let preference: Preference = 'none';
let mediaListeners: Array<(event: { matches: boolean; media: string }) => void> = [];
let windowListeners: Array<[string, EventListenerOrEventListenerObject]> = [];

function queryMatches(query: string): boolean {
    if (query.includes('light')) return preference === 'light';
    if (query.includes('dark')) return preference === 'dark';
    return false;
}

function stubMatchMedia(): void {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: (query: string) => ({
            media: query,
            get matches() {
                return queryMatches(query);
            },
            onchange: null,
            addEventListener: (_type: string, listener: (typeof mediaListeners)[number]) => {
                mediaListeners.push(listener);
            },
            removeEventListener: () => undefined,
            addListener: (listener: (typeof mediaListeners)[number]) => {
                mediaListeners.push(listener);
            },
            removeListener: () => undefined,
            dispatchEvent: () => true,
        }),
    });
}

function setPreference(next: Preference): void {
    preference = next;
    for (const listener of mediaListeners) {
        listener({ matches: next === 'light', media: '(prefers-color-scheme: light)' });
    }
}

function runScript(payload: Payload = { theme: null, accent: null, accents: ACCENTS }): void {
    window.__APPEARANCE__ = payload;
    // Track the listeners the script adds so every case starts clean.
    const original = window.addEventListener.bind(window);
    const spy = vi
        .spyOn(window, 'addEventListener')
        .mockImplementation(
            (
                type: string,
                listener: EventListenerOrEventListenerObject,
                options?: boolean | AddEventListenerOptions
            ) => {
                windowListeners.push([type, listener]);
                original(type, listener, options);
            }
        );
    try {
        new Function(logic)();
    } finally {
        spy.mockRestore();
    }
}

function modeClasses(): string[] {
    return ['light', 'dark'].filter((mode) => root.classList.contains(mode));
}

function accentClasses(): string[] {
    return Array.from(root.classList).filter((name) => name.startsWith('accent-'));
}

function dispatchStorage(key: string, newValue: string | null): void {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
}

beforeEach(() => {
    root.className = '';
    localStorage.clear();
    preference = 'none';
    mediaListeners = [];
    stubMatchMedia();
});

afterEach(() => {
    for (const [type, listener] of windowListeners) {
        window.removeEventListener(type, listener);
    }
    windowListeners = [];
    delete window.__APPEARANCE__;
    vi.restoreAllMocks();
});

describe('shipped early-theme script', () => {
    it('is found in the Blade partial, contains no Blade expression and follows the payload', () => {
        expect(logic.trim().length).toBeGreaterThan(0);
        expect(logic).not.toContain('{{');
        expect(logic).not.toMatch(/@[a-z]+\(/);
        expect(blade.indexOf('window.__APPEARANCE__ =')).toBeLessThan(
            blade.indexOf('<script data-early-theme>')
        );
        expect(blade).not.toContain('Syne');
    });

    it('prefers the server values over localStorage and stores them', () => {
        localStorage.setItem('theme', 'light');
        localStorage.setItem('accent', 'azure');

        runScript({ theme: 'dark', accent: 'violet', accents: ACCENTS });

        expect(modeClasses()).toEqual(['dark']);
        expect(accentClasses()).toEqual(['accent-violet']);
        expect(localStorage.getItem('theme')).toBe('dark');
        expect(localStorage.getItem('accent')).toBe('violet');
    });

    it('keeps the stored values and does not overwrite them while a save is pending', () => {
        // Last page: picked light + ember, reloaded before the save reached the server.
        localStorage.setItem('theme', 'light');
        localStorage.setItem('accent', 'ember');
        localStorage.setItem('appearance-pending', '1');

        runScript({ theme: 'dark', accent: 'violet', accents: ACCENTS });

        expect(modeClasses()).toEqual(['light']);
        expect(accentClasses()).toEqual(['accent-ember']);
        expect(localStorage.getItem('theme')).toBe('light');
        expect(localStorage.getItem('accent')).toBe('ember');
        expect(localStorage.getItem('appearance-pending')).toBe('1');
    });

    it('uses the server value for a key with no valid stored value while a save is pending', () => {
        localStorage.setItem('theme', 'light');
        localStorage.setItem('accent', 'rose');
        localStorage.setItem('appearance-pending', '1');

        runScript({ theme: 'dark', accent: 'violet', accents: ACCENTS });

        expect(modeClasses()).toEqual(['light']);
        expect(accentClasses()).toEqual(['accent-violet']);
        expect(localStorage.getItem('theme')).toBe('light');
        expect(localStorage.getItem('accent')).toBe('violet');
    });

    it('lets the server win again once no save is pending (change made on another device)', () => {
        localStorage.setItem('theme', 'light');
        localStorage.setItem('accent', 'ember');

        runScript({ theme: 'dark', accent: 'violet', accents: ACCENTS });

        expect(modeClasses()).toEqual(['dark']);
        expect(accentClasses()).toEqual(['accent-violet']);
        expect(localStorage.getItem('theme')).toBe('dark');
        expect(localStorage.getItem('accent')).toBe('violet');
        expect(localStorage.getItem('appearance-pending')).toBeNull();
    });

    it('falls back to localStorage when the server has no value', () => {
        localStorage.setItem('theme', 'light');
        localStorage.setItem('accent', 'ember');

        runScript();

        expect(modeClasses()).toEqual(['light']);
        expect(accentClasses()).toEqual(['accent-ember']);
    });

    it('uses system and untangle when nothing is stored: light preference gives light', () => {
        preference = 'light';

        runScript();

        expect(modeClasses()).toEqual(['light']);
        expect(accentClasses()).toEqual(['accent-untangle']);
        expect(localStorage.getItem('theme')).toBeNull();
        expect(localStorage.getItem('accent')).toBeNull();
    });

    it('resolves system to dark with a dark preference', () => {
        preference = 'dark';

        runScript();

        expect(modeClasses()).toEqual(['dark']);
    });

    it('resolves system to dark when the OS gives no preference (D-02)', () => {
        preference = 'none';

        runScript();

        expect(modeClasses()).toEqual(['dark']);
        expect(accentClasses()).toEqual(['accent-untangle']);
    });

    it('ignores unknown stored values', () => {
        preference = 'light';
        localStorage.setItem('theme', 'blue');
        localStorage.setItem('accent', 'rose');

        runScript();

        expect(modeClasses()).toEqual(['light']);
        expect(accentClasses()).toEqual(['accent-untangle']);
    });

    it('ignores unknown server values and never stores them', () => {
        localStorage.setItem('theme', 'dark');
        localStorage.setItem('accent', 'indigo');

        runScript({ theme: 'blue', accent: 'rose', accents: ACCENTS });

        expect(modeClasses()).toEqual(['dark']);
        expect(accentClasses()).toEqual(['accent-indigo']);
        expect(root.classList.contains('accent-rose')).toBe(false);
        expect(localStorage.getItem('theme')).toBe('dark');
        expect(localStorage.getItem('accent')).toBe('indigo');
    });

    it('applies the defaults when localStorage methods throw', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });

        expect(() => runScript({ theme: null, accent: 'violet', accents: ACCENTS })).not.toThrow();

        expect(modeClasses()).toEqual(['dark']);
        expect(accentClasses()).toEqual(['accent-violet']);
    });

    it('applies the defaults when reading window.localStorage itself throws', () => {
        const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            get: () => {
                throw new Error('SecurityError');
            },
        });
        try {
            preference = 'light';
            expect(() => runScript()).not.toThrow();
            expect(modeClasses()).toEqual(['light']);
            expect(accentClasses()).toEqual(['accent-untangle']);
        } finally {
            if (descriptor) {
                Object.defineProperty(window, 'localStorage', descriptor);
            } else {
                delete (window as { localStorage?: Storage }).localStorage;
            }
        }
    });

    it('applies dark without throwing when matchMedia is missing', () => {
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            writable: true,
            value: undefined,
        });

        expect(() => runScript()).not.toThrow();

        expect(modeClasses()).toEqual(['dark']);
    });

    it('replaces mode and accent classes and keeps unrelated classes', () => {
        root.className = 'light accent-azure keep-me';

        runScript({ theme: 'dark', accent: 'graphite', accents: ACCENTS });

        expect(modeClasses()).toEqual(['dark']);
        expect(accentClasses()).toEqual(['accent-graphite']);
        expect(root.classList.contains('keep-me')).toBe(true);
        expect(root.classList.length).toBe(3);
    });

    it('follows a theme change made in another tab', () => {
        runScript({ theme: 'dark', accent: 'violet', accents: ACCENTS });

        localStorage.setItem('theme', 'light');
        dispatchStorage('theme', 'light');

        expect(modeClasses()).toEqual(['light']);
        expect(accentClasses()).toEqual(['accent-violet']);
    });

    it('follows an accent change made in another tab and leaves one accent class', () => {
        runScript({ theme: 'dark', accent: 'violet', accents: ACCENTS });

        localStorage.setItem('accent', 'graphite');
        dispatchStorage('accent', 'graphite');

        expect(accentClasses()).toEqual(['accent-graphite']);
        expect(modeClasses()).toEqual(['dark']);
    });

    it('ignores storage events for other keys', () => {
        runScript({ theme: 'dark', accent: 'violet', accents: ACCENTS });

        localStorage.setItem('theme', 'light');
        dispatchStorage('something-else', 'x');

        expect(modeClasses()).toEqual(['dark']);
    });

    it('follows the system colour scheme while the setting is system', () => {
        preference = 'light';
        runScript();
        expect(modeClasses()).toEqual(['light']);

        setPreference('dark');
        expect(modeClasses()).toEqual(['dark']);

        setPreference('light');
        expect(modeClasses()).toEqual(['light']);
    });

    it('does not follow the system colour scheme when the setting is dark', () => {
        preference = 'dark';
        localStorage.setItem('theme', 'dark');
        runScript();
        expect(modeClasses()).toEqual(['dark']);

        setPreference('light');

        expect(modeClasses()).toEqual(['dark']);
    });
});

describe('drift guard: the script resolves the theme exactly like theme.ts', () => {
    const settings = ['system', 'light', 'dark'] as const;
    const preferences: Preference[] = ['light', 'dark', 'none'];
    const cases = settings.flatMap((setting) =>
        preferences.map((pref) => [setting, pref] as const)
    );

    it.each(cases)('setting %s with preference %s', async (setting, pref) => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        preference = pref;
        localStorage.setItem('theme', setting);

        runScript();
        const fromScript = modeClasses();

        vi.resetModules();
        const { theme } = await import('@/utils/theme');

        expect(fromScript).toEqual([theme.value]);
    });
});
