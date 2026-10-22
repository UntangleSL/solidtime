<?php

declare(strict_types=1);

namespace App\Microsoft365\Auth;

use App\Microsoft365\MicrosoftConfig;

/**
 * Decides whether an identity may continue to the resolver. Pure: no database access and no logging,
 * so a rejected identity can never leave a trace behind.
 *
 * Entra "Assignment required" is off (no Entra P1), so any member or guest of the tenant can finish
 * the Entra flow. This guard is the only gate; every rule fails closed and the cheapest run first.
 */
final class MicrosoftIdentityGuard
{
    private const string GUID_PATTERN = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';

    public function __construct(private readonly MicrosoftConfig $config) {}

    /**
     * @throws MicrosoftSignInException
     */
    public function check(MicrosoftIdentity $identity): void
    {
        $this->checkTenantAndAudience($identity);
        $this->checkObjectId($identity);
        $this->checkNotGuest($identity);
    }

    private function checkTenantAndAudience(MicrosoftIdentity $identity): void
    {
        // Single tenant: the tid claim must be the configured one (GUIDs compare case-insensitively)
        // and the token must have been issued for this very application. The driver only checks that
        // the audience contains the client id, so equality is enforced here.
        if (strtolower(trim($identity->tenantId)) !== $this->config->tenantId()
            || $identity->audience !== $this->config->clientId()) {
            throw new MicrosoftSignInException(MicrosoftSignInFailure::WrongTenant);
        }
    }

    private function checkObjectId(MicrosoftIdentity $identity): void
    {
        // The oid claim and the Graph user id describe the same person. A blank, malformed or
        // mismatching value means the identity cannot be trusted as the stable key of the account.
        $objectId = trim($identity->objectId);
        if ($objectId === ''
            || preg_match(self::GUID_PATTERN, $objectId) !== 1
            || strtolower($objectId) !== strtolower(trim($identity->graphId))) {
            throw new MicrosoftSignInException(MicrosoftSignInFailure::Generic);
        }
    }

    private function checkNotGuest(MicrosoftIdentity $identity): void
    {
        // Only an explicit 'Member' passes: a missing userType fails closed. The #EXT# marker in the
        // user principal name and the optional acct claim (1 = guest) are independent guest signals.
        if ($identity->userType !== 'Member'
            || stripos($identity->userPrincipalName, '#EXT#') !== false
            || ($identity->accountType !== null && trim($identity->accountType) === '1')) {
            throw new MicrosoftSignInException(MicrosoftSignInFailure::Guest);
        }
    }
}
