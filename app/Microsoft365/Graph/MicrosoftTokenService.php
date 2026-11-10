<?php

declare(strict_types=1);

namespace App\Microsoft365\Graph;

use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Hands out a usable Graph access token for a connected account and refreshes it silently with the
 * documented refresh-token grant against the single configured tenant.
 *
 * The refresh runs under a row lock with a post-lock expiry check, so two concurrent requests never
 * spend the same (possibly rotating) refresh token twice. Tokens, the client secret and response bodies
 * are never logged. While an admin impersonates the user it refuses before touching anything.
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

    /**
     * The user can fix these only by signing in again: the stored grant is dead.
     */
    private const array TERMINAL_ERRORS = ['invalid_grant', 'interaction_required', 'consent_required'];

    /**
     * Operator errors (an expired or wrong client secret, a broken app registration): every user would hit
     * them, and a new sign-in cannot fix them, so the tokens stay and the calendar shows "unavailable".
     */
    private const array CLIENT_ERRORS = [
        'invalid_client',
        'unauthorized_client',
        'invalid_request',
        'invalid_scope',
        'unsupported_grant_type',
        'invalid_resource',
    ];

    public function __construct(
        private readonly MicrosoftConfig $config,
        private readonly GraphAccessGuard $access,
    ) {}

    /**
     * Records that the user has to sign in again (Graph kept answering 401/403 with a fresh token):
     * same effect as a terminal refresh failure. A no-op once the marker is set or after a disconnect.
     */
    public function markReconnectRequired(MicrosoftAccount $account): void
    {
        DB::transaction(function () use ($account): void {
            $locked = MicrosoftAccount::query()->whereKey($account->getKey())->lockForUpdate()->first();
            if ($locked !== null && $locked->disconnected_at === null && $locked->reconnect_required_at === null) {
                $this->requireReconnect($locked);
            }
            if ($locked !== null) {
                $account->setRawAttributes($locked->getAttributes(), true);
            }
        });
    }

    /**
     * @param  string|null  $rejectedToken  a token Graph answered 401 for; never handed out again
     *
     * @throws GraphException
     */
    public function accessToken(MicrosoftAccount $account, ?string $rejectedToken = null): string
    {
        // Single choke point for every Graph call (D-22): while an admin impersonates the user, the
        // row is neither read, locked nor refreshed, so no request can carry the user's token.
        if ($this->access->blocked()) {
            throw new GraphException(SyncStatus::NotConnected);
        }

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
        // The authority is built only from a GUID tenant (never common/organizations, Phase 2 D-01): an
        // unconfigured integration sends nothing, not even to a malformed URL
        if (! $this->config->isConfigured()) {
            return $this->failure('client_error', null);
        }

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
            return $this->failure('transient', null);
        }

        if (! $response->successful()) {
            return $this->classifyFailure($account, $response);
        }

        $accessToken = $response->json('access_token');
        $expiresIn = $response->json('expires_in');
        if (! is_string($accessToken) || $accessToken === '' || ! is_numeric($expiresIn)) {
            return $this->failure('transient', null);
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

    /**
     * Keyed on the OAuth `error` string, never on AADSTS numbers. Unknown errors and server-side
     * failures are transient: the tokens stay and a later request tries again.
     */
    private function classifyFailure(MicrosoftAccount $account, Response $response): GraphException
    {
        // The token endpoint throttles too: a back-off like Graph's, tokens kept, nothing logged here
        // (the sync service logs the degraded sync with the HTTP status)
        if ($response->status() === 429) {
            return new GraphException(SyncStatus::Throttled, RetryAfter::seconds($response->header('Retry-After')));
        }

        $error = $response->json('error');
        $error = is_string($error) ? $error : '';
        $description = $response->json('error_description');
        $providerCode = is_string($description) && preg_match('/AADSTS\d+/', $description, $matches) === 1
            ? $matches[0]
            : null;

        if (in_array($error, self::TERMINAL_ERRORS, true)) {
            $this->requireReconnect($account);
            Log::warning('Microsoft token refresh failed', ['reason' => 'terminal', 'provider_code' => $providerCode]);

            return new GraphException(SyncStatus::Reconnect, null, $providerCode);
        }

        if (in_array($error, self::CLIENT_ERRORS, true)) {
            return $this->failure('client_error', $providerCode);
        }

        return $this->failure('transient', $providerCode);
    }

    /**
     * Logs a fixed reason and the AADSTS code only: no token, secret, description or body.
     */
    private function failure(string $reason, ?string $providerCode): GraphException
    {
        Log::warning('Microsoft token refresh failed', ['reason' => $reason, 'provider_code' => $providerCode]);

        return new GraphException(SyncStatus::Unavailable, null, $providerCode);
    }

    private function requireReconnect(MicrosoftAccount $account): void
    {
        $account->reconnect_required_at = Carbon::now();
        $account->access_token = null;
        $account->refresh_token = null;
        $account->access_token_expires_at = null;
        $account->save();
    }
}
