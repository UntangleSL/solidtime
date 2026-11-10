<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Microsoft365\Auth\MicrosoftIdentity;
use App\Microsoft365\Auth\MicrosoftIdentityGuard;
use App\Microsoft365\Auth\MicrosoftIdentityResolver;
use App\Microsoft365\Auth\MicrosoftSignInException;
use App\Microsoft365\Auth\MicrosoftSignInFailure;
use App\Microsoft365\Http\Controllers\MicrosoftAuthController;
use App\Microsoft365\Http\Middleware\EnsureMicrosoftIsEnabled;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

#[CoversClass(MicrosoftAuthController::class)]
#[UsesClass(MicrosoftIdentityResolver::class)]
#[UsesClass(MicrosoftIdentityGuard::class)]
#[UsesClass(MicrosoftSignInException::class)]
#[UsesClass(MicrosoftSignInFailure::class)]
#[UsesClass(MicrosoftIdentity::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(EnsureMicrosoftIsEnabled::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
#[UsesClass(MicrosoftAccount::class)]
class MicrosoftCalendarConnectTest extends TestCaseWithDatabase
{
    use InteractsWithMicrosoft365;

    public function test_authenticated_connect_with_return_calendar_stores_the_return_target(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $gateway = $this->fakeMicrosoftGateway();
        $this->actingAs($user);

        // Act
        $response = $this->get(route('microsoft.redirect', ['intent' => 'connect', 'return' => 'calendar'], false));

        // Assert
        $response->assertRedirect();
        $response->assertSessionHas('microsoft.return', 'calendar');
        $response->assertSessionHas('microsoft.intent', 'connect');
        $response->assertSessionHas('microsoft.connect_user_id', $user->getKey());
        $this->assertSame(0, $gateway->authenticateCalls());
    }

