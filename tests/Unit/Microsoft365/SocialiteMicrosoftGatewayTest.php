<?php

declare(strict_types=1);

namespace Tests\Unit\Microsoft365;

use App\Microsoft365\Auth\MicrosoftIdentity;
use App\Microsoft365\Auth\MicrosoftSignInException;
use App\Microsoft365\Auth\MicrosoftSignInFailure;
use App\Microsoft365\Auth\SocialiteMicrosoftGateway;
use App\Microsoft365\MicrosoftConfig;
use Firebase\JWT\JWT;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Promise\Create;
use GuzzleHttp\Psr7\Response;
use Illuminate\Http\Request;
use Illuminate\Session\ArraySessionHandler;
use Illuminate\Session\Store;
use Illuminate\Support\Facades\Cache;
use OpenSSLAsymmetricKey;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Psr\Http\Message\RequestInterface;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCase;

/**
 * Contract test of the production gateway against a Guzzle handler that plays Entra (openid
 * configuration, JWKS, token endpoint) and Microsoft Graph. No request leaves the process: Socialite
 * uses its own Guzzle client, so Http::preventStrayRequests() does not cover it and every outbound
 * request must be answered by the handler below.
 */
#[CoversClass(SocialiteMicrosoftGateway::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(MicrosoftIdentity::class)]
#[UsesClass(MicrosoftSignInException::class)]
class SocialiteMicrosoftGatewayTest extends TestCase
{
    use InteractsWithMicrosoft365;

    private const string SECOND_OBJECT_ID = '00000000-0000-4000-8000-0000000000b2';

    private const string REDIRECT_URI = 'https://time.example.test/auth/microsoft/callback';

    /** @var list<array{method: string, host: string, path: string, query: array<string, mixed>, form: array<string, mixed>}> */
    private array $requests = [];

    /** @var array<string, array{0: int, 1: array<string, mixed>}> */
    private array $tokenResponses = [];

    /** @var array<string, array<string, mixed>> */
    private array $profiles = [];

    private string $privatePem = '';

    /** @var array<string, string> */
    private array $jwk = [];

    private string $otherPrivatePem = '';

    private Store $session;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        $this->configureMicrosoft365();

