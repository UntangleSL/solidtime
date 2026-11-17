<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Exceptions\Api\ApiException;
use App\Http\Controllers\Api\V1\TimeEntryController;
use App\Http\Middleware\CheckOrganizationBlocked;
use App\Http\Requests\V1\TimeEntry\TimeEntryStoreRequest;
use App\Jobs\RecalculateSpentTimeForProject;
use App\Jobs\RecalculateSpentTimeForTask;
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
use App\Microsoft365\Suggestions\BookableProjects;
use App\Microsoft365\Suggestions\SeriesAssignmentResolver;
use App\Microsoft365\TimeEntries\CoreTimeEntryCreator;
use App\Models\Member;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Tag;
use App\Models\Task;
use App\Models\TimeEntry;
use App\Models\User;
use App\Service\BillingContract;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Laravel\Passport\Passport;
use Mockery\MockInterface;
use PDOException;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use STS\FilamentImpersonate\ImpersonateManager;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

#[CoversClass(MeetingConversionController::class)]
#[UsesClass(MeetingConversionRequest::class)]
#[UsesClass(CoreTimeEntryCreator::class)]
#[UsesClass(OutlookMeetingLink::class)]
#[UsesClass(OutlookMeeting::class)]
#[UsesClass(MicrosoftAccount::class)]
#[UsesClass(GraphAccessGuard::class)]
#[UsesClass(EnsureMicrosoftIsEnabled::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
#[UsesClass(TimeEntryController::class)]
#[UsesClass(TimeEntryStoreRequest::class)]
#[UsesClass(CheckOrganizationBlocked::class)]
#[UsesClass(ApiException::class)]
#[UsesClass(OutlookMeetingController::class)]
#[UsesClass(MeetingRangeRequest::class)]
#[UsesClass(OutlookMeetingResource::class)]
#[UsesClass(OutlookSyncWindow::class)]
#[UsesClass(SeriesAssignmentResolver::class)]
#[UsesClass(BookableProjects::class)]
#[UsesClass(Assignment::class)]
class OutlookMeetingConversionTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

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

    /**
     * @param  array<string, mixed>  $body
     */
    private function convert(Organization $organization, array $body): TestResponse
    {
        return $this->postJson(route('microsoft.meetings.convert', ['organization' => $organization->getKey()], false), $body);
    }

    /**
     * Billing double for the whole web stack: the Inertia middleware reads every value on each request.
     */
    private function billing(bool $blocked, bool $billableRates): void
    {
        $this->mock(BillingContract::class, function (MockInterface $mock) use ($blocked, $billableRates): void {
            $mock->shouldReceive('hasSubscription')->andReturn(! $blocked);
            $mock->shouldReceive('hasTrial')->andReturn(false);
            $mock->shouldReceive('getTrialUntil')->andReturn(null);
            $mock->shouldReceive('getGoalLimit')->andReturn(null);
            $mock->shouldReceive('isBlocked')->andReturn($blocked);
            $mock->shouldReceive('canUseBillableRates')->andReturn($billableRates);
        });
    }

    public function test_converts_one_meeting_into_a_time_entry(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $meeting = $this->meeting($data->user, 'weekly', ['subject' => 'Weekly sync']);

        // Act
        $response = $this->convert($data->organization, [
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);

        // Assert
        $response->assertOk();
        $response->assertJsonCount(1, 'results');
        $response->assertJsonPath('results.0.meeting_id', $meeting->id);
        $response->assertJsonPath('results.0.status', 'created');
        $response->assertJsonPath('results.0.error', null);
        $entryId = $response->json('results.0.time_entry_id');
        $this->assertIsString($entryId);
        $this->assertTrue(Str::isUuid($entryId));
        $this->assertSame(1, TimeEntry::query()->count());
        $entry = TimeEntry::query()->findOrFail($entryId);
        $this->assertSame($data->user->getKey(), $entry->user_id);
        $this->assertSame($data->member->getKey(), $entry->member_id);
        $this->assertSame($data->organization->getKey(), $entry->organization_id);
        $this->assertSame('2026-10-20 09:00:00', $entry->start->utc()->format('Y-m-d H:i:s'));
        $this->assertSame('2026-10-20 10:00:00', $entry->end?->utc()->format('Y-m-d H:i:s'));
        $this->assertSame('Weekly sync', $entry->description);
        $this->assertSame($project->getKey(), $entry->project_id);
        $this->assertFalse($entry->billable);
        $links = OutlookMeetingLink::query()->get();
        $this->assertCount(1, $links);
        $this->assertSame($data->user->getKey(), $links[0]->user_id);
        $this->assertSame('weekly', $links[0]->graph_id);
        $this->assertSame($entryId, $links[0]->time_entry_id);
    }

    public function test_route_is_a_web_session_route_outside_api(): void
    {
        // Arrange
        $route = Route::getRoutes()->getByName('microsoft.meetings.convert');

        // Assert
        $this->assertNotNull($route);
        $this->assertSame('m365/organizations/{organization}/meetings/time-entries', $route->uri());
        $this->assertSame(['POST'], $route->methods());
        $this->assertStringStartsNotWith('api/', $route->uri());
        $middleware = $route->gatherMiddleware();
        foreach (['web', 'auth:web', 'auth.session', 'verified', 'check-organization-blocked'] as $expected) {
            $this->assertContains($expected, $middleware, $expected);
        }
        $throttles = array_filter(
            $middleware,
            fn (mixed $name): bool => is_string($name) && str_starts_with($name, 'throttle:') && str_contains($name, 'm365-convert'),
        );
        $this->assertCount(1, $throttles);
        $this->assertArrayHasKey('organization', $route->wheres);
        $this->assertStringContainsString('{12}', (string) $route->wheres['organization']);
    }

    public function test_unknown_meeting_id_is_reported_per_meeting(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $unknown = (string) Str::uuid();

        // Act
        $response = $this->convert($data->organization, [
            'meeting_ids' => [$unknown],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);

        // Assert
        $response->assertOk();
        $response->assertJsonPath('results.0.meeting_id', $unknown);
        $response->assertJsonPath('results.0.status', 'failed');
        $response->assertJsonPath('results.0.time_entry_id', null);
        $response->assertJsonPath('results.0.error.key', 'meeting_not_found');
        $this->assertSame(0, TimeEntry::query()->count());
        $this->assertSame(0, OutlookMeetingLink::query()->count());
    }

    public function test_employee_cannot_convert_into_a_project_they_cannot_see(): void
    {
        // Arrange: a private project the employee is not a member of
        $data = $this->employee();
        $project = Project::factory()->forOrganization($data->organization)->isPrivate()->create();
        $meeting = $this->meeting($data->user, 'private');

        // Act
        $response = $this->convert($data->organization, [
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);

        // Assert
        $response->assertOk();
        $response->assertJsonPath('results.0.status', 'failed');
        $response->assertJsonPath('results.0.time_entry_id', null);
        $response->assertJsonPath('results.0.error.key', 'validation');
        $this->assertNotSame('', (string) $response->json('results.0.error.message'));
        $this->assertSame(0, TimeEntry::query()->count());
        $this->assertSame(0, OutlookMeetingLink::query()->count());
    }

    public function test_member_without_create_permission_gets_forbidden(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $data = $this->createUserWithPermission([]);
        $this->connectedAccount($data->user);
        $this->actingAs($data->user);
        $project = $this->publicProject($data->organization);
        $meeting = $this->meeting($data->user, 'no-permission');

        // Act
        $response = $this->convert($data->organization, [
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);

        // Assert
        $response->assertOk();
        $response->assertJsonPath('results.0.status', 'failed');
        $response->assertJsonPath('results.0.error.key', 'forbidden');
        $response->assertJsonPath('results.0.error.message', "You can't add time to this project.");
        $this->assertSame(0, TimeEntry::query()->count());
        $this->assertSame(0, OutlookMeetingLink::query()->count());
    }

    public function test_overlap_rule_follows_the_organization_setting(): void
    {
        // Arrange: an existing entry 09:30-10:30 overlaps the 09:00-10:00 meeting
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $meeting = $this->meeting($data->user, 'overlap');
        TimeEntry::factory()->forOrganization($data->organization)->forMember($data->member)->create([
            'start' => Carbon::parse('2026-10-20 09:30:00', 'UTC'),
            'end' => Carbon::parse('2026-10-20 10:30:00', 'UTC'),
        ]);
        $data->organization->prevent_overlapping_time_entries = true;
        $data->organization->save();
        $body = ['meeting_ids' => [$meeting->id], 'project_id' => $project->getKey(), 'billable' => false];

        // Act
        $blocked = $this->convert($data->organization, $body);
        $data->organization->prevent_overlapping_time_entries = false;
        $data->organization->save();
        $allowed = $this->convert($data->organization, $body);

        // Assert
        $blocked->assertOk();
        $blocked->assertJsonPath('results.0.status', 'failed');
        $blocked->assertJsonPath('results.0.error.key', 'overlapping_time_entry');
        $blocked->assertJsonPath('results.0.error.message', __('exceptions.api.overlapping_time_entry'));
        $allowed->assertOk();
        $allowed->assertJsonPath('results.0.status', 'created');
        $this->assertSame(2, TimeEntry::query()->count());
        $this->assertSame(1, OutlookMeetingLink::query()->count());
    }

    public function test_billable_rate_and_lock_match_a_manual_entry(): void
    {
        // Arrange
        $data = $this->employee();
        $project = Project::factory()->forOrganization($data->organization)->isPublic()->billable(12300)->create();
        $first = $this->meeting($data->user, 'billable-one');
        $second = $this->meeting($data->user, 'billable-two', [
            'starts_at' => '2026-10-21 09:00:00',
            'ends_at' => '2026-10-21 10:00:00',
        ]);

        // Act: a conversion, then the same input through the core API endpoint
        $converted = $this->convert($data->organization, [
            'meeting_ids' => [$first->id],
            'project_id' => $project->getKey(),
            'billable' => true,
        ]);
        Passport::actingAs($data->user);
        $manual = $this->postJson(route('api.v1.time-entries.store', [$data->organization->getKey()]), [
            'member_id' => $data->member->getKey(),
            'project_id' => $project->getKey(),
            'billable' => true,
            'start' => '2026-10-20T09:00:00Z',
            'end' => '2026-10-20T10:00:00Z',
            'description' => 'Manual',
        ]);
        $this->actingAs($data->user, 'web');
        $this->billing(blocked: false, billableRates: false);
        $locked = $this->convert($data->organization, [
            'meeting_ids' => [$second->id],
            'project_id' => $project->getKey(),
            'billable' => true,
        ]);

        // Assert
        $converted->assertOk();
        $converted->assertJsonPath('results.0.status', 'created');
        $manual->assertStatus(201);
        $convertedEntry = TimeEntry::query()->findOrFail($converted->json('results.0.time_entry_id'));
        $manualEntry = TimeEntry::query()->findOrFail($manual->json('data.id'));
        $this->assertTrue($convertedEntry->billable);
        $this->assertSame(12300, $convertedEntry->billable_rate);
        $this->assertSame($manualEntry->billable_rate, $convertedEntry->billable_rate);
        $locked->assertOk();
        $locked->assertJsonPath('results.0.status', 'created');
        $lockedEntry = TimeEntry::query()->findOrFail($locked->json('results.0.time_entry_id'));
        $this->assertFalse($lockedEntry->billable);
    }

    public function test_spent_time_jobs_are_dispatched(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $task = Task::factory()->forOrganization($data->organization)->forProject($project)->create();
        $meeting = $this->meeting($data->user, 'jobs');
        Queue::fake([
            RecalculateSpentTimeForProject::class,
            RecalculateSpentTimeForTask::class,
        ]);

        // Act
        $response = $this->convert($data->organization, [
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'task_id' => $task->getKey(),
            'billable' => false,
        ]);

        // Assert
        $response->assertOk();
        $response->assertJsonPath('results.0.status', 'created');
        Queue::assertPushed(RecalculateSpentTimeForProject::class, 1);
        Queue::assertPushed(RecalculateSpentTimeForTask::class, 1);
        Queue::assertPushed(RecalculateSpentTimeForProject::class, fn (RecalculateSpentTimeForProject $job): bool => $job->project->is($project));
        Queue::assertPushed(RecalculateSpentTimeForTask::class, fn (RecalculateSpentTimeForTask $job): bool => $job->task->is($task));
    }

    public function test_task_tags_and_custom_times_are_kept(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $task = Task::factory()->forOrganization($data->organization)->forProject($project)->create();
        $tagA = Tag::factory()->forOrganization($data->organization)->create();
        $tagB = Tag::factory()->forOrganization($data->organization)->create();
        $meeting = $this->meeting($data->user, 'custom');

        // Act
        $response = $this->convert($data->organization, [
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'task_id' => $task->getKey(),
            'tags' => [$tagA->getKey(), $tagB->getKey()],
            'billable' => false,
            'description' => 'Planning notes',
            'start' => '2026-10-20T09:10:00Z',
            'end' => '2026-10-20T09:50:00Z',
        ]);

        // Assert: the entry takes the custom times, the link keeps the meeting's own time (D-03)
        $response->assertOk();
        $response->assertJsonPath('results.0.status', 'created');
        $entry = TimeEntry::query()->findOrFail($response->json('results.0.time_entry_id'));
        $this->assertSame($task->getKey(), $entry->task_id);
        $this->assertEqualsCanonicalizing([$tagA->getKey(), $tagB->getKey()], $entry->tags);
        $this->assertSame('Planning notes', $entry->description);
        $this->assertSame('2026-10-20 09:10:00', $entry->start->utc()->format('Y-m-d H:i:s'));
        $this->assertSame('2026-10-20 09:50:00', $entry->end?->utc()->format('Y-m-d H:i:s'));
        $link = OutlookMeetingLink::query()->sole();
        $this->assertSame($entry->getKey(), $link->time_entry_id);
        $this->assertSame('2026-10-20 09:00:00', $link->meeting_starts_at?->utc()->format('Y-m-d H:i:s'));
        $this->assertSame('2026-10-20 10:00:00', $link->meeting_ends_at?->utc()->format('Y-m-d H:i:s'));
    }

    public function test_two_meetings_in_one_batch_keep_their_own_times_and_subjects(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $first = $this->meeting($data->user, 'batch-one', ['subject' => 'Standup']);
        $second = $this->meeting($data->user, 'batch-two', [
            'subject' => null,
            'starts_at' => '2026-10-22 14:00:00',
            'ends_at' => '2026-10-22 15:30:00',
        ]);

        // Act
        $response = $this->convert($data->organization, [
            'meeting_ids' => [$second->id, $first->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);

        // Assert: results in request order, each entry with its own meeting's time and subject
        $response->assertOk();
        $response->assertJsonPath('results.0.meeting_id', $second->id);
        $response->assertJsonPath('results.1.meeting_id', $first->id);
        $secondEntry = TimeEntry::query()->findOrFail($response->json('results.0.time_entry_id'));
        $firstEntry = TimeEntry::query()->findOrFail($response->json('results.1.time_entry_id'));
        $this->assertSame('', $secondEntry->description);
        $this->assertSame('2026-10-22 14:00:00', $secondEntry->start->utc()->format('Y-m-d H:i:s'));
        $this->assertSame('2026-10-22 15:30:00', $secondEntry->end?->utc()->format('Y-m-d H:i:s'));
        $this->assertSame('Standup', $firstEntry->description);
        $this->assertSame('2026-10-20 09:00:00', $firstEntry->start->utc()->format('Y-m-d H:i:s'));
        $this->assertSame(2, OutlookMeetingLink::query()->count());
    }

    public function test_task_from_another_project_is_a_validation_failure(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $otherProject = $this->publicProject($data->organization);
        $task = Task::factory()->forOrganization($data->organization)->forProject($otherProject)->create();
        $meeting = $this->meeting($data->user, 'wrong-task');

        // Act
        $response = $this->convert($data->organization, [
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'task_id' => $task->getKey(),
            'billable' => false,
        ]);

        // Assert
        $response->assertOk();
        $response->assertJsonPath('results.0.status', 'failed');
        $response->assertJsonPath('results.0.error.key', 'validation');
        $response->assertJsonPath('results.0.error.message', __('validation.task_belongs_to_project', ['attribute' => 'task']));
        $this->assertSame(0, TimeEntry::query()->count());
        $this->assertSame(0, OutlookMeetingLink::query()->count());
    }

    public function test_dismissed_meeting_conversion_clears_the_dismissal(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $meeting = $this->meeting($data->user, 'dismissed', ['dismissed_at' => '2026-10-19 12:00:00']);

        // Act
        $response = $this->convert($data->organization, [
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);

        // Assert
        $response->assertOk();
        $response->assertJsonPath('results.0.status', 'created');
        $this->assertNull($meeting->refresh()->dismissed_at);
    }

    public function test_future_meeting_converts(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $start = Carbon::now()->utc()->addYear()->startOfHour();
        $meeting = $this->meeting($data->user, 'future', [
            'starts_at' => $start->copy(),
            'ends_at' => $start->copy()->addMinutes(45),
        ]);

        // Act
        $response = $this->convert($data->organization, [
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);

        // Assert
        $response->assertOk();
        $response->assertJsonPath('results.0.status', 'created');
        $entry = TimeEntry::query()->findOrFail($response->json('results.0.time_entry_id'));
        $this->assertTrue($start->equalTo($entry->start));
    }

    public function test_blocked_organization_creates_nothing(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $meeting = $this->meeting($data->user, 'blocked');
        $this->billing(blocked: true, billableRates: true);

        // Act
        $response = $this->convert($data->organization, [
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);

        // Assert: the core middleware's own answer
        $response->assertStatus(400);
        $response->assertJsonPath('key', 'organization_has_no_subscription_but_multiple_members');
        $this->assertSame(0, TimeEntry::query()->count());
        $this->assertSame(0, OutlookMeetingLink::query()->count());
    }

    public function test_invalid_bodies_are_422(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $one = $this->meeting($data->user, 'invalid-one');
        $two = $this->meeting($data->user, 'invalid-two');
        $base = ['project_id' => $project->getKey(), 'billable' => false];
        $tooMany = array_map(fn (): string => (string) Str::uuid(), range(1, 51));
        $bodies = [
            'no project' => ['meeting_ids' => [$one->id], 'billable' => false],
            'no ids' => ['meeting_ids' => []] + $base,
            '51 ids' => ['meeting_ids' => $tooMany] + $base,
            'duplicate ids' => ['meeting_ids' => [$one->id, $one->id]] + $base,
            'description with two ids' => ['meeting_ids' => [$one->id, $two->id], 'description' => 'x'] + $base,
            'times with two ids' => ['meeting_ids' => [$one->id, $two->id], 'start' => '2026-10-20T09:00:00Z', 'end' => '2026-10-20T10:00:00Z'] + $base,
            'end before start' => ['meeting_ids' => [$one->id], 'start' => '2026-10-20T10:00:00Z', 'end' => '2026-10-20T09:00:00Z'] + $base,
            'start without end' => ['meeting_ids' => [$one->id], 'start' => '2026-10-20T09:00:00Z'] + $base,
            'end without start' => ['meeting_ids' => [$one->id], 'end' => '2026-10-20T10:00:00Z'] + $base,
            'time with offset' => ['meeting_ids' => [$one->id], 'start' => '2026-10-20T09:00:00+02:00', 'end' => '2026-10-20T10:00:00+02:00'] + $base,
            'not a uuid' => ['meeting_ids' => ['not-a-uuid']] + $base,
            'no billable' => ['meeting_ids' => [$one->id], 'project_id' => $project->getKey()],
        ];

        foreach ($bodies as $case => $body) {
            // Act
            $response = $this->convert($data->organization, $body);

            // Assert
            $this->assertSame(422, $response->status(), $case);
        }
        $this->assertSame(0, TimeEntry::query()->count());
        $this->assertSame(0, OutlookMeetingLink::query()->count());
    }

    public function test_member_id_from_the_client_is_ignored(): void
    {
        // Arrange: the body names the owner's member, the entry still belongs to the session user
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $meeting = $this->meeting($data->user, 'spoof');

        // Act
        $response = $this->convert($data->organization, [
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'billable' => false,
            'member_id' => $data->ownerMember->getKey(),
            'user_id' => $data->owner->getKey(),
        ]);

        // Assert
        $response->assertOk();
        $response->assertJsonPath('results.0.status', 'created');
        $entry = TimeEntry::query()->findOrFail($response->json('results.0.time_entry_id'));
        $this->assertSame($data->member->getKey(), $entry->member_id);
        $this->assertSame($data->user->getKey(), $entry->user_id);
        $this->assertSame($data->user->getKey(), OutlookMeetingLink::query()->sole()->user_id);
    }

    public function test_foreign_and_gone_meetings_are_not_found(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $foreign = $this->meeting($data->owner, 'foreign');
        $gone = $this->meeting($data->user, 'gone', ['gone_at' => '2026-10-19 12:00:00']);

        // Act
        $response = $this->convert($data->organization, [
            'meeting_ids' => [$foreign->id, $gone->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);

        // Assert
        $response->assertOk();
        $response->assertJsonPath('results.0.error.key', 'meeting_not_found');
        $response->assertJsonPath('results.0.error.message', __('microsoft365.calendar.error_meeting_gone'));
        $response->assertJsonPath('results.1.error.key', 'meeting_not_found');
        $this->assertSame(0, TimeEntry::query()->count());
    }

    public function test_user_outside_the_organization_gets_403(): void
    {
        // Arrange
        $data = $this->employee();
        $other = Organization::factory()->create();
        $project = $this->publicProject($other);
        $meeting = $this->meeting($data->user, 'outsider');

        // Act
        $response = $this->convert($other, [
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);

        // Assert
        $response->assertForbidden();
        $this->assertSame(0, TimeEntry::query()->count());
    }

    public function test_impersonating_admin_converts_nothing(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $meeting = $this->meeting($data->user, 'impersonated');
        session()->put(ImpersonateManager::SESSION_KEY, 1);

        // Act
        $response = $this->convert($data->organization, [
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);

        // Assert
        $response->assertNotFound();
        $this->assertSame(0, TimeEntry::query()->count());
        $this->assertSame(0, OutlookMeetingLink::query()->count());
    }

    public function test_converted_meeting_is_no_longer_listed(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $converted = $this->meeting($data->user, 'converted');
        $open = $this->meeting($data->user, 'open', [
            'starts_at' => '2026-10-21 09:00:00',
            'ends_at' => '2026-10-21 10:00:00',
        ]);
        $this->convert($data->organization, [
            'meeting_ids' => [$converted->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ])->assertJsonPath('results.0.status', 'created');

        // Act
        $visible = $this->listMeetings();
        $withDismissed = $this->listMeetings(['include_dismissed' => 1]);

        // Assert
        $visible->assertOk();
        $this->assertSame([$open->id], $visible->json('data.*.id'));
        $withDismissed->assertOk();
        $this->assertSame([$open->id], $withDismissed->json('data.*.id'));
    }

    public function test_meeting_whose_entry_belongs_to_another_user_is_listed_again(): void
    {
        // Arrange: the linked entry is reassigned in bulk, as core's member services do
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $meeting = $this->meeting($data->user, 'reassigned');
        $entryId = $this->convert($data->organization, [
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ])->json('results.0.time_entry_id');
        TimeEntry::query()->whereKey($entryId)->update([
            'user_id' => $data->owner->getKey(),
            'member_id' => $data->ownerMember->getKey(),
        ]);

        // Act
        $response = $this->listMeetings();

        // Assert
        $response->assertOk();
        $this->assertSame([$meeting->id], $response->json('data.*.id'));
    }

    public function test_deleting_the_entry_brings_the_meeting_back(): void
    {
        // Arrange: a query-builder delete, the way core deletes entries in bulk
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $meeting = $this->meeting($data->user, 'deleted');
        $entryId = $this->convert($data->organization, [
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ])->json('results.0.time_entry_id');
        TimeEntry::query()->whereKey($entryId)->delete();

        // Act
        $response = $this->listMeetings();

        // Assert: the link went with the entry (database cascade)
        $response->assertOk();
        $this->assertSame([$meeting->id], $response->json('data.*.id'));
        $this->assertSame(0, OutlookMeetingLink::query()->count());
    }

    public function test_repeat_conversion_returns_the_existing_entry(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $otherProject = $this->publicProject($data->organization);
        $meeting = $this->meeting($data->user, 'repeat');
        $first = $this->convert($data->organization, [
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);
        $entryId = $first->json('results.0.time_entry_id');

        // Act: the same occurrence again, twice, even with another project
        $second = $this->convert($data->organization, [
            'meeting_ids' => [$meeting->id],
            'project_id' => $otherProject->getKey(),
            'billable' => true,
        ]);
        $third = $this->convert($data->organization, [
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);

        // Assert: neutral answer with the first entry, nothing new (D-06, D-16)
        $first->assertOk();
        $first->assertJsonPath('results.0.status', 'created');
        foreach ([$second, $third] as $response) {
            $response->assertOk();
            $response->assertJsonCount(1, 'results');
            $response->assertJsonPath('results.0.meeting_id', $meeting->id);
            $response->assertJsonPath('results.0.status', 'existing');
            $response->assertJsonPath('results.0.time_entry_id', $entryId);
            $response->assertJsonPath('results.0.error', null);
        }
        $this->assertSame(1, TimeEntry::query()->count());
        $this->assertSame(1, OutlookMeetingLink::query()->count());
        $entry = TimeEntry::query()->findOrFail($entryId);
        $this->assertSame($project->getKey(), $entry->project_id);
        $this->assertFalse($entry->billable);
    }

    public function test_duplicate_link_insert_violates_the_unique_index(): void
    {
        // Arrange: two entries of the user, the first already linked to the occurrence
        $data = $this->employee();
        $entries = TimeEntry::factory()->forOrganization($data->organization)->forMember($data->member)->count(2)->create();
        OutlookMeetingLink::query()->create([
            'user_id' => $data->user->getKey(),
            'graph_id' => 'unique-occurrence',
            'time_entry_id' => $entries[0]->getKey(),
            'meeting_starts_at' => '2026-10-20 09:00:00',
            'meeting_ends_at' => '2026-10-20 10:00:00',
        ]);

        // Assert
        $this->expectException(UniqueConstraintViolationException::class);

        // Act: a second link for the same (user, occurrence)
        OutlookMeetingLink::query()->create([
            'user_id' => $data->user->getKey(),
            'graph_id' => 'unique-occurrence',
            'time_entry_id' => $entries[1]->getKey(),
            'meeting_starts_at' => '2026-10-20 09:00:00',
            'meeting_ends_at' => '2026-10-20 10:00:00',
        ]);
    }

    public function test_unique_violation_never_answers_500(): void
    {
        // Arrange: core creates the entry, then the link insert loses a race (simulated by the double)
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $meeting = $this->meeting($data->user, 'race');
        $this->app->instance(CoreTimeEntryCreator::class, new class extends CoreTimeEntryCreator
        {
            public function create(Request $base, Organization $organization, array $payload): TimeEntry
            {
                parent::create($base, $organization, $payload);

                throw new UniqueConstraintViolationException(
                    'pgsql',
                    'insert into "outlook_meeting_links" ("user_id", "graph_id") values (?, ?)',
                    [],
                    new PDOException('duplicate key value violates unique constraint'),
                );
            }
        });

        // Act
        $response = $this->convert($data->organization, [
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);

        // Assert: a per-meeting answer, and the meeting's transaction left nothing behind
        $response->assertOk();
        $response->assertJsonCount(1, 'results');
        $response->assertJsonPath('results.0.meeting_id', $meeting->id);
        $response->assertJsonPath('results.0.status', 'failed');
        $response->assertJsonPath('results.0.time_entry_id', null);
        $response->assertJsonPath('results.0.error.key', 'conflict');
        $response->assertJsonPath('results.0.error.message', __('microsoft365.calendar.error_generic'));
        $this->assertSame(0, TimeEntry::query()->count());
        $this->assertSame(0, OutlookMeetingLink::query()->count());
    }

    public function test_stale_link_is_replaced(): void
    {
        // Arrange: the linked entry now belongs to another user (reassigned in bulk, as core does)
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $meeting = $this->meeting($data->user, 'stale');
        $body = ['meeting_ids' => [$meeting->id], 'project_id' => $project->getKey(), 'billable' => false];
        $oldEntryId = $this->convert($data->organization, $body)->json('results.0.time_entry_id');
        $oldLinkId = OutlookMeetingLink::query()->sole()->getKey();
        TimeEntry::query()->whereKey($oldEntryId)->update([
            'user_id' => $data->owner->getKey(),
            'member_id' => $data->ownerMember->getKey(),
        ]);

        // Act
        $response = $this->convert($data->organization, $body);

        // Assert: a new entry of the user, the stale link replaced by one link to it
        $response->assertOk();
        $response->assertJsonPath('results.0.status', 'created');
        $newEntryId = $response->json('results.0.time_entry_id');
        $this->assertIsString($newEntryId);
        $this->assertNotSame($oldEntryId, $newEntryId);
        $this->assertSame($data->user->getKey(), TimeEntry::query()->findOrFail($newEntryId)->user_id);
        $this->assertSame($data->owner->getKey(), TimeEntry::query()->findOrFail($oldEntryId)->user_id);
        $this->assertNull(OutlookMeetingLink::query()->find($oldLinkId));
        $link = OutlookMeetingLink::query()->sole();
        $this->assertSame($newEntryId, $link->time_entry_id);
        $this->assertSame('stale', $link->graph_id);
    }

    public function test_batch_reports_each_meeting(): void
    {
        // Arrange: a fresh meeting, another user's meeting and an already converted meeting
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $fresh = $this->meeting($data->user, 'batch-fresh', [
            'subject' => 'Fresh review',
            'starts_at' => '2026-10-23 11:00:00',
            'ends_at' => '2026-10-23 11:45:00',
        ]);
        $foreign = $this->meeting($data->owner, 'batch-foreign');
        $converted = $this->meeting($data->user, 'batch-converted');
        $convertedEntryId = $this->convert($data->organization, [
            'meeting_ids' => [$converted->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ])->json('results.0.time_entry_id');
        $foreignBefore = OutlookMeeting::query()->findOrFail($foreign->id)->getAttributes();

        // Act
        $response = $this->convert($data->organization, [
            'meeting_ids' => [$fresh->id, $foreign->id, $converted->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);

        // Assert: three results in request order, each on its own (ASGN-04, D-08)
        $response->assertOk();
        $response->assertJsonCount(3, 'results');
        $response->assertJsonPath('results.0.meeting_id', $fresh->id);
        $response->assertJsonPath('results.0.status', 'created');
        $response->assertJsonPath('results.0.error', null);
        $response->assertJsonPath('results.1.meeting_id', $foreign->id);
        $response->assertJsonPath('results.1.status', 'failed');
        $response->assertJsonPath('results.1.time_entry_id', null);
        $response->assertJsonPath('results.1.error.key', 'meeting_not_found');
        $response->assertJsonPath('results.2.meeting_id', $converted->id);
        $response->assertJsonPath('results.2.status', 'existing');
        $response->assertJsonPath('results.2.time_entry_id', $convertedEntryId);
        $response->assertJsonPath('results.2.error', null);
        $entry = TimeEntry::query()->findOrFail($response->json('results.0.time_entry_id'));
        $this->assertSame('Fresh review', $entry->description);
        $this->assertSame('2026-10-23 11:00:00', $entry->start->utc()->format('Y-m-d H:i:s'));
        $this->assertSame('2026-10-23 11:45:00', $entry->end?->utc()->format('Y-m-d H:i:s'));
        $this->assertSame(2, TimeEntry::query()->count());
        $this->assertSame(2, OutlookMeetingLink::query()->count());
        $this->assertSame(0, TimeEntry::query()->where('user_id', '=', $data->owner->getKey())->count());
        $this->assertSame(0, OutlookMeetingLink::query()->where('user_id', '=', $data->owner->getKey())->count());
        $this->assertSame($foreignBefore, OutlookMeeting::query()->findOrFail($foreign->id)->getAttributes());
    }

    public function test_batch_failure_does_not_roll_back_the_others(): void
    {
        // Arrange: the organization forbids overlaps and the second meeting overlaps a manual entry
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $first = $this->meeting($data->user, 'batch-ok');
        $second = $this->meeting($data->user, 'batch-overlap', [
            'starts_at' => '2026-10-21 09:00:00',
            'ends_at' => '2026-10-21 10:00:00',
        ]);
        $manual = TimeEntry::factory()->forOrganization($data->organization)->forMember($data->member)->create([
            'start' => Carbon::parse('2026-10-21 09:30:00', 'UTC'),
            'end' => Carbon::parse('2026-10-21 10:30:00', 'UTC'),
        ]);
        $data->organization->prevent_overlapping_time_entries = true;
        $data->organization->save();

        // Act
        $response = $this->convert($data->organization, [
            'meeting_ids' => [$first->id, $second->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);

        // Assert: the first is created and kept, the second fails with nothing of its own
        $response->assertOk();
        $response->assertJsonPath('results.0.status', 'created');
        $response->assertJsonPath('results.1.status', 'failed');
        $response->assertJsonPath('results.1.time_entry_id', null);
        $response->assertJsonPath('results.1.error.key', 'overlapping_time_entry');
        $firstEntryId = $response->json('results.0.time_entry_id');
        $this->assertNotNull(TimeEntry::query()->find($firstEntryId));
        $this->assertSame(2, TimeEntry::query()->count());
        $this->assertNotNull(TimeEntry::query()->find($manual->getKey()));
        $link = OutlookMeetingLink::query()->sole();
        $this->assertSame($firstEntryId, $link->time_entry_id);
        $this->assertSame('batch-ok', $link->graph_id);
    }

    public function test_batch_uses_each_subject_and_time(): void
    {
        // Arrange: three meetings with different subjects and times (fresh input bags per meeting)
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $meetings = [
            $this->meeting($data->user, 'each-a', ['subject' => 'Alpha', 'starts_at' => '2026-10-20 08:00:00', 'ends_at' => '2026-10-20 08:30:00']),
            $this->meeting($data->user, 'each-b', ['subject' => 'Beta', 'starts_at' => '2026-10-21 12:00:00', 'ends_at' => '2026-10-21 13:15:00']),
            $this->meeting($data->user, 'each-c', ['subject' => 'Gamma', 'starts_at' => '2026-10-22 16:00:00', 'ends_at' => '2026-10-22 16:20:00']),
        ];

        // Act
        $response = $this->convert($data->organization, [
            'meeting_ids' => array_map(fn (OutlookMeeting $meeting): string => $meeting->id, $meetings),
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);

        // Assert
        $response->assertOk();
        $response->assertJsonCount(3, 'results');
        foreach ($meetings as $index => $meeting) {
            $response->assertJsonPath('results.'.$index.'.meeting_id', $meeting->id);
            $response->assertJsonPath('results.'.$index.'.status', 'created');
            $entry = TimeEntry::query()->findOrFail($response->json('results.'.$index.'.time_entry_id'));
            $this->assertSame($meeting->subject, $entry->description);
            $this->assertTrue($meeting->starts_at->equalTo($entry->start), $meeting->graph_id);
            $this->assertNotNull($entry->end);
            $this->assertTrue($meeting->ends_at->equalTo($entry->end), $meeting->graph_id);
        }
        $this->assertSame(3, OutlookMeetingLink::query()->count());
    }

    /**
     * One occurrence of a recurring meeting (Phase 5): same series, its own day and time.
     *
     * @param  array<string, mixed>  $overrides
     */
    private function occurrence(User $user, string $graphId, string $series, string $day, array $overrides = []): OutlookMeeting
    {
        return $this->meeting($user, $graphId, array_merge([
            'event_type' => 'occurrence',
            'series_master_id' => $series,
            'original_start' => $day.' 09:00:00',
            'starts_at' => $day.' 09:00:00',
            'ends_at' => $day.' 10:00:00',
        ], $overrides));
    }

    /**
     * Confirm mode body: meeting ids only, the server picks the rest (Phase 5 RULE-02).
     *
     * @param  list<string>  $meetingIds
     * @param  array<string, mixed>  $extra
     */
    private function confirm(Organization $organization, array $meetingIds, array $extra = []): TestResponse
    {
        return $this->convert($organization, ['meeting_ids' => $meetingIds, 'use_series_assignment' => true] + $extra);
    }

    public function test_confirm_uses_the_series_assignment(): void
    {
        // Arrange: occurrence A converted with project, task, tag and billable
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $task = Task::factory()->forOrganization($data->organization)->forProject($project)->create();
        $tag = Tag::factory()->forOrganization($data->organization)->create();
        $a = $this->occurrence($data->user, 'series-a', 'series-1', '2026-10-20');
        $b = $this->occurrence($data->user, 'series-b', 'series-1', '2026-10-27', [
            'subject' => 'Weekly sync',
            'ends_at' => '2026-10-27 09:30:00',
        ]);
        $this->convert($data->organization, [
            'meeting_ids' => [$a->id],
            'project_id' => $project->getKey(),
            'task_id' => $task->getKey(),
            'tags' => [$tag->getKey()],
            'billable' => true,
        ])->assertJsonPath('results.0.status', 'created');

        // Act: one click on B, ids only
        $response = $this->confirm($data->organization, [$b->id]);

        // Assert: the series' values, B's own times and subject, owned by the session user
        $response->assertOk();
        $response->assertJsonCount(1, 'results');
        $response->assertJsonPath('results.0.meeting_id', $b->id);
        $response->assertJsonPath('results.0.status', 'created');
        $response->assertJsonPath('results.0.error', null);
        $entry = TimeEntry::query()->findOrFail($response->json('results.0.time_entry_id'));
        $this->assertSame($project->getKey(), $entry->project_id);
        $this->assertSame($task->getKey(), $entry->task_id);
        $this->assertSame([$tag->getKey()], $entry->tags);
        $this->assertTrue($entry->billable);
        $this->assertSame('Weekly sync', $entry->description);
        $this->assertSame('2026-10-27 09:00:00', $entry->start->utc()->format('Y-m-d H:i:s'));
        $this->assertSame('2026-10-27 09:30:00', $entry->end?->utc()->format('Y-m-d H:i:s'));
        $this->assertSame($data->user->getKey(), $entry->user_id);
        $this->assertSame($data->member->getKey(), $entry->member_id);
        $link = OutlookMeetingLink::query()->where('graph_id', '=', 'series-b')->sole();
        $this->assertSame($entry->getKey(), $link->time_entry_id);
        $this->assertSame('series-1', $link->series_master_id);
        $this->assertSame(2, TimeEntry::query()->count());
    }

    /**
     * @param  array<string, mixed>  $extra
     */
    private function listMeetings(array $extra = []): TestResponse
    {
        return $this->getJson(route('microsoft.meetings.index', [
            'start' => '2026-10-19T00:00:00Z',
            'end' => '2026-10-26T00:00:00Z',
        ] + $extra, false));
    }
}
