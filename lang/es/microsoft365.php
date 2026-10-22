<?php

declare(strict_types=1);

// Spanish copy, prepared for a later locale switch. The app locale stays 'en' (D-18).
return [
    'ui' => [
        'sign_in' => 'Iniciar sesión con Microsoft',
        'sign_in_hint' => 'Usa tu cuenta profesional o educativa',
        'section_title' => 'Microsoft 365',
        'section_description' => 'Tu cuenta de trabajo de Microsoft vinculada a solidtime.',
        'connected_as' => 'Conectado como :email',
        'not_connected' => 'No conectado',
        'disconnected_status' => 'Inicio de sesión vinculado. El acceso a los datos de Microsoft está desconectado.',
        'connect' => 'Conectar con Microsoft',
        'disconnect' => 'Desconectar',
        'disconnect_title' => '¿Desconectar Microsoft?',
        'disconnect_body' => 'Se eliminarán los tokens de Microsoft guardados para tu cuenta. Tus registros de tiempo no se ven afectados. Podrás seguir iniciando sesión con Microsoft.',
        'disconnect_body_passwordless' => 'No tienes contraseña, así que el vínculo de inicio de sesión con Microsoft se mantiene y podrás seguir entrando. Para crear una contraseña usa "¿Olvidaste tu contraseña?" en la pantalla de acceso.',
        'cancel' => 'Cancelar',
        'connected_notice' => 'Cuenta de Microsoft conectada.',
        'disconnected_notice' => 'Microsoft desconectado. Tus registros de tiempo no se ven afectados.',
    ],
    'error' => [
        'cancelled' => 'Se ha cancelado el inicio de sesión con Microsoft.',
        'interrupted' => 'El inicio de sesión con Microsoft ha caducado o se ha interrumpido. Inténtalo de nuevo.',
        'wrong_tenant' => 'Esta cuenta de Microsoft no pertenece a la organización de Untangle.',
        'guest' => 'Las cuentas de invitado no pueden iniciar sesión en solidtime.',
        'domain' => 'El dominio de correo de esta cuenta de Microsoft no está permitido.',
        'unverified_account' => 'Ya existe una cuenta con este correo que aún no está verificada. Verifícala con el correo que te enviamos o pide ayuda a un administrador.',
        'already_linked' => 'Esta cuenta de solidtime ya está vinculada a otra cuenta de Microsoft. Pide ayuda a un administrador.',
        'ambiguous_account' => 'Más de una cuenta de solidtime coincide con esta cuenta de Microsoft. Pide ayuda a un administrador.',
        'provisioning_unavailable' => 'Tu cuenta aún no existe y la creación automática no está configurada. Pide ayuda a un administrador.',
        'identity_in_use' => 'Esta cuenta de Microsoft ya está vinculada a otro usuario de solidtime. Pide ayuda a un administrador.',
        'generic' => 'No hemos podido iniciar sesión con Microsoft. Inténtalo de nuevo o usa tu correo y contraseña.',
    ],
];
