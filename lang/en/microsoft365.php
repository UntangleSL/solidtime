<?php

declare(strict_types=1);

return [
    'ui' => [
        'sign_in' => 'Sign in with Microsoft',
        'sign_in_hint' => 'Use your work or school account',
        'section_title' => 'Microsoft 365',
        'section_description' => 'Your Microsoft work account linked to solidtime.',
        'connected_as' => 'Connected as :email',
        'not_connected' => 'Not connected',
        'disconnected_status' => 'Sign-in linked. Microsoft data access is disconnected.',
        'connect' => 'Connect Microsoft',
        'disconnect' => 'Disconnect',
        'disconnect_title' => 'Disconnect Microsoft?',
        'disconnect_body' => 'This removes the Microsoft tokens stored for your account. Your time entries are not affected. You can still sign in with Microsoft.',
        'disconnect_body_passwordless' => 'You have no password, so your Microsoft sign-in link stays and you can still log in. To set a password, use "Forgot your password?" on the login page.',
        'cancel' => 'Cancel',
        'connected_notice' => 'Microsoft account connected.',
        'disconnected_notice' => 'Microsoft disconnected. Your time entries are not affected.',
    ],
    'error' => [
        'cancelled' => 'Microsoft sign-in was cancelled.',
        'interrupted' => 'The Microsoft sign-in expired or was interrupted. Please try again.',
        'wrong_tenant' => 'This Microsoft account does not belong to the Untangle organization.',
        'guest' => 'Guest accounts cannot sign in to solidtime.',
        'domain' => 'The email domain of this Microsoft account is not allowed.',
        'unverified_account' => 'An account with this email already exists but is not verified. Verify it with the email we sent you, or ask an administrator.',
        'already_linked' => 'This solidtime account is already linked to a different Microsoft account. Ask an administrator.',
        'ambiguous_account' => 'More than one solidtime account matches this Microsoft account. Ask an administrator.',
        'provisioning_unavailable' => 'Your account does not exist yet and automatic account creation is not set up. Ask an administrator.',
        'identity_in_use' => 'This Microsoft account is already linked to another solidtime user. Ask an administrator.',
        'generic' => 'We could not sign you in with Microsoft. Try again or use your email and password.',
    ],
];
