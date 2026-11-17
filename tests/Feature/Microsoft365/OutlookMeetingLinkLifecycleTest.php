<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Http\Controllers\Api\V1\MemberController;
use App\Http\Controllers\Api\V1\TimeEntryController;
use App\Microsoft365\Graph\GraphAccessGuard;
use App\Microsoft365\Graph\GraphCalendarClient;
use App\Microsoft365\Graph\MicrosoftTokenService;
use App\Microsoft365\Graph\OutlookMeetingEligibility;
use App\Microsoft365\Graph\OutlookMeetingSyncService;
use App\Microsoft365\Graph\SyncOutcome;
use App\Microsoft365\Graph\SyncStatus;
use App\Microsoft365\Http\Controllers\MeetingConversionController;
use App\Microsoft365\Http\Controllers\MicrosoftAccountController;
use App\Microsoft365\Http\Controllers\MicrosoftAuthController;
use App\Microsoft365\Http\Controllers\OutlookMeetingController;
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
use App\Microsoft365\TimeEntries\CoreTimeEntryCreator;
use App\Models\Member;
use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use App\Service\DeletionService;
use App\Service\MemberService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use Laravel\Passport\Passport;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use STS\FilamentImpersonate\ImpersonateManager;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

/**
 * The life of a meeting-to-entry link (Phase 4 ASGN-05, D-04, D-05, D-15): deleting the entry by any
 * core path brings the meeting back, editing it keeps the meeting converted, re-syncs and a disconnect
 * never re-offer it, and the meetings read names the user's entries that came from meetings.
 * Deletes and edits run through the real core API routes; no fork code deletes anything here.
 */
