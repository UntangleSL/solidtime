<?php

declare(strict_types=1);

namespace App\Microsoft365\Auth;

use SensitiveParameter;

/**
 * What Microsoft told us about the person who just signed in. Built by the gateway, read by the
 * resolver. Tokens are redacted from stack traces and debug output.
 */
final readonly class MicrosoftIdentity
{
    /**
     * @param  list<string>  $scopes
     * @param  list<string>|null  $authMethods  values of the Entra amr claim when the token carried it
     */
    public function __construct(
        public string $tenantId,
        public string $objectId,
        public string $audience,
        public string $graphId,
        public ?string $displayName,
        public ?string $mail,
        public string $userPrincipalName,
        public ?string $userType,
        public ?string $accountType,
        #[SensitiveParameter] public string $accessToken,
        #[SensitiveParameter] public ?string $refreshToken,
        public ?int $expiresIn,
        public array $scopes,
        public ?array $authMethods = null,
    ) {}

    /**
     * The address used for the account. Users without a mailbox (freelancers) have no mail, so the
     * user principal name is the fallback.
     */
    public function primaryEmail(): string
    {
        $mail = $this->mail === null ? '' : strtolower(trim($this->mail));

        return $mail !== '' ? $mail : strtolower(trim($this->userPrincipalName));
    }

    /**
     * Evidence only, never a decision input: 'yes' | 'no' | 'absent' (token carried no amr claim).
     */
    public function mfaEvidence(): string
    {
        if ($this->authMethods === null) {
            return 'absent';
        }

        return in_array('mfa', $this->authMethods, true) || in_array('ngcmfa', $this->authMethods, true)
            ? 'yes'
            : 'no';
    }

    /**
     * @return array<string, mixed>
     */
    public function __debugInfo(): array
    {
        $fields = get_object_vars($this);
        $fields['accessToken'] = '[redacted]';
        $fields['refreshToken'] = '[redacted]';

        return $fields;
    }
}
