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
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Inertia\Inertia;
use Laravel\Passport\Passport;
use OwenIt\Auditing\Contracts\Auditable;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;
use TiMacDonald\Log\LogEntry;

/**
 * SEC-01: Microsoft access and refresh tokens exist only as ciphertext in the two text columns of
 * microsoft_accounts. Every other place a token could leak to is searched for the marker values.
 */
#[CoversClass(MicrosoftAccount::class)]
#[UsesClass(MicrosoftAuthController::class)]
#[UsesClass(MicrosoftIdentityResolver::class)]
#[UsesClass(MicrosoftIdentityGuard::class)]
#[UsesClass(MicrosoftSignInException::class)]
#[UsesClass(MicrosoftSignInFailure::class)]
#[UsesClass(MicrosoftIdentity::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
class MicrosoftTokenStorageTest extends TestCaseWithDatabase
{
    use InteractsWithMicrosoft365;

    private const string ACCESS_MARKER = 'at-marker-7f3c';

    private const string REFRESH_MARKER = 'rt-marker-9d1e';

    public function test_tokens_are_ciphertext_at_rest_and_decrypt(): void
    {
        // Arrange
        $this->signInWithMarkerTokens();

        // Act
        $raw = DB::table('microsoft_accounts')->first();

        // Assert
        $this->assertNotNull($raw);
        $this->assertIsString($raw->access_token);
        $this->assertIsString($raw->refresh_token);
        foreach ([$raw->access_token, $raw->refresh_token] as $stored) {
            $this->assertStringNotContainsString(self::ACCESS_MARKER, $stored);
            $this->assertStringNotContainsString(self::REFRESH_MARKER, $stored);
        }
        $this->assertSame(self::ACCESS_MARKER, Crypt::decryptString($raw->access_token));
        $this->assertSame(self::REFRESH_MARKER, Crypt::decryptString($raw->refresh_token));
        foreach (['access_token', 'refresh_token'] as $column) {
            $types = DB::select(
                'select data_type from information_schema.columns where table_schema = current_schema() and table_name = ? and column_name = ?',
                ['microsoft_accounts', $column],
            );
            $this->assertCount(1, $types);
            $this->assertSame('text', $types[0]->data_type);
        }
    }

    public function test_model_serialisation_hides_tokens(): void
    {
        // Arrange
        $this->signInWithMarkerTokens();
        $account = MicrosoftAccount::query()->firstOrFail();
        $this->assertSame(self::ACCESS_MARKER, $account->access_token);

        // Act
        $array = $account->toArray();
        $json = $account->toJson();

        // Assert
        $this->assertArrayNotHasKey('access_token', $array);
        $this->assertArrayNotHasKey('refresh_token', $array);
        $this->assertStringNotContainsString('access_token', $json);
        $this->assertStringNotContainsString('refresh_token', $json);
        $this->assertStringNotContainsString(self::ACCESS_MARKER, $json);
        $this->assertStringNotContainsString(self::REFRESH_MARKER, $json);
        $this->assertStringNotContainsString(self::ACCESS_MARKER, (string) json_encode($array));
    }

    public function test_microsoft_account_is_not_auditable(): void
    {
        // Arrange
        $this->assertNotInstanceOf(Auditable::class, new MicrosoftAccount);

        // Act
        $this->signInWithMarkerTokens();

        // Assert
        $audits = DB::table('audits')->get();
        foreach ($audits as $audit) {
            $encoded = (string) json_encode($audit);
            $this->assertStringNotContainsString(self::ACCESS_MARKER, $encoded);
            $this->assertStringNotContainsString(self::REFRESH_MARKER, $encoded);
        }
        $this->assertSame(0, DB::table('audits')->where('auditable_type', 'like', '%MicrosoftAccount%')->count());
        $this->assertSame(0, DB::table('audits')->where('auditable_type', 'like', '%microsoft%')->count());
    }

    public function test_users_table_has_no_token_columns(): void
    {
        // Arrange
        $this->signInWithMarkerTokens();

        // Act
        $columns = Schema::getColumnListing('users');

        // Assert
        $this->assertNotContains('access_token', $columns);
        $this->assertNotContains('refresh_token', $columns);
        foreach (DB::table('users')->get() as $row) {
            $encoded = (string) json_encode($row);
            $this->assertStringNotContainsString(self::ACCESS_MARKER, $encoded);
            $this->assertStringNotContainsString(self::REFRESH_MARKER, $encoded);
        }
    }

