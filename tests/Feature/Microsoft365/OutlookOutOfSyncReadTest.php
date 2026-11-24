<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Microsoft365\Graph\GraphAccessGuard;
use App\Microsoft365\Http\Controllers\OutlookMeetingController;
use App\Microsoft365\Http\Middleware\EnsureMicrosoftIsEnabled;
use App\Microsoft365\Http\Requests\MeetingRangeRequest;
use App\Microsoft365\Http\Resources\OutlookMeetingResource;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookMeetingLink;
use App\Microsoft365\Models\OutlookSyncWindow;
use App\Microsoft365\OutOfSync\OutOfSyncFlags;
use App\Microsoft365\OutOfSync\OutOfSyncScope;
use App\Microsoft365\Suggestions\BookableProjects;
use App\Microsoft365\Suggestions\MeetingHints;
use App\Microsoft365\Suggestions\MeetingSuggester;
use App\Microsoft365\Suggestions\SeriesAssignmentResolver;
use App\Microsoft365\Suggestions\SeriesKey;
use App\Microsoft365\Suggestions\SuggestionHistory;
use App\Models\Member;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use STS\FilamentImpersonate\ImpersonateManager;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

/**
 * The out-of-sync part of the calendar read (Phase 6, OSYNC-01..03): the flagged entries of the whole
 * check window (D-09, D-10, D-11), scoped to the session user and the current organization (D-14,
 * T-06-19), empty while impersonating or disconnected (D-14, D-19, T-06-20), with times and the
 * entry's own description only (T-06-21).
 *
 * The clock is fixed on Tuesday 2026-11-24 10:00 UTC; the open week is 2026-11-23 .. 2026-11-30.
 * Links are written directly with the 06-01 columns, so these tests do not depend on the sync.
 */
