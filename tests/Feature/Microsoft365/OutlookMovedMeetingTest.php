<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Exceptions\Api\ApiException;
use App\Http\Controllers\Api\V1\TimeEntryController;
use App\Http\Middleware\CheckOrganizationBlocked;
use App\Http\Requests\V1\TimeEntry\TimeEntryStoreRequest;
use App\Http\Requests\V1\TimeEntry\TimeEntryUpdateRequest;
use App\Microsoft365\Graph\GraphAccessGuard;
use App\Microsoft365\Http\Controllers\MeetingConversionController;
use App\Microsoft365\Http\Controllers\OutlookMeetingController;
use App\Microsoft365\Http\Controllers\OutOfSyncController;
use App\Microsoft365\Http\Middleware\EnsureMicrosoftIsEnabled;
use App\Microsoft365\Http\Requests\MeetingConversionRequest;
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
use App\Microsoft365\Suggestions\MeetingSignalInput;
use App\Microsoft365\Suggestions\MeetingSignals;
use App\Microsoft365\Suggestions\SeriesAssignmentResolver;
use App\Microsoft365\TimeEntries\CoreTimeEntryCreator;
use App\Microsoft365\TimeEntries\CoreTimeEntryUpdater;
use App\Models\Member;
use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use App\Service\BillingContract;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Mockery\MockInterface;
use PDOException;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use STS\FilamentImpersonate\ImpersonateManager;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

/**
 * A started meeting that Outlook moved to a new slot (Phase 6 D-03, OSYNC-01): its link was released, so
 * the meeting shows again at the new slot, and the user either creates a second entry there ("Create time
 * entry", the conversion with an active-only link lookup) or moves the logged entry along ("Move my entry
 * here", OutOfSyncController::moveEntry). Both are scoped to the session user's own data, go through
 * core only, and are safe against races and foreign ids (T-06-27..T-06-30).
 *
 * The clock is fixed on Tuesday 2026-11-24 10:00 UTC. The meeting was logged on Monday 2026-11-23
 * 10:00-11:00; Outlook moved it to Thursday 2026-11-26 15:00-16:00 after it started.
 */
