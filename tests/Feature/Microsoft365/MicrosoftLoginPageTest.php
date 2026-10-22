<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Microsoft365\Http\Middleware\EnsureMicrosoftIsEnabled;
use App\Microsoft365\Http\Middleware\ShareMicrosoftInertiaData;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use Illuminate\Testing\Fluent\AssertableJson;
use Inertia\ResponseFactory;
use Inertia\Testing\AssertableInertia;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

#[CoversClass(ShareMicrosoftInertiaData::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(EnsureMicrosoftIsEnabled::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
class MicrosoftLoginPageTest extends TestCaseWithDatabase
{
    use InteractsWithMicrosoft365;

    public function test_login_page_exposes_microsoft_prop_when_configured(): void
    {
        // Arrange
        $this->configureMicrosoft365();

        // Act
        $response = $this->get('/login');

        // Assert
        $response->assertStatus(200);
        $response->assertInertia(fn (AssertableInertia $page) => $page
            ->where('microsoft.enabled', true)
            ->where('microsoft.login_url', route('microsoft.redirect'))
            ->where('microsoft.labels.sign_in', __('microsoft365.ui.sign_in'))
            ->where('microsoft.labels.sign_in_hint', __('microsoft365.ui.sign_in_hint'))
            ->etc());
    }

    public function test_unconfigured_integration_hides_prop_and_404s_routes(): void
    {
        // Arrange
        $this->configureMicrosoft365(null, ['client_id' => null]);
        $gateway = $this->fakeMicrosoftGateway();

        // Act
        $login = $this->get('/login');
        $redirect = $this->get(route('microsoft.redirect', [], false));
        $callback = $this->get(route('microsoft.callback', [], false));

        // Assert
        $login->assertInertia(fn (AssertableInertia $page) => $page->where('microsoft.enabled', false)->etc());
        $redirect->assertNotFound();
        $callback->assertNotFound();
        $this->assertSame(0, $gateway->authenticateCalls());
    }

    public function test_blank_config_values_count_as_unconfigured(): void
    {
        foreach ([['client_id' => ''], ['tenant_id' => '   '], ['client_secret' => '']] as $overrides) {
            // Arrange
            $this->configureMicrosoft365(null, $overrides);
            $gateway = $this->fakeMicrosoftGateway();

            // Act
            $login = $this->get('/login');
            $redirect = $this->get(route('microsoft.redirect', [], false));
            $callback = $this->get(route('microsoft.callback', [], false));

            // Assert
            $login->assertInertia(fn (AssertableInertia $page) => $page->where('microsoft.enabled', false)->etc());
            $redirect->assertNotFound();
            $callback->assertNotFound();
            $this->assertSame(0, $gateway->authenticateCalls());
        }
    }

    public function test_microsoft_prop_survives_inertia_flush_between_requests(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $expectedUrl = route('microsoft.redirect');
        $first = $this->get('/login');

        // Act: what Octane's PrepareInertiaForNextOperation does between two requests
        app(ResponseFactory::class)->flushShared();
        $second = $this->get('/login');

        // Assert
        $first->assertInertia(fn (AssertableInertia $page) => $page
            ->where('microsoft.enabled', true)
            ->where('microsoft.login_url', $expectedUrl)
            ->etc());
        $second->assertInertia(fn (AssertableInertia $page) => $page
            ->where('microsoft.enabled', true)
            ->where('microsoft.login_url', $expectedUrl)
            ->etc());
    }

    public function test_microsoft_prop_has_only_public_keys(): void
    {
        // Arrange
        $this->configureMicrosoft365();

        // Act
        $configured = $this->get('/login');
        $this->configureMicrosoft365(null, ['client_id' => null]);
        $unconfigured = $this->get('/login');

        // Assert
        $configured->assertInertia(fn (AssertableInertia $page) => $page
            ->has('microsoft', fn (AssertableJson $microsoft) => $microsoft
                ->where('enabled', true)
                ->where('login_url', route('microsoft.redirect'))
                ->has('labels', fn (AssertableJson $labels) => $labels
                    ->where('sign_in', __('microsoft365.ui.sign_in'))
                    ->where('sign_in_hint', __('microsoft365.ui.sign_in_hint'))))
            ->etc());
        $unconfigured->assertInertia(fn (AssertableInertia $page) => $page
            ->has('microsoft', fn (AssertableJson $microsoft) => $microsoft->where('enabled', false))
            ->etc());
    }
}
