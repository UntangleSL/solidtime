import { describe, expect, it, vi } from 'vitest';
import { createAccentCommands } from './accentCommands';
import { createThemeCommands } from '@/utils/commandPaletteCommands';

describe('createAccentCommands', () => {
    it('returns one command per preset in preset order', () => {
        const commands = createAccentCommands(vi.fn());

        expect(commands.map((c) => c.id)).toEqual([
            'accent-untangle',
            'accent-azure',
            'accent-indigo',
            'accent-violet',
            'accent-ember',
            'accent-graphite',
        ]);
        expect(commands.map((c) => c.label)).toEqual([
            'Accent color: Untangle',
            'Accent color: Azure',
            'Accent color: Indigo',
            'Accent color: Violet',
            'Accent color: Ember',
            'Accent color: Graphite',
        ]);
        for (const command of commands) {
            expect(command.group).toBe('accent');
            expect(command.keywords).toEqual(expect.arrayContaining(['accent', 'color']));
            expect(command.icon).toBeDefined();
        }
        expect(commands[4]?.keywords).toContain('ember');
    });

    it('runs setAccent with the preset id', () => {
        const setAccent = vi.fn();
        const commands = createAccentCommands(setAccent);

        commands.find((c) => c.id === 'accent-ember')?.action();

        expect(setAccent).toHaveBeenCalledTimes(1);
        expect(setAccent).toHaveBeenCalledWith('ember');
    });

    it('orders priorities by preset and below the theme group', () => {
        const priorities = createAccentCommands(vi.fn()).map((c) => c.priority);
        const sorted = [...priorities].sort((a, b) => b - a);
        expect(priorities).toEqual(sorted);
        expect(new Set(priorities).size).toBe(priorities.length);

        const lowestTheme = Math.min(...createThemeCommands(vi.fn()).map((c) => c.priority));
        expect(Math.max(...priorities)).toBeLessThan(lowestTheme);
    });
});
