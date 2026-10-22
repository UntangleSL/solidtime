<?php

declare(strict_types=1);

namespace App\Microsoft365\Auth;

use App\Microsoft365\MicrosoftConfig;
use GuzzleHttp\Exception\ResponseException;
use Illuminate\Http\Request;
use Laravel\Socialite\Contracts\User;
use Laravel\Socialite\Two\InvalidStateException;
use SocialiteProviders\Manager\Config;
use SocialiteProviders\Microsoft\Provider;
use stdClass;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Throwable;

/**
 * Production gateway: the SocialiteProviders Microsoft driver, tenant-pinned, with state and PKCE.
 *
 * A NEW driver is built on every call and nothing is kept on this object. The driver caches the
 * authenticated user and the id_token claims, so a reused instance would hand the identity of the
 * previous visitor to the next one. The Socialite manager facade is deliberately not used and the
 * driver is never switched to stateless mode.
 *
 * Failure text is never read: the driver embeds token-derived text in its exception messages. Only
 * a fixed reason and, for a token endpoint error, the AADSTS code leave this class.
 */
final class SocialiteMicrosoftGateway implements MicrosoftOAuthGateway
{
    /**
     * The scopes of decision D-09, least privilege.
     *
     * @var list<string>
     */
    private const array SCOPES = ['openid', 'profile', 'email', 'offline_access', 'User.Read', 'Calendars.Read'];

    /** Upper bound for the access token payload segment read for the informational amr evidence. */
    private const int MAX_ACCESS_TOKEN_PAYLOAD_LENGTH = 8192;

    private const int MAX_AUTH_METHODS = 8;

    /**
     * @param  array<string, mixed>  $httpOptions  Guzzle options; the timeouts keep Octane workers from hanging
     */
    public function __construct(
        private readonly MicrosoftConfig $config,
        private readonly array $httpOptions = ['timeout' => 10, 'connect_timeout' => 5],
    ) {}

    public function redirect(Request $request): RedirectResponse
    {
        return $this->provider($request)->redirect();
    }

    public function authenticate(Request $request): MicrosoftIdentity
    {
        try {
            $provider = $this->provider($request);
            // user() checks state, exchanges the code (with the PKCE verifier) and validates the
            // id_token signature, issuer, audience and expiry against the tenant JWKS.
            $user = $provider->user();
            $claims = $provider->getClaims();
            if ($claims === null) {
                throw new MicrosoftSignInException(MicrosoftSignInFailure::Generic);
            }

            return $this->identity($user, $claims);
        } catch (MicrosoftSignInException $exception) {
            throw $exception;
        } catch (InvalidStateException) {
            // State mismatch, and every id_token validation failure of the driver.
            throw new MicrosoftSignInException(MicrosoftSignInFailure::Interrupted);
        } catch (ResponseException $exception) {
            throw new MicrosoftSignInException(MicrosoftSignInFailure::Generic, $this->providerCode($exception));
        } catch (Throwable) {
            throw new MicrosoftSignInException(MicrosoftSignInFailure::Generic);
        }
    }

    /**
     * Built fresh on every call, never cached.
     */
    private function provider(Request $request): Provider
    {
        $redirectUri = $this->config->redirectUri();

        $provider = new Provider(
            $request,
            $this->config->clientId(),
            $this->config->clientSecret(),
            $redirectUri,
            $this->httpOptions,
        );
        $provider->setConfig(new Config(
            $this->config->clientId(),
            $this->config->clientSecret(),
            $redirectUri,
            // Never 'common': the authority is pinned to the one Untangle tenant (D-01). userType is
            // added to the Graph /me $select for the guest check; no avatar or tenant calls.
            ['tenant' => $this->config->tenantId(), 'fields' => ['userType']],
        ));

        return $provider->enablePKCE()->setScopes(self::SCOPES);
    }

