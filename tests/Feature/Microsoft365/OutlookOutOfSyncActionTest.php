<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Microsoft365\Graph\GraphAccessGuard;
use App\Microsoft365\Http\Controllers\OutlookMeetingController;
use App\Microsoft365\Http\Controllers\OutOfSyncController;
use App\Microsoft365\Http\Middleware\EnsureMicrosoftIsEnabled;
use App\Microsoft365\Http\Requests\MeetingRangeRequest;
use App\Microsoft365\Http\Resources\OutlookMeetingResource;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookMeetingLink;
use App\Microsoft365\Models\OutlookSyncWindow;
use App\Microsoft365\OutOfSync\ApplyResult;
use App\Microsoft365\OutOfSync\Decision;
use App\Microsoft365\OutOfSync\LinkState;
use App\Microsoft365\OutOfSync\Observation;
use App\Microsoft365\OutOfSync\OutOfSyncApplier;
use App\Microsoft365\OutOfSync\OutOfSyncFlags;
use App\Microsoft365\OutOfSync\OutOfSyncRules;
use App\Microsoft365\OutOfSync\OutOfSyncScope;
use App\Models\Member;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use STS\FilamentImpersonate\ImpersonateManager;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

/**
 * The user's answers to an out-of-sync flag (Phase 6, OSYNC-03): "Keep as is" re-baselines a moved flag
 * (D-16) and detaches a cancelled or removed one, "Adjust to Outlook" moves the entry through core's own
 * update path (D-04), and deleting stays core's own DELETE (D-05). Every action is scoped to the session
 * user's own flagged entries (T-06-26) and hidden while impersonating or disconnected (D-14, D-19).
 *
 * The clock is fixed on Tuesday 2026-11-24 10:00 UTC; flagged meetings are on Thursday 2026-11-26, so
 * they have not started. Links are written directly with the 06-01 columns.
 */
