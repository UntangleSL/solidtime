<?php

declare(strict_types=1);

namespace Tests\Feature\Appearance;

use App\Appearance\AccentPreset;
use App\Appearance\AppearanceResolver;
use App\Appearance\AppearanceServiceProvider;
use App\Appearance\Http\Controllers\AppearanceController;
use App\Appearance\Http\Middleware\ShareAppearanceInertiaData;
use App\Appearance\Http\Requests\AppearanceUpdateRequest;
use App\Appearance\Models\UserAppearanceSetting;
use App\Events\BeforeOrganizationDeletion;
use App\Models\User;
use App\Service\DeletionService;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Route;
use Inertia\Testing\AssertableInertia;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

#[CoversClass(AppearanceController::class)]
#[CoversClass(AppearanceResolver::class)]
#[CoversClass(ShareAppearanceInertiaData::class)]
#[UsesClass(AppearanceUpdateRequest::class)]
#[UsesClass(UserAppearanceSetting::class)]
#[UsesClass(AccentPreset::class)]
#[UsesClass(AppearanceServiceProvider::class)]
class UserAppearanceTest extends TestCaseWithDatabase
{
    private function createUser(): User
    {
        return User::factory()->withPersonalOrganization()->create();
    }

    private function settingFor(User $user): ?UserAppearanceSetting
    {
        return UserAppearanceSetting::query()->where('user_id', '=', $user->getKey())->first();
    }

    public function test_put_stores_theme_and_accent_for_the_session_user(): void
    {
        // Arrange
        $user = $this->createUser();
        $this->actingAs($user);

        // Act
        $response = $this->putJson(route('appearance.update', [], false), [
            'theme' => 'dark',
            'accent' => 'violet',
        ]);

        // Assert
        $response->assertStatus(200);
        $response->assertExactJson(['theme' => 'dark', 'accent' => 'violet']);
        $this->assertSame(1, UserAppearanceSetting::query()->where('user_id', '=', $user->getKey())->count());
        $setting = $this->settingFor($user);
        $this->assertNotNull($setting);
        $this->assertSame('dark', $setting->theme);
        $this->assertSame('violet', $setting->accent);
    }

    public function test_second_put_updates_the_same_row(): void
    {
        // Arrange
        $user = $this->createUser();
        $this->actingAs($user);
        $this->putJson(route('appearance.update', [], false), ['theme' => 'dark', 'accent' => 'violet'])
            ->assertStatus(200);

        // Act
        $response = $this->putJson(route('appearance.update', [], false), ['theme' => 'light', 'accent' => 'ember']);

        // Assert
        $response->assertStatus(200);
        $response->assertExactJson(['theme' => 'light', 'accent' => 'ember']);
        $this->assertSame(1, UserAppearanceSetting::query()->count());
        $setting = $this->settingFor($user);
        $this->assertNotNull($setting);
        $this->assertSame('light', $setting->theme);
        $this->assertSame('ember', $setting->accent);
    }

    public function test_partial_put_keeps_the_other_value(): void
    {
        // Arrange
        $user = $this->createUser();
        $this->actingAs($user);
        $this->putJson(route('appearance.update', [], false), ['theme' => 'light'])->assertStatus(200);

        // Act
        $response = $this->putJson(route('appearance.update', [], false), ['accent' => 'azure']);

        // Assert
        $response->assertStatus(200);
        $response->assertExactJson(['theme' => 'light', 'accent' => 'azure']);
        $setting = $this->settingFor($user);
        $this->assertNotNull($setting);
        $this->assertSame('light', $setting->theme);
        $this->assertSame('azure', $setting->accent);
    }

    public function test_null_resets_a_value(): void
    {
        // Arrange
        $user = $this->createUser();
        $this->actingAs($user);
        $this->putJson(route('appearance.update', [], false), ['theme' => 'dark', 'accent' => 'graphite'])
            ->assertStatus(200);

        // Act
        $response = $this->putJson(route('appearance.update', [], false), ['accent' => null]);

        // Assert
        $response->assertStatus(200);
        $response->assertExactJson(['theme' => 'dark', 'accent' => null]);
        $setting = $this->settingFor($user);
        $this->assertNotNull($setting);
        $this->assertSame('dark', $setting->theme);
        $this->assertNull($setting->accent);
    }

    public function test_invalid_values_are_rejected(): void
    {
        // Arrange
        $user = $this->createUser();
        $this->actingAs($user);
        $bodies = [
            ['theme' => 'blue'],
            ['accent' => 'rose'],
            ['accent' => 'gold'],
            ['accent' => 'sky'],
            ['theme' => 'dark', 'accent' => 'rose'],
            [],
        ];

        foreach ($bodies as $body) {
            // Act
            $response = $this->putJson(route('appearance.update', [], false), $body);

            // Assert
            $response->assertStatus(422);
        }
        $this->assertSame(0, UserAppearanceSetting::query()->count());
    }

    public function test_guest_gets_401_json_and_redirect_html(): void
    {
        // Act
        $json = $this->putJson(route('appearance.update', [], false), ['theme' => 'dark']);
        $html = $this->put(route('appearance.update', [], false), ['theme' => 'dark']);

        // Assert
        $json->assertStatus(401);
        $html->assertRedirect(route('login', [], false));
        $this->assertSame(0, UserAppearanceSetting::query()->count());
    }

