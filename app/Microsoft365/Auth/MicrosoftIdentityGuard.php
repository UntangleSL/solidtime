<?php

declare(strict_types=1);

namespace App\Microsoft365\Auth;

use App\Microsoft365\MicrosoftConfig;

/**
 * Decides whether an identity may continue to the resolver. Pure: no database access and no logging,
 * so a rejected identity can never leave a trace behind.
 */
final class MicrosoftIdentityGuard
{
    public function __construct(private readonly MicrosoftConfig $config) {}

    /**
     * @throws MicrosoftSignInException
     */
    public function check(MicrosoftIdentity $identity): void
    {
        // Single tenant: the tid claim must be the configured one (GUIDs compare case-insensitively)
        // and the token must have been issued for this very application.
        if (strtolower(trim($identity->tenantId)) !== $this->config->tenantId()
            || $identity->audience !== $this->config->clientId()) {
            throw new MicrosoftSignInException(MicrosoftSignInFailure::WrongTenant);
        }
    }
}