#[CoversClass(OutOfSyncController::class)]
#[UsesClass(OutOfSyncApplier::class)]
#[UsesClass(OutOfSyncRules::class)]
#[UsesClass(OutOfSyncScope::class)]
#[UsesClass(OutOfSyncFlags::class)]
#[UsesClass(ApplyResult::class)]
#[UsesClass(Decision::class)]
#[UsesClass(LinkState::class)]
#[UsesClass(Observation::class)]
#[UsesClass(OutlookMeetingController::class)]
#[UsesClass(OutlookMeetingResource::class)]
#[UsesClass(MeetingRangeRequest::class)]
#[UsesClass(OutlookMeetingLink::class)]
#[UsesClass(OutlookMeeting::class)]
#[UsesClass(OutlookSyncWindow::class)]
#[UsesClass(MicrosoftAccount::class)]
#[UsesClass(GraphAccessGuard::class)]
#[UsesClass(EnsureMicrosoftIsEnabled::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
class OutlookOutOfSyncActionTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

    private const string NOW = '2026-11-24 10:00:00';

    private const string WEEK_START = '2026-11-23T00:00:00Z';

    private const string WEEK_END = '2026-11-30T00:00:00Z';

    private const string FORMAT = 'Y-m-d H:i:s';

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
        return sprintf('00000000-0000-4000-8000-%012d', 700 + $index);
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
     * A time entry of the member created from a meeting: the cached meeting, the entry (through the
     * factory) and the link with the 06-01 columns. The snapshot and the entry default to the meeting's
     * slot.
     *
     * @param  array<string, mixed>  $link  overrides of the link columns
     * @param  array<string, mixed>  $entry  overrides of the entry attributes
     */
    private function linkedEntry(Member $member, string $graphId, string $start, string $end, array $link = [], array $entry = []): TimeEntry
    {
        $user = User::query()->findOrFail($member->user_id);
        $this->meeting($user, $graphId, $start, $end);
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
    private function movedFlag(string $newStart, string $newEnd, bool $allDay = false): array
    {
        return [
            'flag_reason' => 'moved',
            'flagged_at' => '2026-11-23 08:00:00',
            'outlook_starts_at' => $newStart,
            'outlook_ends_at' => $newEnd,
            'outlook_all_day' => $allDay,
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
     * The moved flag of most tests: Thursday 10:00-11:00 recorded, Outlook now 12:00-13:00, the entry
     * edited to 10:15-11:00 (so it was flagged, not adjusted automatically).
     */
    private function movedEntry(Member $member, string $graphId = 'moved'): TimeEntry
    {
        return $this->linkedEntry(
            $member,
            $graphId,
            '2026-11-26 10:00:00',
            '2026-11-26 11:00:00',
            $this->movedFlag('2026-11-26 12:00:00', '2026-11-26 13:00:00'),
            ['start' => '2026-11-26 10:15:00'],
        );
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function keep(string $entryId, array $body = []): TestResponse
    {
        return $this->postJson(route('microsoft.meetings.out-of-sync.keep', ['entry' => $entryId], false), $body);
    }

    private function linkOf(TimeEntry $entry): OutlookMeetingLink
    {
        return OutlookMeetingLink::query()->where('time_entry_id', '=', $entry->getKey())->sole();
    }

    /**
     * Everything an action could change on the link and its entry, for "nothing changed" checks.
     *
     * @return array<string, mixed>
     */
    private function state(TimeEntry $entry): array
    {
        $link = $this->linkOf($entry);
        $fresh = TimeEntry::query()->findOrFail($entry->getKey());

        return [
            'meeting_starts_at' => $link->meeting_starts_at?->format(self::FORMAT),
            'meeting_ends_at' => $link->meeting_ends_at?->format(self::FORMAT),
            'flag_reason' => $link->flag_reason,
            'flagged_at' => $link->flagged_at?->format(self::FORMAT),
            'outlook_starts_at' => $link->outlook_starts_at?->format(self::FORMAT),
            'outlook_ends_at' => $link->outlook_ends_at?->format(self::FORMAT),
            'outlook_all_day' => $link->outlook_all_day,
            'released_at' => $link->released_at?->format(self::FORMAT),
            'detached_at' => $link->detached_at?->format(self::FORMAT),
            'last_checked_at' => $link->last_checked_at?->format(self::FORMAT),
            'entry_start' => $fresh->start->utc()->format(self::FORMAT),
            'entry_end' => $fresh->end?->utc()->format(self::FORMAT),
            'entry_user_id' => $fresh->user_id,
            'description' => $fresh->description,
            'project_id' => $fresh->project_id,
            'billable' => $fresh->billable,
        ];
    }

    private function assertFlagCleared(OutlookMeetingLink $link): void
    {
        $this->assertNull($link->flag_reason);
        $this->assertNull($link->flagged_at);
        $this->assertNull($link->outlook_starts_at);
        $this->assertNull($link->outlook_ends_at);
        $this->assertFalse($link->outlook_all_day);
        $this->assertSame(self::NOW, $link->last_checked_at?->format(self::FORMAT));
    }

    private function read(): TestResponse
    {
        return $this->getJson(route('microsoft.meetings.index', ['start' => self::WEEK_START, 'end' => self::WEEK_END], false));
    }

    /**
     * @return list<string>
     */
    private function flaggedIds(TestResponse $response): array
    {
        $items = $response->json('out_of_sync.items');
        $this->assertIsArray($items);

        return array_values(array_map(fn (mixed $item): string => is_array($item) ? (string) $item['time_entry_id'] : '', $items));
    }

    private function observe(User $user, string $graphId, Observation $observation): ApplyResult
    {
        return app(OutOfSyncApplier::class)->apply($user, [$graphId => $observation], CarbonImmutable::now());
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

    public function test_keep_on_a_moved_flag_makes_outlook_the_new_reference(): void
    {
        // Arrange
        $data = $this->employee();
        $entry = $this->movedEntry($data->member);

        // Act
        $response = $this->keep($entry->getKey());

        // Assert: the snapshot is the accepted Outlook slot, the flag is gone, the entry is untouched
        $response->assertOk();
        $response->assertExactJson(['time_entry_id' => $entry->getKey(), 'status' => 'kept']);
        $link = $this->linkOf($entry);
        $this->assertSame('2026-11-26 12:00:00', $link->meeting_starts_at?->format(self::FORMAT));
        $this->assertSame('2026-11-26 13:00:00', $link->meeting_ends_at?->format(self::FORMAT));
        $this->assertFlagCleared($link);
        $this->assertNull($link->detached_at);
        $this->assertNull($link->released_at);
        $fresh = TimeEntry::query()->findOrFail($entry->getKey());
        $this->assertSame('2026-11-26 10:15:00', $fresh->start->utc()->format(self::FORMAT));
        $this->assertSame('2026-11-26 11:00:00', $fresh->end?->utc()->format(self::FORMAT));
        $this->assertSame('Entry moved', $fresh->description);
        $this->assertSame([], $this->flaggedIds($this->read()));

        // Act: the same move seen again never flags again (D-16)
        $same = $this->observe($data->user, 'moved', Observation::present('2026-11-26 12:00:00', '2026-11-26 13:00:00', false, CarbonImmutable::now()));

        // Assert
        $this->assertSame(0, $same->flagged);
        $this->assertNull($this->linkOf($entry)->flag_reason);

        // Act: a later move is compared against the new reference and detected
        $later = $this->observe($data->user, 'moved', Observation::present('2026-11-26 14:00:00', '2026-11-26 15:00:00', false, CarbonImmutable::now()));

        // Assert
        $this->assertSame(1, $later->flagged);
        $link = $this->linkOf($entry);
        $this->assertSame('moved', $link->flag_reason);
        $this->assertSame('2026-11-26 14:00:00', $link->outlook_starts_at?->format(self::FORMAT));
        $this->assertSame('2026-11-26 15:00:00', $link->outlook_ends_at?->format(self::FORMAT));
        $this->assertSame('2026-11-26 10:15:00', TimeEntry::query()->findOrFail($entry->getKey())->start->utc()->format(self::FORMAT));
    }

    public function test_keep_on_a_cancelled_flag_detaches_the_link(): void
    {
        // Arrange
        $data = $this->employee();
        $cancelled = $this->linkedEntry($data->member, 'cancelled', '2026-11-26 09:00:00', '2026-11-26 10:00:00', $this->flag('cancelled'));
        $removed = $this->linkedEntry($data->member, 'removed', '2026-11-26 14:00:00', '2026-11-26 15:00:00', $this->flag('removed'));
        $this->assertSame([$cancelled->getKey(), $removed->getKey()], $this->flaggedIds($this->read()));

        // Act
        $keepCancelled = $this->keep($cancelled->getKey());
        $keepRemoved = $this->keep($removed->getKey());

        // Assert: both links are detached with their flag cleared; the entries are untouched
        foreach ([$keepCancelled, $keepRemoved] as $response) {
            $response->assertOk();
            $response->assertJsonPath('status', 'kept');
        }
        foreach ([$cancelled, $removed] as $entry) {
            $link = $this->linkOf($entry);
            $this->assertSame(self::NOW, $link->detached_at?->format(self::FORMAT));
            $this->assertFlagCleared($link);
            $this->assertNotNull(TimeEntry::query()->find($entry->getKey()));
        }
        $before = $this->state($cancelled);

        // Act: a later observation of the occurrence finds no active link to check
        $later = $this->observe($data->user, 'cancelled', Observation::cancelled(CarbonImmutable::now()));

        // Assert
        $this->assertSame(0, $later->flagged);
        $this->assertSame($before, $this->state($cancelled));
        $this->assertSame([], $this->flaggedIds($this->read()));
    }

    public function test_keep_on_an_all_day_moved_flag_detaches_the_link(): void
    {
        // Arrange: Outlook turned the meeting into an all-day event (D-18)
        $data = $this->employee();
        $entry = $this->linkedEntry(
            $data->member,
            'all-day',
            '2026-11-26 10:00:00',
            '2026-11-26 11:00:00',
            $this->movedFlag('2026-11-26 00:00:00', '2026-11-27 00:00:00', true),
        );

        // Act
        $response = $this->keep($entry->getKey());
        $again = $this->observe($data->user, 'all-day', Observation::present('2026-11-26 00:00:00', '2026-11-27 00:00:00', true, CarbonImmutable::now()));

        // Assert: an all-day slot is no reference; the link is detached, so the same sighting never flags again
        $response->assertOk();
        $link = $this->linkOf($entry);
        $this->assertSame(self::NOW, $link->detached_at?->format(self::FORMAT));
        $this->assertFlagCleared($link);
        $this->assertSame('2026-11-26 10:00:00', $link->meeting_starts_at?->format(self::FORMAT));
        $this->assertSame(0, $again->flagged);
        $this->assertNull($this->linkOf($entry)->flag_reason);
    }

    public function test_keep_is_scoped_to_the_session_user(): void
    {
        // Arrange: a flagged entry of another user, an unflagged, a released, a detached and a reassigned one
        $this->configureMicrosoft365();
        $other = $this->employee($this->objectId(1));
        $foreign = $this->movedEntry($other->member, 'foreign');
        $data = $this->employee($this->objectId(2));
        $unflagged = $this->linkedEntry($data->member, 'unflagged', '2026-11-26 09:00:00', '2026-11-26 10:00:00');
        $released = $this->linkedEntry($data->member, 'released', '2026-11-23 09:00:00', '2026-11-23 10:00:00', [
            ...$this->flag('cancelled'),
            'released_at' => '2026-11-23 12:00:00',
        ]);
        $detached = $this->linkedEntry($data->member, 'detached', '2026-11-26 11:00:00', '2026-11-26 12:00:00', [
            ...$this->flag('removed'),
            'detached_at' => '2026-11-23 12:00:00',
        ]);
        $reassigned = $this->linkedEntry($data->member, 'reassigned', '2026-11-26 13:00:00', '2026-11-26 14:00:00', $this->flag('cancelled'));
        TimeEntry::query()->whereKey($reassigned->getKey())->update([
            'user_id' => $data->owner->getKey(),
            'member_id' => $data->ownerMember->getKey(),
        ]);
        $entries = [$foreign, $unflagged, $released, $detached, $reassigned];
        $before = array_map(fn (TimeEntry $entry): array => $this->state($entry), $entries);

        // Act
        $responses = array_map(fn (TimeEntry $entry): TestResponse => $this->keep($entry->getKey()), $entries);
        $unknown = $this->keep(Str::uuid()->toString());
        $notUuid = $this->postJson('/m365/out-of-sync/not-a-uuid/keep');

        // Assert: the same plain 404 for each, and nothing changed
        foreach ([...$responses, $unknown, $notUuid] as $response) {
            $response->assertNotFound();
        }
        $this->assertSame($before, array_map(fn (TimeEntry $entry): array => $this->state($entry), $entries));
    }
}
