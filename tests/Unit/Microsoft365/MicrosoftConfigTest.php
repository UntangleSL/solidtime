<?php

declare(strict_types=1);

namespace Tests\Unit\Microsoft365;

use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use Illuminate\Support\Facades\Config;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCase;

#[CoversClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
class MicrosoftConfigTest extends TestCase
{
    use InteractsWithMicrosoft365;

    /**
     * @return array<string, array{0: string, 1: string|null, 2: string}>
     */
    public static function blankValueProvider(): array
    {
        return [
            'client id null' => ['client_id', null, 'SOLIDTIME_MICROSOFT_CLIENT_ID'],
            'client id empty' => ['client_id', '', 'SOLIDTIME_MICROSOFT_CLIENT_ID'],
            'client id whitespace' => ['client_id', '   ', 'SOLIDTIME_MICROSOFT_CLIENT_ID'],
            'secret null' => ['client_secret', null, 'SOLIDTIME_MICROSOFT_CLIENT_SECRET'],
            'secret empty' => ['client_secret', '', 'SOLIDTIME_MICROSOFT_CLIENT_SECRET'],
            'secret whitespace' => ['client_secret', '   ', 'SOLIDTIME_MICROSOFT_CLIENT_SECRET'],
            'tenant null' => ['tenant_id', null, 'SOLIDTIME_MICROSOFT_TENANT_ID'],
            'tenant empty' => ['tenant_id', '', 'SOLIDTIME_MICROSOFT_TENANT_ID'],
            'tenant whitespace' => ['tenant_id', '   ', 'SOLIDTIME_MICROSOFT_TENANT_ID'],
            'tenant common' => ['tenant_id', 'common', 'SOLIDTIME_MICROSOFT_TENANT_ID'],
            'tenant organizations' => ['tenant_id', 'organizations', 'SOLIDTIME_MICROSOFT_TENANT_ID'],
            'tenant not a guid' => ['tenant_id', 'not-a-guid', 'SOLIDTIME_MICROSOFT_TENANT_ID'],
            'client id not a guid' => ['client_id', 'not-a-guid', 'SOLIDTIME_MICROSOFT_CLIENT_ID'],
        ];
    }

    #[DataProvider('blankValueProvider')]
    public function test_blank_or_invalid_value_is_unconfigured_and_named(string $key, ?string $value, string $expectedName): void
    {
        // Arrange
        $this->configureMicrosoft365(null, [$key => $value]);

        // Act
        $config = new MicrosoftConfig;

        // Assert
        $this->assertFalse($config->isConfigured());
        $this->assertSame([$expectedName], $config->missingKeys());
    }

    public function test_everything_blank_lists_the_three_names(): void
    {
        // Arrange
        $this->configureMicrosoft365(null, ['client_id' => '', 'client_secret' => '', 'tenant_id' => '']);

        // Act
        $missing = (new MicrosoftConfig)->missingKeys();

        // Assert
        $this->assertSame([
            'SOLIDTIME_MICROSOFT_CLIENT_ID',
            'SOLIDTIME_MICROSOFT_CLIENT_SECRET',
            'SOLIDTIME_MICROSOFT_TENANT_ID',
        ], $missing);
    }

    public function test_valid_values_are_configured(): void
    {
        // Arrange
        $this->configureMicrosoft365();

        // Act
        $config = new MicrosoftConfig;

        // Assert
        $this->assertTrue($config->isConfigured());
        $this->assertSame([], $config->missingKeys());
    }

    public function test_tenant_id_is_lower_cased(): void
    {
        // Arrange
        $this->configureMicrosoft365(null, ['tenant_id' => strtoupper(self::MICROSOFT_TEST_TENANT_ID)]);

        // Act
        $tenantId = (new MicrosoftConfig)->tenantId();

        // Assert
        $this->assertSame(self::MICROSOFT_TEST_TENANT_ID, $tenantId);
    }

    public function test_allowed_domains_are_normalised_and_deduplicated(): void
    {
        // Arrange
        $this->configureMicrosoft365(null, ['allowed_domains' => ' Untangle.ES , ,untanglegrowth.com,untangle.es ']);

        // Act
        $domains = (new MicrosoftConfig)->allowedDomains();

        // Assert
        $this->assertEqualsCanonicalizing(['untangle.es', 'untanglegrowth.com'], $domains);
        $this->assertCount(2, $domains);
    }

    public function test_allowed_domains_array_input_is_normalised_the_same_way(): void
    {
        // Arrange
        $this->configureMicrosoft365(null, ['allowed_domains' => [' Untangle.ES ', '', 'untanglegrowth.com', 'UNTANGLE.es']]);

        // Act
        $domains = (new MicrosoftConfig)->allowedDomains();

        // Assert
        $this->assertEqualsCanonicalizing(['untangle.es', 'untanglegrowth.com'], $domains);
        $this->assertCount(2, $domains);
    }

    public function test_empty_allowed_domains_means_none(): void
    {
        // Arrange
        $this->configureMicrosoft365(null, ['allowed_domains' => '']);

        // Act
        $domains = (new MicrosoftConfig)->allowedDomains();

        // Assert
        $this->assertSame([], $domains);
    }

    public function test_shipped_default_for_allowed_domains_is_the_untangle_pair(): void
    {
        // Arrange
        $shipped = require config_path('microsoft365.php');
        Config::set('microsoft365.allowed_domains', $shipped['allowed_domains']);

        // Act
        $domains = (new MicrosoftConfig)->allowedDomains();

        // Assert
        $this->assertEqualsCanonicalizing(['untanglegrowth.com', 'untangle.es'], $domains);
    }

    public function test_redirect_uri_is_built_from_app_url_without_double_slash(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        Config::set('app.url', 'https://time.example.test/');

        // Act
        $uri = (new MicrosoftConfig)->redirectUri();

        // Assert
        $this->assertSame('https://time.example.test/auth/microsoft/callback', $uri);
    }

    public function test_redirect_uri_override_wins_verbatim(): void
    {
        // Arrange
        $this->configureMicrosoft365(null, ['redirect_uri' => 'https://override.example.test/auth/microsoft/callback']);

        // Act
        $uri = (new MicrosoftConfig)->redirectUri();

        // Assert
        $this->assertSame('https://override.example.test/auth/microsoft/callback', $uri);
    }

    public function test_blank_redirect_uri_override_is_ignored(): void
    {
        // Arrange
        $this->configureMicrosoft365(null, ['redirect_uri' => '   ']);

        // Act
        $uri = (new MicrosoftConfig)->redirectUri();

        // Assert
        $this->assertSame('https://time.example.test/auth/microsoft/callback', $uri);
    }

    public function test_organization_id_is_null_unless_it_is_a_uuid(): void
    {
        // Arrange
        $valid = '00000000-0000-4000-8000-0000000000d1';

        // Act
        $values = [];
        foreach (['', '   ', 'not-a-uuid', $valid, ' '.$valid.' '] as $input) {
            $this->configureMicrosoft365(null, ['organization_id' => $input]);
            $values[] = (new MicrosoftConfig)->organizationId();
        }

        // Assert
        $this->assertSame([null, null, null, $valid, $valid], $values);
    }

    public function test_invalid_organization_id_does_not_make_the_integration_unconfigured(): void
    {
        // Arrange
        $this->configureMicrosoft365(null, ['organization_id' => 'not-a-uuid']);

        // Act
        $config = new MicrosoftConfig;

        // Assert
        $this->assertTrue($config->isConfigured());
        $this->assertNull($config->organizationId());
    }
}
