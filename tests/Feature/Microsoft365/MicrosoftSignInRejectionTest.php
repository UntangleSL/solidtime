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
use Illuminate\Support\Facades\Log;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;
use TiMacDonald\Log\LogEntry;

#[CoversClass(MicrosoftIdentityGuard::class)]
#[UsesClass(MicrosoftAuthController::class)]
#[UsesClass(MicrosoftIdentityResolver::class)]
#[UsesClass(MicrosoftSignInException::class)]
#[UsesClass(MicrosoftSignInFailure::class)]
#[UsesClass(MicrosoftIdentity::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
#[UsesClass(MicrosoftAccount::class)]
class MicrosoftSignInRejectionTest extends TestCaseWithDatabase
{
    use InteractsWithMicrosoft365;

    public function test_identity_of_another_tenant_is_sent_back_to_login_with_the_wrong_tenant_message(): void
    {
        // Arrange
        $this->configureMicrosoft365(Organization::factory()->create());
        $identity = $this->microsoftIdentity([
            'tenantId' => '00000000-0000-4000-8000-0000000000ff',
            'objectId' => '00000000-0000-4000-8000-0000000000d4',
            'graphId' => '00000000-0000-4000-8000-0000000000d4',
            'mail' => 'outsider@example.test',
            'userPrincipalName' => 'outsider@example.test',
        ]);
        $this->fakeMicrosoftGateway()->willReturn($identity);
        $userCount = User::query()->count();

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $this->assertRejected($response, 'wrong_tenant', $userCount, $identity);
    }

    public function test_guest_identity_is_sent_back_to_login_with_the_guest_message(): void
    {
        // Arrange
        $this->configureMicrosoft365(Organization::factory()->create());
        $identity = $this->microsoftIdentity([
            'objectId' => '00000000-0000-4000-8000-0000000000d5',
            'graphId' => '00000000-0000-4000-8000-0000000000d5',
            'mail' => 'guest@example.test',
            'userPrincipalName' => 'guest_example.test#EXT#@untangle.onmicrosoft.com',
            'userType' => 'Guest',
        ]);
        $this->fakeMicrosoftGateway()->willReturn($identity);
        $userCount = User::query()->count();

        // Act
        $response = $this->get($this->callbackUrl());

        // Assert
        $this->assertRejected($response, 'guest', $userCount, $identity);
    }

    private function assertRejected(
        TestResponse $response,
        string $reason,
        int $userCountBefore,
        MicrosoftIdentity $identity,
    ): void {
        $response->assertRedirect(route('login', [], false));
        $response->assertSessionHas('message', __('microsoft365.error.'.$reason));
        $this->assertGuest();
        $this->assertSame($userCountBefore, User::query()->count());
        $this->assertSame(0, MicrosoftAccount::query()->count());
        Log::assertLogged(fn (LogEntry $log) => $log->level === 'warning'
            && $log->message === 'Microsoft sign-in rejected'
            && $log->context === ['reason' => $reason, 'provider_code' => null]);
        Log::assertNotLogged(function (LogEntry $log) use ($identity): bool {
            $haystack = $log->message.json_encode($log->context);
            $secrets = [
                $identity->objectId,
                $identity->userPrincipalName,
                (string) $identity->mail,
                $identity->accessToken,
                (string) $identity->refreshToken,
            ];
            foreach ($secrets as $secret) {
                if (str_contains($haystack, $secret)) {
                    return true;
                }
            }

            return false;
        });
    }

    private function callbackUrl(): string
    {
        return route('microsoft.callback', ['code' => 'fake-code', 'state' => 'fake-state'], false);
    }
}
