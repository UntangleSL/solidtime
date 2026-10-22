<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Microsoft365\Auth\MicrosoftIdentity;
use App\Microsoft365\Auth\MicrosoftIdentityGuard;
use App\Microsoft365\Auth\MicrosoftIdentityResolver;
use App\Microsoft365\Auth\MicrosoftSignInException;
use App\Microsoft365\Auth\MicrosoftSignInFailure;
use App\Microsoft365\Http\Controllers\MicrosoftAuthController;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Laravel\Passport\ClientRepository;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;
use TiMacDonald\Log\LogEntry;

#[CoversClass(MicrosoftAuthController::class)]
#[UsesClass(MicrosoftIdentityResolver::class)]
#[UsesClass(MicrosoftIdentityGuard::class)]
#[UsesClass(MicrosoftSignInException::class)]
#[UsesClass(MicrosoftSignInFailure::class)]
#[UsesClass(MicrosoftIdentity::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
#[UsesClass(MicrosoftAccount::class)]
class MicrosoftSessionTest extends TestCaseWithDatabase
{
    use InteractsWithMicrosoft365;

    private const string COMPLETED_MESSAGE = 'Microsoft sign-in completed';

    public function test_totp_user_signing_in_with_microsoft_skips_fortify_challenge(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $user = $this->createTotpUser();
        $this->linkMicrosoftAccount($user);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('dashboard', [], false));
        $response->assertSessionMissing('login.id');
        $this->assertAuthenticatedAs($user);
    }

    public function test_password_login_for_totp_user_still_requires_the_code(): void
    {
        // Arrange
        $user = $this->createTotpUser();

        // Act
        $response = $this->post('/login', [
            'email' => $user->email,
            'password' => 'password',
        ]);

        // Assert
        $response->assertRedirect(route('two-factor.login'));
        $response->assertSessionHas('login.id', $user->getKey());
        $this->assertGuest();
    }

    public function test_successful_sign_in_logs_mfa_evidence_without_pii(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $gateway = $this->fakeMicrosoftGateway();
        $cases = [
            ['authMethods' => ['pwd', 'mfa'], 'expected' => 'yes'],
            ['authMethods' => ['pwd'], 'expected' => 'no'],
            ['authMethods' => null, 'expected' => 'absent'],
        ];

        foreach ($cases as $index => $case) {
            $identity = $this->microsoftIdentity([
                'authMethods' => $case['authMethods'],
                'objectId' => sprintf('00000000-0000-4000-8000-0000000001%02d', $index),
                'graphId' => sprintf('00000000-0000-4000-8000-0000000001%02d', $index),
                'mail' => sprintf('person%d@example.test', $index),
                'userPrincipalName' => sprintf('person%d@example.test', $index),
            ]);
            $gateway->willReturn($identity);
            Auth::guard('web')->logout();
            $this->flushSession();

            // Act
            $response = $this->get($this->callbackUrl());

            // Assert
            $response->assertRedirect(route('dashboard', [], false));
            $this->assertAuthenticated();
            $completed = Log::allLogs()
                ->filter(fn (LogEntry $log): bool => $log->message === self::COMPLETED_MESSAGE)
                ->values();
            $this->assertCount($index + 1, $completed);
            $latest = $completed->last();
            $this->assertInstanceOf(LogEntry::class, $latest);
            $this->assertSame('info', $latest->level);
            $this->assertSame(['amr_mfa' => $case['expected']], $latest->context);
        }
        $everything = json_encode(Log::allLogs()->map(fn (LogEntry $log): array => $log->toArray())->all());
        $this->assertIsString($everything);
        foreach (['person0@example.test', 'person1@example.test', 'person2@example.test', self::MICROSOFT_TEST_OBJECT_ID, 'at-marker-7f3c', 'rt-marker-9d1e', self::MICROSOFT_TEST_TENANT_ID] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $everything);
        }
    }

    public function test_rejected_sign_in_writes_no_completed_line(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity([
            'tenantId' => '00000000-0000-4000-8000-0000000000ff',
        ]));

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('login', [], false));
        $this->assertGuest();
        Log::assertNotLogged(fn (LogEntry $log): bool => $log->message === self::COMPLETED_MESSAGE);
    }

    public function test_passwordless_user_can_use_session_protected_pages(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->get($this->callbackUrl())->assertRedirect(route('dashboard', [], false));
        $user = User::query()->where('email', 'ada@example.test')->firstOrFail();
        $this->assertNull($user->password);

        // Act
        $dashboard = $this->get(route('dashboard', [], false));
        $profile = $this->get(route('profile.show', [], false));

        // Assert
        $dashboard->assertStatus(200);
        $profile->assertStatus(200);
        $this->assertAuthenticatedAs($user);
    }

    public function test_password_login_for_passwordless_user_fails_cleanly(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->get($this->callbackUrl());
        $user = User::query()->where('email', 'ada@example.test')->firstOrFail();
        Auth::guard('web')->logout();
        $this->flushSession();
        $this->assertGuest();

        // Act
        $response = $this->post('/login', [
            'email' => $user->email,
            'password' => 'any-password-at-all',
        ]);

        // Assert
        $response->assertStatus(302);
        $response->assertSessionHasErrors('email');
        $this->assertGuest();
    }

    public function test_microsoft_sign_in_never_queues_remember_cookie(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $gateway = $this->fakeMicrosoftGateway();
        $recaller = Auth::guard('web')->getRecallerName();

        // Passwordless user (provisioned by the callback)
        $gateway->willReturn($this->microsoftIdentity());

        // Act
        $passwordless = $this->get($this->callbackUrl());

        // Assert
        $passwordless->assertRedirect(route('dashboard', [], false));
        $this->assertAuthenticated();
        $passwordless->assertCookieMissing($recaller);
        Auth::guard('web')->logout();
        $this->flushSession();

        // Arrange: a user that has a password
        $passwordUser = User::factory()->create(['email' => 'grace@example.test']);
        $gateway->willReturn($this->microsoftIdentity([
            'objectId' => '00000000-0000-4000-8000-0000000000b9',
            'graphId' => '00000000-0000-4000-8000-0000000000b9',
            'mail' => 'grace@example.test',
            'userPrincipalName' => 'grace@example.test',
        ]));

        // Act
        $withPassword = $this->get($this->callbackUrl());

        // Assert
        $withPassword->assertRedirect(route('dashboard', [], false));
        $this->assertAuthenticatedAs($passwordUser);
        $withPassword->assertCookieMissing($recaller);
    }

    public function test_callback_resumes_intended_oauth_authorize_url(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $client = app(ClientRepository::class)->createAuthorizationCodeGrantClient(
            'Microsoft session test client',
            ['https://client.example.test/callback'],
        );
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $authorizeQuery = http_build_query([
            'client_id' => $client->getKey(),
            'redirect_uri' => 'https://client.example.test/callback',
            'response_type' => 'code',
        ]);
        $guestResponse = $this->get('/oauth/authorize?'.$authorizeQuery);
        $guestResponse->assertRedirect(route('login'));
        $intended = session('url.intended');
        $this->assertIsString($intended);
        $this->assertStringContainsString('/oauth/authorize?', $intended);
        $this->assertStringContainsString('client_id='.$client->getKey(), $intended);

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect($intended);
        $this->assertAuthenticated();
        $response->assertSessionMissing('url.intended');
    }

    public function test_callback_without_intended_url_lands_on_dashboard(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $response->assertRedirect(route('dashboard', [], false));
        $this->assertAuthenticated();
    }

    public function test_session_keys_are_cleared(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $gateway = $this->fakeMicrosoftGateway();

        // Act: success
        $gateway->willReturn($this->microsoftIdentity());
        $success = $this->withSession(['microsoft.timezone' => 'Europe/Berlin'])->get($this->callbackUrl());

        // Assert
        $success->assertRedirect(route('dashboard', [], false));
        $success->assertSessionMissing('microsoft.timezone');
        $this->assertEmpty(session('microsoft', []));
        Auth::guard('web')->logout();
        $this->flushSession();

        // Act: rejection
        $gateway->willReturn($this->microsoftIdentity([
            'tenantId' => '00000000-0000-4000-8000-0000000000ff',
        ]));
        $rejected = $this->withSession(['microsoft.timezone' => 'Europe/Berlin'])->get($this->callbackUrl());

        // Assert
        $rejected->assertRedirect(route('login', [], false));
        $rejected->assertSessionMissing('microsoft.timezone');
        $this->assertEmpty(session('microsoft', []));
        $this->assertGuest();
    }

    private function createTotpUser(): User
    {
        return User::factory()->create([
            'email' => 'ada@example.test',
            'two_factor_secret' => encrypt('JBSWY3DPEHPK3PXP'),
            'two_factor_recovery_codes' => encrypt(json_encode(['recovery-code-1'])),
            'two_factor_confirmed_at' => now(),
        ]);
    }

    private function linkMicrosoftAccount(User $user): MicrosoftAccount
    {
        $account = new MicrosoftAccount;
        $account->user()->associate($user);
        $account->tenant_id = self::MICROSOFT_TEST_TENANT_ID;
        $account->microsoft_oid = self::MICROSOFT_TEST_OBJECT_ID;
        $account->microsoft_email = $user->email;
        $account->save();

        return $account;
    }

    private function callbackUrl(): string
    {
        return route('microsoft.callback', ['code' => 'fake-code', 'state' => 'fake-state'], false);
    }
}
