<?php

declare(strict_types=1);

namespace Tests\Feature\Profitability;

use App\Enums\Role;
use App\Models\Member;
use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use App\Profitability\Access\AccessScope;
use App\Profitability\Access\ProfitabilityAccess;
use App\Profitability\Http\Controllers\ProjectSummaryController;
use App\Profitability\Models\ContractPeriod;
use App\Profitability\Models\ProjectContract;
use App\Profitability\ProfitabilityServiceProvider;
use App\Profitability\Reporting\ConsumptionQuery;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

#[CoversClass(ProjectSummaryController::class)]
#[CoversClass(ProfitabilityAccess::class)]
#[CoversClass(AccessScope::class)]
#[CoversClass(ConsumptionQuery::class)]
#[UsesClass(ProjectContract::class)]
#[UsesClass(ContractPeriod::class)]
#[UsesClass(ProfitabilityServiceProvider::class)]
class ProjectSummaryTest extends TestCaseWithDatabase
{
    protected function setUp(): void
    {
        parent::setUp();
        // Europe/Madrid is UTC+1 in November: local midnight of 2026-11-01 is 2026-10-31 23:00 UTC
        Carbon::setTestNow('2026-11-18 10:00:00');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    /**
     * A monthly contract of the project with its November 2026 period (1 to 30, local dates).
     */
    private function contractWithNovemberPeriod(Project $project, int $budgetSeconds = 72000): ContractPeriod
    {
        $contract = ProjectContract::query()->create([
            'organization_id' => $project->organization_id,
            'project_id' => $project->getKey(),
            'service' => 'SEO retainer',
            'schedule' => 'monthly',
            'starts_on' => '2026-01-01',
            'ends_on' => null,
            'amount_cents' => 250000,
            'budget_seconds' => $budgetSeconds,
        ]);

        return ContractPeriod::query()->create([
            'organization_id' => $project->organization_id,
            'contract_id' => $contract->getKey(),
            'starts_on' => '2026-11-01',
            'ends_on' => '2026-11-30',
            'amount_cents' => 250000,
            'budget_seconds' => $budgetSeconds,
        ]);
    }

    private function billableProject(Organization $organization): Project
    {
        return Project::factory()->forOrganization($organization)->billable()->create();
    }

    private function workEntry(Member $member, Project $project, string $startUtc, int $seconds): TimeEntry
    {
        return TimeEntry::factory()
            ->forMember($member)
            ->forProject($project)
            ->startWithDuration(Carbon::parse($startUtc, 'UTC'), $seconds)
            ->create(['description' => '']);
    }

    /**
     * createUserWithRole associates the current organization of a non-owner without saving it.
     */
    private function actAs(User $user): void
    {
        $user->save();
        $this->actingAs($user);
    }

    private function getSummary(Organization $organization, string $projectId): TestResponse
    {
        return $this->getJson(route('profitability.projects.summary', [
            'organization' => $organization->getKey(),
            'project' => $projectId,
        ], false));
    }

    public function test_owner_sees_hours_sold_and_consumed_of_the_current_period(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $period = $this->contractWithNovemberPeriod($project, 72000);
        // 2026-11-01 00:30 local: inside the period
        $this->workEntry($data->member, $project, '2026-10-31 23:30:00', 3600);
        $this->workEntry($data->member, $project, '2026-11-10 14:00:00', 5400);
        // 2026-10-31 23:30 local: the day before the period
        $this->workEntry($data->member, $project, '2026-10-31 22:30:00', 1800);
        $this->actAs($data->user);

        // Act
        $response = $this->getSummary($data->organization, $project->getKey());

        // Assert
        $response->assertOk();
        $response->assertJsonPath('data.project_id', $project->getKey());
        $response->assertJsonPath('data.can_edit_terms', true);
        $response->assertJsonPath('data.can_edit_plan', true);
        $response->assertJsonPath('data.contract.service', 'SEO retainer');
        $response->assertJsonPath('data.contract.schedule', 'monthly');
        $response->assertJsonPath('data.contract.starts_on', '2026-01-01');
        $response->assertJsonPath('data.contract.ends_on', null);
        $response->assertJsonPath('data.contract.archived', false);
        $response->assertJsonPath('data.period.id', $period->getKey());
        $response->assertJsonPath('data.period.starts_on', '2026-11-01');
        $response->assertJsonPath('data.period.ends_on', '2026-11-30');
        $response->assertJsonPath('data.period.state', 'current');
        $response->assertJsonPath('data.period.budget_seconds', 72000);
        $response->assertJsonPath('data.period.consumed_seconds', 9000);
    }

    public function test_admin_sees_the_summary(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Admin);
        $project = $this->billableProject($data->organization);
        $this->contractWithNovemberPeriod($project, 36000);
        $this->workEntry($data->ownerMember, $project, '2026-11-05 09:00:00', 7200);
        $this->actAs($data->user);

        // Act
        $response = $this->getSummary($data->organization, $project->getKey());

        // Assert
        $response->assertOk();
        $response->assertJsonPath('data.project_id', $project->getKey());
        $response->assertJsonPath('data.can_edit_terms', true);
        $response->assertJsonPath('data.can_edit_plan', true);
        $response->assertJsonPath('data.period.budget_seconds', 36000);
        $response->assertJsonPath('data.period.consumed_seconds', 7200);
    }

