<?php

declare(strict_types=1);

namespace Tests\Feature\Profitability;

use App\Enums\TimeEntryType;
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

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

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

    public function test_api_update_moving_an_entry_to_a_billable_project_forces_billable(): void
    {
        // Arrange
        $data = $this->timeEntryUser();
        $project = $this->billableProject($data->organization);
        $timeEntry = $this->entryFor($data->organization, $data->member)->notBillable()->create();
        Passport::actingAs($data->user);

        // Act
        $response = $this->putJson(route('api.v1.time-entries.update', [$data->organization->getKey(), $timeEntry->getKey()]), [
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);

        // Assert
        $response->assertOk();
        $response->assertJsonPath('data.billable', true);
        $timeEntry->refresh();
        $this->assertSame($project->getKey(), $timeEntry->project_id);
        $this->assertTrue($timeEntry->billable);
        $this->assertSame(self::RATE, $timeEntry->billable_rate);
    }

    public function test_api_update_setting_billable_false_on_a_billable_project_is_overridden(): void
    {
        // Arrange
        $data = $this->timeEntryUser();
        $project = $this->billableProject($data->organization);
        $timeEntry = $this->entryFor($data->organization, $data->member)->forProject($project)->billable()->create();
        Passport::actingAs($data->user);

        // Act
        $response = $this->putJson(route('api.v1.time-entries.update', [$data->organization->getKey(), $timeEntry->getKey()]), [
            'billable' => false,
        ]);

        // Assert
        $response->assertOk();
        $response->assertJsonPath('data.billable', true);
        $timeEntry->refresh();
        $this->assertTrue($timeEntry->billable);
        $this->assertSame(self::RATE, $timeEntry->billable_rate);
    }

    public function test_update_multiple_forces_billable(): void
    {
        // Arrange
        $data = $this->timeEntryUser();
        $project = $this->billableProject($data->organization);
        $first = $this->entryFor($data->organization, $data->member)->notBillable()
            ->startWithDuration(Carbon::now()->subHours(6), 3600)->create();
        $second = $this->entryFor($data->organization, $data->member)->forProject($project)->billable()
            ->startWithDuration(Carbon::now()->subHours(4), 3600)->create();
        Passport::actingAs($data->user);

        // Act: move the first one and try to clear the flag on both
        $response = $this->patchJson(route('api.v1.time-entries.update-multiple', [$data->organization->getKey()]), [
            'ids' => [$first->getKey(), $second->getKey()],
            'changes' => [
                'project_id' => $project->getKey(),
                'billable' => false,
            ],
        ]);

        // Assert
        $response->assertOk();
        $this->assertEqualsCanonicalizing([$first->getKey(), $second->getKey()], $response->json('success'));
        foreach ([$first, $second] as $timeEntry) {
            $timeEntry->refresh();
            $this->assertSame($project->getKey(), $timeEntry->project_id);
            $this->assertTrue($timeEntry->billable);
            $this->assertSame(self::RATE, $timeEntry->billable_rate);
        }
    }

    public function test_model_save_forces_billable(): void
    {
        // Arrange: a direct model save, the in-process path of the Outlook conversion and of any
        // non-import save that does not go through the controller
        $data = $this->timeEntryUser();
        $project = $this->billableProject($data->organization);

        // Act
        $timeEntry = $this->entryFor($data->organization, $data->member)->forProject($project)->notBillable()->create();

        // Assert
        $timeEntry->refresh();
        $this->assertTrue($timeEntry->billable);
        $this->assertSame(self::RATE, $timeEntry->billable_rate);
    }

    public function test_break_entries_are_untouched(): void
    {
        // Arrange
        $data = $this->timeEntryUser();
        $project = $this->billableProject($data->organization);

        // Act: even a break saved with a billable project keeps core's break rules
        $break = $this->entryFor($data->organization, $data->member)->forProject($project)->isBreak()->create();

        // Assert
        $break->refresh();
        $this->assertSame(TimeEntryType::Break, $break->type);
        $this->assertFalse($break->billable);
        $this->assertNull($break->billable_rate);
        $this->assertNull($break->project_id);
    }

    public function test_entries_without_project_or_on_non_billable_projects_are_untouched(): void
    {
        // Arrange
        $data = $this->timeEntryUser();
        $nonBillableProject = Project::factory()->forOrganization($data->organization)->create(['billable_rate' => self::RATE]);
        Passport::actingAs($data->user);

        // Act
        $withoutProject = $this->entryFor($data->organization, $data->member)->notBillable()->create();
        $onNonBillableProject = $this->entryFor($data->organization, $data->member)->forProject($nonBillableProject)->notBillable()->create();
        $response = $this->postJson(route('api.v1.time-entries.store', [$data->organization->getKey()]), [
            'member_id' => $data->member->getKey(),
            'project_id' => $nonBillableProject->getKey(),
            'billable' => false,
            'start' => Carbon::now()->subMinutes(30)->toIso8601ZuluString(),
            'end' => Carbon::now()->subMinutes(10)->toIso8601ZuluString(),
            'description' => '',
        ]);

        // Assert
        $response->assertStatus(201);
        $response->assertJsonPath('data.billable', false);
        $this->assertFalse($withoutProject->refresh()->billable);
        $this->assertFalse($onNonBillableProject->refresh()->billable);
        $this->assertNull($onNonBillableProject->billable_rate);
    }

    public function test_imported_entries_are_untouched(): void
    {
        // Arrange
        $data = $this->timeEntryUser();
        $project = $this->billableProject($data->organization);

        // Act: an import copies history as it was recorded
        $imported = $this->entryFor($data->organization, $data->member)->forProject($project)->notBillable()->create([
            'is_imported' => true,
        ]);

        // Assert
        $imported->refresh();
        $this->assertTrue($imported->is_imported);
        $this->assertFalse($imported->billable);
        $this->assertNull($imported->billable_rate);
    }

    public function test_organization_without_billable_rates_keeps_non_billable(): void
    {
        // Arrange
        $data = $this->timeEntryUser();
        $project = $this->billableProject($data->organization);
        $this->actAsOrganizationWithoutBillableRates();
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

        // Assert: core's premium lock wins
        $response->assertStatus(201);
        $response->assertJsonPath('data.billable', false);
        $this->assertDatabaseHas(TimeEntry::class, [
            'id' => $response->json('data.id'),
            'billable' => false,
            'billable_rate' => null,
        ]);
    }

    public function test_editing_only_the_description_of_a_legacy_entry_keeps_it_non_billable(): void
    {
        // Arrange
        Carbon::setTestNow('2026-11-18 10:00:00');
        $data = $this->timeEntryUser();
        $project = $this->billableProject($data->organization);
        $legacy = $this->legacyEntry($data->organization, $data->member, $project);
        $updatedBefore = $legacy->updated_at;
        Passport::actingAs($data->user);

        // Act
        $response = $this->putJson(route('api.v1.time-entries.update', [$data->organization->getKey(), $legacy->getKey()]), [
            'description' => 'Changed description',
        ]);

        // Assert
        $response->assertOk();
        $response->assertJsonPath('data.billable', false);
        $legacy->refresh();
        $this->assertSame('Changed description', $legacy->description);
        $this->assertFalse($legacy->billable);
        $this->assertNull($legacy->billable_rate);
        $this->assertNotNull($updatedBefore);
        $this->assertNotNull($legacy->updated_at);
        $this->assertTrue($legacy->updated_at->greaterThan($updatedBefore));
    }

    public function test_saving_a_legacy_entry_with_its_unchanged_billable_flag_keeps_it_non_billable(): void
    {
        // Arrange: the edit modal sends the whole entry back, billable flag included
        $data = $this->timeEntryUser();
        $project = $this->billableProject($data->organization);
        $legacy = $this->legacyEntry($data->organization, $data->member, $project);
        Passport::actingAs($data->user);

        // Act
        $response = $this->putJson(route('api.v1.time-entries.update', [$data->organization->getKey(), $legacy->getKey()]), [
            'description' => 'Same flag',
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);

        // Assert
        $response->assertOk();
        $response->assertJsonPath('data.billable', false);
        $this->assertFalse($legacy->refresh()->billable);
        $this->assertNull($legacy->billable_rate);
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

    /**
     * A legacy non-billable entry on a billable project, written without model events (as it was
     * stored before D-05).
     */
    private function legacyEntry(Organization $organization, Member $member, Project $project): TimeEntry
    {
        /** @var TimeEntry $legacy */
        $legacy = $this->entryFor($organization, $member)->forProject($project)->notBillable()->make([
            'description' => '',
            'updated_at' => Carbon::now()->subDays(10),
        ]);
        $legacy->saveQuietly();

        return $legacy->refresh();
    }
}
