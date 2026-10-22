<?php

declare(strict_types=1);

return [
    'ui' => [
        'sign_in' => 'Sign in with Microsoft',
        'sign_in_hint' => 'Use your work or school account',
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
