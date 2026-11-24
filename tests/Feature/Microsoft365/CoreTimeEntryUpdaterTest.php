<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Exceptions\Api\ApiException;
use App\Exceptions\Api\OrganizationHasNoSubscriptionButMultipleMembersException;
use App\Exceptions\Api\OverlappingTimeEntryApiException;
use App\Http\Controllers\Api\V1\TimeEntryController;
use App\Http\Requests\V1\TimeEntry\TimeEntryUpdateRequest;
use App\Jobs\RecalculateSpentTimeForProject;
use App\Jobs\RecalculateSpentTimeForTask;
use App\Microsoft365\Http\Requests\MeetingConversionRequest;
use App\Microsoft365\TimeEntries\CoreTimeEntryUpdater;
use App\Models\Member;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Tag;
use App\Models\Task;
use App\Models\TimeEntry;
use App\Models\User;
use App\Service\BillingContract;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Queue;
use Illuminate\Validation\ValidationException;
use LogicException;
use Mockery\MockInterface;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;
use Throwable;

/**
 * The in-process core update in every context it runs in (Phase 6 D-04, D-12, RESEARCH Pattern 4):
 * a queued job (nobody signed in: the actor is set for the call and always forgotten), an HTTP request
 * (the session user must be the actor), the entry's own organization, a blocked organization, core's
 * opt-in overlap check, core's permission check and core's validation message. Only start and end ever
 * change; the recalculation jobs of core run as for a manual edit.
 */
#[CoversClass(CoreTimeEntryUpdater::class)]
#[UsesClass(TimeEntryController::class)]
#[UsesClass(TimeEntryUpdateRequest::class)]
#[UsesClass(MeetingConversionRequest::class)]
#[UsesClass(ApiException::class)]
#[UsesClass(OverlappingTimeEntryApiException::class)]
#[UsesClass(OrganizationHasNoSubscriptionButMultipleMembersException::class)]
class CoreTimeEntryUpdaterTest extends TestCaseWithDatabase
{
    private const string START = '2026-12-03 10:00:00';

    private const string END = '2026-12-03 11:00:00';

    private const string NEW_START = '2026-12-03 12:00:00';

    private const string NEW_END = '2026-12-03 13:00:00';

    /**
     * An employee of a fresh organization, nobody signed in, the clock on Tuesday 2026-12-01 08:00 UTC.
     *
     * @return object{user: User, organization: Organization, member: Member, owner: User, ownerMember: Member}
     */
    private function employee(): object
    {
        $this->travelTo(CarbonImmutable::parse('2026-12-01 08:00:00', 'UTC'));
        $data = $this->createUserWithRole(Role::Employee);
        $data->user->save();

        return $data;
    }

    /**
     * An entry of the member at START-END with a project, a task, two tags, a description and the
     * billable flag set, so a change to any of them shows.
     */
    private function richEntry(Member $member, Organization $organization): TimeEntry
    {
        $project = Project::factory()->forOrganization($organization)->isPublic()->create();
        $task = Task::factory()->forProject($project)->forOrganization($organization)->create();
        $tags = [
            Tag::factory()->forOrganization($organization)->create()->getKey(),
            Tag::factory()->forOrganization($organization)->create()->getKey(),
        ];

        return TimeEntry::factory()->forMember($member)->forTask($task)->create([
            'start' => Carbon::parse(self::START, 'UTC'),
            'end' => Carbon::parse(self::END, 'UTC'),
            'description' => 'Weekly planning',
            'billable' => true,
            'tags' => $tags,
        ]);
    }

    private function plainEntry(Member $member, string $start = self::START, string $end = self::END): TimeEntry
    {
        return TimeEntry::factory()->forMember($member)->create([
            'start' => Carbon::parse($start, 'UTC'),
            'end' => Carbon::parse($end, 'UTC'),
            'description' => '',
            'billable' => false,
        ]);
    }

    private function update(User $actor, TimeEntry $entry, string $start = self::NEW_START, string $end = self::NEW_END): TimeEntry
    {
        return app(CoreTimeEntryUpdater::class)->updateTimes(
            $actor,
            $entry,
            CoreTimeEntryUpdater::format($start),
            CoreTimeEntryUpdater::format($end),
        );
    }

