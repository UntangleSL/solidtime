<?php

declare(strict_types=1);

namespace App\Microsoft365\Auth;

use RuntimeException;

/**
 * Thrown by the gateway, the guard and the resolver for every expected sign-in failure. The
 * exception message is the reason value only; provider text never enters it.
 */
class MicrosoftSignInException extends RuntimeException
{
    public function __construct(
        public readonly MicrosoftSignInFailure $reason,
        public readonly ?string $providerCode = null,
    ) {
        parent::__construct($reason->value);
    }
}
