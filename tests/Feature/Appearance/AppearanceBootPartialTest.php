<?php

declare(strict_types=1);

namespace Tests\Feature\Appearance;

use App\Appearance\AccentPreset;
use App\Appearance\AppearanceResolver;
use App\Appearance\AppearanceServiceProvider;
use App\Appearance\Http\Requests\AppearanceUpdateRequest;
use App\Appearance\Models\UserAppearanceSetting;
use App\Models\Passport\Client;
use App\Models\User;
use Illuminate\Support\Js;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

/**
 * Rendered-HTML contract of resources/views/branding/early-theme.blade.php: the pre-paint
 * partial is in the head of every full page load, carries only the session user's own
 * allow-listed values, and runs before the routes script and the bundles.
 */
#[CoversClass(AppearanceResolver::class)]
#[UsesClass(AccentPreset::class)]
#[UsesClass(AppearanceServiceProvider::class)]
#[UsesClass(AppearanceUpdateRequest::class)]
#[UsesClass(UserAppearanceSetting::class)]
class AppearanceBootPartialTest extends TestCaseWithDatabase
{
    private function createUserWithAppearance(?string $theme, ?string $accent): User
    {
        $user = User::factory()->withPersonalOrganization()->create();
        UserAppearanceSetting::query()->create([
            'user_id' => $user->getKey(),
            'theme' => $theme,
            'accent' => $accent,
        ]);

        return $user;
    }

    /**
     * @param  array{theme: string|null, accent: string|null}  $values
     */
    private function expectedPayload(array $values): string
    {
        return Js::from([
            'theme' => $values['theme'],
            'accent' => $values['accent'],
            'accents' => AccentPreset::values(),
        ])->toHtml();
    }

    private function dashboardHtmlFor(User $user): string
    {
        $this->actingAs($user);
        $response = $this->get('/dashboard');
        $response->assertSuccessful();
        $html = $response->getContent();
        $this->assertIsString($html);

        return $html;
    }

    public function test_guest_page_carries_the_partial_with_null_values(): void
    {
        // Act
        $response = $this->get('/login');

        // Assert
        $response->assertSuccessful();
        $html = $response->getContent();
        $this->assertIsString($html);
        $this->assertSame(1, substr_count($html, '<script data-early-theme>'));
        $this->assertStringContainsString('window.__APPEARANCE__ = ', $html);
        $this->assertStringContainsString(
            'window.__APPEARANCE__ = '.$this->expectedPayload(['theme' => null, 'accent' => null]).';',
            $html
        );
    }

    public function test_saved_preference_is_in_the_payload(): void
    {
        // Arrange
        $user = $this->createUserWithAppearance('dark', 'violet');

        // Act
        $html = $this->dashboardHtmlFor($user);

        // Assert
        $this->assertStringContainsString(
            'window.__APPEARANCE__ = '.$this->expectedPayload(['theme' => 'dark', 'accent' => 'violet']).';',
            $html
        );
    }

    public function test_unknown_stored_values_are_not_printed(): void
    {
        // Arrange: a hand-edited row never reaches the inline script
        $user = $this->createUserWithAppearance('blue', 'rose');

        // Act
        $html = $this->dashboardHtmlFor($user);

        // Assert
        $this->assertStringContainsString(
            'window.__APPEARANCE__ = '.$this->expectedPayload(['theme' => null, 'accent' => null]).';',
            $html
        );
    }

    public function test_partial_runs_before_routes_and_assets(): void
    {
        // Arrange
        $user = $this->createUserWithAppearance('light', 'ember');

        // Act
        $html = $this->dashboardHtmlFor($user);

        // Assert
        $partial = strpos($html, '<script data-early-theme>');
        $payload = strpos($html, 'window.__APPEARANCE__ = ');
        $routes = strpos($html, 'const Ziggy=');
        $assets = strpos($html, '/build/assets/');
        $headEnd = strpos($html, '</head>');
        $this->assertNotFalse($partial);
        $this->assertNotFalse($payload);
        $this->assertNotFalse($routes, 'The Ziggy routes script is missing from the page.');
        $this->assertNotFalse($assets, 'No built asset tag found; the front end must be built before this test.');
        $this->assertNotFalse($headEnd);
        $this->assertLessThan($partial, $payload, 'The payload must be assigned before the logic script runs.');
        $this->assertLessThan($routes, $partial);
        $this->assertLessThan($assets, $partial);
        $this->assertLessThan($headEnd, $partial);
        $this->assertLessThan(strpos($html, '<link rel="stylesheet"') ?: PHP_INT_MAX, $partial);
    }

    public function test_theme_color_metas(): void
    {
        // Act
        $response = $this->get('/login');

        // Assert
        $response->assertSuccessful();
        $html = $response->getContent();
        $this->assertIsString($html);
        $this->assertStringContainsString(
            '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1C1C1C">',
            $html
        );
        $this->assertStringContainsString(
            '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#F9FCFD">',
            $html
        );
        $this->assertStringNotContainsString('name="theme-color" content="#000000"', $html);
    }

    public function test_oauth_authorize_page_uses_the_partial_instead_of_its_inline_copy(): void
    {
        // Arrange
        $user = $this->createUserWithAppearance('light', 'azure');
        $this->actingAs($user);
        $client = Client::factory()->make(['name' => 'Appearance test client']);

        // Act
        $html = view('auth.oauth.authorize', [
            'client' => $client,
            'scopes' => [],
            'request' => request(),
            'authToken' => 'dummy-auth-token',
        ])->render();

        // Assert
        $this->assertSame(1, substr_count($html, '<script data-early-theme>'));
        $this->assertStringContainsString(
            'window.__APPEARANCE__ = '.$this->expectedPayload(['theme' => 'light', 'accent' => 'azure']).';',
            $html
        );
        $this->assertStringNotContainsString("localStorage.getItem('theme') || 'system'", $html);
        $this->assertStringContainsString('<html lang="en" class="light">', $html);
        $this->assertStringContainsString('Appearance test client', $html);
        $partial = strpos($html, '<script data-early-theme>');
        $stylesheet = strpos($html, '/build/assets/');
        $this->assertNotFalse($partial);
        $this->assertNotFalse($stylesheet, 'No built asset tag found; the front end must be built before this test.');
        $this->assertLessThan($stylesheet, $partial);
    }
}