    /**
     * Runs the call and returns what it threw (null when nothing was thrown).
     */
    private function thrownBy(callable $call): ?Throwable
    {
        try {
            $call();
        } catch (Throwable $exception) {
            return $exception;
        }

        return null;
    }

    private function utc(?\DateTimeInterface $value): ?string
    {
        return $value === null ? null : CarbonImmutable::instance($value)->utc()->format('Y-m-d H:i:s');
    }

    private function assertUnchanged(TimeEntry $entry): void
    {
        $fresh = TimeEntry::query()->findOrFail($entry->getKey());
        $this->assertSame(self::START, $this->utc($fresh->start));
        $this->assertSame(self::END, $this->utc($fresh->end));
    }

    public function test_job_context_update_sets_and_forgets_the_user(): void
    {
        // Arrange: a queued job, nobody signed in
        $data = $this->employee();
        $entry = $this->richEntry($data->member, $data->organization);
        $before = $entry->only(['description', 'project_id', 'task_id', 'tags', 'billable', 'member_id', 'user_id', 'organization_id']);
        Queue::fake();
        $this->assertNull(Auth::guard('web')->user());

        // Act
        $updated = $this->update($data->user, $entry);

        // Assert: only start and end changed, through core
        $this->assertSame($entry->getKey(), $updated->getKey());
        $fresh = TimeEntry::query()->findOrFail($entry->getKey());
        $this->assertSame(self::NEW_START, $this->utc($fresh->start));
        $this->assertSame(self::NEW_END, $this->utc($fresh->end));
        $this->assertSame($before, $fresh->only(array_keys($before)));
        $this->assertSame('Weekly planning', $fresh->description);
        $this->assertTrue($fresh->billable);
        // Core's recalculation jobs ran as for a manual edit
        Queue::assertPushed(RecalculateSpentTimeForProject::class);
        Queue::assertPushed(RecalculateSpentTimeForTask::class);
        // The acting user does not outlive the call (T-06-11)
        $this->assertNull(Auth::guard('web')->user());
        $this->assertNull(Auth::user());
    }

    public function test_job_context_forgets_the_user_when_core_throws(): void
    {
        // Arrange: the organization forbids overlaps and another entry occupies the new slot
        $data = $this->employee();
        $entry = $this->plainEntry($data->member);
        $this->plainEntry($data->member, '2026-12-03 12:30:00', '2026-12-03 13:30:00');
        $data->organization->prevent_overlapping_time_entries = true;
        $data->organization->save();

        // Act
        $thrown = $this->thrownBy(fn (): TimeEntry => $this->update($data->user, $entry));

        // Assert: core's own refusal, the entry untouched, nobody left signed in
        $this->assertInstanceOf(OverlappingTimeEntryApiException::class, $thrown);
        $this->assertUnchanged($entry);
        $this->assertNull(Auth::guard('web')->user());
        $this->assertNull(Auth::user());
    }

    public function test_overlap_is_allowed_when_the_organization_does_not_forbid_it(): void
    {
        // Arrange: the same overlap, without the opt-in setting
        $data = $this->employee();
        $entry = $this->plainEntry($data->member);
        $this->plainEntry($data->member, '2026-12-03 12:30:00', '2026-12-03 13:30:00');

        // Act
        $this->update($data->user, $entry);

        // Assert
        $fresh = TimeEntry::query()->findOrFail($entry->getKey());
        $this->assertSame(self::NEW_START, $this->utc($fresh->start));
        $this->assertNull(Auth::guard('web')->user());
    }

    public function test_http_context_uses_the_session_user(): void
    {
        // Arrange: the entry's user is signed in on the web guard
        $data = $this->employee();
        $entry = $this->plainEntry($data->member);
        $this->actingAs($data->user, 'web');

        // Act
        $this->update($data->user, $entry);

        // Assert: updated, and the session user is still signed in afterwards
        $fresh = TimeEntry::query()->findOrFail($entry->getKey());
        $this->assertSame(self::NEW_START, $this->utc($fresh->start));
        $this->assertSame(self::NEW_END, $this->utc($fresh->end));
        $this->assertTrue($data->user->is(Auth::guard('web')->user()));
    }

