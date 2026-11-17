<?php

declare(strict_types=1);

namespace App\Appearance;

/**
 * The accent color presets a user can pick. The ids are stored in user_appearance_settings.accent and
 * shared with the frontend, which maps each id to its palette. Untangle is the default.
 */
enum AccentPreset: string
{
    case Untangle = 'untangle';
    case Azure = 'azure';
    case Indigo = 'indigo';
    case Violet = 'violet';
    case Ember = 'ember';
    case Graphite = 'graphite';

    /**
     * The preset ids in display order.
     *
     * @return list<string>
     */
    public static function values(): array
    {
        return array_map(static fn (self $preset): string => $preset->value, self::cases());
    }
}