    public function test_a_user_id_in_the_body_is_ignored(): void
    {
        // Arrange
        $user = $this->createUser();
        $other = $this->createUser();
        $this->actingAs($user);

        // Act
        $response = $this->putJson(route('appearance.update', [], false), [
            'user_id' => $other->getKey(),
            'theme' => 'dark',
            'accent' => 'indigo',
        ]);

        // Assert
        $response->assertStatus(200);
        $setting = $this->settingFor($user);
        $this->assertNotNull($setting);
        $this->assertSame('dark', $setting->theme);
        $this->assertSame('indigo', $setting->accent);
        $this->assertNull($this->settingFor($other));
    }

    public function test_settings_row_is_deleted_with_the_user(): void
    {
        // Arrange
        // Same as DeletionServiceTest: extension listeners of the organization deletion are out of scope
        Event::fake([BeforeOrganizationDeletion::class]);
        $user = $this->createUser();
        $other = $this->createUser();
        UserAppearanceSetting::query()->create(['user_id' => $user->getKey(), 'theme' => 'dark', 'accent' => 'ember']);
        UserAppearanceSetting::query()->create(['user_id' => $other->getKey(), 'theme' => 'light', 'accent' => 'azure']);

        // Act
        app(DeletionService::class)->deleteUser($user);

        // Assert
        $this->assertNull(User::query()->find($user->getKey()));
        $this->assertNull($this->settingFor($user));
        $this->assertNotNull($this->settingFor($other));
    }

    public function test_route_is_a_web_session_route_not_under_api(): void
    {
        // Act
        $route = Route::getRoutes()->getByName('appearance.update');

        // Assert
        $this->assertNotNull($route);
        $this->assertSame('user/appearance', $route->uri());
        $this->assertContains('PUT', $route->methods());
        $this->assertStringStartsNotWith('api/', $route->uri());
        $middleware = $route->gatherMiddleware();
        $this->assertContains('web', $middleware);
        $this->assertContains('auth:web', $middleware);
        $this->assertContains('auth.session', $middleware);
        $this->assertContains('verified', $middleware);
        $this->assertContains('throttle:60,1,appearance:', $middleware);
        $this->assertSame([], $route->parameterNames());
    }

    public function test_appearance_prop_carries_saved_values_presets_labels_and_update_url(): void
    {
        // Arrange
        $user = $this->createUser();
        UserAppearanceSetting::query()->create(['user_id' => $user->getKey(), 'theme' => 'dark', 'accent' => 'violet']);
        $this->actingAs($user);

        // Act
        $response = $this->get(route('dashboard', [], false));

        // Assert
        $response->assertStatus(200);
        $response->assertInertia(fn (AssertableInertia $page) => $page
            ->where('appearance.theme', 'dark')
            ->where('appearance.accent', 'violet')
            ->where('appearance.accents', AccentPreset::values())
            ->where('appearance.update_url', route('appearance.update'))
            ->where('appearance.labels.accent_label', 'Accent color')
            ->where('appearance.labels.theme_helper', 'Follows your device setting. Currently: :mode.')
            ->has('appearance.labels', 23)
            ->where('appearance.presets.ember', 'Ember')
            ->has('appearance.presets', 6)
            ->etc());
    }

    public function test_user_without_settings_gets_null_values(): void
    {
        // Arrange
        $this->actingAs($this->createUser());

        // Act
        $response = $this->get(route('dashboard', [], false));

        // Assert
        $response->assertStatus(200);
        $response->assertInertia(fn (AssertableInertia $page) => $page
            ->where('appearance.theme', null)
            ->where('appearance.accent', null)
            ->where('appearance.update_url', route('appearance.update'))
            ->etc());
    }

    public function test_guest_prop_has_no_update_url(): void
    {
        // Act
        $response = $this->get(route('login', [], false));

        // Assert
        $response->assertStatus(200);
        $response->assertInertia(fn (AssertableInertia $page) => $page
            ->where('appearance.theme', null)
            ->where('appearance.accent', null)
            ->where('appearance.update_url', null)
            ->where('appearance.accents', AccentPreset::values())
            ->etc());
    }

    public function test_unknown_stored_values_are_not_shared(): void
    {
        // Arrange
        $user = $this->createUser();
        UserAppearanceSetting::query()->create(['user_id' => $user->getKey(), 'theme' => 'blue', 'accent' => 'sky']);
        $this->actingAs($user);

        // Act
        $response = $this->get(route('dashboard', [], false));

        // Assert
        $response->assertStatus(200);
        $response->assertInertia(fn (AssertableInertia $page) => $page
            ->where('appearance.theme', null)
            ->where('appearance.accent', null)
            ->etc());
    }

    public function test_boot_payload_matches_the_session_user(): void
    {
        // Arrange
        $user = $this->createUser();
        UserAppearanceSetting::query()->create(['user_id' => $user->getKey(), 'theme' => 'light', 'accent' => 'ember']);

        // Act
        $guestPayload = app(AppearanceResolver::class)->bootPayload();
        $this->actingAs($user);
        $userPayload = app(AppearanceResolver::class)->bootPayload();

        // Assert
        $this->assertSame(['theme' => null, 'accent' => null, 'accents' => AccentPreset::values()], $guestPayload);
        $this->assertSame(['theme' => 'light', 'accent' => 'ember', 'accents' => AccentPreset::values()], $userPayload);
    }

    public function test_accent_preset_values_are_the_six_presets_in_order(): void
    {
        // Act
        $values = AccentPreset::values();

        // Assert
        $this->assertSame(['untangle', 'azure', 'indigo', 'violet', 'ember', 'graphite'], $values);
    }
}
