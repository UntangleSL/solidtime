<?php

declare(strict_types=1);

// Spanish copy, prepared for a later locale switch. The app locale stays 'en' (D-18).
return [
    'ui' => [
        'accent_label' => 'Color de acento',
        'accent_description' => ':name. Se usa en botones, enlaces y elementos seleccionados.',
        'accent_default_name' => ':name (predeterminado)',
        'accent_reset' => 'Restablecer a Untangle',
        'accent_announcement' => 'Color de acento: :name.',
        'accent_save_failed_title' => 'No se pudo guardar tu color de acento.',
        'accent_save_failed_body' => 'Se aplica solo en este dispositivo. Inténtalo más tarde.',
        'theme_helper' => 'Sigue el ajuste de tu dispositivo. Ahora: :mode.',
        'mode_light' => 'claro',
        'mode_dark' => 'oscuro',
        'icon_label' => 'Icono de la organización',
        'icon_upload' => 'Subir icono',
        'icon_replace' => 'Cambiar icono',
        'icon_remove' => 'Quitar icono',
        'icon_helper' => 'PNG o JPG, hasta 1 MB. Funcionan mejor las imágenes cuadradas (al menos 128 x 128 px).',
        'icon_empty' => 'Sin icono. Se muestra la primera letra del nombre de la organización.',
        'icon_pending' => 'Icono nuevo seleccionado. Guarda para aplicarlo.',
        'icon_read_only' => 'Solo los propietarios y administradores de la organización pueden cambiar el icono.',
        'icon_error_type' => 'El icono debe ser una imagen PNG o JPG.',
        'icon_error_size' => 'El icono debe pesar 1 MB o menos.',
        'icon_error_generic' => 'No se pudo actualizar el icono de la organización. Inténtalo de nuevo.',
        'icon_removed' => 'Icono de la organización eliminado.',
        'icon_alt' => 'Icono de :name',
    ],
    'presets' => [
        'untangle' => 'Untangle',
        'azure' => 'Azul',
        'indigo' => 'Índigo',
        'violet' => 'Violeta',
        'ember' => 'Brasa',
        'graphite' => 'Grafito',
    ],
    'validation' => [
        'icon_dimensions' => 'El icono debe medir entre 32 y 1024 píxeles por lado.',
    ],
];
