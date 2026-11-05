<?php

declare(strict_types=1);

namespace App\Microsoft365\Graph;

use App\Microsoft365\Models\MicrosoftAccount;
use Carbon\CarbonImmutable;

/**
 * Hands out a usable Graph access token for a connected account. The seam is stable: a later plan
 * replaces the "expired" branch with the refresh grant without changing the signature.
 */
final class MicrosoftTokenService
{
    /**
     * Seconds of validity a token must still have, so it does not expire mid-sync.
     */
    private const int EXPIRY_MARGIN_SECONDS = 120;

    /**
     * @param  string|null  $rejectedToken  a token Graph answered 401 for; never handed out again
     *
     * @throws GraphException
     */
    public function accessToken(MicrosoftAccount $account, ?string $rejectedToken = null): string
    {
        if (! $account->isConnected()) {
            throw new GraphException(SyncStatus::NotConnected);
        }

        $token = $account->access_token;
        $expiresAt = $account->access_token_expires_at;
        if (
            $token !== null
            && $token !== ''
            && $token !== $rejectedToken
            && $expiresAt !== null
            && CarbonImmutable::now()->addSeconds(self::EXPIRY_MARGIN_SECONDS)->lessThan($expiresAt)
        ) {
            return $token;
        }

        throw new GraphException(SyncStatus::Unavailable);
    }
}
