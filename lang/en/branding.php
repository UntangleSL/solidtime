<?php

declare(strict_types=1);

// Fork-owned copy of the appearance and branding phase (03.2), shared through the `appearance` prop.
return [
    'ui' => [
        'accent_label' => 'Accent color',
        'accent_description' => ':name. Used for buttons, links and selected items.',
        'accent_default_name' => ':name (default)',
        'accent_reset' => 'Reset to Untangle',
        'accent_announcement' => 'Accent color set to :name.',
        'accent_save_failed_title' => "Couldn't save your accent color.",
        'accent_save_failed_body' => 'It is applied on this device only. Try again later.',
        'theme_helper' => 'Follows your device setting. Currently: :mode.',
        'mode_light' => 'light',
        'mode_dark' => 'dark',
        'icon_label' => 'Organization icon',
        'icon_upload' => 'Upload icon',
        'icon_replace' => 'Replace icon',
        'icon_remove' => 'Remove icon',
        'icon_helper' => 'PNG or JPG, up to 1 MB. Square images work best (at least 128 x 128 px).',
        'icon_empty' => 'No icon set. The first letter of the organization name is shown instead.',
        'icon_pending' => 'New icon selected. Save to apply it.',
        'icon_read_only' => 'Only organization owners and admins can change the icon.',
        'icon_error_type' => 'The icon must be a PNG or JPG image.',
        'icon_error_size' => 'The icon must be 1 MB or smaller.',
        'icon_error_generic' => "Couldn't update the organization icon. Try again.",
        'icon_removed' => 'Organization icon removed.',
        'icon_alt' => ':name icon',
    ],
    'presets' => [
        'untangle' => 'Untangle',
        'azure' => 'Azure',
        'indigo' => 'Indigo',
        'violet' => 'Violet',
        'ember' => 'Ember',
        'graphite' => 'Graphite',
    ],
    'validation' => [
        'icon_dimensions' => 'The icon must be between 32 and 1024 pixels on each side.',
    ],
];
