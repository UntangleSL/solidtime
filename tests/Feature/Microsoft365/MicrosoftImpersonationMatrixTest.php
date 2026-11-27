<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Microsoft365\Graph\GraphAccessGuard;
use App\Microsoft365\Http\Controllers\MicrosoftAccountController;
use App\Microsoft365\Http\Middleware\EnsureMicrosoftIsEnabled;
use App\Microsoft365\Http\Middleware\EnsureNotImpersonating;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookSyncWindow;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use STS\FilamentImpersonate\ImpersonateManager;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

/**
 * SEC-04 (D-07, D-08): while an admin impersonates a user, every Microsoft 365 entry point of the fork
 * is inert. No Graph or token request leaves, no OAuth gateway runs, no Microsoft identity is linked and
 * no row of the fork tables or of time_entries changes.
 */
#[CoversClass(EnsureNotImpersonating::class)]
#[UsesClass(GraphAccessGuard::class)]
#[UsesClass(MicrosoftAccountController::class)]
#[UsesClass(EnsureMicrosoftIsEnabled::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
#[UsesClass(MicrosoftAccount::class)]
#[UsesClass(OutlookMeeting::class)]
#[UsesClass(OutlookSyncWindow::class)]
class MicrosoftImpersonationMatrixTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

    /** Every table a Microsoft 365 route could write, plus core's time entries. All have an `id` key. */
    private const array SNAPSHOT_TABLES = [
        'microsoft_accounts',
        'outlook_meetings',
        'outlook_sync_windows',
        'outlook_meeting_links',
        'outlook_series_settings',
        'time_entries',
    ];

    private function createUser(): User
    {
        return User::factory()->withPersonalOrganization()->create();
    }

    private function startImpersonation(): void
    {
        // The session key of stechstudio/filament-impersonate: the id of the admin who impersonates
        session()->put(ImpersonateManager::SESSION_KEY, 1);
    }

    /**
     * Every row of the fork tables and of time_entries, in a stable order, as JSON per table.
     *
     * @return array<string, string>
     */
    private function forkRows(): array
    {
        $rows = [];
        foreach (self::SNAPSHOT_TABLES as $table) {
            $rows[$table] = (string) json_encode(DB::table($table)->orderBy('id')->get());
        }

        return $rows;
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function meeting(User $user, string $graphId, array $overrides = []): OutlookMeeting
    {
        return OutlookMeeting::query()->create(array_merge([
            'user_id' => $user->getKey(),
            'graph_id' => $graphId,
            'event_type' => 'singleInstance',
            'subject' => 'Subject '.$graphId,
            'starts_at' => '2026-10-20 09:00:00',
            'ends_at' => '2026-10-20 10:00:00',
            'organizer_name' => 'Org Name',
            'is_organizer' => false,
            'is_online_meeting' => true,
            'web_link' => 'https://outlook.office.com/owa/?itemid='.$graphId,
            'last_seen_at' => '2026-10-19 00:00:00',
        ], $overrides));
    }

    private function syncWindow(User $user, string $start, string $end): OutlookSyncWindow
    {
        return OutlookSyncWindow::query()->create([
            'user_id' => $user->getKey(),
            'window_start' => $start,
            'window_end' => $end,
            'synced_at' => '2026-10-19 12:00:00',
        ]);
    }

    public function test_disconnect_is_a_404_and_changes_nothing_while_impersonating(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->connectedAccount($user);
        $this->meeting($user, 'kept');
        $this->syncWindow($user, '2026-10-19 00:00:00', '2026-11-16 00:00:00');
        Http::fake();
        $this->actingAs($user, 'web');
        $this->startImpersonation();
        $before = $this->forkRows();

        // Act
        $response = $this->delete(route('microsoft.account.destroy', [], false));

        // Assert
        $response->assertNotFound();
        $this->assertSame($before, $this->forkRows());
        $this->assertNotNull($account->refresh()->refresh_token);
        Http::assertNothingSent();
    }
}
