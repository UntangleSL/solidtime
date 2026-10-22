<?php

declare(strict_types=1);

namespace App\Microsoft365\Auth;

/**
 * Every expected way a Microsoft sign-in can end without a login. The value is what gets logged and
 * the lang key under microsoft365.error.* is what the visitor reads: fixed text only, never
 * anything that came from the provider.
 */
enum MicrosoftSignInFailure: string
{
    case Cancelled = 'cancelled';
    case Interrupted = 'interrupted';
    case WrongTenant = 'wrong_tenant';
    case Guest = 'guest';
    case Domain = 'domain';
    case UnverifiedAccount = 'unverified_account';
    case AlreadyLinked = 'already_linked';
    case AmbiguousAccount = 'ambiguous_account';
    case ProvisioningUnavailable = 'provisioning_unavailable';
    case IdentityInUse = 'identity_in_use';
    case Generic = 'generic';

    public function messageKey(): string
    {
        return 'microsoft365.error.'.$this->value;
    }
}
