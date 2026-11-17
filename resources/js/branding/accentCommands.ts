import { Palette } from '@lucide/vue';
import { GROUP_PRIORITIES, type Command } from '@/utils/commandPaletteCommands';
import { ACCENT_PRESETS, type AccentId } from './accentPresets';

/**
 * Command palette entries for the accent presets (Phase 3.2, UI-SPEC "Command palette"): one
 * "Accent color: <Name>" command per preset in the "Accent color" group, below the Theme group.
 * Labels are English like the core command labels.
 */
export function createAccentCommands(setAccent: (id: AccentId) => void): Command[] {
    return ACCENT_PRESETS.map((preset, index) => ({
        id: `accent-${preset.id}`,
        label: `Accent color: ${preset.name}`,
        icon: Palette,
        keywords: ['accent', 'color', 'colour', 'theme', preset.name.toLowerCase()],
        group: 'accent',
        action: () => setAccent(preset.id),
        priority: GROUP_PRIORITIES.accent + (ACCENT_PRESETS.length - index),
    }));
}