#[CoversClass(OutOfSyncFlags::class)]
#[UsesClass(OutOfSyncScope::class)]
#[UsesClass(OutlookMeetingController::class)]
#[UsesClass(OutlookMeetingResource::class)]
#[UsesClass(MeetingRangeRequest::class)]
#[UsesClass(MeetingHints::class)]
#[UsesClass(SeriesKey::class)]
#[UsesClass(SeriesAssignmentResolver::class)]
#[UsesClass(MeetingSuggester::class)]
#[UsesClass(SuggestionHistory::class)]
#[UsesClass(BookableProjects::class)]
#[UsesClass(OutlookMeetingLink::class)]
#[UsesClass(OutlookMeeting::class)]
#[UsesClass(OutlookSyncWindow::class)]
#[UsesClass(MicrosoftAccount::class)]
#[UsesClass(GraphAccessGuard::class)]
#[UsesClass(EnsureMicrosoftIsEnabled::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
class OutlookOutOfSyncReadTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

    private const string NOW = '2026-11-24 10:00:00';

    private const string WEEK_START = '2026-11-23T00:00:00Z';

    private const string WEEK_END = '2026-11-30T00:00:00Z';

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow(Carbon::parse(self::NOW, 'UTC'));
    }

    /**
     * An employee of a fresh organization, signed in on the web guard with a connected account.
     *
     * @return object{user: User, organization: Organization, member: Member, owner: User, ownerMember: Member}
     */
    private function employee(?string $objectId = null): object
    {
        $this->configureMicrosoft365();
        $data = $this->createUserWithRole(Role::Employee);
        $data->user->save();
        $this->connectedAccount($data->user, objectId: $objectId);
        $this->actingAs($data->user);

        return $data;
    }

    private function objectId(int $index): string
    {
        return sprintf('00000000-0000-4000-8000-%012d', 500 + $index);
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function meeting(User $user, string $graphId, string $start, string $end, array $overrides = []): OutlookMeeting
    {
        return OutlookMeeting::query()->create(array_merge([
            'user_id' => $user->getKey(),
            'graph_id' => $graphId,
            'event_type' => 'singleInstance',
            'subject' => 'Subject '.$graphId,
            'starts_at' => $start,
            'ends_at' => $end,
            'organizer_name' => 'Org Name',
            'is_organizer' => false,
            'is_online_meeting' => true,
            'web_link' => 'https://outlook.office.com/owa/?itemid='.$graphId,
            'last_seen_at' => '2026-11-20 00:00:00',
        ], $overrides));
    }

    /**
     * A time entry of the member created from a meeting: the cached meeting (optional), the entry
     * (through the factory) and the link with the 06-01 columns. The snapshot and the entry default to
     * the meeting's slot.
     *
     * @param  array<string, mixed>  $link  overrides of the link columns
     * @param  array<string, mixed>  $entry  overrides of the entry attributes
     */
    private function linkedEntry(Member $member, string $graphId, string $start, string $end, array $link = [], array $entry = [], bool $cache = true): TimeEntry
    {
        $user = User::query()->findOrFail($member->user_id);
        if ($cache) {
            $this->meeting($user, $graphId, $start, $end);
        }
        $timeEntry = TimeEntry::factory()->forMember($member)->create(array_merge([
            'start' => $start,
            'end' => $end,
            'description' => 'Entry '.$graphId,
        ], $entry));
        OutlookMeetingLink::query()->create(array_merge([
            'user_id' => $member->user_id,
            'graph_id' => $graphId,
            'time_entry_id' => $timeEntry->getKey(),
            'meeting_starts_at' => $start,
            'meeting_ends_at' => $end,
        ], $link));

        return $timeEntry;
    }

    /**
     * @return array<string, mixed>
     */
    private function movedFlag(string $newStart, string $newEnd): array
    {
        return [
            'flag_reason' => 'moved',
            'flagged_at' => '2026-11-23 08:00:00',
            'outlook_starts_at' => $newStart,
            'outlook_ends_at' => $newEnd,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function flag(string $reason): array
    {
        return ['flag_reason' => $reason, 'flagged_at' => '2026-11-23 08:00:00'];
    }

    /**
     * @param  array<string, mixed>  $extra
     */
    private function read(string $start = self::WEEK_START, string $end = self::WEEK_END, array $extra = []): TestResponse
    {
        return $this->getJson(route('microsoft.meetings.index', ['start' => $start, 'end' => $end] + $extra, false));
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function items(TestResponse $response): array
    {
        $items = $response->json('out_of_sync.items');
        $this->assertIsArray($items);
        $this->assertTrue(array_is_list($items));

        /** @var list<array<string, mixed>> $items */
        return $items;
    }

    /**
     * @return list<string>
     */
    private function itemEntryIds(TestResponse $response): array
    {
        return array_map(fn (array $item): string => (string) $item['time_entry_id'], $this->items($response));
    }

    /**
     * Moves the cached meeting of the occurrence to a new slot, as the sync does when Outlook moves it.
     */
    private function movedMeeting(User $user, string $graphId, string $start, string $end): OutlookMeeting
    {
        $meeting = OutlookMeeting::query()
            ->where('user_id', '=', $user->getKey())
            ->where('graph_id', '=', $graphId)
            ->firstOrFail();
        $meeting->starts_at = Carbon::parse($start, 'UTC');
        $meeting->ends_at = Carbon::parse($end, 'UTC');
        $meeting->save();

        return $meeting;
    }

    /**
     * The serialized meeting with this id in a read.
     *
     * @return array<string, mixed>
     */
    private function item(TestResponse $response, OutlookMeeting $meeting): array
    {
        $data = $response->json('data');
        $this->assertIsArray($data);
        foreach ($data as $item) {
            if (is_array($item) && ($item['id'] ?? null) === $meeting->id) {
                return $item;
            }
        }
        $this->fail('Meeting '.$meeting->graph_id.' is not in the read');
    }

    private function startImpersonation(): void
    {
        // The session key of stechstudio/filament-impersonate: the id of the admin who impersonates
        session()->put(ImpersonateManager::SESSION_KEY, 1);
    }

    private function disconnect(User $user): void
    {
        $account = MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->firstOrFail();
        $account->access_token = null;
        $account->refresh_token = null;
        $account->access_token_expires_at = null;
        $account->disconnected_at = Carbon::now();
        $account->save();
    }

    public function test_flagged_entry_is_listed_whatever_week_is_read(): void
    {
        // Arrange: a meeting next month moved from 10:00 to 12:00 in Outlook
        $data = $this->employee();
        $entry = $this->linkedEntry(
            $data->member,
            'next-month',
            '2026-12-15 10:00:00',
            '2026-12-15 11:00:00',
            $this->movedFlag('2026-12-15 12:00:00', '2026-12-15 13:00:00'),
            ['description' => 'Board prep'],
        );

        // Act: the current week is read, not the week of the entry
        $response = $this->read();

        // Assert
        $response->assertOk();
        $this->assertSame([[
            'time_entry_id' => $entry->getKey(),
            'kind' => 'moved',
            'meeting_start' => '2026-12-15T10:00:00Z',
            'meeting_end' => '2026-12-15T11:00:00Z',
            'new_start' => '2026-12-15T12:00:00Z',
            'new_end' => '2026-12-15T13:00:00Z',
            'all_day' => false,
            'entry_start' => '2026-12-15T10:00:00Z',
            'entry_end' => '2026-12-15T11:00:00Z',
            'description' => 'Board prep',
        ]], $this->items($response));
        // The entry is not in the week, so it carries no Outlook icon here
        $this->assertSame([], $response->json('linked_time_entry_ids'));
    }

    public function test_entry_without_description_has_an_empty_one_and_all_day_is_served(): void
    {
        // Arrange
        $data = $this->employee();
        $entry = $this->linkedEntry(
            $data->member,
            'all-day',
            '2026-11-26 10:00:00',
            '2026-11-26 11:00:00',
            $this->movedFlag('2026-11-27 00:00:00', '2026-11-28 00:00:00') + ['outlook_all_day' => true],
            ['description' => null],
        );

        // Act
        $response = $this->read();

        // Assert
        $response->assertOk();
        $items = $this->items($response);
        $this->assertCount(1, $items);
        $this->assertSame($entry->getKey(), $items[0]['time_entry_id']);
        $this->assertSame('', $items[0]['description']);
        $this->assertTrue($items[0]['all_day']);
        $this->assertSame('2026-11-27T00:00:00Z', $items[0]['new_start']);
    }

    public function test_items_are_scoped(): void
    {
        // Arrange
        $data = $this->employee();
        $moved = $this->movedFlag('2026-11-27 12:00:00', '2026-11-27 13:00:00');
        // Listed: an older flag still inside the 60-day window, a cancelled and a removed flag
        $past = $this->linkedEntry($data->member, 'past', '2026-11-02 09:00:00', '2026-11-02 10:00:00', $moved);
        $cancelled = $this->linkedEntry($data->member, 'cancelled', '2026-11-26 09:00:00', '2026-11-26 10:00:00', $this->flag('cancelled') + [
            // A leftover slot on a cancelled flag is never served
            'outlook_starts_at' => '2026-11-26 15:00:00',
            'outlook_ends_at' => '2026-11-26 16:00:00',
        ]);
        $removed = $this->linkedEntry($data->member, 'removed', '2026-11-27 09:00:00', '2026-11-27 10:00:00', $this->flag('removed'));
        // Not listed: unflagged, released, detached, older than 60 days
        $this->linkedEntry($data->member, 'unflagged', '2026-11-25 09:00:00', '2026-11-25 10:00:00');
        $this->linkedEntry($data->member, 'released', '2026-11-25 11:00:00', '2026-11-25 12:00:00', $moved + ['released_at' => '2026-11-23 09:00:00']);
        $this->linkedEntry($data->member, 'detached', '2026-11-25 13:00:00', '2026-11-25 14:00:00', $this->flag('cancelled') + ['detached_at' => '2026-11-23 09:00:00']);
        $this->linkedEntry($data->member, 'too-old', '2026-09-20 09:00:00', '2026-09-20 10:00:00', $moved);
        // Not listed: an entry of the user in another organization
        $other = $this->createUserWithRole(Role::Employee);
        $otherMember = Member::factory()->forUser($data->user)->forOrganization($other->organization)->role(Role::Employee)->create();
        $this->linkedEntry($otherMember, 'other-org', '2026-11-25 15:00:00', '2026-11-25 16:00:00', $moved);
        // Not listed: another user's flagged link, and the user's entry reassigned to another user
        $neighbour = User::factory()->create();
        $neighbourMember = Member::factory()->forUser($neighbour)->forOrganization($data->organization)->role(Role::Employee)->create();
        $this->linkedEntry($neighbourMember, 'neighbour', '2026-11-25 17:00:00', '2026-11-25 18:00:00', $moved);
        $reassigned = $this->linkedEntry($data->member, 'reassigned', '2026-11-26 17:00:00', '2026-11-26 18:00:00', $moved);
        $reassigned->user_id = $neighbour->getKey();
        $reassigned->member_id = $neighbourMember->getKey();
        $reassigned->save();

        // Act
        $response = $this->read();

        // Assert: ordered by entry start
        $response->assertOk();
        $this->assertSame([$past->getKey(), $cancelled->getKey(), $removed->getKey()], $this->itemEntryIds($response));
        $items = $this->items($response);
        $this->assertSame('moved', $items[0]['kind']);
        foreach ([1 => 'cancelled', 2 => 'removed'] as $index => $kind) {
            $this->assertSame($kind, $items[$index]['kind']);
            $this->assertNull($items[$index]['new_start']);
            $this->assertNull($items[$index]['new_end']);
            $this->assertFalse($items[$index]['all_day']);
        }
    }

    public function test_items_are_capped_and_ordered(): void
    {
        // Arrange: 205 flagged links, created latest first
        $data = $this->employee();
        $base = Carbon::parse('2026-11-25 00:00:00', 'UTC');
        $entries = [];
        for ($index = 204; $index >= 0; $index--) {
            $start = $base->copy()->addHours($index);
            $entries[$index] = TimeEntry::factory()->forMember($data->member)->create([
                'start' => $start->format('Y-m-d H:i:s'),
                'end' => $start->copy()->addMinutes(30)->format('Y-m-d H:i:s'),
            ]);
        }
        $rows = [];
        foreach ($entries as $index => $entry) {
            $start = $base->copy()->addHours($index);
            $rows[] = [
                'id' => (string) Str::uuid(),
                'user_id' => $data->user->getKey(),
                'graph_id' => 'bulk-'.$index,
                'time_entry_id' => $entry->getKey(),
                'meeting_starts_at' => $start->format('Y-m-d H:i:s'),
                'meeting_ends_at' => $start->copy()->addMinutes(30)->format('Y-m-d H:i:s'),
                'flag_reason' => 'cancelled',
                'flagged_at' => '2026-11-23 08:00:00',
                'outlook_all_day' => false,
                'created_at' => '2026-11-20 00:00:00',
                'updated_at' => '2026-11-20 00:00:00',
            ];
        }
        DB::table('outlook_meeting_links')->insert($rows);

        // Act
        $response = $this->read();

        // Assert: the 200 earliest, in entry start order
        $response->assertOk();
        $expected = [];
        for ($index = 0; $index < 200; $index++) {
            $expected[] = $entries[$index]->getKey();
        }
        $this->assertSame($expected, $this->itemEntryIds($response));
    }

    public function test_empty_states(): void
    {
        // Arrange: a flagged entry for every user
        $this->configureMicrosoft365();
        $empty = ['items' => []];
        $impersonated = $this->employee($this->objectId(1));
        $this->linkedEntry($impersonated->member, 'imp', '2026-11-26 09:00:00', '2026-11-26 10:00:00', $this->flag('cancelled'));
        $noAccount = $this->createUserWithRole(Role::Employee);
        $noAccount->user->save();
        $this->linkedEntry($noAccount->member, 'no-account', '2026-11-26 09:00:00', '2026-11-26 10:00:00', $this->flag('cancelled'));
        $disconnected = $this->employee($this->objectId(2));
        $this->linkedEntry($disconnected->member, 'disc', '2026-11-26 09:00:00', '2026-11-26 10:00:00', $this->flag('removed'));
        $this->disconnect($disconnected->user);
        $reconnect = $this->employee($this->objectId(3));
        $reconnectEntry = $this->linkedEntry($reconnect->member, 'recon', '2026-11-26 09:00:00', '2026-11-26 10:00:00', $this->flag('cancelled'));
        $reconnectAccount = MicrosoftAccount::query()->where('user_id', '=', $reconnect->user->getKey())->firstOrFail();
        $reconnectAccount->reconnect_required_at = Carbon::now();
        $reconnectAccount->save();

        // Act
        $this->actingAs($impersonated->user);
        $control = $this->read();
        $this->startImpersonation();
        $impersonatedRead = $this->read();
        session()->forget(ImpersonateManager::SESSION_KEY);
        $this->actingAs($noAccount->user);
        $noAccountRead = $this->read();
        $this->actingAs($disconnected->user);
        $disconnectedRead = $this->read();
        $this->actingAs($reconnect->user);
        $reconnectRead = $this->read();

        // Assert
        $control->assertOk();
        $this->assertCount(1, $this->items($control));
        foreach ([$impersonatedRead, $noAccountRead, $disconnectedRead] as $read) {
            $read->assertOk();
            $read->assertJsonPath('out_of_sync', $empty);
            $read->assertJsonPath('auto_adjusted', []);
        }
        $reconnectRead->assertOk();
        $this->assertSame([$reconnectEntry->getKey()], $this->itemEntryIds($reconnectRead));
    }

    public function test_flags_survive_disconnect_and_a_new_connect(): void
    {
        // Arrange
        $data = $this->employee();
        $entry = $this->linkedEntry($data->member, 'kept', '2026-11-26 09:00:00', '2026-11-26 10:00:00', $this->flag('cancelled'));
        $before = $this->read();

        // Act: Disconnect, then connect again
        $this->disconnect($data->user);
        $whileDisconnected = $this->read();
        MicrosoftAccount::query()->where('user_id', '=', $data->user->getKey())->delete();
        $this->connectedAccount($data->user);
        $after = $this->read();

        // Assert
        $this->assertSame([$entry->getKey()], $this->itemEntryIds($before));
        $whileDisconnected->assertJsonPath('out_of_sync', ['items' => []]);
        $this->assertSame([$entry->getKey()], $this->itemEntryIds($after));
    }

    public function test_no_current_organization_lists_nothing(): void
    {
        // Arrange: the user left the organization of the entry
        $data = $this->employee();
        $this->linkedEntry($data->member, 'left', '2026-11-26 09:00:00', '2026-11-26 10:00:00', $this->flag('cancelled'));
        $data->user->current_team_id = null;
        $data->user->save();

        // Act
        $response = $this->read();

        // Assert
        $response->assertOk();
        $response->assertJsonPath('out_of_sync', ['items' => []]);
        $response->assertJsonPath('auto_adjusted', []);
    }

    public function test_no_subject_or_graph_id_in_flags(): void
    {
        // Arrange
        $data = $this->employee();
        $graphId = 'AAMkAGSecretImmutableId==';
        $this->linkedEntry(
            $data->member,
            $graphId,
            '2026-11-26 09:00:00',
            '2026-11-26 10:00:00',
            $this->movedFlag('2026-11-26 12:00:00', '2026-11-26 13:00:00') + ['series_master_id' => 'AAMkSeriesSecret=='],
            ['description' => 'My own words'],
        );
        OutlookMeeting::query()->where('graph_id', '=', $graphId)->update(['subject' => 'Confidential board topic', 'series_master_id' => 'AAMkSeriesSecret==']);

        // Act
        $response = $this->read();

        // Assert
        $response->assertOk();
        $json = json_encode([$response->json('out_of_sync'), $response->json('auto_adjusted')], JSON_THROW_ON_ERROR);
        $this->assertStringNotContainsString('Confidential', $json);
        $this->assertStringNotContainsString('AAMk', $json);
        $this->assertStringContainsString('My own words', $json);
        $this->assertSame(
            ['time_entry_id', 'kind', 'meeting_start', 'meeting_end', 'new_start', 'new_end', 'all_day', 'entry_start', 'entry_end', 'description'],
            array_keys($this->items($response)[0]),
        );
    }

    public function test_released_meeting_shows_again_with_moved_from(): void
    {
        // Arrange: logged on Monday 10:00, started, then moved by Outlook to Thursday 15:00 (released)
        $data = $this->employee();
        $entry = $this->linkedEntry($data->member, 'started', '2026-11-23 10:00:00', '2026-11-23 11:00:00', ['released_at' => '2026-11-24 09:00:00']);
        $meeting = $this->movedMeeting($data->user, 'started', '2026-11-26 15:00:00', '2026-11-26 16:00:00');

        // Act
        $response = $this->read();

        // Assert
        $response->assertOk();
        $item = $this->item($response, $meeting);
        $this->assertSame('2026-11-26T15:00:00Z', $item['start']);
        $this->assertSame([
            'time_entry_id' => $entry->getKey(),
            'entry_start' => '2026-11-23T10:00:00Z',
            'entry_end' => '2026-11-23T11:00:00Z',
        ], $item['moved_from']);
        // The logged entry keeps its Outlook icon
        $this->assertSame([$entry->getKey()], $response->json('linked_time_entry_ids'));
        $this->assertSame([], $this->items($response));
    }

    public function test_active_link_still_hides_the_meeting(): void
    {
        // Arrange: a flagged and an auto-adjusted link, both active, their meetings in the week
        $data = $this->employee();
        $flagged = $this->linkedEntry($data->member, 'flagged', '2026-11-26 09:00:00', '2026-11-26 10:00:00', $this->movedFlag('2026-11-27 09:00:00', '2026-11-27 10:00:00'));
        $this->movedMeeting($data->user, 'flagged', '2026-11-27 09:00:00', '2026-11-27 10:00:00');
        $adjusted = $this->linkedEntry($data->member, 'adjusted', '2026-11-26 12:00:00', '2026-11-26 13:00:00', [
            'auto_adjusted_at' => '2026-11-23 09:00:00',
            'auto_adjusted_from_starts_at' => '2026-11-25 12:00:00',
            'auto_adjusted_from_ends_at' => '2026-11-25 13:00:00',
        ]);

        // Act
        $response = $this->read();

        // Assert
        $response->assertOk();
        $this->assertSame([], $response->json('data'));
        $this->assertSame([$flagged->getKey(), $adjusted->getKey()], $response->json('linked_time_entry_ids'));
    }

    public function test_second_entry_hides_it_again(): void
    {
        // Arrange: the released meeting was logged again at its new slot (a second, active link)
        $data = $this->employee();
        $first = $this->linkedEntry($data->member, 'twice', '2026-11-23 10:00:00', '2026-11-23 11:00:00', ['released_at' => '2026-11-24 09:00:00']);
        $this->movedMeeting($data->user, 'twice', '2026-11-26 15:00:00', '2026-11-26 16:00:00');
        $second = $this->linkedEntry($data->member, 'twice', '2026-11-26 15:00:00', '2026-11-26 16:00:00', cache: false);

        // Act
        $response = $this->read();

        // Assert
        $response->assertOk();
        $this->assertSame([], $response->json('data'));
        $this->assertSame([$first->getKey(), $second->getKey()], $response->json('linked_time_entry_ids'));
    }

    public function test_moved_from_only_for_own_live_entries_in_the_current_organization(): void
    {
        // Arrange: three released meetings whose entry was deleted, reassigned or lives elsewhere
        $data = $this->employee();
        $released = ['released_at' => '2026-11-24 09:00:00'];
        $deleted = $this->linkedEntry($data->member, 'deleted', '2026-11-23 09:00:00', '2026-11-23 10:00:00', $released);
        $deletedMeeting = $this->movedMeeting($data->user, 'deleted', '2026-11-26 09:00:00', '2026-11-26 10:00:00');
        $deleted->delete();
        $neighbour = User::factory()->create();
        $neighbourMember = Member::factory()->forUser($neighbour)->forOrganization($data->organization)->role(Role::Employee)->create();
        $reassigned = $this->linkedEntry($data->member, 'reassigned', '2026-11-23 11:00:00', '2026-11-23 12:00:00', $released);
        $reassignedMeeting = $this->movedMeeting($data->user, 'reassigned', '2026-11-26 11:00:00', '2026-11-26 12:00:00');
        $reassigned->user_id = $neighbour->getKey();
        $reassigned->member_id = $neighbourMember->getKey();
        $reassigned->save();
        $other = $this->createUserWithRole(Role::Employee);
        $otherMember = Member::factory()->forUser($data->user)->forOrganization($other->organization)->role(Role::Employee)->create();
        $this->linkedEntry($otherMember, 'elsewhere', '2026-11-23 13:00:00', '2026-11-23 14:00:00', $released);
        $elsewhereMeeting = $this->movedMeeting($data->user, 'elsewhere', '2026-11-26 13:00:00', '2026-11-26 14:00:00');

        // Act
        $response = $this->read();

        // Assert: each meeting is a plain suggestion again
        $response->assertOk();
        $this->assertCount(3, $response->json('data'));
        foreach ([$deletedMeeting, $reassignedMeeting, $elsewhereMeeting] as $meeting) {
            $item = $this->item($response, $meeting);
            $this->assertNull($item['moved_from']);
            $this->assertIsArray($item['suggestions']);
        }
        $this->assertSame(0, OutlookMeetingLink::query()->where('graph_id', '=', 'deleted')->count());
    }

    public function test_latest_released_link_wins(): void
    {
        // Arrange: the occurrence was logged twice and both links were released
        $data = $this->employee();
        $this->linkedEntry($data->member, 'moving', '2026-11-23 10:00:00', '2026-11-23 11:00:00', ['released_at' => '2026-11-23 12:00:00']);
        $latest = $this->linkedEntry($data->member, 'moving', '2026-11-24 07:00:00', '2026-11-24 08:00:00', ['released_at' => '2026-11-24 09:00:00'], cache: false);
        $meeting = $this->movedMeeting($data->user, 'moving', '2026-11-26 15:00:00', '2026-11-26 16:00:00');

        // Act
        $response = $this->read();

        // Assert
        $response->assertOk();
        $this->assertSame([
            'time_entry_id' => $latest->getKey(),
            'entry_start' => '2026-11-24T07:00:00Z',
            'entry_end' => '2026-11-24T08:00:00Z',
        ], $this->item($response, $meeting)['moved_from']);
    }

    public function test_dismissed_meeting_has_no_moved_from(): void
    {
        // Arrange
        $data = $this->employee();
        $this->linkedEntry($data->member, 'dismissed', '2026-11-23 10:00:00', '2026-11-23 11:00:00', ['released_at' => '2026-11-24 09:00:00']);
        $meeting = $this->movedMeeting($data->user, 'dismissed', '2026-11-26 15:00:00', '2026-11-26 16:00:00');
        $meeting->dismissed_at = Carbon::now();
        $meeting->save();

        // Act
        $response = $this->read(extra: ['include_dismissed' => 1]);

        // Assert
        $response->assertOk();
        $item = $this->item($response, $meeting);
        $this->assertTrue($item['dismissed']);
        $this->assertNull($item['moved_from']);
    }

    public function test_recent_auto_adjust_is_listed_for_entries_in_range(): void
    {
        // Arrange: adjusted from Wednesday 12:00 to Thursday 12:00 two days ago
        $data = $this->employee();
        $recent = $this->linkedEntry($data->member, 'recent', '2026-11-26 12:00:00', '2026-11-26 13:00:00', $this->adjusted('2026-11-22 10:00:00', '2026-11-25 12:00:00', '2026-11-25 13:00:00'));
        // Not listed: adjusted eight days ago, outside the range, another organization, another user
        $this->linkedEntry($data->member, 'stale', '2026-11-27 12:00:00', '2026-11-27 13:00:00', $this->adjusted('2026-11-16 10:00:00', '2026-11-20 12:00:00', '2026-11-20 13:00:00'));
        $this->linkedEntry($data->member, 'later', '2026-12-08 12:00:00', '2026-12-08 13:00:00', $this->adjusted('2026-11-22 10:00:00', '2026-12-07 12:00:00', '2026-12-07 13:00:00'));
        $other = $this->createUserWithRole(Role::Employee);
        $otherMember = Member::factory()->forUser($data->user)->forOrganization($other->organization)->role(Role::Employee)->create();
        $this->linkedEntry($otherMember, 'other-org', '2026-11-26 15:00:00', '2026-11-26 16:00:00', $this->adjusted('2026-11-22 10:00:00', '2026-11-25 15:00:00', '2026-11-25 16:00:00'));
        $neighbour = User::factory()->create();
        $neighbourMember = Member::factory()->forUser($neighbour)->forOrganization($data->organization)->role(Role::Employee)->create();
        $this->linkedEntry($neighbourMember, 'neighbour', '2026-11-26 17:00:00', '2026-11-26 18:00:00', $this->adjusted('2026-11-22 10:00:00', '2026-11-25 17:00:00', '2026-11-25 18:00:00'));

        // Act
        $response = $this->read();
        $nextWeek = $this->read('2026-12-07T00:00:00Z', '2026-12-14T00:00:00Z');

        // Assert
        $response->assertOk();
        $this->assertSame([[
            'time_entry_id' => $recent->getKey(),
            'at' => '2026-11-22T10:00:00Z',
            'from_start' => '2026-11-25T12:00:00Z',
            'from_end' => '2026-11-25T13:00:00Z',
            'to_start' => '2026-11-26T12:00:00Z',
            'to_end' => '2026-11-26T13:00:00Z',
        ]], $response->json('auto_adjusted'));
        $nextWeek->assertOk();
        $this->assertSame(['later'], array_map(
            fn (array $item): string => (string) OutlookMeetingLink::query()->where('time_entry_id', '=', $item['time_entry_id'])->value('graph_id'),
            $nextWeek->json('auto_adjusted'),
        ));
    }

    public function test_read_query_count_does_not_grow(): void
    {
        // Arrange: a small and a large user, each with flags, released meetings and an adjusted entry
        $small = $this->employee($this->objectId(1));
        $this->outOfSyncState($small->member, flagged: 2, released: 2);
        $large = $this->employee($this->objectId(2));
        $this->outOfSyncState($large->member, flagged: 40, released: 10);
        $this->actingAs($small->user);
        $this->read()->assertOk();
        $this->actingAs($large->user);
        $this->read()->assertOk();

        // Act
        $this->actingAs($small->user);
        $this->enableQueryLog();
        $smallRead = $this->read();
        $smallQueries = count($this->getQueryLog());
        DB::flushQueryLog();
        $this->actingAs($large->user);
        $largeRead = $this->read();
        $largeQueries = count($this->getQueryLog());
        DB::disableQueryLog();

        // Assert: everything is served, at the same cost (T-06-22)
        $smallRead->assertOk();
        $largeRead->assertOk();
        $this->assertCount(2, $this->items($smallRead));
        $this->assertCount(40, $this->items($largeRead));
        $this->assertCount(2, $smallRead->json('data'));
        $this->assertCount(10, $largeRead->json('data'));
        foreach ([$smallRead, $largeRead] as $read) {
            foreach ($read->json('data') as $item) {
                $this->assertNotNull($item['moved_from']);
            }
            $this->assertCount(1, $read->json('auto_adjusted'));
        }
        $this->assertSame($smallQueries, $largeQueries);
    }

    /**
     * @return array<string, mixed>
     */
    private function adjusted(string $at, string $fromStart, string $fromEnd): array
    {
        return [
            'auto_adjusted_at' => $at,
            'auto_adjusted_from_starts_at' => $fromStart,
            'auto_adjusted_from_ends_at' => $fromEnd,
        ];
    }

    /**
     * Flagged entries next month, started meetings released on Monday and shown again on Thursday,
     * and one entry adjusted automatically this week.
     */
    private function outOfSyncState(Member $member, int $flagged, int $released): void
    {
        $user = User::query()->findOrFail($member->user_id);
        $base = Carbon::parse('2026-12-01 00:00:00', 'UTC');
        for ($index = 0; $index < $flagged; $index++) {
            $start = $base->copy()->addHours($index);
            $this->linkedEntry($member, 'flagged-'.$index, $start->format('Y-m-d H:i:s'), $start->copy()->addMinutes(30)->format('Y-m-d H:i:s'), $this->flag('cancelled'));
        }
        for ($index = 0; $index < $released; $index++) {
            $graphId = 'released-'.$index;
            $this->linkedEntry($member, $graphId, sprintf('2026-11-23 %02d:00:00', $index), sprintf('2026-11-23 %02d:30:00', $index), ['released_at' => '2026-11-24 09:00:00']);
            $this->movedMeeting($user, $graphId, sprintf('2026-11-26 %02d:00:00', $index), sprintf('2026-11-26 %02d:30:00', $index));
        }
        $this->linkedEntry($member, 'adjusted', '2026-11-27 12:00:00', '2026-11-27 13:00:00', $this->adjusted('2026-11-23 10:00:00', '2026-11-25 12:00:00', '2026-11-25 13:00:00'));
    }
}
