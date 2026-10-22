<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Microsoft365\Auth\MicrosoftIdentity;
use App\Microsoft365\Auth\MicrosoftIdentityGuard;
use App\Microsoft365\Auth\MicrosoftIdentityResolver;
use App\Microsoft365\Auth\MicrosoftSignInException;
use App\Microsoft365\Auth\MicrosoftSignInFailure;
use App\Microsoft365\Http\Controllers\MicrosoftAccountController;
use App\Microsoft365\Http\Controllers\MicrosoftAuthController;
use App\Microsoft365\Http\Middleware\EnsureMicrosoftIsEnabled;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Models\Member;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Auth;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

#[CoversClass(MicrosoftAccountController::class)]
#[UsesClass(MicrosoftAuthController::class)]
#[UsesClass(MicrosoftIdentityResolver::class)]
#[UsesClass(MicrosoftIdentityGuard::class)]
#[UsesClass(MicrosoftSignInException::class)]
#[UsesClass(MicrosoftSignInFailure::class)]
#[UsesClass(MicrosoftIdentity::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(EnsureMicrosoftIsEnabled::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
#[UsesClass(MicrosoftAccount::class)]
class MicrosoftAccountTest extends TestCaseWithDatabase
{
    use InteractsWithMicrosoft365;

    private const string OTHER_OBJECT_ID = '00000000-0000-4000-8000-0000000000b2';

    public function test_disconnect_nulls_tokens_keeps_identity_and_time_entries(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->linkAccount($user, withTokens: true);
        $member = Member::query()->where('user_id', '=', $user->getKey())->firstOrFail();
        TimeEntry::factory()->forMember($member)->count(3)->create();
        $before = $this->timeEntrySnapshot();
        $this->actingAs($user);

        // Act
        $response = $this->delete(route('microsoft.account.destroy', [], false));

        // Assert
        $response->assertRedirect(route('profile.show', [], false));
        $response->assertSessionHas('microsoft365.notice', __('microsoft365.ui.disconnected_notice'));
        $fresh = MicrosoftAccount::query()->findOrFail($account->getKey());
        $this->assertSame($user->getKey(), $fresh->user_id);
        $this->assertSame(self::MICROSOFT_TEST_TENANT_ID, $fresh->tenant_id);
        $this->assertSame(self::MICROSOFT_TEST_OBJECT_ID, $fresh->microsoft_oid);
        $this->assertNull($fresh->access_token);
        $this->assertNull($fresh->refresh_token);
        $this->assertNull($fresh->access_token_expires_at);
        $this->assertNull($fresh->scopes);
        $this->assertNotNull($fresh->disconnected_at);
        $this->assertFalse($fresh->isConnected());
        $this->assertSame(3, TimeEntry::query()->count());
        $this->assertSame($before, $this->timeEntrySnapshot());
    }

    public function test_disconnect_without_account_or_twice_is_a_no_op(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->actingAs($user);

        // Act
        $withoutAccount = $this->delete(route('microsoft.account.destroy', [], false));

        // Assert
        $withoutAccount->assertRedirect(route('profile.show', [], false));
        $withoutAccount->assertSessionHasNoErrors();
        $this->assertSame(0, MicrosoftAccount::query()->count());

        // Arrange
        $account = $this->linkAccount($user, withTokens: true);
        $this->delete(route('microsoft.account.destroy', [], false))->assertRedirect(route('profile.show', [], false));
        $firstDisconnect = MicrosoftAccount::query()->findOrFail($account->getKey())->disconnected_at;
        $this->assertNotNull($firstDisconnect);
        $this->travel(5)->minutes();

        // Act
        $second = $this->delete(route('microsoft.account.destroy', [], false));

        // Assert
        $second->assertRedirect(route('profile.show', [], false));
        $second->assertSessionHasNoErrors();
        $this->assertSame(1, MicrosoftAccount::query()->count());
        $this->assertEquals($firstDisconnect, MicrosoftAccount::query()->findOrFail($account->getKey())->disconnected_at);
    }

