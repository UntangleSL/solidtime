<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Microsoft365\Auth\MicrosoftOAuthGateway;
use App\Microsoft365\Auth\SocialiteMicrosoftGateway;
use App\Microsoft365\Http\Controllers\MicrosoftAuthController;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

#[CoversClass(SocialiteMicrosoftGateway::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
#[UsesClass(MicrosoftAuthController::class)]
class MicrosoftRedirectTest extends TestCaseWithDatabase
{
    use InteractsWithMicrosoft365;

    /**
     * @return array{scheme: string, host: string, path: string, query: array<string, mixed>}
     */
    private function authorizeUrl(string $location): array
    {
        $parts = parse_url($location);
        $this->assertIsArray($parts);
        $query = [];
        parse_str($parts['query'] ?? '', $query);

        return [
            'scheme' => $parts['scheme'] ?? '',
            'host' => $parts['host'] ?? '',
            'path' => $parts['path'] ?? '',
            'query' => $query,
        ];
    }

    public function test_redirect_goes_to_tenant_pinned_authorize_endpoint_with_pkce(): void
    {
        // Arrange
        $this->configureMicrosoft365();

        // Act
        $response = $this->get(route('microsoft.redirect', [], false));

        // Assert
        $response->assertStatus(302);
        $url = $this->authorizeUrl((string) $response->headers->get('Location'));
        $this->assertSame('https', $url['scheme']);
        $this->assertSame('login.microsoftonline.com', $url['host']);
        $this->assertSame('/'.self::MICROSOFT_TEST_TENANT_ID.'/oauth2/v2.0/authorize', $url['path']);
        $this->assertSame(self::MICROSOFT_TEST_CLIENT_ID, $url['query']['client_id']);
        $this->assertSame('https://time.example.test/auth/microsoft/callback', $url['query']['redirect_uri']);
        $this->assertSame('code', $url['query']['response_type']);
        $this->assertEqualsCanonicalizing(
            ['openid', 'profile', 'email', 'offline_access', 'User.Read', 'Calendars.Read'],
            explode(' ', (string) $url['query']['scope'])
        );
        $this->assertSame('S256', $url['query']['code_challenge_method']);
        $this->assertNotEmpty($url['query']['code_challenge']);
        $this->assertNotEmpty($url['query']['state']);
        $this->assertSame(session('state'), $url['query']['state']);
        $this->assertNotEmpty(session('code_verifier'));
    }

    public function test_redirect_never_targets_common_or_organizations_authority(): void
    {
        // Arrange
        $this->configureMicrosoft365();

        // Act
        $response = $this->get(route('microsoft.redirect', [], false));

        // Assert
        $url = $this->authorizeUrl((string) $response->headers->get('Location'));
        $this->assertStringStartsNotWith('/common/', $url['path']);
        $this->assertStringStartsNotWith('/organizations/', $url['path']);
    }

    public function test_each_redirect_uses_a_fresh_state(): void
    {
        // Arrange
        $this->configureMicrosoft365();

        // Act
        $first = $this->authorizeUrl((string) $this->get(route('microsoft.redirect', [], false))->headers->get('Location'));
        $this->flushSession();
        $second = $this->authorizeUrl((string) $this->get(route('microsoft.redirect', [], false))->headers->get('Location'));

        // Assert
        $this->assertNotSame($first['query']['state'], $second['query']['state']);
        $this->assertNotSame($first['query']['code_challenge'], $second['query']['code_challenge']);
    }

    public function test_redirect_uri_override_is_used_verbatim(): void
    {
        // Arrange
        $this->configureMicrosoft365(null, ['redirect_uri' => 'https://override.example.test/auth/microsoft/callback']);

        // Act
        $response = $this->get(route('microsoft.redirect', [], false));

        // Assert
        $url = $this->authorizeUrl((string) $response->headers->get('Location'));
        $this->assertSame('https://override.example.test/auth/microsoft/callback', $url['query']['redirect_uri']);
    }

    public function test_container_resolves_a_new_gateway_each_time(): void
    {
        // Arrange
        $this->configureMicrosoft365();

        // Act
        $first = app(MicrosoftOAuthGateway::class);
        $second = app(MicrosoftOAuthGateway::class);

        // Assert
        $this->assertInstanceOf(SocialiteMicrosoftGateway::class, $first);
        $this->assertInstanceOf(SocialiteMicrosoftGateway::class, $second);
        $this->assertNotSame($first, $second);
    }
}
