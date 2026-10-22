<?php

declare(strict_types=1);

namespace App\Microsoft365;

/**
 * Typed view over config/microsoft365.php.
 *
 * Stateless on purpose: every call reads the config repository, so a changed value (a test calling
 * Config::set, a worker booted with new env) is picked up without any cached state.
 */
final class MicrosoftConfig
{
    /**
     * The integration is usable only when client id, secret and tenant are all filled in. Dokploy passes
     * empty strings for variables that are not set, so a blank value must count as missing.
     */
    public function isConfigured(): bool
    {
        return $this->clientId() !== ''
            && $this->clientSecret() !== ''
            && $this->tenantId() !== '';
    }

    public function clientId(): string
    {
        return $this->string('client_id');
    }

    public function clientSecret(): string
    {
        return $this->string('client_secret');
    }

    /**
     * Single configured tenant, normalised for comparison with the tid claim.
     */
    public function tenantId(): string
    {
        return strtolower($this->string('tenant_id'));
    }

    /**
     * Built from APP_URL, never from the request host, so it matches what is registered in Entra
     * even behind a reverse proxy.
     */
    public function redirectUri(): string
    {
        $override = $this->string('redirect_uri');
        if ($override !== '') {
            return $override;
        }

        $appUrl = config('app.url');

        return rtrim(is_string($appUrl) ? $appUrl : '', '/').route('microsoft.callback', [], false);
    }

    public function organizationId(): ?string
    {
        $organizationId = $this->string('organization_id');

        return $organizationId === '' ? null : $organizationId;
    }

    /**
     * @return list<string>
     */
    public function allowedDomains(): array
    {
        $configured = config('microsoft365.allowed_domains');
        $entries = is_array($configured) ? $configured : explode(',', is_string($configured) ? $configured : '');

        $domains = [];
        foreach ($entries as $entry) {
            if (! is_string($entry)) {
                continue;
            }
            $domain = strtolower(trim($entry));
            if ($domain !== '') {
                $domains[] = $domain;
            }
        }

        return array_values(array_unique($domains));
    }

    public function defaultTimezone(): string
    {
        $timezone = $this->string('default_timezone');

        return $timezone === '' ? 'Europe/Madrid' : $timezone;
    }

    private function string(string $key): string
    {
        $value = config('microsoft365.'.$key);

        return is_string($value) ? trim($value) : '';
    }
}
