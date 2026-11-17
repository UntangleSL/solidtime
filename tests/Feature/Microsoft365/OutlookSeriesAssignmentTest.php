<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Http\Controllers\Api\V1\TimeEntryController;
use App\Http\Requests\V1\TimeEntry\TimeEntryStoreRequest;
use App\Microsoft365\Graph\GraphAccessGuard;
use App\Microsoft365\Http\Controllers\MeetingConversionController;
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
use App\Microsoft365\Suggestions\MeetingHints;
use App\Microsoft365\Suggestions\SeriesAssignmentResolver;
use App\Microsoft365\Suggestions\SeriesKey;
use App\Microsoft365\TimeEntries\CoreTimeEntryCreator;
use App\Models\Client;
use App\Models\Member;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Tag;
use App\Models\Task;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

/**
 * Series pre-assignment (Phase 5 RULE-01, D-02, D-03, D-05, D-12, D-13, D-17): converting one
 * occurrence of a recurring meeting makes the other occurrences of the series come back from the read
 * carrying that conversion's project, task, tags and billable, derived live from the time entry and
 * filtered through the core booking rules. The read never converts or changes anything.
 */
#[CoversClass(SeriesAssignmentResolver::class)]
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
class OutlookSeriesAssignmentTest extends TestCaseWithDatabase
{
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
}
