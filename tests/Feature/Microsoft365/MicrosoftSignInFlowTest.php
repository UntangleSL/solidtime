<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Microsoft365\Auth\MicrosoftIdentity;
use App\Microsoft365\Auth\MicrosoftIdentityResolver;
use App\Microsoft365\Http\Controllers\MicrosoftAuthController;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Models\Member;
use App\Models\Organization;
use App\Models\User;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

#[CoversClass(MicrosoftAuthController::class)]
#[UsesClass(MicrosoftIdentityResolver::class)]
#[UsesClass(MicrosoftIdentity::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
#[UsesClass(MicrosoftAccount::class)]
class MicrosoftSignInFlowTest extends TestCaseWithDatabase
{
    use InteractsWithMicrosoft365;

    public function test_redirect_stores_valid_browser_timezone_and_hands_off_to_gateway(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $this->fakeMicrosoftGateway();

        // Act
        $response = $this->get(route('microsoft.redirect', ['timezone' => 'Europe/Berlin'], false));

        // Assert
        $response->assertRedirectContains('/auth/microsoft/callback?code=fake-code&state=fake-state');
        $response->assertSessionHas('microsoft.timezone', 'Europe/Berlin');
    }

    public function test_redirect_ignores_an_invalid_browser_timezone(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $this->fakeMicrosoftGateway();

        // Act
        $response = $this->get(route('microsoft.redirect', ['timezone' => 'Not/AZone'], false));

        // Assert
        $response->assertRedirectContains('/auth/microsoft/callback');
        $response->assertSessionMissing('microsoft.timezone');
    }

    public function test_first_sign_in_provisions_verified_passwordless_employee_and_lands_on_dashboard(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $organizationCount = Organization::query()->count();
        $this->configureMicrosoft365($organization);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity([
            'tenantId' => strtoupper(self::MICROSOFT_TEST_TENANT_ID),
            'objectId' => strtoupper(self::MICROSOFT_TEST_OBJECT_ID),
        ]));

        // Act
        $response = $this
            ->withSession(['microsoft.timezone' => 'Europe/Berlin'])
            ->get(route('microsoft.callback', ['code' => 'fake-code', 'state' => 'fake-state'], false));

        // Assert
        $response->assertRedirect(route('dashboard', [], false));
        $this->assertAuthenticated();
        $user = User::query()->where('email', 'ada@example.test')->firstOrFail();
        $this->assertAuthenticatedAs($user);
        $this->assertNull($user->password);
        $this->assertNotNull($user->email_verified_at);
        $this->assertSame('Europe/Berlin', $user->timezone);
        $this->assertFalse($user->is_placeholder);
        $this->assertSame($organization->getKey(), $user->current_team_id);
        $members = Member::query()->where('user_id', $user->getKey())->get();
        $this->assertCount(1, $members);
        $this->assertSame(Role::Employee->value, $members->firstOrFail()->role);
        $this->assertSame($organization->getKey(), $members->firstOrFail()->organization_id);
        $this->assertSame($organizationCount, Organization::query()->count());
        $this->assertDatabaseHas('microsoft_accounts', [
            'user_id' => $user->getKey(),
            'tenant_id' => self::MICROSOFT_TEST_TENANT_ID,
            'microsoft_oid' => self::MICROSOFT_TEST_OBJECT_ID,
        ]);
        $this->get(route('dashboard', [], false))->assertStatus(200);
    }
}
