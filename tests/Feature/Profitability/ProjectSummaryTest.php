<?php

declare(strict_types=1);

namespace Tests\Feature\Profitability;

use App\Enums\Role;
use App\Models\Member;
use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
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
        $this->actingAs($data->user);

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
}