#[CoversClass(OutlookMeetingController::class)]
#[CoversClass(MeetingConversionController::class)]
#[UsesClass(MeetingConversionRequest::class)]
#[UsesClass(CoreTimeEntryCreator::class)]
#[UsesClass(OutlookMeetingLink::class)]
#[UsesClass(OutlookMeeting::class)]
#[UsesClass(OutlookSyncWindow::class)]
#[UsesClass(MicrosoftAccount::class)]
#[UsesClass(GraphAccessGuard::class)]
#[UsesClass(GraphCalendarClient::class)]
#[UsesClass(MicrosoftTokenService::class)]
#[UsesClass(OutlookMeetingEligibility::class)]
#[UsesClass(OutlookMeetingSyncService::class)]
#[UsesClass(SyncOutcome::class)]
#[UsesClass(SyncStatus::class)]
#[UsesClass(MicrosoftAccountController::class)]
#[UsesClass(MicrosoftAuthController::class)]
#[UsesClass(EnsureMicrosoftIsEnabled::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
#[UsesClass(MeetingRangeRequest::class)]
#[UsesClass(OutlookMeetingResource::class)]
#[UsesClass(TimeEntryController::class)]
#[UsesClass(MemberController::class)]
#[UsesClass(MemberService::class)]
#[UsesClass(DeletionService::class)]
class OutlookMeetingLinkLifecycleTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

    private const string WEEK_START = '2026-10-19T00:00:00Z';

    private const string WEEK_END = '2026-10-26T00:00:00Z';

    private const string NEXT_WEEK_END = '2026-11-02T00:00:00Z';

    /**
     * An employee of a fresh organization, signed in on the web guard with a connected account.
     *
     * @return object{user: User, organization: Organization, member: Member, owner: User, ownerMember: Member}
     */
    private function employee(): object
    {
        $this->configureMicrosoft365();
        $data = $this->createUserWithRole(Role::Employee);
        $data->user->save();
        $this->connectedAccount($data->user);
        $this->actingAs($data->user);

        return $data;
    }

    private function publicProject(Organization $organization): Project
    {
        return Project::factory()->forOrganization($organization)->isPublic()->create();
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

    private function convertResponse(Organization $organization, string $meetingId, Project $project): TestResponse
    {
        return $this->postJson(route('microsoft.meetings.convert', ['organization' => $organization->getKey()], false), [
            'meeting_ids' => [$meetingId],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);
    }

    /**
     * Converts one meeting and returns the id of the created entry.
     */
    private function convert(Organization $organization, string $meetingId, Project $project): string
    {
        $response = $this->convertResponse($organization, $meetingId, $project);
        $response->assertOk();
        $response->assertJsonPath('results.0.status', 'created');
        $entryId = $response->json('results.0.time_entry_id');
        $this->assertIsString($entryId);

        return $entryId;
    }

    private function listMeetings(string $start = self::WEEK_START, string $end = self::WEEK_END): TestResponse
    {
        return $this->getJson(route('microsoft.meetings.index', ['start' => $start, 'end' => $end], false));
    }

    private function listFixtureWindow(): TestResponse
    {
        return $this->getJson(route('microsoft.meetings.index', $this->fixtureWindow(), false));
    }

    private function postSync(): TestResponse
    {
        return $this->postJson(route('microsoft.meetings.sync', [], false), $this->fixtureWindow());
    }

    /**
     * Graph answers round A as many times as asked, in one Http::fake.
     */
    private function fakeRoundA(int $times): void
    {
        Config::set('microsoft365.graph.max_pages', 30);
        $sequence = Http::sequence();
        for ($i = 0; $i < $times; $i++) {
            foreach ($this->graphPages('A') as $page) {
                $sequence->push($page);
            }
        }
        Http::fake(['https://graph.microsoft.com/v1.0/me/calendarView*' => $sequence]);
    }

    /**
     * Back on the session (web) guard after a core API call made with Passport.
     */
    private function backOnTheWeb(User $user): void
    {
        $this->actingAs($user, 'web');
    }

    /**
     * @return array<string, mixed>
     */
    private function linkRow(OutlookMeetingLink $link): array
    {
        return OutlookMeetingLink::query()->findOrFail($link->getKey())->getAttributes();
    }

    public function test_deleting_the_entry_resurfaces_the_meeting(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $meeting = $this->meeting($data->user, 'single-delete');
        $entryId = $this->convert($data->organization, $meeting->id, $project);
        $this->assertSame([], $this->listMeetings()->json('data.*.id'));

        // Act: core's own delete endpoint
        Passport::actingAs($data->user);
        $delete = $this->deleteJson(route('api.v1.time-entries.destroy', [$data->organization->getKey(), $entryId]));
        $this->backOnTheWeb($data->user);
        $read = $this->listMeetings();
        $again = $this->convertResponse($data->organization, $meeting->id, $project);

        // Assert
        $delete->assertNoContent();
        $this->assertNull(TimeEntry::query()->find($entryId));
        $read->assertOk();
        $this->assertSame([$meeting->id], $read->json('data.*.id'));
        $this->assertSame([], $read->json('linked_time_entry_ids'));
        $again->assertOk();
        $again->assertJsonPath('results.0.status', 'created');
        $this->assertNotSame($entryId, $again->json('results.0.time_entry_id'));
        $this->assertSame($again->json('results.0.time_entry_id'), OutlookMeetingLink::query()->sole()->time_entry_id);
    }

    public function test_bulk_delete_resurfaces_the_meeting(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $meeting = $this->meeting($data->user, 'bulk-delete');
        $entryId = $this->convert($data->organization, $meeting->id, $project);

        // Act: core's bulk delete endpoint
        Passport::actingAs($data->user);
        $delete = $this->deleteJson(route('api.v1.time-entries.destroy-multiple', [$data->organization->getKey()]), [
            'ids' => [$entryId],
        ]);
        $this->backOnTheWeb($data->user);
        $read = $this->listMeetings();

        // Assert
        $delete->assertOk();
        $this->assertSame([$entryId], $delete->json('success'));
        $this->assertSame(0, OutlookMeetingLink::query()->count());
        $read->assertOk();
        $this->assertSame([$meeting->id], $read->json('data.*.id'));
    }

    public function test_member_removal_and_organization_deletion_remove_links(): void
    {
        // Arrange: the employee's converted entry, and the owner's converted entry in the same organization
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $employeeMeeting = $this->meeting($data->user, 'member-removal');
        $employeeEntryId = $this->convert($data->organization, $employeeMeeting->id, $project);
        $this->connectedAccount($data->owner, objectId: '00000000-0000-4000-8000-0000000003a1');
        $this->actingAs($data->owner, 'web');
        $ownerMeeting = $this->meeting($data->owner, 'organization-deletion');
        $ownerEntryId = $this->convert($data->organization, $ownerMeeting->id, $project);
        $this->assertSame(2, OutlookMeetingLink::query()->count());

        // Act 1: the owner removes the employee together with their time entries (core endpoint)
        Passport::actingAs($data->owner);
        $removal = $this->deleteJson(route('api.v1.members.destroy', [
            'organization' => $data->organization->getKey(),
            'member' => $data->member->getKey(),
            'delete_related' => 'true',
        ]));

        // Assert 1
        $removal->assertNoContent();
        $this->assertNull(TimeEntry::query()->find($employeeEntryId));
        $this->assertSame(0, OutlookMeetingLink::query()->where('time_entry_id', '=', $employeeEntryId)->count());
        $this->assertSame(1, OutlookMeetingLink::query()->where('time_entry_id', '=', $ownerEntryId)->count());

        // Act 2: the whole organization is deleted (core service)
        app(DeletionService::class)->deleteOrganization($data->organization);

        // Assert 2
        $this->assertNull(TimeEntry::query()->find($ownerEntryId));
        $this->assertSame(0, OutlookMeetingLink::query()->count());
    }

    public function test_editing_the_entry_keeps_the_meeting_hidden(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $otherProject = $this->publicProject($data->organization);
        $meeting = $this->meeting($data->user, 'edited');
        $entryId = $this->convert($data->organization, $meeting->id, $project);
        $link = OutlookMeetingLink::query()->sole();
        $before = $this->linkRow($link);

        // Act: new times, project and description through core's update endpoint (D-05)
        Passport::actingAs($data->user);
        $update = $this->putJson(route('api.v1.time-entries.update', [$data->organization->getKey(), $entryId]), [
            'start' => '2026-10-21T13:00:00Z',
            'end' => '2026-10-21T13:45:00Z',
            'project_id' => $otherProject->getKey(),
            'description' => 'Edited by hand',
        ]);
        $this->backOnTheWeb($data->user);
        $read = $this->listMeetings();

        // Assert
        $update->assertOk();
        $entry = TimeEntry::query()->findOrFail($entryId);
        $this->assertSame($otherProject->getKey(), $entry->project_id);
        $this->assertSame('Edited by hand', $entry->description);
        $this->assertSame('2026-10-21 13:00:00', $entry->start->utc()->format('Y-m-d H:i:s'));
        $read->assertOk();
        $this->assertSame([], $read->json('data.*.id'));
        $this->assertSame([$entryId], $read->json('linked_time_entry_ids'));
        $this->assertSame($before, $this->linkRow($link));
    }

    public function test_reassigned_entry_resurfaces(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $meeting = $this->meeting($data->user, 'reassigned');
        $entryId = $this->convert($data->organization, $meeting->id, $project);

        // Act: core moves the employee's entries to the owner (merge/placeholder flows)
        app(MemberService::class)->assignOrganizationEntitiesToDifferentMember($data->organization, $data->member, $data->ownerMember);
        $read = $this->listMeetings();

        // Assert: the entry is no longer the user's, so neither the meeting nor the icon are hidden/shown
        $this->assertSame($data->owner->getKey(), TimeEntry::query()->findOrFail($entryId)->user_id);
        $read->assertOk();
        $this->assertSame([$meeting->id], $read->json('data.*.id'));
        $this->assertSame([], $read->json('linked_time_entry_ids'));
    }

    public function test_link_survives_a_resync(): void
    {
        // Arrange: round A synced, one of its meetings converted
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $this->fakeRoundA(2);
        $this->postSync()->assertOk()->assertJsonPath('status', 'ok');
        $firstRead = $this->listFixtureWindow();
        $meetingId = $firstRead->json('data.0.id');
        $this->assertIsString($meetingId);
        $graphId = OutlookMeeting::query()->findOrFail($meetingId)->graph_id;
        $entryId = $this->convert($data->organization, $meetingId, $project);
        $link = OutlookMeetingLink::query()->sole();
        $before = $this->linkRow($link);

        // Act: the same window synced again once the reuse window is over
        $this->travel(61)->seconds();
        $sync = $this->postSync();
        $read = $this->listFixtureWindow();

        // Assert: same row, still hidden, link untouched
        $sync->assertOk()->assertJsonPath('status', 'ok');
        $read->assertOk();
        $this->assertNotContains($meetingId, $read->json('data.*.id'));
        $this->assertCount(count($firstRead->json('data')) - 1, $read->json('data'));
        $this->assertSame($meetingId, OutlookMeeting::query()->where('user_id', '=', $data->user->getKey())->where('graph_id', '=', $graphId)->sole()->id);
        $this->assertSame($before, $this->linkRow($link));
        $this->assertSame($entryId, $link->time_entry_id);
    }

    public function test_link_survives_disconnect_and_reconnect(): void
    {
        // Arrange: round A synced, one of its meetings converted
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $this->fakeRoundA(2);
        $this->postSync()->assertOk()->assertJsonPath('status', 'ok');
        $firstRead = $this->listFixtureWindow();
        $meetingId = $firstRead->json('data.0.id');
        $this->assertIsString($meetingId);
        $graphId = OutlookMeeting::query()->findOrFail($meetingId)->graph_id;
        $entryId = $this->convert($data->organization, $meetingId, $project);

        // Act: Disconnect Microsoft (purges the cached meetings), reconnect and sync round A again
        $this->delete(route('microsoft.account.destroy', [], false))->assertRedirect(route('profile.show', [], false));
        $meetingsAfterDisconnect = OutlookMeeting::query()->where('user_id', '=', $data->user->getKey())->count();
        $linksAfterDisconnect = OutlookMeetingLink::query()->count();
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->get(route('microsoft.redirect', ['intent' => 'connect'], false))->assertRedirect();
        $this->get(route('microsoft.callback', ['code' => 'fake-code', 'state' => 'fake-state'], false))->assertRedirect();
        $this->travel(61)->seconds();
        $sync = $this->postSync();
        $read = $this->listFixtureWindow();

        // Assert: the re-created row of the same occurrence stays hidden (D-15)
        $this->assertSame(0, $meetingsAfterDisconnect);
        $this->assertSame(1, $linksAfterDisconnect);
        $sync->assertOk()->assertJsonPath('status', 'ok');
        $recreated = OutlookMeeting::query()->where('user_id', '=', $data->user->getKey())->where('graph_id', '=', $graphId)->sole();
        $this->assertNotSame($meetingId, $recreated->id);
        $read->assertOk();
        $this->assertNotContains($recreated->id, $read->json('data.*.id'));
        $this->assertCount(count($firstRead->json('data')) - 1, $read->json('data'));
        $this->assertContains($entryId, $read->json('linked_time_entry_ids'));
        $this->assertSame($entryId, OutlookMeetingLink::query()->sole()->time_entry_id);
    }

    public function test_linked_ids_cover_entries_overlapping_the_range(): void
    {
        // Arrange: two converted meetings in the week and an unrelated manual entry
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $monday = $this->meeting($data->user, 'monday');
        $wednesday = $this->meeting($data->user, 'wednesday', [
            'starts_at' => '2026-10-21 09:00:00',
            'ends_at' => '2026-10-21 10:00:00',
        ]);
        $stays = $this->convert($data->organization, $monday->id, $project);
        $moves = $this->convert($data->organization, $wednesday->id, $project);
        TimeEntry::factory()->forOrganization($data->organization)->forMember($data->member)->create([
            'start' => Carbon::parse('2026-10-22 09:00:00', 'UTC'),
            'end' => Carbon::parse('2026-10-22 10:00:00', 'UTC'),
        ]);
        $both = $this->listMeetings()->json('linked_time_entry_ids');

        // Act: one entry is dragged to the next week through core's update endpoint
        Passport::actingAs($data->user);
        $this->putJson(route('api.v1.time-entries.update', [$data->organization->getKey(), $moves]), [
            'start' => '2026-10-28T09:00:00Z',
            'end' => '2026-10-28T10:00:00Z',
        ])->assertOk();
        $this->backOnTheWeb($data->user);
        $thisWeek = $this->listMeetings();
        $nextWeek = $this->listMeetings(self::WEEK_END, self::NEXT_WEEK_END);

        // Assert: by the entry's own time, not the meeting's
        $this->assertSame([$stays, $moves], $both);
        $thisWeek->assertOk();
        $this->assertSame([$stays], $thisWeek->json('linked_time_entry_ids'));
        $nextWeek->assertOk();
        $this->assertSame([$moves], $nextWeek->json('linked_time_entry_ids'));
    }

    public function test_linked_ids_are_empty_without_a_usable_link(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $meeting = $this->meeting($data->user, 'usable');
        $entryId = $this->convert($data->organization, $meeting->id, $project);
        $connected = $this->listMeetings();

        // Act 1: an admin impersonates the user
        session()->put(ImpersonateManager::SESSION_KEY, 1);
        $impersonated = $this->listMeetings();
        session()->forget(ImpersonateManager::SESSION_KEY);

        // Act 2: the account is no longer connected
        $account = MicrosoftAccount::query()->where('user_id', '=', $data->user->getKey())->sole();
        $account->access_token = null;
        $account->refresh_token = null;
        $account->access_token_expires_at = null;
        $account->disconnected_at = Carbon::now();
        $account->save();
        $disconnected = $this->listMeetings();

        // Assert
        $connected->assertOk();
        $this->assertSame([$entryId], $connected->json('linked_time_entry_ids'));
        $impersonated->assertOk();
        $this->assertSame([], $impersonated->json('data'));
        $this->assertSame([], $impersonated->json('linked_time_entry_ids'));
        $disconnected->assertOk();
        $this->assertSame([], $disconnected->json('data'));
        $this->assertSame([], $disconnected->json('linked_time_entry_ids'));
    }

    public function test_linked_ids_never_name_other_users_entries(): void
    {
        // Arrange: the owner converts a meeting of their own in the same week
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $own = $this->convert($data->organization, $this->meeting($data->user, 'own')->id, $project);
        $this->connectedAccount($data->owner, objectId: '00000000-0000-4000-8000-0000000003a2');
        $this->actingAs($data->owner, 'web');
        $foreign = $this->convert($data->organization, $this->meeting($data->owner, 'foreign')->id, $project);
        $this->actingAs($data->user, 'web');

        // Act
        $read = $this->listMeetings();

        // Assert
        $read->assertOk();
        $this->assertSame([$own], $read->json('linked_time_entry_ids'));
        $this->assertNotContains($foreign, $read->json('linked_time_entry_ids'));
    }
}
