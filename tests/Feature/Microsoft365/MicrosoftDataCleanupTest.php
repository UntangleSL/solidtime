<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Microsoft365\Graph\GraphAccessGuard;
use App\Microsoft365\Graph\GraphCalendarClient;
use App\Microsoft365\Graph\MicrosoftTokenService;
use App\Microsoft365\Graph\OutlookMeetingEligibility;
use App\Microsoft365\Graph\OutlookMeetingSyncService;
use App\Microsoft365\Graph\SyncOutcome;
use App\Microsoft365\Graph\SyncStatus;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookMeetingLink;
use App\Microsoft365\Models\OutlookSeriesSetting;
use App\Microsoft365\Models\OutlookSyncWindow;
use App\Models\Member;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Service\DeletionService;
use App\Service\MemberService;
use Carbon\CarbonImmutable;
use GuzzleHttp\Promise\PromiseInterface;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

/**
 * SEC-03: deleting a user leaves none of their Microsoft data behind, on every core deletion path.
 *
 * The cleanup is the database itself: every fork table has an ON DELETE CASCADE foreign key to users
 * (and the links one to time_entries, because core deletes entries in bulk without Eloquent events).
 * There is deliberately no DeletionService hook and no listener on core deletion events. Microsoft data
 * belongs to the user, not to an organization (07-CONTEXT D-09): an organization deletion or a member
 * removal only takes the links of the entries core deletes, while the surviving user keeps the rest.
 * Fork code never deletes or changes a time entry here; entries follow core's own deletion rules.
 * A disconnect that races a running sync leaves nothing behind either (Phase 3 D-21).
 */
