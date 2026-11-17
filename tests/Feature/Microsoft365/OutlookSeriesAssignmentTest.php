<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Http\Controllers\Api\V1\TimeEntryController;
use App\Http\Requests\V1\TimeEntry\TimeEntryStoreRequest;
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
use App\Microsoft365\Suggestions\Assignment;
use App\Microsoft365\Suggestions\BookableProjects;
use App\Microsoft365\Suggestions\MeetingHints;
use App\Microsoft365\Suggestions\SeriesAssignmentResolver;
use App\Microsoft365\Suggestions\SeriesKey;
use App\Microsoft365\TimeEntries\CoreTimeEntryCreator;
use App\Models\Client;
use App\Models\Member;
use App\Models\Organization;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Models\Tag;
use App\Models\Task;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use Laravel\Passport\Passport;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

/**
 * Series pre-assignment (Phase 5 RULE-01, D-02, D-03, D-05, D-12, D-13, D-17): converting one
 * occurrence of a recurring meeting makes the other occurrences of the series come back from the read
 * carrying that conversion's project, task, tags and billable, derived live from the time entry and
 * filtered through the core booking rules. The read never converts or changes anything.
 */
#[CoversClass(SeriesAssignmentResolver::class)]
#[CoversClass(BookableProjects::class)]
#[UsesClass(Assignment::class)]
#[UsesClass(MeetingHints::class)]
#[UsesClass(SeriesKey::class)]
#[UsesClass(OutlookMeetingController::class)]
#[UsesClass(OutlookMeetingResource::class)]
#[UsesClass(MeetingRangeRequest::class)]
#[UsesClass(MeetingConversionController::class)]
#[UsesClass(MeetingConversionRequest::class)]
#[UsesClass(CoreTimeEntryCreator::class)]
#[UsesClass(OutlookMeetingLink::class)]
#[UsesClass(OutlookMeeting::class)]
#[UsesClass(OutlookSyncWindow::class)]
#[UsesClass(MicrosoftAccount::class)]
#[UsesClass(GraphAccessGuard::class)]
#[UsesClass(EnsureMicrosoftIsEnabled::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
#[UsesClass(TimeEntryController::class)]
#[UsesClass(TimeEntryStoreRequest::class)]
#[UsesClass(GraphCalendarClient::class)]
#[UsesClass(MicrosoftTokenService::class)]
#[UsesClass(OutlookMeetingEligibility::class)]
#[UsesClass(OutlookMeetingSyncService::class)]
#[UsesClass(SyncOutcome::class)]
#[UsesClass(SyncStatus::class)]
#[UsesClass(MicrosoftAccountController::class)]
#[UsesClass(MicrosoftAuthController::class)]
class OutlookSeriesAssignmentTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

    private const string WEEK_START = '2026-10-19T00:00:00Z';

    private const string WEEK_END = '2026-10-26T00:00:00Z';

    private const string SERIES = 'series-1';

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

    private function publicProject(Organization $organization, ?Client $client = null): Project
    {
        return Project::factory()->forOrganization($organization)->forClient($client)->isPublic()->create();
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

    /**
     * An occurrence of a recurring series on the given day, 09:00-10:00 UTC.
     */
    private function occurrence(User $user, string $graphId, string $day, string $series = self::SERIES): OutlookMeeting
    {
        return $this->meeting($user, $graphId, [
            'event_type' => 'occurrence',
            'series_master_id' => $series,
            'original_start' => $day.' 09:00:00',
            'starts_at' => $day.' 09:00:00',
            'ends_at' => $day.' 10:00:00',
        ]);
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function convert(Organization $organization, array $body): TestResponse
    {
        return $this->postJson(route('microsoft.meetings.convert', ['organization' => $organization->getKey()], false), $body);
    }

    /**
     * Converts one meeting to a project (no task, no tags, not billable) and returns the entry id.
     */
    private function convertTo(Organization $organization, OutlookMeeting $meeting, Project $project): string
    {
        $response = $this->convert($organization, [
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);
        $response->assertOk();
        $response->assertJsonPath('results.0.status', 'created');
        $entryId = $response->json('results.0.time_entry_id');
        $this->assertIsString($entryId);

        return $entryId;
    }

    private function read(string $start = self::WEEK_START, string $end = self::WEEK_END): TestResponse
    {
        return $this->getJson(route('microsoft.meetings.index', ['start' => $start, 'end' => $end], false));
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

    /**
     * @return array<string, mixed>|null
     */
    private function assignmentOf(TestResponse $response, OutlookMeeting $meeting): ?array
    {
        $assignment = $this->item($response, $meeting)['assignment'];
        $this->assertTrue($assignment === null || is_array($assignment));

        return $assignment;
    }

    public function test_converting_one_occurrence_pre_assigns_the_others(): void
    {
        // Arrange
        $data = $this->employee();
        $client = Client::factory()->forOrganization($data->organization)->create();
        $project = $this->publicProject($data->organization, $client);
        $task = Task::factory()->forOrganization($data->organization)->forProject($project)->create();
        $tagOne = Tag::factory()->forOrganization($data->organization)->create();
        $tagTwo = Tag::factory()->forOrganization($data->organization)->create();
        $a = $this->occurrence($data->user, 'occ-a', '2026-10-20');
        $b = $this->occurrence($data->user, 'occ-b', '2026-10-22');
        $c = $this->occurrence($data->user, 'occ-c', '2026-10-19');
        $d = $this->meeting($data->user, 'single-d', ['starts_at' => '2026-10-21 11:00:00', 'ends_at' => '2026-10-21 12:00:00']);

        // Act
        $convert = $this->convert($data->organization, [
            'meeting_ids' => [$a->id],
            'project_id' => $project->getKey(),
            'task_id' => $task->getKey(),
            'tags' => [$tagOne->getKey(), $tagTwo->getKey()],
            'billable' => true,
        ]);
        $read = $this->read();

        // Assert
        $convert->assertOk();
        $convert->assertJsonPath('results.0.status', 'created');
        $read->assertOk();
        $ids = $read->json('data.*.id');
        $this->assertNotContains($a->id, $ids);
        $this->assertEqualsCanonicalizing([$b->id, $c->id, $d->id], $ids);
        foreach ([$b, $c] as $occurrence) {
            $assignment = $this->assignmentOf($read, $occurrence);
            $this->assertNotNull($assignment);
            $this->assertSame([
                'project_id' => $project->getKey(),
                'project_name' => $project->name,
                'project_color' => $project->color,
                'client_name' => $client->name,
                'task_id' => $task->getKey(),
                'task_name' => $task->name,
                'billable' => true,
            ], array_diff_key($assignment, ['converted_at' => true, 'tags' => true]));
            $this->assertEqualsCanonicalizing([$tagOne->getKey(), $tagTwo->getKey()], $assignment['tags']);
            $this->assertIsString($assignment['converted_at']);
            $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $assignment['converted_at']);
        }
        $this->assertNull($this->assignmentOf($read, $d));
        foreach ($read->json('data') as $item) {
            $this->assertFalse($item['series_ignored']);
            $this->assertSame([], $item['suggestions']);
        }
    }

    public function test_series_key_is_opaque_and_shared(): void
    {
        // Arrange
        $data = $this->employee();
        $b = $this->occurrence($data->user, 'occ-b', '2026-10-22');
        $c = $this->occurrence($data->user, 'occ-c', '2026-10-19');
        $d = $this->meeting($data->user, 'single-d', ['starts_at' => '2026-10-21 11:00:00', 'ends_at' => '2026-10-21 12:00:00']);

        // Act
        $read = $this->read();

        // Assert
        $read->assertOk();
        $keyB = $this->item($read, $b)['series_key'];
        $keyC = $this->item($read, $c)['series_key'];
        $this->assertIsString($keyB);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{16}$/', $keyB);
        $this->assertSame($keyB, $keyC);
        $this->assertNotSame(self::SERIES, $keyB);
        $this->assertNull($this->item($read, $d)['series_key']);
        $json = (string) $read->getContent();
        $this->assertStringNotContainsString(self::SERIES, $json);
        foreach ([$b, $c, $d] as $meeting) {
            $this->assertStringNotContainsString('"'.$meeting->graph_id.'"', $json);
        }
    }

    public function test_no_meeting_is_converted_by_the_read(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $a = $this->occurrence($data->user, 'occ-a', '2026-10-20');
        $this->occurrence($data->user, 'occ-b', '2026-10-22');
        $this->occurrence($data->user, 'occ-c', '2026-10-19');
        $this->convertTo($data->organization, $a, $project);
        $entriesBefore = TimeEntry::query()->count();
        $linksBefore = OutlookMeetingLink::query()->count();

        // Act
        $read = $this->read();
        $again = $this->read();

        // Assert
        $read->assertOk();
        $again->assertOk();
        $this->assertCount(2, $read->json('data'));
        $this->assertSame($entriesBefore, TimeEntry::query()->count());
        $this->assertSame($linksBefore, OutlookMeetingLink::query()->count());
        $this->assertSame(1, $entriesBefore);
    }

    public function test_latest_conversion_wins(): void
    {
        // Arrange
        $data = $this->employee();
        $first = $this->publicProject($data->organization);
        $second = $this->publicProject($data->organization);
        $a = $this->occurrence($data->user, 'occ-a', '2026-10-20');
        $b = $this->occurrence($data->user, 'occ-b', '2026-10-22');
        $c = $this->occurrence($data->user, 'occ-c', '2026-10-19');
        $entryA = $this->convertTo($data->organization, $a, $first);
        $this->assertSame($first->getKey(), $this->assignmentOf($this->read(), $b)['project_id'] ?? null);

        // Act: a later conversion of an earlier occurrence to another project (D-05)
        $this->travel(5)->seconds();
        $this->convertTo($data->organization, $c, $second);
        $read = $this->read();

        // Assert: the series follows the newest conversion; the first entry is untouched (D-12)
        $read->assertOk();
        $this->assertSame($second->getKey(), $this->assignmentOf($read, $b)['project_id'] ?? null);
        $this->assertSame($second->name, $this->assignmentOf($read, $b)['project_name'] ?? null);
        $this->assertSame($first->getKey(), TimeEntry::query()->findOrFail($entryA)->project_id);
    }

    public function test_editing_the_entry_moves_the_series(): void
    {
        // Arrange
        $data = $this->employee();
        $first = $this->publicProject($data->organization);
        $third = $this->publicProject($data->organization);
        $a = $this->occurrence($data->user, 'occ-a', '2026-10-20');
        $b = $this->occurrence($data->user, 'occ-b', '2026-10-22');
        $entryId = $this->convertTo($data->organization, $a, $first);

        // Act: the user moves the entry to another project through core's update endpoint
        Passport::actingAs($data->user);
        $update = $this->putJson(route('api.v1.time-entries.update', [$data->organization->getKey(), $entryId]), [
            'project_id' => $third->getKey(),
        ]);
        $this->actingAs($data->user, 'web');
        $read = $this->read();

        // Assert
        $update->assertOk();
        $read->assertOk();
        $this->assertSame($third->getKey(), $this->assignmentOf($read, $b)['project_id'] ?? null);
        $this->assertSame($third->name, $this->assignmentOf($read, $b)['project_name'] ?? null);
    }

    public function test_links_in_another_organization_are_ignored(): void
    {
        // Arrange: the user also belongs to a second organization and converted the series there
        $data = $this->employee();
        $otherOrganization = Organization::factory()->create();
        Member::factory()->forUser($data->user)->forOrganization($otherOrganization)->role(Role::Employee)->create();
        $otherProject = $this->publicProject($otherOrganization);
        $a = $this->occurrence($data->user, 'occ-a', '2026-10-20');
        $b = $this->occurrence($data->user, 'occ-b', '2026-10-22');
        $this->convertTo($otherOrganization, $a, $otherProject);

        // Act: current organization is the first one, then the second one
        $inFirst = $this->read();
        $data->user->current_team_id = $otherOrganization->getKey();
        $data->user->save();
        $inSecond = $this->read();

        // Assert
        $inFirst->assertOk();
        $this->assertNull($this->assignmentOf($inFirst, $b));
        $inSecond->assertOk();
        $this->assertSame($otherProject->getKey(), $this->assignmentOf($inSecond, $b)['project_id'] ?? null);
    }

    public function test_reassigned_entry_gives_no_assignment(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $a = $this->occurrence($data->user, 'occ-a', '2026-10-20');
        $b = $this->occurrence($data->user, 'occ-b', '2026-10-22');
        $entryId = $this->convertTo($data->organization, $a, $project);

        // Act: core moves the entry to another member
        TimeEntry::query()->whereKey($entryId)->update([
            'user_id' => $data->owner->getKey(),
            'member_id' => $data->ownerMember->getKey(),
        ]);
        $read = $this->read();

        // Assert
        $read->assertOk();
        $this->assertNull($this->assignmentOf($read, $b));
        $this->assertNull($this->assignmentOf($read, $a));
    }

    public function test_archived_project_gives_no_assignment_and_no_fallback(): void
    {
        // Arrange
        $data = $this->employee();
        $first = $this->publicProject($data->organization);
        $second = $this->publicProject($data->organization);
        $a = $this->occurrence($data->user, 'occ-a', '2026-10-20');
        $b = $this->occurrence($data->user, 'occ-b', '2026-10-22');
        $c = $this->occurrence($data->user, 'occ-c', '2026-10-19');
        $this->convertTo($data->organization, $a, $first);
        $this->travel(5)->seconds();
        $this->convertTo($data->organization, $c, $second);

        // Act
        $second->archived_at = Carbon::now();
        $second->save();
        $read = $this->read();

        // Assert: the latest conversion is not bookable any more, and the older one is not used instead
        $read->assertOk();
        $this->assertNull($this->assignmentOf($read, $b));
    }

    public function test_project_the_employee_can_no_longer_book_gives_no_assignment(): void
    {
        // Arrange: a private project the employee is a member of at conversion time
        $data = $this->employee();
        $project = Project::factory()->forOrganization($data->organization)->isPrivate()->create();
        $projectMember = ProjectMember::factory()->forProject($project)->forMember($data->member)->create();
        $a = $this->occurrence($data->user, 'occ-a', '2026-10-20');
        $b = $this->occurrence($data->user, 'occ-b', '2026-10-22');
        $this->convertTo($data->organization, $a, $project);
        $before = $this->read();

        // Act: the employee is removed from the project
        ProjectMember::query()->whereKey($projectMember->getKey())->delete();
        $after = $this->read();

        // Assert
        $this->assertSame($project->getKey(), $this->assignmentOf($before, $b)['project_id'] ?? null);
        $after->assertOk();
        $this->assertNull($this->assignmentOf($after, $b));
    }

    public function test_done_task_and_deleted_tags_are_dropped(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $task = Task::factory()->forOrganization($data->organization)->forProject($project)->create();
        $kept = Tag::factory()->forOrganization($data->organization)->create();
        $deleted = Tag::factory()->forOrganization($data->organization)->create();
        $a = $this->occurrence($data->user, 'occ-a', '2026-10-20');
        $b = $this->occurrence($data->user, 'occ-b', '2026-10-22');
        $this->convert($data->organization, [
            'meeting_ids' => [$a->id],
            'project_id' => $project->getKey(),
            'task_id' => $task->getKey(),
            'tags' => [$kept->getKey(), $deleted->getKey()],
            'billable' => false,
        ])->assertJsonPath('results.0.status', 'created');

        // Act
        $task->done_at = Carbon::now();
        $task->save();
        Tag::query()->whereKey($deleted->getKey())->delete();
        $read = $this->read();

        // Assert: the project stays, the done task and the deleted tag are dropped silently
        $read->assertOk();
        $assignment = $this->assignmentOf($read, $b);
        $this->assertNotNull($assignment);
        $this->assertSame($project->getKey(), $assignment['project_id']);
        $this->assertNull($assignment['task_id']);
        $this->assertNull($assignment['task_name']);
        $this->assertSame([$kept->getKey()], $assignment['tags']);
        $this->assertFalse($assignment['billable']);
    }

    public function test_dismissed_occurrence_and_single_meeting_have_no_assignment(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $a = $this->occurrence($data->user, 'occ-a', '2026-10-20');
        $b = $this->occurrence($data->user, 'occ-b', '2026-10-22');
        $c = $this->occurrence($data->user, 'occ-c', '2026-10-19');
        $d = $this->meeting($data->user, 'single-d', ['starts_at' => '2026-10-21 11:00:00', 'ends_at' => '2026-10-21 12:00:00']);
        $this->convertTo($data->organization, $a, $project);
        $b->dismissed_at = Carbon::now();
        $b->save();

        // Act
        $read = $this->getJson(route('microsoft.meetings.index', ['start' => self::WEEK_START, 'end' => self::WEEK_END, 'include_dismissed' => 1], false));

        // Assert
        $read->assertOk();
        $this->assertTrue($this->item($read, $b)['dismissed']);
        $this->assertNull($this->assignmentOf($read, $b));
        $this->assertNull($this->assignmentOf($read, $d));
        $this->assertSame($project->getKey(), $this->assignmentOf($read, $c)['project_id'] ?? null);
        $this->assertSame(1, TimeEntry::query()->count());
    }

    public function test_without_current_organization_there_is_no_assignment(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $a = $this->occurrence($data->user, 'occ-a', '2026-10-20');
        $b = $this->occurrence($data->user, 'occ-b', '2026-10-22');
        $this->convertTo($data->organization, $a, $project);

        // Act
        $data->user->current_team_id = null;
        $data->user->save();
        $read = $this->read();

        // Assert
        $read->assertOk();
        $this->assertNull($this->assignmentOf($read, $b));
    }

    public function test_another_users_conversions_never_pre_assign(): void
    {
        // Arrange: a colleague in the same organization has an occurrence of the same series id
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $colleague = User::factory()->create();
        Member::factory()->forUser($colleague)->forOrganization($data->organization)->role(Role::Employee)->create();
        $colleague->currentOrganization()->associate($data->organization);
        $colleague->save();
        $this->connectedAccount($colleague);
        $colleagueOccurrence = $this->occurrence($colleague, 'colleague-occ', '2026-10-20');
        $b = $this->occurrence($data->user, 'occ-b', '2026-10-22');
        $c = $this->occurrence($data->user, 'occ-c', '2026-10-19');

        // Act: the colleague converts their occurrence, then the user reads
        $this->actingAs($colleague);
        $this->convertTo($data->organization, $colleagueOccurrence, $project);
        $this->actingAs($data->user);
        $read = $this->read();

        // Assert
        $read->assertOk();
        $this->assertNull($this->assignmentOf($read, $b));
        $this->assertNull($this->assignmentOf($read, $c));
    }

    public function test_link_records_the_series_of_the_occurrence(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $occurrence = $this->occurrence($data->user, 'occ-a', '2026-10-20');
        $single = $this->meeting($data->user, 'single-d', ['starts_at' => '2026-10-21 11:00:00', 'ends_at' => '2026-10-21 12:00:00']);

        // Act
        $this->convertTo($data->organization, $occurrence, $project);
        $this->convertTo($data->organization, $single, $project);

        // Assert
        $this->assertSame(self::SERIES, OutlookMeetingLink::query()->where('graph_id', '=', 'occ-a')->sole()->series_master_id);
        $this->assertNull(OutlookMeetingLink::query()->where('graph_id', '=', 'single-d')->sole()->series_master_id);
    }

    public function test_backfill_fills_the_series_of_existing_links(): void
    {
        // Arrange: two Phase 4 links (no series recorded); the meeting of the second one was purged
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $cached = $this->occurrence($data->user, 'occ-cached', '2026-10-20', 'series-9');
        $purged = $this->occurrence($data->user, 'occ-purged', '2026-10-21', 'series-8');
        $this->convertTo($data->organization, $cached, $project);
        $this->convertTo($data->organization, $purged, $project);
        OutlookMeetingLink::query()->update(['series_master_id' => null]);
        OutlookMeeting::query()->whereKey($purged->getKey())->delete();

        // Act
        $migration = require base_path('app/Microsoft365/database/migrations/2026_11_18_000001_add_series_and_signals_to_outlook_meeting_links.php');
        $this->assertIsObject($migration);
        $this->assertTrue(method_exists($migration, 'backfill'));
        $migration->backfill();

        // Assert
        $this->assertSame('series-9', OutlookMeetingLink::query()->where('graph_id', '=', 'occ-cached')->sole()->series_master_id);
        $this->assertNull(OutlookMeetingLink::query()->where('graph_id', '=', 'occ-purged')->sole()->series_master_id);
    }

    public function test_series_assignment_survives_disconnect_and_resync(): void
    {
        // Arrange: round A synced, one occurrence of its recurring series converted
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $this->fakeRoundA(2);
        $this->postSync()->assertOk()->assertJsonPath('status', 'ok');
        $occurrences = OutlookMeeting::query()
            ->where('user_id', '=', $data->user->getKey())
            ->whereNotNull('series_master_id')
            ->orderBy('starts_at')
            ->get();
        $this->assertGreaterThanOrEqual(2, $occurrences->count());
        $converted = $occurrences->first();
        $this->assertInstanceOf(OutlookMeeting::class, $converted);
        $series = $converted->series_master_id;
        $otherGraphIds = $occurrences
            ->filter(fn (OutlookMeeting $meeting): bool => $meeting->series_master_id === $series && $meeting->graph_id !== $converted->graph_id)
            ->pluck('graph_id')
            ->all();
        $this->assertNotEmpty($otherGraphIds);
        $this->convertTo($data->organization, $converted, $project);

        // Act: Disconnect Microsoft (purges the cached meetings), reconnect and sync round A again
        $this->delete(route('microsoft.account.destroy', [], false))->assertRedirect(route('profile.show', [], false));
        $meetingsAfterDisconnect = OutlookMeeting::query()->where('user_id', '=', $data->user->getKey())->count();
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->get(route('microsoft.redirect', ['intent' => 'connect'], false))->assertRedirect();
        $this->get(route('microsoft.callback', ['code' => 'fake-code', 'state' => 'fake-state'], false))->assertRedirect();
        $this->travel(61)->seconds();
        $sync = $this->postSync();
        $read = $this->getJson(route('microsoft.meetings.index', $this->fixtureWindow(), false));

        // Assert: the re-created occurrences of the series still come pre-assigned (RESEARCH Pitfall 1)
        $this->assertSame(0, $meetingsAfterDisconnect);
        $sync->assertOk()->assertJsonPath('status', 'ok');
        $read->assertOk();
        $recreated = OutlookMeeting::query()
            ->where('user_id', '=', $data->user->getKey())
            ->whereIn('graph_id', $otherGraphIds)
            ->get();
        $this->assertCount(count($otherGraphIds), $recreated);
        foreach ($recreated as $meeting) {
            $this->assertSame($project->getKey(), $this->assignmentOf($read, $meeting)['project_id'] ?? null);
        }
    }

    public function test_read_query_count_does_not_grow_with_meetings(): void
    {
        // Arrange: week 1 has 2 pre-assigned occurrences of one series; week 2 has 20 of 4 series
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $weekOne = [];
        foreach (['2026-10-20', '2026-10-21', '2026-10-22'] as $index => $day) {
            $weekOne[] = $this->occurrence($data->user, 'w1-'.$index, $day, 'series-small');
        }
        $this->convertTo($data->organization, $weekOne[0], $project);
        foreach (['s-a', 's-b', 's-c', 's-d'] as $series) {
            $first = null;
            foreach (['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'] as $index => $day) {
                $meeting = $this->occurrence($data->user, 'w2-'.$series.'-'.$index, $day, $series);
                $first ??= $meeting;
            }
            $this->convertTo($data->organization, $first, $project);
        }
        $this->read()->assertOk();

        // Act
        DB::flushQueryLog();
        DB::enableQueryLog();
        $small = $this->read();
        $smallQueries = count(DB::getQueryLog());
        DB::flushQueryLog();
        $large = $this->read('2026-10-26T00:00:00Z', '2026-11-02T00:00:00Z');
        $largeQueries = count(DB::getQueryLog());
        DB::disableQueryLog();

        // Assert
        $small->assertOk();
        $large->assertOk();
        $this->assertCount(2, array_filter($small->json('data.*.assignment')));
        $this->assertCount(20, $large->json('data'));
        $this->assertCount(20, array_filter($large->json('data.*.assignment')));
        $this->assertSame($smallQueries, $largeQueries);
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
}
