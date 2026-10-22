<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Microsoft 365 integration (Untangle fork)
|--------------------------------------------------------------------------
|
| Every value comes from the environment so the secret never reaches git.
| The names are copied 1:1 from Doppler (vps/prd). A blank value counts as
| "not set": App\Microsoft365\MicrosoftConfig decides whether the integration
| is configured, so nothing is precomputed here.
|
*/

return [
    'client_id' => env('SOLIDTIME_MICROSOFT_CLIENT_ID'),

    'client_secret' => env('SOLIDTIME_MICROSOFT_CLIENT_SECRET'),

    // The single Untangle tenant. Never "common" or "organizations".
    'tenant_id' => env('SOLIDTIME_MICROSOFT_TENANT_ID'),

    // Optional full override of the callback URL. Default: APP_URL + the callback route path.
    'redirect_uri' => env('SOLIDTIME_MICROSOFT_REDIRECT_URI'),

    // Organization that new Microsoft users join as employees. Blank = no provisioning.
    'organization_id' => env('SOLIDTIME_MICROSOFT_ORGANIZATION_ID'),

    // Raw comma separated list, normalised by MicrosoftConfig::allowedDomains().
    'allowed_domains' => env('SOLIDTIME_MICROSOFT_ALLOWED_DOMAINS', 'untanglegrowth.com,untangle.es'),

    // Used when the browser did not send a valid timezone at sign-in.
    'default_timezone' => env('SOLIDTIME_MICROSOFT_DEFAULT_TIMEZONE', 'Europe/Madrid'),
];