    public function test_http_context_refuses_another_signed_in_user(): void
    {
        // Arrange: another member of the organization is signed in
        $data = $this->employee();
        $entry = $this->plainEntry($data->member);
        $this->actingAs($data->owner, 'web');

        // Act
        $thrown = $this->thrownBy(fn (): TimeEntry => $this->update($data->user, $entry));

        // Assert: refused before core runs; the signed-in user stays as it was
        $this->assertInstanceOf(LogicException::class, $thrown);
        $this->assertUnchanged($entry);
        $this->assertTrue($data->owner->is(Auth::guard('web')->user()));
    }

    public function test_uses_the_entry_organization(): void
    {
        // Arrange: the user's current organization is another one they belong to
        $data = $this->employee();
        $entry = $this->plainEntry($data->member);
        $other = Organization::factory()->withOwner($data->owner)->create();
        Member::factory()->forUser($data->user)->forOrganization($other)->role(Role::Employee)->create();
        $data->user->currentOrganization()->associate($other);
        $data->user->save();

        // Act
        $this->update($data->user, $entry);

        // Assert: the update ran against the entry's organization
        $fresh = TimeEntry::query()->findOrFail($entry->getKey());
        $this->assertSame(self::NEW_START, $this->utc($fresh->start));
        $this->assertSame($data->organization->getKey(), $fresh->organization_id);
        $this->assertSame($other->getKey(), $data->user->fresh()?->current_team_id);
    }

    public function test_blocked_organization_is_refused(): void
    {
        // Arrange: billing reports the organization as blocked (check-organization-blocked)
        $data = $this->employee();
        $entry = $this->plainEntry($data->member);
        $this->mock(BillingContract::class, function (MockInterface $mock): void {
            $mock->shouldReceive('isBlocked')->andReturn(true);
            $mock->shouldReceive('hasSubscription')->andReturn(false);
            $mock->shouldReceive('hasTrial')->andReturn(false);
            $mock->shouldReceive('canUseBillableRates')->andReturn(false);
        });

        // Act
        $thrown = $this->thrownBy(fn (): TimeEntry => $this->update($data->user, $entry));

        // Assert
        $this->assertInstanceOf(OrganizationHasNoSubscriptionButMultipleMembersException::class, $thrown);
        $this->assertUnchanged($entry);
        $this->assertNull(Auth::guard('web')->user());
    }

    public function test_missing_update_permission_is_refused(): void
    {
        // Arrange: a member whose role may view but not update its own entries
        $this->travelTo(CarbonImmutable::parse('2026-12-01 08:00:00', 'UTC'));
        $data = $this->createUserWithPermission(['time-entries:view:own']);
        $entry = $this->plainEntry($data->member);

        // Act
        $thrown = $this->thrownBy(fn (): TimeEntry => $this->update($data->user, $entry));

        // Assert: core's permission check applies to the job path too
        $this->assertInstanceOf(AuthorizationException::class, $thrown);
        $this->assertUnchanged($entry);
        $this->assertNull(Auth::guard('web')->user());
    }

    public function test_another_members_entry_needs_the_update_all_permission(): void
    {
        // Arrange: the actor is an employee, the entry belongs to someone else
        $data = $this->employee();
        $colleague = User::factory()->create();
        $colleagueMember = Member::factory()->forUser($colleague)->forOrganization($data->organization)->role(Role::Employee)->create();
        $entry = $this->plainEntry($colleagueMember);

        // Act
        $thrown = $this->thrownBy(fn (): TimeEntry => $this->update($data->user, $entry));

        // Assert
        $this->assertInstanceOf(AuthorizationException::class, $thrown);
        $this->assertUnchanged($entry);
        $this->assertNull(Auth::guard('web')->user());
    }

    public function test_validation_message_is_core_s(): void
    {
        // Arrange
        $data = $this->employee();
        $entry = $this->plainEntry($data->member);

        // Act: the end before the start
        $thrown = $this->thrownBy(fn (): TimeEntry => $this->update($data->user, $entry, self::NEW_END, self::NEW_START));

        // Assert: core's own rule and message (after_or_equal:start)
        $this->assertInstanceOf(ValidationException::class, $thrown);
        $this->assertSame(
            [__('validation.after_or_equal', ['attribute' => 'end', 'date' => 'start'])],
            $thrown->errors()['end'] ?? null,
        );
        $this->assertUnchanged($entry);
        $this->assertNull(Auth::guard('web')->user());
    }
}
