<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Events\MemberAdded;
use App\Events\MemberAdding;
use App\Microsoft365\Auth\MicrosoftIdentity;
use App\Microsoft365\Auth\MicrosoftIdentityGuard;
use App\Microsoft365\Auth\MicrosoftIdentityResolver;
use App\Microsoft365\Auth\MicrosoftSignInException;
use App\Microsoft365\Auth\MicrosoftSignInFailure;
use App\Microsoft365\Auth\MicrosoftUserProvisioner;
use App\Microsoft365\Http\Controllers\MicrosoftAuthController;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Models\Member;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Event;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

#[CoversClass(MicrosoftUserProvisioner::class)]
#[UsesClass(MicrosoftAuthController::class)]
#[UsesClass(MicrosoftIdentityResolver::class)]
#[UsesClass(MicrosoftIdentityGuard::class)]
#[UsesClass(MicrosoftSignInException::class)]
#[UsesClass(MicrosoftSignInFailure::class)]
#[UsesClass(MicrosoftIdentity::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
#[UsesClass(MicrosoftAccount::class)]
class MicrosoftProvisioningTest extends TestCaseWithDatabase
{
    use InteractsWithMicrosoft365;

    public function test_provisioned_user_is_verified_passwordless_employee_of_configured_org(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $organizationCount = Organization::query()->count();
        $this->configureMicrosoft365($organization);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity([
            'displayName' => 'Ada Example',
            'mail' => 'Ada.Lovelace@Example.TEST',
            'userPrincipalName' => 'Ada.Lovelace@Example.TEST',
        ]));

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('dashboard', [], false));
        $user = User::query()->where('email', '=', 'ada.lovelace@example.test')->firstOrFail();
        $this->assertAuthenticatedAs($user);
        $this->assertSame('Ada Example', $user->name);
        $this->assertNull($user->password);
        $this->assertNotNull($user->email_verified_at);
        $this->assertFalse($user->is_placeholder);
        $this->assertSame($organization->getKey(), $user->current_team_id);
        $members = Member::query()->where('user_id', '=', $user->getKey())->get();
        $this->assertCount(1, $members);
        $this->assertSame(Role::Employee->value, $members->firstOrFail()->role);
        $this->assertSame($organization->getKey(), $members->firstOrFail()->organization_id);
        $this->assertSame($organizationCount, Organization::query()->count());
        $this->assertSame(0, Organization::query()->where('user_id', '=', $user->getKey())->count());
    }

    public function test_provisioning_dispatches_member_events(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        Event::fake([MemberAdding::class, MemberAdded::class]);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());

        // Act
        $this->get($this->callbackUrl())->assertRedirect(route('dashboard', [], false));

        // Assert
        Event::assertDispatchedTimes(MemberAdding::class, 1);
        Event::assertDispatchedTimes(MemberAdded::class, 1);
        Event::assertDispatched(MemberAdding::class, fn (MemberAdding $event): bool => $event->role === Role::Employee
            && $event->organization->is($organization));
    }

    public function test_name_falls_back_to_email_local_part(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $provisioner = $this->app->make(MicrosoftUserProvisioner::class);

        // Act
        $fromNull = $provisioner->provision($this->microsoftIdentity(['displayName' => null]), null);
        $fromBlank = $provisioner->provision($this->microsoftIdentity([
            'displayName' => '   ',
            'mail' => 'grace@example.test',
            'userPrincipalName' => 'grace@example.test',
        ]), null);

        // Assert
        $this->assertSame('ada', $fromNull->name);
        $this->assertSame('grace', $fromBlank->name);
    }

    public function test_timezone_uses_valid_browser_value_else_configured_default(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $provisioner = $this->app->make(MicrosoftUserProvisioner::class);

        // Act
        $browser = $provisioner->provision($this->identityFor('browser'), 'Europe/Berlin');
        $default = $provisioner->provision($this->identityFor('default'), null);
        $invalidBrowser = $provisioner->provision($this->identityFor('invalid'), 'Not/AZone');
        $this->configureMicrosoft365($organization, ['default_timezone' => 'Mars/Olympus']);
        $fallback = $provisioner->provision($this->identityFor('fallback'), null);

        // Assert
        $this->assertSame('Europe/Berlin', $browser->timezone);
        $this->assertSame('Europe/Madrid', $default->timezone);
        $this->assertSame('Europe/Madrid', $invalidBrowser->timezone);
        $this->assertSame('UTC', $fallback->timezone);
    }

    public function test_provisioning_works_with_registration_off_and_invite_only(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $gateway = $this->fakeMicrosoftGateway();

        foreach (['off', 'invite-only'] as $mode) {
            Config::set('app.enable_registration', $mode);
            $gateway->willReturn($this->identityFor($mode));

            // Act
            $response = $this->get($this->callbackUrl());

            // Assert
            $response->assertRedirect(route('dashboard', [], false));
            $user = User::query()->where('email', '=', $mode.'@example.test')->firstOrFail();
            $this->assertAuthenticatedAs($user);
            $this->assertSame(Role::Employee->value, Member::query()->where('user_id', '=', $user->getKey())->firstOrFail()->role);
            Auth::guard('web')->logout();
            $this->flushSession();
        }
    }

    public function test_missing_or_unknown_organization_refuses_provisioning_but_links_existing_users(): void
    {
        // Arrange
        $gateway = $this->fakeMicrosoftGateway();
        $userCount = User::query()->count();
        $existing = User::factory()->create(['email' => 'grace@example.test']);

        foreach ([null, '', '00000000-0000-4000-8000-00000000dead'] as $organizationId) {
            $this->configureMicrosoft365(null, ['organization_id' => $organizationId]);
            $gateway->willReturn($this->identityFor('newcomer'));

            // Act
            $response = $this->get($this->callbackUrl());

            // Assert
            $response->assertRedirect(route('login', [], false));
            $response->assertSessionHas('message', __('microsoft365.error.provisioning_unavailable'));
            $this->assertGuest();
            $this->assertSame($userCount + 1, User::query()->count());
            $this->assertSame(0, MicrosoftAccount::query()->count());
        }

        // Act
        $gateway->willReturn($this->identityFor('grace'));
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('dashboard', [], false));
        $this->assertAuthenticatedAs($existing);
        $this->assertSame(1, MicrosoftAccount::query()->where('user_id', '=', $existing->getKey())->count());
        $this->assertSame($userCount + 1, User::query()->count());
    }

    public function test_placeholder_member_is_merged_into_provisioned_user(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $placeholder = User::factory()->placeholder()->create(['email' => 'ada@example.test']);
        $placeholderMember = Member::factory()->forUser($placeholder)->forOrganization($organization)->role(Role::Placeholder)->create();
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('dashboard', [], false));
        $user = Auth::guard('web')->user();
        $this->assertInstanceOf(User::class, $user);
        $this->assertNotSame($placeholder->getKey(), $user->getKey());
        $this->assertDatabaseMissing('members', ['id' => $placeholderMember->getKey()]);
        $this->assertDatabaseMissing('users', ['id' => $placeholder->getKey()]);
        $this->assertDatabaseHas('members', [
            'user_id' => $user->getKey(),
            'organization_id' => $organization->getKey(),
            'role' => Role::Employee->value,
        ]);
    }

    public function test_f1_user_without_mailbox_is_provisioned_from_upn(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity([
            'mail' => null,
            'userPrincipalName' => 'f1.freelance@example.test',
        ]));

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('dashboard', [], false));
        $user = Auth::guard('web')->user();
        $this->assertInstanceOf(User::class, $user);
        $this->assertSame('f1.freelance@example.test', $user->email);
        $this->assertDatabaseHas('microsoft_accounts', [
            'user_id' => $user->getKey(),
            'microsoft_email' => 'f1.freelance@example.test',
        ]);
    }

    /**
     * A distinct person per local part: own object id and own address.
     */
    private function identityFor(string $localPart): MicrosoftIdentity
    {
        $objectId = '00000000-0000-4000-8000-'.substr(md5($localPart), 0, 12);

        return $this->microsoftIdentity([
            'objectId' => $objectId,
            'graphId' => $objectId,
            'displayName' => ucfirst($localPart),
            'mail' => $localPart.'@example.test',
            'userPrincipalName' => $localPart.'@example.test',
        ]);
    }

    private function callbackUrl(): string
    {
        return route('microsoft.callback', ['code' => 'fake-code', 'state' => 'fake-state'], false);
    }
}