    public function test_session_and_logs_never_contain_tokens(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $gateway = $this->fakeMicrosoftGateway();

        // Act: a successful sign-in
        $gateway->willReturn($this->microsoftIdentity());
        $this->get($this->callbackUrl())->assertRedirect(route('dashboard', [], false));

        // Assert
        $this->assertStringNotContainsString(self::ACCESS_MARKER, serialize(session()->all()));
        $this->assertStringNotContainsString(self::REFRESH_MARKER, serialize(session()->all()));
        $this->assertNoTokenInLogs();

        // Act: a rejection that already obtained tokens
        $this->flushSession();
        $gateway->willReturn($this->microsoftIdentity(['tenantId' => '00000000-0000-4000-8000-0000000000ff']));
        $this->get($this->callbackUrl())->assertRedirect(route('login', [], false));

        // Assert
        $this->assertStringNotContainsString(self::ACCESS_MARKER, serialize(session()->all()));
        $this->assertStringNotContainsString(self::REFRESH_MARKER, serialize(session()->all()));
        $this->assertNoTokenInLogs();
    }

    public function test_inertia_pages_never_carry_tokens(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        // A plain request first, so the Inertia middleware has registered the asset version
        $this->get('/login')->assertStatus(200);
        $headers = ['X-Inertia' => 'true', 'X-Inertia-Version' => Inertia::getVersion()];

        // Act
        $login = $this->get('/login', $headers);
        $this->get($this->callbackUrl())->assertRedirect(route('dashboard', [], false));
        $dashboard = $this->get(route('dashboard', [], false), $headers);

        // Assert
        foreach ([$login, $dashboard] as $response) {
            $response->assertStatus(200);
            $response->assertHeader('X-Inertia', 'true');
            $content = (string) $response->getContent();
            $this->assertStringNotContainsString(self::ACCESS_MARKER, $content);
            $this->assertStringNotContainsString(self::REFRESH_MARKER, $content);
            $this->assertStringNotContainsString('access_token', $content);
            $this->assertStringNotContainsString('refresh_token', $content);
        }
    }

    public function test_api_responses_never_carry_tokens_for_linked_user(): void
    {
        // Arrange
        $this->signInWithMarkerTokens();
        $user = User::query()->where('email', 'ada@example.test')->firstOrFail();
        $this->assertSame(1, MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->count());
        Passport::actingAs($user);

        // Act
        $response = $this->getJson(route('api.v1.users.me'));

        // Assert
        $response->assertStatus(200);
        $content = (string) $response->getContent();
        $this->assertStringNotContainsString(self::ACCESS_MARKER, $content);
        $this->assertStringNotContainsString(self::REFRESH_MARKER, $content);
        $this->assertStringNotContainsString('access_token', $content);
        $this->assertStringNotContainsString('refresh_token', $content);
    }

    public function test_identity_debug_output_redacts_tokens(): void
    {
        // Arrange
        $identity = $this->microsoftIdentity();

        // Act
        $printed = print_r($identity, true);
        ob_start();
        var_dump($identity);
        $dumped = (string) ob_get_clean();

        // Assert
        $this->assertStringContainsString('[redacted]', $printed);
        $this->assertStringContainsString('[redacted]', $dumped);
        foreach ([$printed, $dumped] as $output) {
            $this->assertStringNotContainsString(self::ACCESS_MARKER, $output);
            $this->assertStringNotContainsString(self::REFRESH_MARKER, $output);
        }
    }

    public function test_rejected_callback_stores_no_tokens(): void
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
        $this->assertSame(0, MicrosoftAccount::query()->count());
        $this->assertStringNotContainsString(self::ACCESS_MARKER, serialize(session()->all()));
        $this->assertNoTokenInLogs();
    }

    /**
     * Provisions Ada through a real callback so the marker tokens are stored by the production path.
     */
    private function signInWithMarkerTokens(): void
    {
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());

        $this->get($this->callbackUrl())->assertRedirect(route('dashboard', [], false));
        $this->assertSame(1, MicrosoftAccount::query()->count());
    }

    private function assertNoTokenInLogs(): void
    {
        Log::assertNotLogged(fn (LogEntry $log): bool => str_contains((string) $log->message, self::ACCESS_MARKER)
            || str_contains((string) $log->message, self::REFRESH_MARKER)
            || str_contains((string) json_encode($log->context), self::ACCESS_MARKER)
            || str_contains((string) json_encode($log->context), self::REFRESH_MARKER));
    }

    private function callbackUrl(): string
    {
        return route('microsoft.callback', ['code' => 'fake-code', 'state' => 'fake-state'], false);
    }
}