        [$this->privatePem, $this->jwk] = $this->generateKeyPair('test-kid');
        [$this->otherPrivatePem] = $this->generateKeyPair('unknown-kid');
        $this->session = new Store('test', new ArraySessionHandler(120));
    }

    public function test_authenticate_maps_claims_graph_profile_and_tokens(): void
    {
        // Arrange
        $this->queueToken('code-1', $this->tokenBody($this->idToken(), 'opaque-at-1'));

        // Act
        $identity = $this->authenticate('code-1');

        // Assert
        $this->assertSame(self::MICROSOFT_TEST_TENANT_ID, $identity->tenantId);
        $this->assertSame(self::MICROSOFT_TEST_OBJECT_ID, $identity->objectId);
        $this->assertSame(self::MICROSOFT_TEST_CLIENT_ID, $identity->audience);
        $this->assertSame(self::MICROSOFT_TEST_OBJECT_ID, $identity->graphId);
        $this->assertSame('Ada Example', $identity->displayName);
        $this->assertSame('ada@example.test', $identity->mail);
        $this->assertSame('ada@example.test', $identity->userPrincipalName);
        $this->assertSame('Member', $identity->userType);
        $this->assertSame('opaque-at-1', $identity->accessToken);
        $this->assertSame('rt-1', $identity->refreshToken);
        $this->assertSame(3600, $identity->expiresIn);
        $this->assertSame(['openid', 'profile', 'email', 'User.Read', 'Calendars.Read'], $identity->scopes);
    }

    public function test_token_request_sends_code_verifier_secret_and_redirect_uri(): void
    {
        // Arrange
        $this->queueToken('code-1', $this->tokenBody($this->idToken(), 'opaque-at-1'));

        // Act
        $callback = $this->startFlow('code-1');
        $verifier = $this->session->get('code_verifier');
        $this->gateway()->authenticate($callback);

        // Assert
        $tokenRequests = $this->requestsTo('POST', '/'.self::MICROSOFT_TEST_TENANT_ID.'/oauth2/v2.0/token');
        $this->assertCount(1, $tokenRequests);
        $form = $tokenRequests[0]['form'];
        $this->assertSame('login.microsoftonline.com', $tokenRequests[0]['host']);
        $this->assertSame('authorization_code', $form['grant_type']);
        $this->assertSame('code-1', $form['code']);
        $this->assertSame($verifier, $form['code_verifier']);
        $this->assertNotEmpty($verifier);
        $this->assertSame('fake-secret', $form['client_secret']);
        $this->assertSame(self::MICROSOFT_TEST_CLIENT_ID, $form['client_id']);
        $this->assertSame(self::REDIRECT_URI, $form['redirect_uri']);
    }

    public function test_graph_profile_request_selects_user_type(): void
    {
        // Arrange
        $this->queueToken('code-1', $this->tokenBody($this->idToken(), 'opaque-at-1'));

        // Act
        $this->authenticate('code-1');

        // Assert
        $profileRequests = $this->requestsTo('GET', '/v1.0/me');
        $this->assertCount(1, $profileRequests);
        $this->assertSame('graph.microsoft.com', $profileRequests[0]['host']);
        $this->assertStringContainsString('userType', (string) $profileRequests[0]['query']['$select']);
    }

    public function test_amr_from_id_token_is_mapped(): void
    {
        // Arrange
        $this->queueToken('code-1', $this->tokenBody($this->idToken(['amr' => ['pwd', 'mfa']]), 'opaque-at-1'));

        // Act
        $identity = $this->authenticate('code-1');

        // Assert
        $this->assertSame(['pwd', 'mfa'], $identity->authMethods);
        $this->assertSame('yes', $identity->mfaEvidence());
    }

    public function test_amr_falls_back_to_access_token_payload(): void
    {
        // Arrange
        $accessToken = JWT::encode(['amr' => ['pwd'], 'aud' => 'graph'], $this->privatePem, 'RS256', 'test-kid');
        $this->queueToken('code-1', $this->tokenBody($this->idToken(), $accessToken));

        // Act
        $identity = $this->authenticate('code-1');

        // Assert
        $this->assertSame(['pwd'], $identity->authMethods);
        $this->assertSame('no', $identity->mfaEvidence());
    }

    public function test_amr_absent_or_undecodable_yields_null(): void
    {
        // Arrange
        $this->queueToken('code-1', $this->tokenBody($this->idToken(), 'opaque-at-1'));

        // Act
        $identity = $this->authenticate('code-1');

        // Assert
        $this->assertNull($identity->authMethods);
        $this->assertSame('absent', $identity->mfaEvidence());
    }

    public function test_amr_with_unexpected_shape_is_dropped(): void
    {
        // Arrange
        $accessToken = JWT::encode(['amr' => ['pwd', 'not a valid value!', str_repeat('x', 40)]], $this->privatePem, 'RS256', 'test-kid');
        $this->queueToken('code-1', $this->tokenBody($this->idToken(), $accessToken));

        // Act
        $identity = $this->authenticate('code-1');

        // Assert
        $this->assertSame(['pwd'], $identity->authMethods);
    }

    public function test_two_sequential_authentications_do_not_share_state(): void
    {
        // Arrange
        $gateway = $this->gateway();
        $this->queueToken('code-1', $this->tokenBody($this->idToken(), 'opaque-at-1'));
        $this->queueToken('code-2', $this->tokenBody($this->idToken(['oid' => self::SECOND_OBJECT_ID]), 'opaque-at-2', 'rt-2'));
        $this->profiles['opaque-at-2'] = $this->profile(self::SECOND_OBJECT_ID, 'grace@example.test');

        // Act
        $first = $gateway->authenticate($this->startFlow('code-1', $gateway));
        $second = $gateway->authenticate($this->startFlow('code-2', $gateway));

        // Assert
        $this->assertSame(self::MICROSOFT_TEST_OBJECT_ID, $first->objectId);
        $this->assertSame(self::SECOND_OBJECT_ID, $second->objectId);
        $this->assertSame('ada@example.test', $first->userPrincipalName);
        $this->assertSame('grace@example.test', $second->userPrincipalName);
        $this->assertSame('rt-1', $first->refreshToken);
        $this->assertSame('rt-2', $second->refreshToken);
    }

    public function test_state_mismatch_maps_to_interrupted(): void
    {
        // Arrange
        $gateway = $this->gateway();
        $this->startFlow('code-1', $gateway);
        $callback = Request::create('/auth/microsoft/callback', 'GET', ['code' => 'code-1', 'state' => 'forged-state']);
        $callback->setLaravelSession($this->session);

        // Act
        $failure = $this->captureFailure(fn () => $gateway->authenticate($callback));

        // Assert
        $this->assertSame(MicrosoftSignInFailure::Interrupted, $failure->reason);
        $this->assertNull($failure->providerCode);
        $this->assertSame([], $this->requestsTo('POST', '/'.self::MICROSOFT_TEST_TENANT_ID.'/oauth2/v2.0/token'));
    }

    public function test_id_token_signed_by_unknown_key_is_rejected(): void
    {
        // Arrange
        $forged = $this->idToken([], $this->otherPrivatePem, 'unknown-kid');
        $this->queueToken('code-1', $this->tokenBody($forged, 'opaque-at-1'));

        // Act
        $failure = $this->captureFailure(fn () => $this->authenticate('code-1'));

        // Assert
        $this->assertContains($failure->reason, [MicrosoftSignInFailure::Interrupted, MicrosoftSignInFailure::Generic]);
        $this->assertNull($failure->providerCode);
        $this->assertSame($failure->reason->value, $failure->getMessage());
    }

    public function test_token_endpoint_error_exposes_only_the_aadsts_code(): void
    {
        // Arrange
        $this->queueToken('code-1', [
            'error' => 'invalid_client',
            'error_description' => 'AADSTS7000215: Invalid client secret provided. Trace ID: 0a1b2c3d Timestamp: 2026-10-23',
        ], 401);

        // Act
        $failure = $this->captureFailure(fn () => $this->authenticate('code-1'));

        // Assert
        $this->assertSame(MicrosoftSignInFailure::Generic, $failure->reason);
        $this->assertSame('AADSTS7000215', $failure->providerCode);
        $this->assertSame('generic', $failure->getMessage());
        $this->assertNull($failure->getPrevious());
    }

    public function test_token_endpoint_error_without_aadsts_code_has_no_provider_code(): void
    {
        // Arrange
        $this->queueToken('code-1', ['error' => 'server_error', 'error_description' => 'try again later'], 500);

        // Act
        $failure = $this->captureFailure(fn () => $this->authenticate('code-1'));

        // Assert
        $this->assertSame(MicrosoftSignInFailure::Generic, $failure->reason);
        $this->assertNull($failure->providerCode);
    }

    private function gateway(): SocialiteMicrosoftGateway
    {
        return new SocialiteMicrosoftGateway(new MicrosoftConfig, ['handler' => HandlerStack::create($this->handler())]);
    }

    /**
     * Runs redirect() on the shared session (which stores state and the PKCE verifier) and returns the
     * callback request the browser would send back.
     */
    private function startFlow(string $code, ?SocialiteMicrosoftGateway $gateway = null): Request
    {
        $redirect = Request::create('/auth/microsoft/redirect');
        $redirect->setLaravelSession($this->session);
        ($gateway ?? $this->gateway())->redirect($redirect);

        $callback = Request::create('/auth/microsoft/callback', 'GET', [
            'code' => $code,
            'state' => $this->session->get('state'),
        ]);
        $callback->setLaravelSession($this->session);

        return $callback;
    }

    private function authenticate(string $code): MicrosoftIdentity
    {
        $gateway = $this->gateway();

        return $gateway->authenticate($this->startFlow($code, $gateway));
    }

    private function captureFailure(callable $act): MicrosoftSignInException
    {
        try {
            $act();
        } catch (MicrosoftSignInException $exception) {
            return $exception;
        }

        $this->fail('Expected a MicrosoftSignInException');
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function queueToken(string $code, array $body, int $status = 200): void
    {
        $this->tokenResponses[$code] = [$status, $body];
    }

    /**
     * @return array<string, mixed>
     */
    private function tokenBody(string $idToken, string $accessToken, string $refreshToken = 'rt-1'): array
    {
        return [
            'token_type' => 'Bearer',
            'scope' => 'openid profile email User.Read Calendars.Read',
            'expires_in' => 3600,
            'access_token' => $accessToken,
            'refresh_token' => $refreshToken,
            'id_token' => $idToken,
        ];
    }

    /**
     * Built at runtime on purpose: no token-shaped literal may live in the repository.
     *
     * @param  array<string, mixed>  $overrides
     */
    private function idToken(array $overrides = [], ?string $pem = null, string $kid = 'test-kid'): string
    {
        $now = time();
        $claims = array_merge([
            'iss' => 'https://login.microsoftonline.com/'.self::MICROSOFT_TEST_TENANT_ID.'/v2.0',
            'aud' => self::MICROSOFT_TEST_CLIENT_ID,
            'tid' => self::MICROSOFT_TEST_TENANT_ID,
            'oid' => self::MICROSOFT_TEST_OBJECT_ID,
            'sub' => 'subject-1',
            'iat' => $now - 10,
            'nbf' => $now - 10,
            'exp' => $now + 3600,
        ], $overrides);

        return JWT::encode($claims, $pem ?? $this->privatePem, 'RS256', $kid);
    }

    /**
     * @return array<string, mixed>
     */
    private function profile(string $id, string $userPrincipalName): array
    {
        return [
            'id' => $id,
            'displayName' => 'Ada Example',
            'mail' => $userPrincipalName,
            'userPrincipalName' => $userPrincipalName,
            'userType' => 'Member',
        ];
    }

    /**
     * @return list<array{method: string, host: string, path: string, query: array<string, mixed>, form: array<string, mixed>}>
     */
    private function requestsTo(string $method, string $path): array
    {
        return array_values(array_filter(
            $this->requests,
            fn (array $request): bool => $request['method'] === $method && $request['path'] === $path
        ));
    }

    /**
     * Plays Entra and Graph, and records every request.
     */
    private function handler(): callable
    {
        return function (RequestInterface $request) {
            $uri = $request->getUri();
            $query = [];
            parse_str($uri->getQuery(), $query);
            $form = [];
            if ($request->getMethod() === 'POST') {
                parse_str((string) $request->getBody(), $form);
            }
            $this->requests[] = [
                'method' => $request->getMethod(),
                'host' => $uri->getHost(),
                'path' => $uri->getPath(),
                'query' => $query,
                'form' => $form,
            ];

            $tenant = self::MICROSOFT_TEST_TENANT_ID;
            $isEntra = $uri->getHost() === 'login.microsoftonline.com';
            $path = $uri->getPath();

            if ($isEntra && $path === "/$tenant/v2.0/.well-known/openid-configuration") {
                $response = $this->jsonResponse(200, [
                    'issuer' => 'https://login.microsoftonline.com/{tenantid}/v2.0',
                    'jwks_uri' => "https://login.microsoftonline.com/$tenant/discovery/v2.0/keys",
                    'id_token_signing_alg_values_supported' => ['RS256'],
                ]);
            } elseif ($isEntra && $path === "/$tenant/discovery/v2.0/keys") {
                $response = $this->jsonResponse(200, ['keys' => [$this->jwk]]);
            } elseif ($isEntra && $path === "/$tenant/oauth2/v2.0/token") {
                [$status, $body] = $this->tokenResponses[(string) ($form['code'] ?? '')] ?? [400, ['error' => 'invalid_grant']];
                $response = $this->jsonResponse($status, $body);
            } elseif ($uri->getHost() === 'graph.microsoft.com' && $path === '/v1.0/me') {
                $bearer = substr($request->getHeaderLine('Authorization'), strlen('Bearer '));
                $response = $this->jsonResponse(200, $this->profiles[$bearer] ?? $this->profile(self::MICROSOFT_TEST_OBJECT_ID, 'ada@example.test'));
            } else {
                $response = $this->jsonResponse(404, ['error' => 'unrouted']);
            }

            return Create::promiseFor($response);
        };
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function jsonResponse(int $status, array $body): Response
    {
        return new Response($status, ['Content-Type' => 'application/json'], json_encode($body, JSON_THROW_ON_ERROR));
    }

    /**
     * @return array{0: string, 1: array<string, string>}
     */
    private function generateKeyPair(string $kid): array
    {
        $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        $this->assertInstanceOf(OpenSSLAsymmetricKey::class, $key);
        $pem = '';
        openssl_pkey_export($key, $pem);
        $details = openssl_pkey_get_details($key);
        $this->assertIsArray($details);

        $encode = static fn (string $binary): string => rtrim(strtr(base64_encode($binary), '+/', '-_'), '=');

        return [$pem, [
            'kty' => 'RSA',
            'use' => 'sig',
            'alg' => 'RS256',
            'kid' => $kid,
            'n' => $encode($details['rsa']['n']),
            'e' => $encode($details['rsa']['e']),
        ]];
    }
}