#[CoversClass(OutOfSyncController::class)]
#[CoversClass(MeetingConversionController::class)]
#[UsesClass(CoreTimeEntryUpdater::class)]
#[UsesClass(CoreTimeEntryCreator::class)]
#[UsesClass(MeetingConversionRequest::class)]
#[UsesClass(TimeEntryController::class)]
#[UsesClass(TimeEntryStoreRequest::class)]
#[UsesClass(TimeEntryUpdateRequest::class)]
#[UsesClass(CheckOrganizationBlocked::class)]
#[UsesClass(ApiException::class)]
#[UsesClass(OutlookMeetingController::class)]
#[UsesClass(OutlookMeetingResource::class)]
#[UsesClass(MeetingRangeRequest::class)]
#[UsesClass(OutOfSyncFlags::class)]
#[UsesClass(OutOfSyncScope::class)]
#[UsesClass(SeriesAssignmentResolver::class)]
#[UsesClass(MeetingSignalInput::class)]
#[UsesClass(MeetingSignals::class)]
#[UsesClass(OutlookMeetingLink::class)]
#[UsesClass(OutlookMeeting::class)]
#[UsesClass(OutlookSyncWindow::class)]
#[UsesClass(MicrosoftAccount::class)]
#[UsesClass(GraphAccessGuard::class)]
#[UsesClass(EnsureMicrosoftIsEnabled::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
class OutlookMovedMeetingTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

    private const string NOW = '2026-11-24 10:00:00';

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
        return sprintf('00000000-0000-4000-8000-%012d', 800 + $index);
    }

    private function publicProject(Organization $organization): Project
    {
        return Project::factory()->forOrganization($organization)->isPublic()->create();
    }

    /**
     * The cached meeting, already at its new Outlook slot (Thursday 15:00-16:00 by default).
     *
     * @param  array<string, mixed>  $overrides
     */
    private function meeting(User $user, string $graphId, array $overrides = []): OutlookMeeting
    {
        return OutlookMeeting::query()->create(array_merge([
            'user_id' => $user->getKey(),
            'graph_id' => $graphId,
            'event_type' => 'singleInstance',
            'subject' => 'Subject '.$graphId,
            'starts_at' => '2026-11-26 15:00:00',
            'ends_at' => '2026-11-26 16:00:00',
            'organizer_name' => 'Org Name',
            'is_organizer' => false,
            'is_online_meeting' => true,
            'web_link' => 'https://outlook.office.com/owa/?itemid='.$graphId,
            'last_seen_at' => '2026-11-24 09:00:00',
        ], $overrides));
    }

    /**
     * The entry logged on the meeting's old slot (Monday 10:00-11:00 by default) and its released link.
     *
     * @param  array<string, mixed>  $entry  overrides of the entry attributes
     * @param  array<string, mixed>  $link  overrides of the link columns
     */
    private function releasedEntry(Member $member, string $graphId, array $entry = [], array $link = []): TimeEntry
    {
        $timeEntry = TimeEntry::factory()->forMember($member)->create(array_merge([
            'start' => '2026-11-23 10:00:00',
            'end' => '2026-11-23 11:00:00',
            'description' => 'Logged '.$graphId,
        ], $entry));
        OutlookMeetingLink::query()->create(array_merge([
            'user_id' => $member->user_id,
            'graph_id' => $graphId,
            'time_entry_id' => $timeEntry->getKey(),
            'meeting_starts_at' => '2026-11-23 10:00:00',
            'meeting_ends_at' => '2026-11-23 11:00:00',
            'released_at' => '2026-11-24 09:00:00',
        ], $link));

        return $timeEntry;
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function convert(Organization $organization, OutlookMeeting $meeting, Project $project, array $body = []): TestResponse
    {
        return $this->postJson(route('microsoft.meetings.convert', ['organization' => $organization->getKey()], false), array_merge([
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ], $body));
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function moveEntry(Organization $organization, string $meetingId, array $body = []): TestResponse
    {
        return $this->postJson(route('microsoft.meetings.move-entry', [
            'organization' => $organization->getKey(),
            'meeting' => $meetingId,
        ], false), $body);
    }

    private function read(): TestResponse
    {
        return $this->getJson(route('microsoft.meetings.index', ['start' => '2026-11-23T00:00:00Z', 'end' => '2026-11-30T00:00:00Z'], false));
    }

    /**
     * Billing double for the whole web stack: the Inertia middleware reads every value on each request.
     */
    private function billing(bool $blocked): void
    {
        $this->mock(BillingContract::class, function (MockInterface $mock) use ($blocked): void {
            $mock->shouldReceive('hasSubscription')->andReturn(! $blocked);
            $mock->shouldReceive('hasTrial')->andReturn(false);
            $mock->shouldReceive('getTrialUntil')->andReturn(null);
            $mock->shouldReceive('getGoalLimit')->andReturn(null);
            $mock->shouldReceive('isBlocked')->andReturn($blocked);
            $mock->shouldReceive('canUseBillableRates')->andReturn(true);
        });
    }

    /**
     * The entry's times and the links of the occurrence, for "nothing changed" checks.
     *
     * @return array<string, mixed>
     */
    private function state(TimeEntry $entry, string $graphId): array
    {
        $fresh = TimeEntry::query()->find($entry->getKey());

        return [
            'entry' => $fresh === null ? null : [
                $fresh->start->utc()->format(self::FORMAT),
                $fresh->end?->utc()->format(self::FORMAT),
                $fresh->user_id,
                $fresh->description,
            ],
            'links' => OutlookMeetingLink::query()
                ->where('graph_id', '=', $graphId)
                ->orderBy('id')
                ->get()
                ->map(fn (OutlookMeetingLink $link): array => [
                    $link->id,
                    $link->time_entry_id,
                    $link->meeting_starts_at?->format(self::FORMAT),
                    $link->released_at?->format(self::FORMAT),
                    $link->last_checked_at?->format(self::FORMAT),
                ])
                ->all(),
            'entries' => TimeEntry::query()->count(),
        ];
    }

    public function test_create_on_a_released_meeting_makes_a_second_entry(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $first = $this->releasedEntry($data->member, 'moved');
        $releasedLink = OutlookMeetingLink::query()->sole();
        $meeting = $this->meeting($data->user, 'moved');

        // Act
        $created = $this->convert($data->organization, $meeting, $project);
        $again = $this->convert($data->organization, $meeting, $project);

        // Assert: a second entry at the new slot with a second, active link; the first one is untouched
        $created->assertOk();
        $created->assertJsonPath('results.0.status', 'created');
        $secondId = $created->json('results.0.time_entry_id');
        $this->assertIsString($secondId);
        $this->assertNotSame($first->getKey(), $secondId);
        $second = TimeEntry::query()->findOrFail($secondId);
        $this->assertSame('2026-11-26 15:00:00', $second->start->utc()->format(self::FORMAT));
        $this->assertSame('2026-11-26 16:00:00', $second->end?->utc()->format(self::FORMAT));
        $firstFresh = TimeEntry::query()->findOrFail($first->getKey());
        $this->assertSame('2026-11-23 10:00:00', $firstFresh->start->utc()->format(self::FORMAT));
        $this->assertSame('Logged moved', $firstFresh->description);
        $links = OutlookMeetingLink::query()->where('graph_id', '=', 'moved')->get();
        $this->assertCount(2, $links);
        $active = $links->firstWhere('time_entry_id', $secondId);
        $this->assertInstanceOf(OutlookMeetingLink::class, $active);
        $this->assertNull($active->released_at);
        $this->assertSame('2026-11-26 15:00:00', $active->meeting_starts_at?->format(self::FORMAT));
        $released = OutlookMeetingLink::query()->findOrFail($releasedLink->getKey());
        $this->assertSame('2026-11-24 09:00:00', $released->released_at?->format(self::FORMAT));
        $this->assertSame($first->getKey(), $released->time_entry_id);
        // Converting the active occurrence again still yields one entry (Phase 4 D-06)
        $again->assertOk();
        $again->assertJsonPath('results.0.status', 'existing');
        $again->assertJsonPath('results.0.time_entry_id', $secondId);
        $this->assertSame(2, TimeEntry::query()->count());
        $this->assertSame(2, OutlookMeetingLink::query()->count());
    }

    public function test_move_entry_moves_the_logged_entry_to_the_new_slot(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $entry = $this->releasedEntry($data->member, 'moved', ['project_id' => $project->getKey()]);
        $meeting = $this->meeting($data->user, 'moved');
        // The read offers it at the new slot, with the entry logged on the old one
        $this->assertSame([$meeting->id], $this->read()->json('data.*.id'));
        $this->assertSame($entry->getKey(), $this->read()->json('data.0.moved_from.time_entry_id'));

        // Act
        $response = $this->moveEntry($data->organization, $meeting->id);

        // Assert: the same entry, now at the new slot, with its link active again on the new reference
        $response->assertOk();
        $response->assertExactJson([
            'meeting_id' => $meeting->id,
            'status' => 'moved',
            'time_entry_id' => $entry->getKey(),
        ]);
        $fresh = TimeEntry::query()->findOrFail($entry->getKey());
        $this->assertSame('2026-11-26 15:00:00', $fresh->start->utc()->format(self::FORMAT));
        $this->assertSame('2026-11-26 16:00:00', $fresh->end?->utc()->format(self::FORMAT));
        $this->assertSame('Logged moved', $fresh->description);
        $this->assertSame($project->getKey(), $fresh->project_id);
        $this->assertSame(1, TimeEntry::query()->count());
        $link = OutlookMeetingLink::query()->sole();
        $this->assertSame($entry->getKey(), $link->time_entry_id);
        $this->assertNull($link->released_at);
        $this->assertNull($link->detached_at);
        $this->assertSame('2026-11-26 15:00:00', $link->meeting_starts_at?->format(self::FORMAT));
        $this->assertSame('2026-11-26 16:00:00', $link->meeting_ends_at?->format(self::FORMAT));
        $this->assertNull($link->flag_reason);
        $this->assertNull($link->outlook_starts_at);
        $this->assertSame(self::NOW, $link->last_checked_at?->format(self::FORMAT));
        // The active link hides the meeting again, and the entry keeps its Outlook icon
        $read = $this->read();
        $read->assertOk();
        $this->assertSame([], $read->json('data'));
        $this->assertSame([$entry->getKey()], $read->json('linked_time_entry_ids'));
    }

    public function test_move_entry_after_a_second_entry_answers_existing(): void
    {
        // Arrange: the moved meeting was already logged again at its new slot
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $first = $this->releasedEntry($data->member, 'twice');
        $meeting = $this->meeting($data->user, 'twice');
        $secondId = $this->convert($data->organization, $meeting, $project)->json('results.0.time_entry_id');
        $this->assertIsString($secondId);
        $before = $this->state($first, 'twice');

        // Act
        $response = $this->moveEntry($data->organization, $meeting->id);

        // Assert: the active link's entry, nothing changes
        $response->assertOk();
        $response->assertExactJson([
            'meeting_id' => $meeting->id,
            'status' => 'existing',
            'time_entry_id' => $secondId,
        ]);
        $this->assertSame($before, $this->state($first, 'twice'));
    }

    public function test_move_entry_takes_the_latest_released_link(): void
    {
        // Arrange: the occurrence was moved twice after it started, each time logged and released
        $data = $this->employee();
        $older = $this->releasedEntry($data->member, 'twice-moved', [], ['released_at' => '2026-11-23 12:00:00']);
        // A second entry was created on the first new slot, and released when Outlook moved it again
        $latest = $this->releasedEntry($data->member, 'twice-moved', [
            'start' => '2026-11-24 08:00:00',
            'end' => '2026-11-24 09:00:00',
        ], [
            'meeting_starts_at' => '2026-11-24 08:00:00',
            'meeting_ends_at' => '2026-11-24 09:00:00',
            'released_at' => '2026-11-24 09:30:00',
        ]);
        $meeting = $this->meeting($data->user, 'twice-moved');

        // Act
        $response = $this->moveEntry($data->organization, $meeting->id);

        // Assert
        $response->assertOk();
        $response->assertJsonPath('time_entry_id', $latest->getKey());
        $this->assertSame('2026-11-26 15:00:00', TimeEntry::query()->findOrFail($latest->getKey())->start->utc()->format(self::FORMAT));
        $this->assertSame('2026-11-23 10:00:00', TimeEntry::query()->findOrFail($older->getKey())->start->utc()->format(self::FORMAT));
        $olderLink = OutlookMeetingLink::query()->where('time_entry_id', '=', $older->getKey())->sole();
        $this->assertNotNull($olderLink->released_at);
    }

    public function test_move_entry_access(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $other = $this->employee($this->objectId(1));
        $this->releasedEntry($other->member, 'foreign');
        $foreignMeeting = $this->meeting($other->user, 'foreign');
        $data = $this->employee($this->objectId(2));
        // Gone at its new slot
        $this->releasedEntry($data->member, 'gone');
        $gone = $this->meeting($data->user, 'gone', ['gone_at' => '2026-11-24 09:45:00']);
        // Never logged
        $unlogged = $this->meeting($data->user, 'unlogged');
        // Logged, released, then the entry was deleted (the link went with it)
        $deleted = $this->releasedEntry($data->member, 'deleted');
        $deletedMeeting = $this->meeting($data->user, 'deleted');
        TimeEntry::query()->whereKey($deleted->getKey())->delete();
        // Logged, released, then the entry was reassigned to the owner
        $reassigned = $this->releasedEntry($data->member, 'reassigned');
        $reassignedMeeting = $this->meeting($data->user, 'reassigned');
        TimeEntry::query()->whereKey($reassigned->getKey())->update([
            'user_id' => $data->owner->getKey(),
            'member_id' => $data->ownerMember->getKey(),
        ]);
        // Logged in another organization the user also belongs to
        $secondOrganization = Organization::factory()->create();
        $secondMember = Member::factory()->forUser($data->user)->forOrganization($secondOrganization)->role(Role::Employee)->create();
        $elsewhere = $this->releasedEntry($secondMember, 'elsewhere');
        $elsewhereMeeting = $this->meeting($data->user, 'elsewhere');
        // Logged as a running timer (no end): nothing to move
        $running = $this->releasedEntry($data->member, 'running', ['end' => null]);
        $runningMeeting = $this->meeting($data->user, 'running');
        $before = [
            $this->state($reassigned, 'reassigned'),
            $this->state($elsewhere, 'elsewhere'),
            $this->state($running, 'running'),
        ];

        // Act
        $responses = [
            'foreign' => $this->moveEntry($data->organization, $foreignMeeting->id),
            'unknown' => $this->moveEntry($data->organization, Str::uuid()->toString()),
            'gone' => $this->moveEntry($data->organization, $gone->id),
            'unlogged' => $this->moveEntry($data->organization, $unlogged->id),
            'deleted' => $this->moveEntry($data->organization, $deletedMeeting->id),
            'reassigned' => $this->moveEntry($data->organization, $reassignedMeeting->id),
            'elsewhere' => $this->moveEntry($data->organization, $elsewhereMeeting->id),
            'running' => $this->moveEntry($data->organization, $runningMeeting->id),
        ];

        // Assert: the same plain 404 for each, and nothing changed
        foreach ($responses as $name => $response) {
            $this->assertSame(404, $response->status(), $name);
        }
        $this->assertSame($before, [
            $this->state($reassigned, 'reassigned'),
            $this->state($elsewhere, 'elsewhere'),
            $this->state($running, 'running'),
        ]);
        $this->assertSame(0, OutlookMeetingLink::query()->whereNull('released_at')->count());
    }

    public function test_move_entry_is_404_while_impersonating_or_disconnected(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $impersonated = $this->employee($this->objectId(1));
        $impersonatedEntry = $this->releasedEntry($impersonated->member, 'impersonated');
        $impersonatedMeeting = $this->meeting($impersonated->user, 'impersonated');
        $disconnected = $this->employee($this->objectId(2));
        $disconnectedEntry = $this->releasedEntry($disconnected->member, 'disconnected');
        $disconnectedMeeting = $this->meeting($disconnected->user, 'disconnected');
        $account = MicrosoftAccount::query()->where('user_id', '=', $disconnected->user->getKey())->firstOrFail();
        $account->access_token = null;
        $account->refresh_token = null;
        $account->disconnected_at = Carbon::now();
        $account->save();
        $before = [$this->state($impersonatedEntry, 'impersonated'), $this->state($disconnectedEntry, 'disconnected')];

        // Act
        $this->actingAs($impersonated->user);
        session()->put(ImpersonateManager::SESSION_KEY, 1);
        $whileImpersonating = $this->moveEntry($impersonated->organization, $impersonatedMeeting->id);
        session()->forget(ImpersonateManager::SESSION_KEY);
        $this->actingAs($disconnected->user);
        $whileDisconnected = $this->moveEntry($disconnected->organization, $disconnectedMeeting->id);

        // Assert (D-14, D-19)
        $whileImpersonating->assertNotFound();
        $whileDisconnected->assertNotFound();
        $this->assertSame($before, [$this->state($impersonatedEntry, 'impersonated'), $this->state($disconnectedEntry, 'disconnected')]);
    }

    public function test_move_entry_outside_the_organization_is_forbidden(): void
    {
        // Arrange: an organization the user is not a member of
        $data = $this->employee();
        $entry = $this->releasedEntry($data->member, 'outsider');
        $meeting = $this->meeting($data->user, 'outsider');
        $foreignOrganization = Organization::factory()->create();
        $before = $this->state($entry, 'outsider');

        // Act
        $response = $this->moveEntry($foreignOrganization, $meeting->id);

        // Assert
        $response->assertForbidden();
        $this->assertSame($before, $this->state($entry, 'outsider'));
    }

    public function test_move_entry_in_a_blocked_organization_is_refused(): void
    {
        // Arrange
        $data = $this->employee();
        $entry = $this->releasedEntry($data->member, 'blocked');
        $meeting = $this->meeting($data->user, 'blocked');
        $this->billing(blocked: true);
        $before = $this->state($entry, 'blocked');

        // Act
        $response = $this->moveEntry($data->organization, $meeting->id);

        // Assert: the core middleware's own answer
        $response->assertStatus(400);
        $response->assertJsonPath('key', 'organization_has_no_subscription_but_multiple_members');
        $this->assertSame($before, $this->state($entry, 'blocked'));
    }

    public function test_move_entry_refused_by_core_changes_nothing(): void
    {
        // Arrange: overlaps are forbidden and another entry covers 15:30-16:30 on Thursday
        $data = $this->employee();
        $entry = $this->releasedEntry($data->member, 'overlap');
        $meeting = $this->meeting($data->user, 'overlap');
        TimeEntry::factory()->forMember($data->member)->create([
            'start' => '2026-11-26 15:30:00',
            'end' => '2026-11-26 16:30:00',
            'description' => '',
        ]);
        $data->organization->prevent_overlapping_time_entries = true;
        $data->organization->save();
        $before = $this->state($entry, 'overlap');

        // Act
        $response = $this->moveEntry($data->organization, $meeting->id);

        // Assert: core's answer, the link stays released and the entry where it was
        $response->assertStatus(400);
        $response->assertJsonPath('key', 'overlapping_time_entry');
        $this->assertSame($before, $this->state($entry, 'overlap'));
    }

    public function test_move_entry_ignores_any_body(): void
    {
        // Arrange
        $data = $this->employee();
        $entry = $this->releasedEntry($data->member, 'body');
        $other = $this->releasedEntry($data->member, 'other-body', ['start' => '2026-11-23 12:00:00', 'end' => '2026-11-23 13:00:00']);
        $meeting = $this->meeting($data->user, 'body');

        // Act: a body naming another slot and another entry
        $response = $this->moveEntry($data->organization, $meeting->id, [
            'start' => '2026-11-27T08:00:00Z',
            'end' => '2026-11-27T09:00:00Z',
            'time_entry_id' => $other->getKey(),
            'user_id' => $data->owner->getKey(),
        ]);

        // Assert: the meeting's slot, the occurrence's own entry
        $response->assertOk();
        $response->assertJsonPath('time_entry_id', $entry->getKey());
        $fresh = TimeEntry::query()->findOrFail($entry->getKey());
        $this->assertSame('2026-11-26 15:00:00', $fresh->start->utc()->format(self::FORMAT));
        $this->assertSame($data->user->getKey(), $fresh->user_id);
        $this->assertSame('2026-11-23 12:00:00', TimeEntry::query()->findOrFail($other->getKey())->start->utc()->format(self::FORMAT));
    }

    public function test_unique_violation_never_answers_500(): void
    {
        // Arrange: core moves the entry, then a concurrent conversion wins the active link (simulated)
        $data = $this->employee();
        $entry = $this->releasedEntry($data->member, 'race');
        $meeting = $this->meeting($data->user, 'race');
        $before = $this->state($entry, 'race');
        $this->app->instance(CoreTimeEntryUpdater::class, new class extends CoreTimeEntryUpdater
        {
            public function updateTimes(User $actor, TimeEntry $entry, string $start, string $end): TimeEntry
            {
                parent::updateTimes($actor, $entry, $start, $end);

                throw new UniqueConstraintViolationException(
                    'pgsql',
                    'update "outlook_meeting_links" set "released_at" = ?',
                    [],
                    new PDOException('duplicate key value violates unique constraint'),
                );
            }
        });

        // Act
        $response = $this->moveEntry($data->organization, $meeting->id);

        // Assert: no winner's entry of the user is left, so a 409; this call's changes rolled back
        $response->assertStatus(409);
        $this->assertSame($before, $this->state($entry, 'race'));
    }

    public function test_route_is_a_web_session_route_outside_api(): void
    {
        // Arrange
        $route = Route::getRoutes()->getByName('microsoft.meetings.move-entry');

        // Assert
        $this->assertNotNull($route);
        $this->assertSame('m365/organizations/{organization}/meetings/{meeting}/move-entry', $route->uri());
        $this->assertSame(['POST'], $route->methods());
        $this->assertSame(['organization', 'meeting'], $route->parameterNames());
        $middleware = $route->gatherMiddleware();
        foreach (['web', 'auth:web', 'auth.session', 'verified', 'check-organization-blocked'] as $expected) {
            $this->assertContains($expected, $middleware, $expected);
        }
        $throttles = array_filter(
            $middleware,
            fn (mixed $name): bool => is_string($name) && str_starts_with($name, 'throttle:') && str_contains($name, 'm365-move'),
        );
        $this->assertCount(1, $throttles);
        foreach (['organization', 'meeting'] as $parameter) {
            $this->assertArrayHasKey($parameter, $route->wheres);
            $this->assertStringContainsString('{12}', (string) $route->wheres[$parameter]);
        }
    }
}
