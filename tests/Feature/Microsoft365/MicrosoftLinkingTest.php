<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Microsoft365\Auth\MicrosoftIdentity;
use App\Microsoft365\Auth\MicrosoftIdentityGuard;
use App\Microsoft365\Auth\MicrosoftIdentityResolver;
use App\Microsoft365\Auth\MicrosoftSignInException;
use App\Microsoft365\Auth\MicrosoftSignInFailure;
use App\Microsoft365\Http\Controllers\MicrosoftAuthController;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Models\Member;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

#[CoversClass(MicrosoftIdentityResolver::class)]
#[UsesClass(MicrosoftAuthController::class)]
#[UsesClass(MicrosoftIdentityGuard::class)]
#[UsesClass(MicrosoftSignInException::class)]
#[UsesClass(MicrosoftSignInFailure::class)]
#[UsesClass(MicrosoftIdentity::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
#[UsesClass(MicrosoftAccount::class)]
class MicrosoftLinkingTest extends TestCaseWithDatabase
{
    use InteractsWithMicrosoft365;

    public function test_links_existing_verified_user_by_email_case_insensitively(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $user = User::factory()->create(['email' => 'ada@example.test']);
        DB::table('users')->where('id', '=', $user->getKey())->update(['email' => 'Ada@Example.test']);
        $member = Member::factory()->forUser($user)->forOrganization($organization)->role(Role::Manager)->create();
        $passwordBefore = DB::table('users')->where('id', '=', $user->getKey())->value('password');
        $membershipsBefore = Member::query()->where('user_id', '=', $user->getKey())->orderBy('id')->get(['id', 'organization_id', 'role'])->toArray();
        $userCount = User::query()->count();
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity([
            'mail' => 'ADA@example.TEST',
            'userPrincipalName' => 'ada@example.test',
        ]));

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('dashboard', [], false));
        $this->assertAuthenticatedAs($user);
        $this->assertSame(1, MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->count());
        $this->assertSame(1, MicrosoftAccount::query()->count());
        $this->assertSame($userCount, User::query()->count());
        $this->assertSame($passwordBefore, DB::table('users')->where('id', '=', $user->getKey())->value('password'));
        $this->assertSame($membershipsBefore, Member::query()->where('user_id', '=', $user->getKey())->orderBy('id')->get(['id', 'organization_id', 'role'])->toArray());
        $this->assertSame(Role::Manager->value, $member->fresh()?->role);
    }

    public function test_links_by_upn_when_mail_differs(): void
    {
        // Arrange
        $this->configureMicrosoft365(null);
        $user = User::factory()->create(['email' => 'ada@example.test']);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity([
            'mail' => null,
            'userPrincipalName' => 'ada@example.test',
        ]));
        $userCount = User::query()->count();

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('dashboard', [], false));
        $this->assertAuthenticatedAs($user);
        $this->assertSame($userCount, User::query()->count());
        $this->assertDatabaseHas('microsoft_accounts', [
            'user_id' => $user->getKey(),
            'microsoft_oid' => self::MICROSOFT_TEST_OBJECT_ID,
        ]);
    }

    public function test_unverified_account_is_never_linked(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $user = User::factory()->unverified()->create(['email' => 'ada@example.test']);
        $rowBefore = DB::table('users')->where('id', '=', $user->getKey())->first();
        $userCount = User::query()->count();
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('login', [], false));
        $response->assertSessionHas('message', __('microsoft365.error.unverified_account'));
        $this->assertGuest();
        $this->assertSame(0, MicrosoftAccount::query()->count());
        $this->assertSame($userCount, User::query()->count());
        $this->assertEquals($rowBefore, DB::table('users')->where('id', '=', $user->getKey())->first());
    }

    public function test_placeholder_with_same_email_is_not_logged_into(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $placeholder = User::factory()->placeholder()->create(['email' => 'ada@example.test']);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('dashboard', [], false));
        $this->assertAuthenticated();
        $authenticated = Auth::guard('web')->user();
        $this->assertInstanceOf(User::class, $authenticated);
        $this->assertNotSame($placeholder->getKey(), $authenticated->getKey());
        $this->assertFalse($authenticated->is_placeholder);
        $this->assertSame('ada@example.test', $authenticated->email);
        $this->assertDatabaseMissing('microsoft_accounts', ['user_id' => $placeholder->getKey()]);
        $this->assertDatabaseHas('microsoft_accounts', ['user_id' => $authenticated->getKey()]);
    }

    public function test_two_candidate_users_are_refused_as_ambiguous(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        User::factory()->create(['email' => 'ada@example.test']);
        User::factory()->create(['email' => 'ada.upn@example.test']);
        $userCount = User::query()->count();
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity([
            'mail' => 'ada@example.test',
            'userPrincipalName' => 'ada.upn@example.test',
        ]));

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('login', [], false));
        $response->assertSessionHas('message', __('microsoft365.error.ambiguous_account'));
        $this->assertGuest();
        $this->assertSame(0, MicrosoftAccount::query()->count());
        $this->assertSame($userCount, User::query()->count());
    }

    public function test_user_already_linked_to_another_identity_is_refused(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $user = User::factory()->create(['email' => 'ada@example.test']);
        $existing = new MicrosoftAccount;
        $existing->user()->associate($user);
        $existing->tenant_id = self::MICROSOFT_TEST_TENANT_ID;
        $existing->microsoft_oid = '00000000-0000-4000-8000-0000000000b9';
        $existing->save();
        $userCount = User::query()->count();
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('login', [], false));
        $response->assertSessionHas('message', __('microsoft365.error.already_linked'));
        $this->assertGuest();
        $this->assertSame(1, MicrosoftAccount::query()->count());
        $this->assertSame('00000000-0000-4000-8000-0000000000b9', $existing->fresh()?->microsoft_oid);
        $this->assertSame($userCount, User::query()->count());
    }

    public function test_candidates_outside_the_allowlist_are_ignored(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $outsider = User::factory()->create(['email' => 'ada@other.test']);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity([
            'mail' => 'ada@example.test',
            'userPrincipalName' => 'ada@other.test',
        ]));

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('dashboard', [], false));
        $authenticated = Auth::guard('web')->user();
        $this->assertInstanceOf(User::class, $authenticated);
        $this->assertNotSame($outsider->getKey(), $authenticated->getKey());
        $this->assertSame('ada@example.test', $authenticated->email);
        $this->assertDatabaseMissing('microsoft_accounts', ['user_id' => $outsider->getKey()]);
    }

    public function test_returning_identity_resolves_by_tid_oid_after_email_changes(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $user = User::factory()->create(['email' => 'ada@example.test']);
        $gateway = $this->fakeMicrosoftGateway();
        $gateway->willReturn($this->microsoftIdentity());
        $this->get($this->callbackUrl())->assertRedirect(route('dashboard', [], false));
        $this->assertAuthenticatedAs($user);
        Auth::guard('web')->logout();
        $this->flushSession();
        DB::table('users')->where('id', '=', $user->getKey())->update(['email' => 'ada.renamed@example.test']);
        $gateway->willReturn($this->microsoftIdentity([
            'mail' => 'ada.entra@example.test',
            'userPrincipalName' => 'ada.entra@example.test',
        ]));
        $userCount = User::query()->count();
        $accountCount = MicrosoftAccount::query()->count();

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('dashboard', [], false));
        $this->assertAuthenticatedAs($user);
        $this->assertSame($userCount, User::query()->count());
        $this->assertSame($accountCount, MicrosoftAccount::query()->count());
        $this->assertSame('ada.renamed@example.test', $user->fresh()?->email);
    }

    private function callbackUrl(): string
    {
        return route('microsoft.callback', ['code' => 'fake-code', 'state' => 'fake-state'], false);
    }
}
