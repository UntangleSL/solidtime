<?php

declare(strict_types=1);

namespace App\Microsoft365\Console;

use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Models\Organization;
use Illuminate\Console\Command;

/**
 * Prints the effective Microsoft 365 sign-in configuration of the running container.
 *
 * Output is meant to be pasted into chats and tickets, so it holds only yes/no flags, variable NAMES,
 * URIs and counts. The client secret and the token columns are never read here.
 */
class MicrosoftCheckCommand extends Command
{
    /**
     * @var string
     */
    protected $signature = 'm365:check';

    /**
     * @var string
     */
    protected $description = 'Show the Microsoft 365 sign-in configuration (no secrets)';

    public function handle(MicrosoftConfig $config): int
    {
        $missing = $config->missingKeys();
        $configured = $missing === [];

        $this->line('configured: '.($configured ? 'yes' : 'no'));
        if (! $configured) {
            $this->line('missing: '.implode(', ', $missing));
        }

        $redirectUri = $config->redirectUri();
        $this->line('redirect uri: '.$redirectUri);
        if (config('app.env') !== 'local' && parse_url($redirectUri, PHP_URL_SCHEME) !== 'https') {
            $this->line('WARNING: redirect uri is not https; Entra accepts http only for localhost');
        }

        $domains = $config->allowedDomains();
        $this->line('allowed domains: '.($domains === [] ? 'none (every Microsoft sign-in will be rejected)' : implode(', ', $domains)));

        $this->line('organization: '.$this->describeOrganization($config->organizationId()));
        $this->line('registration: '.$this->scalar(config('app.enable_registration')));
        $this->line('force https: '.((bool) config('app.force_https') ? 'true' : 'false'));
        $this->line('session lifetime: '.$this->scalar(config('session.lifetime')));

        $linked = MicrosoftAccount::query()->count();
        $connected = MicrosoftAccount::query()->connected()->count();
        $this->line('linked accounts: '.$linked.' (connected: '.$connected.')');

        return $configured ? self::SUCCESS : self::FAILURE;
    }

    private function describeOrganization(?string $organizationId): string
    {
        if ($organizationId === null) {
            return 'not set';
        }

        $organization = Organization::query()->whereKey($organizationId)->first();

        return $organization === null
            ? $organizationId.' NOT FOUND'
            : $organizationId.' ('.$organization->name.')';
    }

    private function scalar(mixed $value): string
    {
        return is_scalar($value) ? (string) $value : 'unknown';
    }
}