    public function test_connect_callback_with_return_calendar_lands_on_the_calendar_with_a_success_notice(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->linkAccount($user);
        $account->reconnect_required_at = Carbon::now()->subMinute();
        $account->save();
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->actingAs($user);

        // Act
        $this->get(route('microsoft.redirect', ['intent' => 'connect', 'return' => 'calendar'], false))->assertRedirect();
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('calendar', [], false));
        $response->assertSessionHas('microsoft365.notice', __('microsoft365.ui.connected_notice'));
        $response->assertSessionHas('microsoft365.notice_level', 'success');
        $fresh = MicrosoftAccount::query()->findOrFail($account->getKey());
        $this->assertTrue($fresh->isConnected());
        $this->assertNull($fresh->reconnect_required_at);
        $this->assertSame('connected', $fresh->calendarAccessState());
    }

    public function test_refused_connect_with_return_calendar_lands_on_the_calendar_with_an_error_notice(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $holder = $this->createUser();
        $this->linkAccount($holder);
        $user = $this->createUser();
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->actingAs($user);

        // Act
        $this->get(route('microsoft.redirect', ['intent' => 'connect', 'return' => 'calendar'], false))->assertRedirect();
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('calendar', [], false));
        $response->assertSessionHas('microsoft365.notice', __('microsoft365.error.identity_in_use'));
        $response->assertSessionHas('microsoft365.notice_level', 'error');
        $this->assertFalse(MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->exists());
    }

    public function test_cancelled_connect_with_return_calendar_lands_on_the_calendar_with_an_error_notice(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $gateway = $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->actingAs($user);
        $this->get(route('microsoft.redirect', ['intent' => 'connect', 'return' => 'calendar'], false))->assertRedirect();

        // Act
        $response = $this->get(route('microsoft.callback', ['error' => 'access_denied'], false));

        // Assert
        $response->assertRedirect(route('calendar', [], false));
        $response->assertSessionHas('microsoft365.notice', __('microsoft365.error.cancelled'));
        $response->assertSessionHas('microsoft365.notice_level', 'error');
        $this->assertSame(0, $gateway->authenticateCalls());
    }

    public function test_return_values_other_than_calendar_are_ignored_and_the_callback_goes_to_the_profile(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->actingAs($user);

        foreach (['profile', 'https://evil.example.test', '//evil.example.test', 'CALENDAR', '/calendar'] as $value) {
            // Act
            $redirect = $this->get(route('microsoft.redirect', ['intent' => 'connect', 'return' => $value], false));

            // Assert: the session is read before the callback pulls (and forgets) its keys
            $redirect->assertRedirect();
            $redirect->assertSessionMissing('microsoft.return');
            $redirect->assertSessionHas('microsoft.intent', 'connect');

            // Act
            $response = $this->get($this->callbackUrl());

            // Assert
            $response->assertRedirect(route('profile.show', [], false));
            $this->assertStringNotContainsString('evil.example.test', (string) $response->headers->get('Location'));
            $response->assertSessionHas('microsoft365.notice', __('microsoft365.ui.connected_notice'));
            $response->assertSessionMissing('microsoft365.notice_level');
        }
    }

    public function test_return_as_an_array_is_ignored(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->actingAs($user);

        // Act
        $redirect = $this->get('/auth/microsoft/redirect?intent=connect&return[]=calendar');
        $redirect->assertSessionMissing('microsoft.return');
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('profile.show', [], false));
    }

    public function test_a_connect_without_return_clears_a_return_target_left_by_an_abandoned_connect(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->actingAs($user);
        $this->get(route('microsoft.redirect', ['intent' => 'connect', 'return' => 'calendar'], false))->assertRedirect();

        // Act: the user never came back from Microsoft and starts a Connect from the profile instead
        $redirect = $this->get(route('microsoft.redirect', ['intent' => 'connect'], false));
        $redirect->assertSessionMissing('microsoft.return');
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('profile.show', [], false));
    }

    public function test_guest_redirect_with_return_calendar_stores_nothing_and_keeps_the_intended_url(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->get('/time')->assertRedirect(route('login'));

        // Act: no connect intent, so the return value means nothing to a sign-in
        $redirect = $this->get(route('microsoft.redirect', ['return' => 'calendar'], false));
        $redirect->assertRedirect();
        $redirect->assertSessionMissing('microsoft.return');
        $redirect->assertSessionMissing('microsoft.intent');
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(url('/time'));
        $this->assertAuthenticated();
        $response->assertSessionMissing('microsoft.return');
    }

    public function test_guest_connect_with_return_calendar_goes_to_login_and_stores_nothing(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $gateway = $this->fakeMicrosoftGateway();

        // Act
        $response = $this->get(route('microsoft.redirect', ['intent' => 'connect', 'return' => 'calendar'], false));

        // Assert
        $response->assertRedirect(route('login', [], false));
        $response->assertSessionMissing('microsoft.return');
        $response->assertSessionMissing('microsoft.intent');
        $this->assertSame(0, $gateway->authenticateCalls());
    }

    public function test_a_stale_return_target_without_a_connect_intent_is_dropped(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $gateway = $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->actingAs($user);

        // Act
        $response = $this->withSession(['microsoft.return' => 'calendar'])->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('dashboard', [], false));
        $response->assertSessionMissing('microsoft.return');
        $this->assertSame(0, $gateway->authenticateCalls());
    }

    public function test_return_target_is_cleared_after_success_refusal_and_interruption(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $holder = $this->createUser();
        $gateway = $this->fakeMicrosoftGateway();
        $this->actingAs($user);

        // Act: successful connect
        $gateway->willReturn($this->microsoftIdentity());
        $this->get(route('microsoft.redirect', ['intent' => 'connect', 'return' => 'calendar'], false))->assertRedirect();
        $success = $this->get($this->callbackUrl());

        // Assert
        $success->assertRedirect(route('calendar', [], false));
        $this->assertSessionKeysCleared($success);

        // Arrange: the identity now belongs to someone else
        MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->delete();
        $this->linkAccount($holder);

        // Act: refused connect
        $this->get(route('microsoft.redirect', ['intent' => 'connect', 'return' => 'calendar'], false))->assertRedirect();
        $refused = $this->get($this->callbackUrl());

        // Assert
        $refused->assertRedirect(route('calendar', [], false));
        $this->assertSessionKeysCleared($refused);

        // Act: interrupted connect (the session names someone else)
        $interrupted = $this->withSession([
            'microsoft.intent' => 'connect',
            'microsoft.connect_user_id' => $holder->getKey(),
            'microsoft.return' => 'calendar',
        ])->get($this->callbackUrl());

        // Assert
        $interrupted->assertRedirect(route('calendar', [], false));
        $interrupted->assertSessionHas('microsoft365.notice', __('microsoft365.error.interrupted'));
        $interrupted->assertSessionHas('microsoft365.notice_level', 'error');
        $this->assertSessionKeysCleared($interrupted);
    }

    private function assertSessionKeysCleared(TestResponse $response): void
    {
        $response->assertSessionMissing('microsoft.return');
        $response->assertSessionMissing('microsoft.intent');
        $response->assertSessionMissing('microsoft.connect_user_id');
    }

    private function createUser(): User
    {
        return User::factory()->withPersonalOrganization()->create();
    }

    private function linkAccount(User $user): MicrosoftAccount
    {
        $account = new MicrosoftAccount;
        $account->user()->associate($user);
        $account->tenant_id = self::MICROSOFT_TEST_TENANT_ID;
        $account->microsoft_oid = self::MICROSOFT_TEST_OBJECT_ID;
        $account->microsoft_email = 'ada@example.test';
        $account->access_token = 'at-old-marker';
        $account->refresh_token = 'rt-old-marker';
        $account->access_token_expires_at = Carbon::now()->subHour();
        $account->scopes = ['openid', 'User.Read', 'Calendars.Read'];
        $account->save();

        return $account;
    }

    private function callbackUrl(): string
    {
        return route('microsoft.callback', ['code' => 'fake-code', 'state' => 'fake-state'], false);
    }
}