    public function test_employee_and_manager_get_404(): void
    {
        foreach ([Role::Employee, Role::Manager] as $role) {
            // Arrange
            $data = $this->createUserWithRole($role);
            $project = $this->billableProject($data->organization);
            $this->contractWithNovemberPeriod($project);
            $this->actAs($data->user);

            // Act
            $response = $this->getSummary($data->organization, $project->getKey());

            // Assert
            $response->assertNotFound();
            $this->assertNull($response->json('data'), $role->value.' must not receive summary data');
        }
    }

    public function test_placeholder_member_gets_404(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Placeholder);
        $project = $this->billableProject($data->organization);
        $this->contractWithNovemberPeriod($project);
        $this->actAs($data->user);

        // Act
        $response = $this->getSummary($data->organization, $project->getKey());

        // Assert
        $response->assertNotFound();
    }

    public function test_foreign_organization_and_unknown_project_get_404(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $foreign = $this->createUserWithRole(Role::Owner);
        $foreignProject = $this->billableProject($foreign->organization);
        $this->contractWithNovemberPeriod($foreignProject);
        $this->actAs($data->user);

        // Act
        $foreignProjectThroughOwnOrganization = $this->getSummary($data->organization, $foreignProject->getKey());
        $unknownProject = $this->getSummary($data->organization, '7b4c5d3e-1f2a-4b6c-8d9e-0a1b2c3d4e5f');
        $organizationNotAMemberOf = $this->getSummary($foreign->organization, $foreignProject->getKey());

        // Assert
        $foreignProjectThroughOwnOrganization->assertNotFound();
        $unknownProject->assertNotFound();
        $organizationNotAMemberOf->assertNotFound();
    }

    public function test_non_billable_project_without_contract_gets_404(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = Project::factory()->forOrganization($data->organization)->create(['is_billable' => false]);
        $this->actAs($data->user);

        // Act
        $response = $this->getSummary($data->organization, $project->getKey());

        // Assert
        $response->assertNotFound();
    }

    public function test_billable_project_without_contract_answers_with_null_contract(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->workEntry($data->member, $project, '2026-11-05 09:00:00', 3600);
        $this->actAs($data->user);

        // Act
        $response = $this->getSummary($data->organization, $project->getKey());

        // Assert
        $response->assertOk();
        $response->assertJsonPath('data.project_id', $project->getKey());
        $response->assertJsonPath('data.can_edit_terms', true);
        $response->assertJsonPath('data.contract', null);
        $response->assertJsonPath('data.period', null);
    }

    public function test_money_appears_only_inside_the_owner_period_block(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->contractWithNovemberPeriod($project);
        $this->workEntry($data->member, $project, '2026-11-05 09:00:00', 3600);
        $this->actAs($data->user);

        // Act
        $response = $this->getSummary($data->organization, $project->getKey());

        // Assert: Owner has money (08-10), but only the period block carries it; the contract terms,
        // the period list and the months never do
        $response->assertOk();
        $response->assertJsonPath('data.period.amount_cents', 250000);
        $payload = $response->json('data');
        $this->assertIsArray($payload);
        $period = $payload['period'];
        $this->assertIsArray($period);
        unset($payload['period']);
        $this->assertNoKeyMatches($payload, '/(amount|cost|margin|revenue|cents)/i');
        $this->assertIsArray($period['months']);
        $this->assertNoKeyMatches($period['months'], '/(amount|cost|margin|revenue|cents)/i');
    }

    public function test_breaks_and_other_projects_never_count(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $otherProject = $this->billableProject($data->organization);
        $this->contractWithNovemberPeriod($project);
        $this->workEntry($data->member, $project, '2026-11-05 09:00:00', 3600);
        $this->workEntry($data->member, $otherProject, '2026-11-05 11:00:00', 5400);
        $break = TimeEntry::factory()
            ->forMember($data->member)
            ->isBreak()
            ->startWithDuration(Carbon::parse('2026-11-05 10:00:00', 'UTC'), 1800)
            ->create(['description' => '']);
        // Core clears the project of a break on save; a bulk update (no model events) still could not
        // make it count
        TimeEntry::query()->whereKey($break->getKey())->update(['project_id' => $project->getKey()]);
        $this->actAs($data->user);

        // Act
        $response = $this->getSummary($data->organization, $project->getKey());

        // Assert
        $response->assertOk();
        $response->assertJsonPath('data.period.consumed_seconds', 3600);
    }

    public function test_running_entry_counts_up_to_now(): void
    {
        // Arrange: started 08:00 UTC, the test clock is 10:00 UTC
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->contractWithNovemberPeriod($project);
        TimeEntry::factory()
            ->forMember($data->member)
            ->forProject($project)
            ->start(Carbon::parse('2026-11-18 08:00:00', 'UTC'))
            ->active()
            ->create(['description' => '']);
        $this->actAs($data->user);

        // Act
        $response = $this->getSummary($data->organization, $project->getKey());

        // Assert
        $response->assertOk();
        $response->assertJsonPath('data.period.consumed_seconds', 7200);
    }

    public function test_entry_starting_in_the_period_counts_in_full_even_if_it_ends_after(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->contractWithNovemberPeriod($project);
        // 2026-11-30 23:00 local (last day of the period) to 2026-12-01 01:00 local: two hours, all counted
        $this->workEntry($data->member, $project, '2026-11-30 22:00:00', 7200);
        // 2026-12-01 00:00 local: the day after the period, never counted
        $this->workEntry($data->member, $project, '2026-11-30 23:00:00', 600);
        $this->actAs($data->user);

        // Act
        $response = $this->getSummary($data->organization, $project->getKey());

        // Assert
        $response->assertOk();
        $response->assertJsonPath('data.period.consumed_seconds', 7200);
    }

    public function test_entries_of_other_organizations_never_count(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $foreign = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->contractWithNovemberPeriod($project);
        $this->workEntry($data->member, $project, '2026-11-05 09:00:00', 3600);
        // An entry of another organization pointing at this project id
        $this->workEntry($foreign->member, $project, '2026-11-06 09:00:00', 5400);
        $this->actAs($data->user);

        // Act
        $response = $this->getSummary($data->organization, $project->getKey());

        // Assert
        $response->assertOk();
        $response->assertJsonPath('data.period.consumed_seconds', 3600);
    }

    /**
     * Fails when any key at any depth of the JSON matches the pattern: money must be absent, not null.
     *
     * @param  array<array-key, mixed>  $json
     */
    private function assertNoKeyMatches(array $json, string $pattern, string $path = ''): void
    {
        foreach ($json as $key => $value) {
            $keyPath = $path === '' ? (string) $key : $path.'.'.$key;
            $this->assertDoesNotMatchRegularExpression($pattern, (string) $key, 'Forbidden key at '.$keyPath);
            if (is_array($value)) {
                $this->assertNoKeyMatches($value, $pattern, $keyPath);
            }
        }
    }
}