    public function test_disconnect_requires_authentication(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->linkAccount($user, withTokens: true);

        // Act
        $response = $this->delete(route('microsoft.account.destroy', [], false));

        // Assert
        $response->assertRedirect(route('login', [], false));
        $this->assertNull(MicrosoftAccount::query()->findOrFail($account->getKey())->disconnected_at);
    }

    public function test_disconnect_only_affects_the_current_user(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $other = $this->createUser();
        $this->linkAccount($user, withTokens: true);
        $otherAccount = $this->linkAccount($other, self::OTHER_OBJECT_ID, withTokens: true);
        $this->actingAs($user);

        // Act
        $this->delete(route('microsoft.account.destroy', [], false))->assertRedirect(route('profile.show', [], false));

        // Assert
        $untouched = MicrosoftAccount::query()->findOrFail($otherAccount->getKey());
        $this->assertNull($untouched->disconnected_at);
        $this->assertSame('at-marker-7f3c', $untouched->access_token);
        $this->assertSame('rt-marker-9d1e', $untouched->refresh_token);
        $this->assertTrue($untouched->isConnected());
    }

    public function test_sign_in_after_disconnect_works_without_storing_tokens(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser(['email' => 'ada@example.test', 'password' => null]);
        $account = $this->linkAccount($user, withTokens: true);
        $account->last_login_at = Carbon::parse('2020-01-01 00:00:00', 'UTC');
        $account->save();
        $this->actingAs($user);
        $this->delete(route('microsoft.account.destroy', [], false))->assertRedirect(route('profile.show', [], false));
        Auth::guard('web')->logout();
        $this->flushSession();
        $this->assertGuest();
        $disconnectedAt = MicrosoftAccount::query()->findOrFail($account->getKey())->disconnected_at;
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('dashboard', [], false));
        $this->assertAuthenticatedAs($user);
        $fresh = MicrosoftAccount::query()->findOrFail($account->getKey());
        $this->assertNull($fresh->access_token);
        $this->assertNull($fresh->refresh_token);
        $this->assertNull($fresh->access_token_expires_at);
        $this->assertNull($fresh->scopes);
        $this->assertEquals($disconnectedAt, $fresh->disconnected_at);
        $this->assertNotNull($fresh->last_login_at);
        $this->assertTrue($fresh->last_login_at->greaterThan(Carbon::parse('2020-01-01 00:00:00', 'UTC')));
        $this->assertSame(1, MicrosoftAccount::query()->count());
    }

    public function test_connect_intent_requires_authentication(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $gateway = $this->fakeMicrosoftGateway();

        // Act
        $response = $this->get(route('microsoft.redirect', ['intent' => 'connect'], false));

        // Assert
        $response->assertRedirect(route('login', [], false));
        $this->assertSame(0, $gateway->authenticateCalls());
        $response->assertSessionMissing('microsoft.intent');
    }

    public function test_connect_restores_tokens_for_same_identity(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->linkAccount($user, withTokens: true);
        $account->access_token = null;
        $account->refresh_token = null;
        $account->scopes = null;
        $account->access_token_expires_at = null;
        $account->disconnected_at = Carbon::now()->subDay();
        $account->save();
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->actingAs($user);

        // Act
        $this->get(route('microsoft.redirect', ['intent' => 'connect'], false))->assertRedirect();
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('profile.show', [], false));
        $response->assertSessionHas('microsoft365.notice', __('microsoft365.ui.connected_notice'));
        $fresh = MicrosoftAccount::query()->findOrFail($account->getKey());
        $this->assertSame('at-marker-7f3c', $fresh->access_token);
        $this->assertSame('rt-marker-9d1e', $fresh->refresh_token);
        $this->assertNotNull($fresh->access_token_expires_at);
        $this->assertContains('Calendars.Read', $fresh->scopes ?? []);
        $this->assertNull($fresh->disconnected_at);
        $this->assertTrue($fresh->isConnected());
        $this->assertSame(1, MicrosoftAccount::query()->count());
    }

    public function test_connect_links_unlinked_password_user(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser(['email' => 'someone.else@example.test']);
        $this->assertNotNull($user->password);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->actingAs($user);

        // Act
        $this->get(route('microsoft.redirect', ['intent' => 'connect'], false))->assertRedirect();
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('profile.show', [], false));
        $account = MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->firstOrFail();
        $this->assertSame(self::MICROSOFT_TEST_TENANT_ID, $account->tenant_id);
        $this->assertSame(self::MICROSOFT_TEST_OBJECT_ID, $account->microsoft_oid);
        $this->assertSame('ada@example.test', $account->microsoft_email);
        $this->assertSame('at-marker-7f3c', $account->access_token);
        $this->assertTrue($account->isConnected());
        $this->assertAuthenticatedAs($user);
    }

    public function test_connect_refuses_identity_in_use(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $owner = $this->createUser();
        $holder = $this->linkAccount($owner, withTokens: true);
        $user = $this->createUser();
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->actingAs($user);

        // Act
        $this->get(route('microsoft.redirect', ['intent' => 'connect'], false))->assertRedirect();
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('profile.show', [], false));
        $response->assertSessionHas('microsoft365.notice', __('microsoft365.error.identity_in_use'));
        $this->assertSame(1, MicrosoftAccount::query()->count());
        $this->assertSame($owner->getKey(), MicrosoftAccount::query()->findOrFail($holder->getKey())->user_id);
        $this->assertFalse(MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->exists());
    }

    public function test_connect_refuses_when_user_linked_to_other_identity(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $existing = $this->linkAccount($user, self::MICROSOFT_TEST_OBJECT_ID, withTokens: true);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity([
            'objectId' => self::OTHER_OBJECT_ID,
            'graphId' => self::OTHER_OBJECT_ID,
            'accessToken' => 'at-other-identity',
            'refreshToken' => 'rt-other-identity',
        ]));
        $this->actingAs($user);

        // Act
        $this->get(route('microsoft.redirect', ['intent' => 'connect'], false))->assertRedirect();
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('profile.show', [], false));
        $response->assertSessionHas('microsoft365.notice', __('microsoft365.error.already_linked'));
        $this->assertSame(1, MicrosoftAccount::query()->count());
        $fresh = MicrosoftAccount::query()->findOrFail($existing->getKey());
        $this->assertSame(self::MICROSOFT_TEST_OBJECT_ID, $fresh->microsoft_oid);
        $this->assertSame('at-marker-7f3c', $fresh->access_token);
    }

    public function test_connect_callback_for_a_different_session_user_is_interrupted(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $gateway = $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->actingAs($user);

        // Act
        $response = $this->withSession([
            'microsoft.intent' => 'connect',
            'microsoft.connect_user_id' => '00000000-0000-4000-8000-00000000dead',
        ])->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('profile.show', [], false));
        $response->assertSessionHas('microsoft365.notice', __('microsoft365.error.interrupted'));
        $this->assertSame(0, $gateway->authenticateCalls());
        $this->assertSame(0, MicrosoftAccount::query()->count());
    }

    public function test_connect_callback_without_a_session_user_goes_to_login(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $gateway = $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());

        // Act
        $response = $this->withSession([
            'microsoft.intent' => 'connect',
            'microsoft.connect_user_id' => '00000000-0000-4000-8000-00000000dead',
        ])->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('login', [], false));
        $this->assertSame(0, $gateway->authenticateCalls());
        $this->assertGuest();
        $this->assertSame(0, MicrosoftAccount::query()->count());
    }

    public function test_authenticated_connect_callback_runs_before_dashboard_shortcut(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $gateway = $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->actingAs($user);

        // Act
        $redirect = $this->get(route('microsoft.redirect', ['intent' => 'connect'], false));

        // Assert
        $redirect->assertRedirect();
        $redirect->assertSessionHas('microsoft.intent', 'connect');
        $redirect->assertSessionHas('microsoft.connect_user_id', $user->getKey());

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('profile.show', [], false));
        $this->assertNotSame(route('dashboard', [], false), parse_url((string) $response->headers->get('Location'), PHP_URL_PATH));
        $this->assertSame(1, $gateway->authenticateCalls());
        $account = MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->firstOrFail();
        $this->assertSame('at-marker-7f3c', $account->access_token);
        $this->assertNull($account->disconnected_at);
    }

    public function test_callback_query_intent_is_ignored_without_session_intent(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $gateway = $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->actingAs($user);

        // Act
        $response = $this->get(route('microsoft.callback', ['intent' => 'connect', 'code' => 'x', 'state' => 'y'], false));

        // Assert
        $response->assertRedirect(route('dashboard', [], false));
        $this->assertSame(0, $gateway->authenticateCalls());
        $this->assertSame(0, MicrosoftAccount::query()->count());
    }

    public function test_connect_session_keys_are_cleared_on_every_exit(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $holder = $this->createUser();
        $gateway = $this->fakeMicrosoftGateway();
        $this->actingAs($user);

        // Act: successful connect
        $gateway->willReturn($this->microsoftIdentity());
        $this->get(route('microsoft.redirect', ['intent' => 'connect'], false))->assertRedirect();
        $success = $this->get($this->callbackUrl());

        // Assert
        $success->assertRedirect(route('profile.show', [], false));
        $success->assertSessionMissing('microsoft.intent');
        $success->assertSessionMissing('microsoft.connect_user_id');

        // Arrange: another identity that belongs to someone else
        $this->linkAccount($holder, self::OTHER_OBJECT_ID, withTokens: true);
        MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->delete();
        $gateway->willReturn($this->microsoftIdentity([
            'objectId' => self::OTHER_OBJECT_ID,
            'graphId' => self::OTHER_OBJECT_ID,
        ]));

        // Act: refused connect
        $this->get(route('microsoft.redirect', ['intent' => 'connect'], false))->assertRedirect();
        $refused = $this->get($this->callbackUrl());

        // Assert
        $refused->assertSessionHas('microsoft365.notice', __('microsoft365.error.identity_in_use'));
        $refused->assertSessionMissing('microsoft.intent');
        $refused->assertSessionMissing('microsoft.connect_user_id');

        // Act: interrupted connect (the session names someone else)
        $interrupted = $this->withSession([
            'microsoft.intent' => 'connect',
            'microsoft.connect_user_id' => $holder->getKey(),
        ])->get($this->callbackUrl());

        // Assert
        $interrupted->assertSessionHas('microsoft365.notice', __('microsoft365.error.interrupted'));
        $interrupted->assertSessionMissing('microsoft.intent');
        $interrupted->assertSessionMissing('microsoft.connect_user_id');
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function createUser(array $attributes = []): User
    {
        return User::factory()->withPersonalOrganization()->create($attributes);
    }

    private function linkAccount(User $user, string $objectId = self::MICROSOFT_TEST_OBJECT_ID, bool $withTokens = false): MicrosoftAccount
    {
        $account = new MicrosoftAccount;
        $account->user()->associate($user);
        $account->tenant_id = self::MICROSOFT_TEST_TENANT_ID;
        $account->microsoft_oid = $objectId;
        $account->microsoft_email = 'ada@example.test';
        if ($withTokens) {
            $account->access_token = 'at-marker-7f3c';
            $account->refresh_token = 'rt-marker-9d1e';
            $account->access_token_expires_at = Carbon::now()->addHour();
            $account->scopes = ['openid', 'User.Read', 'Calendars.Read'];
        }
        $account->save();

        return $account;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function timeEntrySnapshot(): array
    {
        return TimeEntry::query()
            ->orderBy('id')
            ->get(['id', 'start', 'end', 'description', 'project_id', 'user_id', 'member_id', 'organization_id'])
            ->map(fn (TimeEntry $entry): array => $entry->getAttributes())
            ->all();
    }

    private function callbackUrl(): string
    {
        return route('microsoft.callback', ['code' => 'fake-code', 'state' => 'fake-state'], false);
    }
}
