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
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use RuntimeException;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;
use TiMacDonald\Log\LogEntry;

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

    public function test_returning_identity_logs_in_same_user_without_duplicates(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->get($this->callbackUrl())->assertRedirect(route('dashboard', [], false));
        $user = User::query()->where('email', 'ada@example.test')->firstOrFail();
        $userCount = User::query()->count();
        $accountCount = MicrosoftAccount::query()->count();
        Auth::guard('web')->logout();
        $this->flushSession();
        $this->assertGuest();

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('dashboard', [], false));
        $this->assertAuthenticatedAs($user);
        $this->assertSame($userCount, User::query()->count());
        $this->assertSame($accountCount, MicrosoftAccount::query()->count());
        $this->assertSame(1, Member::query()->where('user_id', $user->getKey())->count());
    }

    public function test_tokens_are_stored_encrypted(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $identity = $this->microsoftIdentity();
        $this->fakeMicrosoftGateway()->willReturn($identity);

        // Act
        $this->get($this->callbackUrl());

        // Assert
        $raw = DB::table('microsoft_accounts')->first();
        $this->assertNotNull($raw);
        $this->assertIsString($raw->access_token);
        $this->assertIsString($raw->refresh_token);
        $this->assertNotSame($identity->accessToken, $raw->access_token);
        $this->assertNotSame($identity->refreshToken, $raw->refresh_token);
        $this->assertStringNotContainsString($identity->accessToken, $raw->access_token);
        $this->assertStringNotContainsString((string) $identity->refreshToken, $raw->refresh_token);
        $account = MicrosoftAccount::query()->firstOrFail();
        $this->assertSame($identity->accessToken, $account->access_token);
        $this->assertSame($identity->refreshToken, $account->refresh_token);
        $this->assertArrayNotHasKey('access_token', $account->toArray());
        $this->assertArrayNotHasKey('refresh_token', $account->toArray());
        $this->assertSame($identity->scopes, $account->scopes);
        $this->assertNotNull($account->access_token_expires_at);
        $this->assertNotNull($account->last_login_at);
    }

    public function test_gateway_exception_returns_guest_to_login_without_side_effects(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $this->fakeMicrosoftGateway()->willThrow(new RuntimeException('boom-detail-41'));
        $userCount = User::query()->count();

        // Act
        $response = $this
            ->withSession(['microsoft.timezone' => 'Europe/Berlin'])
            ->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('login', [], false));
        $this->assertGuest();
        $this->assertSame($userCount, User::query()->count());
        $this->assertSame(0, MicrosoftAccount::query()->count());
        $response->assertSessionMissing('microsoft.timezone');
        Log::assertLogged(fn (LogEntry $log) => $log->level === 'error'
            && $log->message === 'Microsoft sign-in failed'
            && $log->context === ['reason' => 'unexpected', 'exception' => RuntimeException::class]);
        Log::assertNotLogged(fn (LogEntry $log) => str_contains($log->message, 'boom-detail-41')
            || str_contains((string) json_encode($log->context), 'boom-detail-41'));
    }

    public function test_missing_organization_never_creates_a_user(): void
    {
        // Arrange
        $this->configureMicrosoft365(null);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $userCount = User::query()->count();

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('login', [], false));
        $this->assertGuest();
        $this->assertSame($userCount, User::query()->count());
        $this->assertSame(0, MicrosoftAccount::query()->count());
    }

    public function test_two_identities_in_one_process_get_two_distinct_users(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $gateway = $this->fakeMicrosoftGateway();
        $gateway->willReturn($this->microsoftIdentity());
        $this->get($this->callbackUrl());
        $userA = User::query()->where('email', 'ada@example.test')->firstOrFail();
        Auth::guard('web')->logout();
        $this->flushSession();
        $gateway->willReturn($this->microsoftIdentity([
            'objectId' => '00000000-0000-4000-8000-0000000000b2',
            'graphId' => '00000000-0000-4000-8000-0000000000b2',
            'displayName' => 'Bob Example',
            'mail' => 'bob@example.test',
            'userPrincipalName' => 'bob@example.test',
        ]));

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('dashboard', [], false));
        $userB = User::query()->where('email', 'bob@example.test')->firstOrFail();
        $this->assertNotSame($userA->getKey(), $userB->getKey());
        $this->assertAuthenticatedAs($userB);
        $this->assertSame(2, MicrosoftAccount::query()->count());
        $this->assertSame(2, User::query()->whereIn('email', ['ada@example.test', 'bob@example.test'])->count());
    }

    public function test_invalid_timezone_falls_back_to_configured_default(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->get(route('microsoft.redirect', ['timezone' => 'Not/AZone'], false));

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('dashboard', [], false));
        $user = User::query()->where('email', 'ada@example.test')->firstOrFail();
        $this->assertSame('Europe/Madrid', $user->timezone);
    }

    private function callbackUrl(): string
    {
        return route('microsoft.callback', ['code' => 'fake-code', 'state' => 'fake-state'], false);
    }
}
