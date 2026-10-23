<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Microsoft365\Console\MicrosoftCheckCommand;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Config;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

#[CoversClass(MicrosoftCheckCommand::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
#[UsesClass(MicrosoftAccount::class)]
class MicrosoftCheckCommandTest extends TestCaseWithDatabase
{
    use InteractsWithMicrosoft365;

    public function test_configured_integration_prints_the_effective_settings_and_exits_zero(): void
    {
        // Arrange
        $organization = Organization::factory()->create(['name' => 'Untangle Test Org']);
        $this->configureMicrosoft365($organization, ['allowed_domains' => 'untangle.es,untanglegrowth.com']);
        Config::set('app.enable_registration', 'off');
        $this->linkAccount(User::factory()->create(), true);

        // Act
        $exitCode = $this->withoutMockingConsoleOutput()->artisan('m365:check');
        $output = Artisan::output();

        // Assert
        $this->assertSame(Command::SUCCESS, $exitCode);
        $this->assertStringContainsString('configured: yes', $output);
        $this->assertStringContainsString('redirect uri: https://time.example.test/auth/microsoft/callback', $output);
        $this->assertStringContainsString('untangle.es', $output);
        $this->assertStringContainsString('untanglegrowth.com', $output);
        $this->assertStringContainsString($organization->getKey().' (Untangle Test Org)', $output);
        $this->assertStringContainsString('registration: off', $output);
        $this->assertStringContainsString('linked accounts: 1 (connected: 1)', $output);
        $this->assertStringNotContainsString('WARNING', $output);
    }

    public function test_output_never_contains_the_secret_or_token_markers(): void
    {
        // Arrange
        $this->configureMicrosoft365(null, ['client_secret' => 'fake-secret']);
        $this->linkAccount(User::factory()->create(), true);

        // Act
        $this->withoutMockingConsoleOutput()->artisan('m365:check');
        $output = Artisan::output();

        // Assert
        $this->assertStringNotContainsString('fake-secret', $output);
        $this->assertStringNotContainsString('at-marker-7f3c', $output);
        $this->assertStringNotContainsString('rt-marker-9d1e', $output);
    }

    public function test_disconnected_account_is_linked_but_not_connected(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $account = $this->linkAccount(User::factory()->create(), true);
        $account->refresh_token = null;
        $account->access_token = null;
        $account->disconnected_at = Carbon::now();
        $account->save();

        // Act
        $this->withoutMockingConsoleOutput()->artisan('m365:check');
        $output = Artisan::output();

        // Assert
        $this->assertStringContainsString('linked accounts: 1 (connected: 0)', $output);
    }

    public function test_unconfigured_integration_names_the_missing_variables_and_exits_one(): void
    {
        // Arrange
        $this->configureMicrosoft365(null, ['client_id' => '']);

        // Act
        $exitCode = $this->withoutMockingConsoleOutput()->artisan('m365:check');
        $output = Artisan::output();

        // Assert
        $this->assertSame(Command::FAILURE, $exitCode);
        $this->assertStringContainsString('configured: no', $output);
        $this->assertStringContainsString('SOLIDTIME_MICROSOFT_CLIENT_ID', $output);
        $this->assertStringNotContainsString('fake-secret', $output);
    }

    public function test_non_https_redirect_uri_outside_local_prints_a_warning(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        Config::set('app.env', 'production');
        Config::set('app.url', 'http://time.example.test');

        // Act
        $exitCode = $this->withoutMockingConsoleOutput()->artisan('m365:check');
        $output = Artisan::output();

        // Assert
        $this->assertSame(Command::SUCCESS, $exitCode);
        $this->assertStringContainsString('WARNING', $output);
        $this->assertStringContainsString('https', $output);
    }

    public function test_missing_organization_is_reported_without_failing_the_command(): void
    {
        // Arrange
        $missingId = '00000000-0000-4000-8000-0000000000e1';
        $this->configureMicrosoft365(null, ['organization_id' => $missingId]);

        // Act
        $exitCode = $this->withoutMockingConsoleOutput()->artisan('m365:check');
        $output = Artisan::output();

        // Assert
        $this->assertSame(Command::SUCCESS, $exitCode);
        $this->assertStringContainsString($missingId.' NOT FOUND', $output);
    }

    public function test_empty_allow_list_and_unset_organization_are_spelled_out(): void
    {
        // Arrange
        $this->configureMicrosoft365(null, ['allowed_domains' => '']);

        // Act
        $this->withoutMockingConsoleOutput()->artisan('m365:check');
        $output = Artisan::output();

        // Assert
        $this->assertStringContainsString('allowed domains: none', $output);
        $this->assertStringContainsString('organization: not set', $output);
    }

    private function linkAccount(User $user, bool $withTokens): MicrosoftAccount
    {
        $account = new MicrosoftAccount;
        $account->user()->associate($user);
        $account->tenant_id = self::MICROSOFT_TEST_TENANT_ID;
        $account->microsoft_oid = self::MICROSOFT_TEST_OBJECT_ID;
        $account->microsoft_email = 'ada@example.test';
        if ($withTokens) {
            $account->access_token = 'at-marker-7f3c';
            $account->refresh_token = 'rt-marker-9d1e';
            $account->access_token_expires_at = Carbon::now()->addHour();
        }
        $account->save();

        return $account;
    }
}
