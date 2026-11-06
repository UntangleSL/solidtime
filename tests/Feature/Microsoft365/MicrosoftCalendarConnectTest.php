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
use App\Models\User;
use Illuminate\Support\Carbon;
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