    /**
     * @param  User  $user
     */
    private function identity($user, stdClass $claims): MicrosoftIdentity
    {
        /** @var \Laravel\Socialite\Two\User $user */
        $raw = $this->rawProfile($user->user);

        $tenantId = $this->nonEmptyString($claims->tid ?? null);
        $objectId = $this->nonEmptyString($claims->oid ?? null);
        $audience = $this->audience($claims->aud ?? null);
        $graphId = $this->nonEmptyString($raw['id'] ?? null);
        $userPrincipalName = $this->nonEmptyString($raw['userPrincipalName'] ?? null);
        $accessToken = $this->nonEmptyString($user->token);
        if ($tenantId === null || $objectId === null || $audience === null || $graphId === null
            || $userPrincipalName === null || $accessToken === null) {
            throw new MicrosoftSignInException(MicrosoftSignInFailure::Generic);
        }

        return new MicrosoftIdentity(
            tenantId: $tenantId,
            objectId: $objectId,
            audience: $audience,
            graphId: $graphId,
            displayName: $this->nonEmptyString($raw['displayName'] ?? null),
            mail: $this->nonEmptyString($raw['mail'] ?? null),
            userPrincipalName: $userPrincipalName,
            userType: $this->nonEmptyString($raw['userType'] ?? null),
            accountType: isset($claims->acct) && is_numeric($claims->acct) ? (string) (int) $claims->acct : null,
            accessToken: $accessToken,
            refreshToken: $this->nonEmptyString($user->refreshToken),
            expiresIn: $this->nullableInt($user->expiresIn),
            scopes: $this->scopes($user->approvedScopes),
            authMethods: $this->authMethods($claims, $accessToken),
        );
    }

    /**
     * @return array<array-key, mixed>
     */
    private function rawProfile(mixed $raw): array
    {
        return is_array($raw) ? $raw : [];
    }

    private function nullableInt(mixed $value): ?int
    {
        return is_numeric($value) ? (int) $value : null;
    }

    private function nonEmptyString(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? $value : null;
    }

    private function audience(mixed $aud): ?string
    {
        if (is_array($aud)) {
            $aud = $aud[array_key_first($aud)] ?? null;
        }

        return $this->nonEmptyString($aud);
    }

    /**
     * @return list<string>
     */
    private function scopes(mixed $approved): array
    {
        if (is_string($approved)) {
            $approved = explode(' ', $approved);
        }
        if (! is_array($approved)) {
            return [];
        }

        $scopes = [];
        foreach ($approved as $scope) {
            if (is_string($scope) && trim($scope) !== '') {
                $scopes[] = trim($scope);
            }
        }

        return $scopes;
    }

    /**
     * Evidence for the per-sign-in MFA log line (D-06), never an input to a decision: the app does not
     * require mfa because Security Defaults prompt based on risk. Order: the validated id_token, then a
     * best-effort read of the access token, then null.
     *
     * @return list<string>|null
     */
    private function authMethods(stdClass $claims, string $accessToken): ?array
    {
        return $this->normaliseAuthMethods($claims->amr ?? null) ?? $this->authMethodsFromAccessToken($accessToken);
    }

    /**
     * Microsoft documents Graph access tokens as opaque and may change their format, so any failure
     * to read the payload simply yields null. The decoded payload is never logged or stored.
     *
     * @return list<string>|null
     */
    private function authMethodsFromAccessToken(string $accessToken): ?array
    {
        try {
            $segments = explode('.', $accessToken);
            if (count($segments) !== 3 || $segments[1] === '' || strlen($segments[1]) > self::MAX_ACCESS_TOKEN_PAYLOAD_LENGTH) {
                return null;
            }

            $payload = strtr($segments[1], '-_', '+/');
            $payload .= str_repeat('=', (4 - strlen($payload) % 4) % 4);
            $json = base64_decode($payload, true);
            if ($json === false) {
                return null;
            }

            $decoded = json_decode($json, true, 16);

            return is_array($decoded) ? $this->normaliseAuthMethods($decoded['amr'] ?? null) : null;
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * @return list<string>|null
     */
    private function normaliseAuthMethods(mixed $amr): ?array
    {
        if (! is_array($amr) || $amr === [] || ! array_is_list($amr)) {
            return null;
        }

        $methods = [];
        foreach ($amr as $method) {
            if (is_string($method) && preg_match('/^[a-z0-9_]{1,16}$/i', $method) === 1) {
                $methods[] = strtolower($method);
            }
        }

        return $methods === [] ? null : array_slice($methods, 0, self::MAX_AUTH_METHODS);
    }

    /**
     * The AADSTS code is the only provider text allowed out (D-12: AADSTS7000215 means a wrong secret value).
     */
    private function providerCode(ResponseException $exception): ?string
    {
        try {
            $body = substr((string) $exception->getResponse()->getBody(), 0, 16384);

            return preg_match('/AADSTS\d+/', $body, $matches) === 1 ? $matches[0] : null;
        } catch (Throwable) {
            return null;
        }
    }
}
