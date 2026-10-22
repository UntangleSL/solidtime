<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365\Support;

use App\Microsoft365\Auth\MicrosoftIdentity;
use App\Microsoft365\Auth\MicrosoftOAuthGateway;
use App\Models\Organization;
use Illuminate\Support\Facades\Config;

trait InteractsWithMicrosoft365
{
    protected const string MICROSOFT_TEST_TENANT_ID = '00000000-0000-4000-8000-0000000000a1';

    protected const string MICROSOFT_TEST_CLIENT_ID = '00000000-0000-4000-8000-0000000000c1';

    protected const string MICROSOFT_TEST_OBJECT_ID = '00000000-0000-4000-8000-0000000000b1';

    /**
     * @param  array<string, mixed>  $overrides  values for the microsoft365.* config keys
     */
    protected function configureMicrosoft365(?Organization $organization = null, array $overrides = []): void
    {
        $values = array_merge([
            'client_id' => self::MICROSOFT_TEST_CLIENT_ID,
            'client_secret' => 'fake-secret',
            'tenant_id' => self::MICROSOFT_TEST_TENANT_ID,
            'organization_id' => $organization?->getKey(),
            'allowed_domains' => 'example.test',
            'redirect_uri' => null,
            'default_timezone' => 'Europe/Madrid',
        ], $overrides);

        foreach ($values as $key => $value) {
            Config::set('microsoft365.'.$key, $value);
        }
        Config::set('app.url', 'https://time.example.test');
    }

    protected function fakeMicrosoftGateway(): FakeMicrosoftOAuthGateway
    {
        $gateway = new FakeMicrosoftOAuthGateway;
        $this->app->instance(MicrosoftOAuthGateway::class, $gateway);

        return $gateway;
    }

    /**
     * @param  array<string, mixed>  $overrides  constructor arguments of MicrosoftIdentity by name
     */
    protected function microsoftIdentity(array $overrides = []): MicrosoftIdentity
    {
        $arguments = array_merge([
            'tenantId' => self::MICROSOFT_TEST_TENANT_ID,
            'objectId' => self::MICROSOFT_TEST_OBJECT_ID,
            'audience' => self::MICROSOFT_TEST_CLIENT_ID,
            'graphId' => self::MICROSOFT_TEST_OBJECT_ID,
            'displayName' => 'Ada Example',
            'mail' => 'ada@example.test',
            'userPrincipalName' => 'ada@example.test',
            'userType' => 'Member',
            'accountType' => null,
            'accessToken' => 'at-marker-7f3c',
            'refreshToken' => 'rt-marker-9d1e',
            'expiresIn' => 3600,
            'scopes' => ['openid', 'profile', 'email', 'offline_access', 'User.Read', 'Calendars.Read'],
            'authMethods' => ['pwd', 'mfa'],
        ], $overrides);

        return new MicrosoftIdentity(...$arguments);
    }
}