#[CoversClass(OutlookMeetingSyncService::class)]
#[UsesClass(GraphCalendarClient::class)]
#[UsesClass(MicrosoftTokenService::class)]
#[UsesClass(GraphAccessGuard::class)]
#[UsesClass(OutlookMeetingEligibility::class)]
#[UsesClass(SyncOutcome::class)]
#[UsesClass(SyncStatus::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(DeletionService::class)]
#[UsesClass(MemberService::class)]
#[UsesClass(MicrosoftAccount::class)]
#[UsesClass(OutlookMeeting::class)]
#[UsesClass(OutlookSyncWindow::class)]
#[UsesClass(OutlookMeetingLink::class)]
#[UsesClass(OutlookSeriesSetting::class)]
class MicrosoftDataCleanupTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

    /**
     * Every table the fork migrations create, sorted; each ties its rows to a user through user_id.
     */
    private const array FORK_TABLES = [
        'microsoft_accounts',
        'outlook_meeting_links',
        'outlook_meetings',
        'outlook_series_settings',
        'outlook_sync_windows',
    ];

    private const string SERIES = 'cleanup-series-master';

    /**
     * One row in each of the five fork tables for the user: a connected account with tokens, a cached
     * meeting, a sync window, a series setting, and a time entry of the member converted from that
     * meeting (the link). The account's Microsoft object id is the user's own id, so several seeded
     * users never collide on the unique tenant + object id pair.
     */
    private function seedMicrosoftData(User $user, Member $member, Organization $organization): TimeEntry
    {
        $this->assertSame($organization->getKey(), $member->organization_id);
        $this->connectedAccount($user, objectId: (string) $user->getKey());

        OutlookMeeting::query()->create([
            'user_id' => $user->getKey(),
            'graph_id' => 'cleanup-meeting',
            'series_master_id' => self::SERIES,
            'event_type' => 'occurrence',
            'subject' => 'Cleanup subject',
            'starts_at' => '2026-10-20 09:00:00',
            'ends_at' => '2026-10-20 10:00:00',
            'organizer_name' => 'Org Name',
            'is_organizer' => false,
            'is_online_meeting' => true,
            'web_link' => 'https://outlook.office.com/owa/?itemid=cleanup-meeting',
            'last_seen_at' => '2026-10-19 00:00:00',
        ]);
        OutlookSyncWindow::query()->create([
            'user_id' => $user->getKey(),
            'window_start' => '2026-10-19 00:00:00',
            'window_end' => '2026-10-26 00:00:00',
            'synced_at' => '2026-10-19 12:00:00',
        ]);
        OutlookSeriesSetting::query()->create([
            'user_id' => $user->getKey(),
            'series_master_id' => self::SERIES,
            'ignored_at' => '2026-10-19 08:00:00',
        ]);

        $entry = TimeEntry::factory()->forMember($member)->createOne();
        OutlookMeetingLink::query()->create([
            'user_id' => $user->getKey(),
            'graph_id' => 'cleanup-meeting',
            'time_entry_id' => $entry->getKey(),
            'series_master_id' => self::SERIES,
            'meeting_starts_at' => '2026-10-20 09:00:00',
            'meeting_ends_at' => '2026-10-20 10:00:00',
        ]);

        return $entry;
    }

    /**
     * Rows per fork table that belong to the user id, read straight from the tables (no model scope).
     *
     * @return array<string, int>
     */
    private function rowsOf(string $userId): array
    {
        $counts = [];
        foreach (self::FORK_TABLES as $table) {
            $counts[$table] = DB::table($table)->where('user_id', '=', $userId)->count();
        }

        return $counts;
    }

    /**
     * @return array<string, int>
     */
    private function every(int $count): array
    {
        return array_fill_keys(self::FORK_TABLES, $count);
    }

    public function test_deleting_a_user_leaves_no_microsoft_row(): void
    {
        // Arrange: the owner of a single-member organization, so core deletes the organization too;
        // an unrelated user in another organization with the same data, which must survive
        $data = $this->createUserWithRole(Role::Owner);
        $this->seedMicrosoftData($data->user, $data->member, $data->organization);
        $other = $this->createUserWithRole(Role::Owner);
        $otherEntry = $this->seedMicrosoftData($other->user, $other->member, $other->organization);
        $deletedId = (string) $data->user->getKey();
        $this->assertSame($this->every(1), $this->rowsOf($deletedId));

        // Act
        app(DeletionService::class)->deleteUser($data->user);

        // Assert: identity, tokens, cached meetings, sync windows, links and series rules are gone
        $this->assertNull(User::query()->find($deletedId));
        $this->assertSame($this->every(0), $this->rowsOf($deletedId));
        $this->assertSame($this->every(1), $this->rowsOf((string) $other->user->getKey()));
        $this->assertNotNull(TimeEntry::query()->find($otherEntry->getKey()));
    }

    public function test_every_fork_table_cascades_from_users(): void
    {
        // Arrange: the table list comes from the fork migrations, so a new fork table forces a review
        $files = glob(app_path('Microsoft365/database/migrations').'/*.php');
        $this->assertIsArray($files);
        $this->assertNotEmpty($files);
        $created = [];
        foreach ($files as $file) {
            $source = file_get_contents($file);
            $this->assertIsString($source, 'Migration not readable: '.basename($file));
            preg_match_all("/Schema::create\\('([a-z0-9_]+)'/", $source, $matches);
            foreach ($matches[1] as $table) {
                $created[] = $table;
            }
        }
        sort($created);

        // Act: every foreign key of the fork tables, as PostgreSQL enforces it
        $rows = DB::select(<<<'SQL'
            SELECT c.conrelid::regclass::text AS table_name,
                   a.attname::text AS column_name,
                   c.confrelid::regclass::text AS referenced_table,
                   c.confdeltype::text AS on_delete
            FROM pg_constraint AS c
            JOIN pg_attribute AS a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
            WHERE c.contype = 'f'
            SQL);
        $cascading = [];
        foreach ($rows as $row) {
            // confdeltype 'c' is ON DELETE CASCADE
            if ($row->on_delete === 'c') {
                $cascading[$row->table_name][] = $row->column_name.'->'.$row->referenced_table;
            }
        }

        // Assert
        $this->assertSame(self::FORK_TABLES, $created, 'The fork migrations create a table this guard does not know: '
            .'give it an ON DELETE CASCADE foreign key to users and add it here and to rowsOf()');
        foreach ($created as $table) {
            $this->assertContains('user_id->users', $cascading[$table] ?? [], $table.' has no ON DELETE CASCADE foreign key to users');
        }
        $this->assertContains('time_entry_id->time_entries', $cascading['outlook_meeting_links'] ?? [],
            'outlook_meeting_links has no ON DELETE CASCADE foreign key to time_entries');
    }

    public function test_deleting_a_member_user_keeps_entries_under_the_placeholder_and_drops_microsoft_rows(): void
    {
        // Arrange: an employee and the organization's owner, both with Microsoft data
        $data = $this->createUserWithRole(Role::Employee);
        $data->user->save();
        $employeeEntry = $this->seedMicrosoftData($data->user, $data->member, $data->organization);
        $this->seedMicrosoftData($data->owner, $data->ownerMember, $data->organization);
        $deletedId = (string) $data->user->getKey();

        // Act: core turns the membership into a placeholder user, then deletes the user
        app(DeletionService::class)->deleteUser($data->user);

        // Assert: the entry survives under the placeholder (core rule, unchanged by the fork)
        $placeholderId = (string) $data->member->refresh()->user_id;
        $this->assertNotSame($deletedId, $placeholderId);
        $this->assertTrue(User::query()->findOrFail($placeholderId)->is_placeholder);
        $entry = TimeEntry::query()->whereKey($employeeEntry->getKey())->first();
        $this->assertNotNull($entry);
        $this->assertSame($placeholderId, (string) $entry->user_id);
        // Every Microsoft row of the deleted user is gone, and the placeholder inherited none
        $this->assertNull(User::query()->find($deletedId));
        $this->assertSame($this->every(0), $this->rowsOf($deletedId));
        $this->assertSame($this->every(0), $this->rowsOf($placeholderId));
        $this->assertSame($this->every(1), $this->rowsOf((string) $data->owner->getKey()));
    }

    public function test_removing_a_member_with_their_data_drops_only_their_links(): void
    {
        // Arrange: an employee and the organization's owner, both with a converted meeting
        $data = $this->createUserWithRole(Role::Employee);
        $data->user->save();
        $employeeEntry = $this->seedMicrosoftData($data->user, $data->member, $data->organization);
        $ownerEntry = $this->seedMicrosoftData($data->owner, $data->ownerMember, $data->organization);

        // Act: core member removal together with the member's time entries
        app(MemberService::class)->removeMember($data->member, $data->organization, true);

        // Assert: core deleted the employee's entry and the cascade took its link; the owner's stays
        $this->assertNull(TimeEntry::query()->find($employeeEntry->getKey()));
        $this->assertSame(0, OutlookMeetingLink::query()->where('time_entry_id', '=', $employeeEntry->getKey())->count());
        $this->assertSame(1, OutlookMeetingLink::query()->where('time_entry_id', '=', $ownerEntry->getKey())->count());
        // The employee still exists and keeps their own Microsoft connection and data (D-09)
        $this->assertNotNull(User::query()->find($data->user->getKey()));
        $this->assertSame(
            array_merge($this->every(1), ['outlook_meeting_links' => 0]),
            $this->rowsOf((string) $data->user->getKey()),
        );
        $this->assertSame($this->every(1), $this->rowsOf((string) $data->owner->getKey()));
    }

    public function test_deleting_an_organization_drops_its_links_and_keeps_user_level_rows(): void
    {
        // Arrange: an employee and the organization's owner, both with a converted meeting
        $data = $this->createUserWithRole(Role::Employee);
        $data->user->save();
        $employeeEntry = $this->seedMicrosoftData($data->user, $data->member, $data->organization);
        $ownerEntry = $this->seedMicrosoftData($data->owner, $data->ownerMember, $data->organization);

        // Act: core bulk-deletes the organization's entries without Eloquent events
        app(DeletionService::class)->deleteOrganization($data->organization);

        // Assert: the entries went with the organization and the time_entry_id cascade took the links
        $this->assertNull(TimeEntry::query()->find($employeeEntry->getKey()));
        $this->assertNull(TimeEntry::query()->find($ownerEntry->getKey()));
        $this->assertSame(0, OutlookMeetingLink::query()->count());
        // Both users still exist and keep their account, cached meetings, windows and series rules (D-09)
        $userLevel = array_merge($this->every(1), ['outlook_meeting_links' => 0]);
        $this->assertSame($userLevel, $this->rowsOf((string) $data->user->getKey()));
        $this->assertSame($userLevel, $this->rowsOf((string) $data->owner->getKey()));
    }

    /**
     * Exactly what MicrosoftAccountController::destroy does, applied while the sync is between two
     * Graph pages: under the account row lock the cached meetings and windows go, the tokens are
     * cleared and disconnected_at is set.
     */
    private function disconnectMeanwhile(User $user): void
    {
        DB::transaction(function () use ($user): void {
            $account = MicrosoftAccount::query()
                ->where('user_id', '=', $user->getKey())
                ->lockForUpdate()
                ->firstOrFail();
            OutlookMeeting::query()->where('user_id', '=', $user->getKey())->delete();
            OutlookSyncWindow::query()->where('user_id', '=', $user->getKey())->delete();
            $account->access_token = null;
            $account->refresh_token = null;
            $account->access_token_expires_at = null;
            $account->scopes = null;
            $account->reconnect_required_at = null;
            $account->graph_backoff_until = null;
            $account->disconnected_at = Carbon::now();
            $account->save();
        });
    }

    /**
     * The Graph page whose request lands right after the disconnect. Page 2 of round A carries an
     * eligible meeting and more pages follow (the next token check fails, the pages read so far would
     * be stored); page 22 is the last one (the traversal completes and would also record a window).
     *
     * @return array<string, array{int}>
     */
    public static function disconnectMoments(): array
    {
        return [
            'while more pages are to come' => [2],
            'with the last page' => [22],
        ];
    }

    #[DataProvider('disconnectMoments')]
    public function test_disconnect_during_a_sync_leaves_no_cached_meeting(int $disconnectAtPage): void
    {
        // Arrange: a connected user (token not expired, so no token request) with a time entry that
        // came from an earlier meeting outside the window; Graph answers round A page by page and the
        // user disconnects while the chosen page is being fetched
        $this->configureMicrosoft365();
        $data = $this->createUserWithRole(Role::Owner);
        $user = $data->user;
        $account = $this->connectedAccount($user);
        $entry = TimeEntry::factory()->forMember($data->member)->createOne();
        OutlookMeetingLink::query()->create([
            'user_id' => $user->getKey(),
            'graph_id' => 'converted-before-the-window',
            'time_entry_id' => $entry->getKey(),
            'meeting_starts_at' => '2026-09-01 09:00:00',
            'meeting_ends_at' => '2026-09-01 10:00:00',
        ]);
        $entryBefore = $this->entrySnapshot($entry);
        $entriesBefore = TimeEntry::query()->count();
        Config::set('microsoft365.graph.max_pages', 30);
        $pages = $this->graphPages('A');
        $this->assertCount(22, $pages);
        $served = 0;
        Http::fake([
            'https://graph.microsoft.com/v1.0/me/calendarView*' => function () use (&$served, $pages, $disconnectAtPage, $user): PromiseInterface {
                $served++;
                if ($served === $disconnectAtPage) {
                    $this->disconnectMeanwhile($user);
                }

                return Http::response($pages[$served - 1]);
            },
        ]);
        $window = $this->fixtureWindow();

        // Act
        $outcome = app(OutlookMeetingSyncService::class)->sync(
            $user,
            CarbonImmutable::parse($window['start']),
            CarbonImmutable::parse($window['end']),
            true,
        );

        // Assert: the race happened where intended, and nothing the sync wrote outlived the disconnect
        $this->assertSame($disconnectAtPage, $served);
        $this->assertSame(SyncStatus::NotConnected, $outcome->status);
        $this->assertSame(0, OutlookMeeting::query()->where('user_id', '=', $user->getKey())->count());
        $this->assertSame(0, OutlookSyncWindow::query()->where('user_id', '=', $user->getKey())->count());
        // The disconnect stands: no token came back
        $account->refresh();
        $this->assertNotNull($account->disconnected_at);
        $this->assertNull($account->refresh_token);
        $this->assertNull($account->access_token);
        // No time entry changed, and the link survives a disconnect by design
        $this->assertSame($entriesBefore, TimeEntry::query()->count());
        $this->assertSame($entryBefore, $this->entrySnapshot($entry));
        $this->assertSame(1, OutlookMeetingLink::query()->where('user_id', '=', $user->getKey())->count());
    }

    /**
     * @return array<string, mixed>
     */
    private function entrySnapshot(TimeEntry $entry): array
    {
        return (array) DB::table('time_entries')
            ->where('id', '=', $entry->getKey())
            ->first(['start', 'end', 'user_id', 'member_id', 'project_id', 'description', 'updated_at']);
    }
}
