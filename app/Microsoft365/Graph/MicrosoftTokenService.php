<?php

declare(strict_types=1);

namespace App\Microsoft365\Graph;

use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

/**
 * Hands out a usable Graph access token for a connected account and refreshes it silently with the
 * documented refresh-token grant against the single configured tenant.
 *
 * The refresh runs under a row lock with a post-lock expiry check, so two concurrent requests never
 * spend the same (possibly rotating) refresh token twice. Tokens, the client secret and response bodies
 * are never logged.
 */
final class MicrosoftTokenService
{
    /**
     * Seconds of validity a token must still have, so it does not expire mid-sync.
     */
    private const int EXPIRY_MARGIN_SECONDS = 120;

    /**
     * Never asks for more than read access to the calendar.
     */
    private const string REFRESH_SCOPE = 'Calendars.Read offline_access';

    public function __construct(private readonly MicrosoftConfig $config) {}

    /**
     * @param  string|null  $rejectedToken  a token Graph answered 401 for; never handed out again
     *
     * @throws GraphException
     */
    public function accessToken(MicrosoftAccount $account, ?string $rejectedToken = null): string
    {
        // The transaction only scopes the row lock. A failure is returned, not thrown, so that state
        // written on the way (a later plan's markers) is committed instead of rolled back.
        $result = DB::transaction(function () use ($account, $rejectedToken): string|GraphException {
            $locked = MicrosoftAccount::query()->whereKey($account->getKey())->lockForUpdate()->first();
            if ($locked === null) {
                return new GraphException(SyncStatus::NotConnected);
            }

            $state = $locked->calendarAccessState();
            if ($state === 'not_connected') {
                return new GraphException(SyncStatus::NotConnected);
            }
            if ($state === 'reconnect') {
                return new GraphException(SyncStatus::Reconnect);
            }

            // Also returns a token that a concurrent request refreshed while this one waited for the lock
            if ($this->isUsable($locked, $rejectedToken)) {
                $account->setRawAttributes($locked->getAttributes(), true);

                return (string) $locked->access_token;
            }

            $result = $this->refresh($locked);
            $account->setRawAttributes($locked->getAttributes(), true);

            return $result;
        });

        if ($result instanceof GraphException) {
            throw $result;
        }

        return $result;
    }

    private function isUsable(MicrosoftAccount $account, ?string $rejectedToken): bool
    {
        $token = $account->access_token;
        $expiresAt = $account->access_token_expires_at;

        return $token !== null
            && $token !== ''
            && $token !== $rejectedToken
            && $expiresAt !== null
            && CarbonImmutable::now()->addSeconds(self::EXPIRY_MARGIN_SECONDS)->lessThan($expiresAt);
    }

    private function refresh(MicrosoftAccount $account): string|GraphException
    {
        try {
            $response = Http::asForm()
                ->connectTimeout(3)
                ->timeout(8)
                ->post('https://login.microsoftonline.com/'.$this->config->tenantId().'/oauth2/v2.0/token', [
                    'client_id' => $this->config->clientId(),
                    'client_secret' => $this->config->clientSecret(),
                    'grant_type' => 'refresh_token',
                    'refresh_token' => $account->refresh_token,
                    'scope' => self::REFRESH_SCOPE,
                ]);
        } catch (ConnectionException) {
            return new GraphException(SyncStatus::Unavailable);
        }

        if (! $response->successful()) {
            return new GraphException(SyncStatus::Unavailable);
        }

        $accessToken = $response->json('access_token');
        $expiresIn = $response->json('expires_in');
        if (! is_string($accessToken) || $accessToken === '' || ! is_numeric($expiresIn)) {
            return new GraphException(SyncStatus::Unavailable);
        }

        $account->access_token = $accessToken;
        $account->access_token_expires_at = Carbon::now()->addSeconds((int) $expiresIn);
        $refreshToken = $response->json('refresh_token');
        // Refresh tokens rotate: keep the old one when Microsoft does not send a new one
        if (is_string($refreshToken) && $refreshToken !== '') {
            $account->refresh_token = $refreshToken;
        }
        // The response scope is narrower than the sign-in scope: stored scopes stay as they are
        $account->save();

        return $accessToken;
    }
}
