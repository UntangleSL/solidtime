<?php

declare(strict_types=1);

namespace Tests\Feature\Profitability;

use App\Models\Member;
use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use App\Profitability\ProfitabilityServiceProvider;
use App\Profitability\TimeEntries\EnforceBillableOnBillableProject;
use Database\Factories\TimeEntryFactory;
use Illuminate\Support\Carbon;
use Laravel\Passport\Passport;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

/**
 * D-05: on a billable project every work entry is billable, through every write path, while legacy
 * entries, breaks, imports and organizations without billable rates keep core's behaviour.
 */
#[CoversClass(EnforceBillableOnBillableProject::class)]
#[UsesClass(ProfitabilityServiceProvider::class)]
class EnforceBillableTest extends TestCaseWithDatabase
{
    private const int RATE = 5000;

    public function test_api_store_forces_billable_and_recomputes_the_rate(): void
    {
        // Arrange
        $data = $this->timeEntryUser();
        $project = $this->billableProject($data->organization);
        Passport::actingAs($data->user);

        // Act
        $response = $this->postJson(route('api.v1.time-entries.store', [$data->organization->getKey()]), [
            'member_id' => $data->member->getKey(),
            'project_id' => $project->getKey(),
            'billable' => false,
            'start' => Carbon::now()->subHours(2)->toIso8601ZuluString(),
            'end' => Carbon::now()->subHour()->toIso8601ZuluString(),
            'description' => '',
        ]);

        // Assert
        $response->assertStatus(201);
        $response->assertJsonPath('data.billable', true);
        $this->assertDatabaseHas(TimeEntry::class, [
            'id' => $response->json('data.id'),
            'project_id' => $project->getKey(),
            'billable' => true,
            'billable_rate' => self::RATE,
        ]);
    }

    /**
     * @return object{user: User, organization: Organization, member: Member, owner: User, ownerMember: Member}
     */
    private function timeEntryUser(): object
    {
        return $this->createUserWithPermission([
            'time-entries:create:own',
            'time-entries:update:own',
            'projects:view:all',
        ]);
    }

    private function billableProject(Organization $organization): Project
    {
        return Project::factory()->forOrganization($organization)->isPublic()->billable(self::RATE)->create();
    }

    private function entryFor(Organization $organization, Member $member): TimeEntryFactory
    {
        return TimeEntry::factory()->forOrganization($organization)->forMember($member)
            ->startWithDuration(Carbon::now()->subDays(2), 3600);
    }
}
