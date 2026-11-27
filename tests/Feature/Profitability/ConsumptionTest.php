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
use App\Profitability\Reporting\ProjectBalanceService;
use App\Profitability\Reporting\Projection;
use App\Profitability\Reporting\ProjectionResult;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

/**
 * Consumption as the period balance reads it (BUDG-03, BUDG-04): work time bucketed by the local month
 * of its start in Europe/Madrid across both DST changes, running entries up to now, breaks and other
 * projects never, placeholders' past hours always; and the projection fields in the period block.
 */
#[CoversClass(ConsumptionQuery::class)]
#[CoversClass(ProjectBalanceService::class)]
#[UsesClass(Projection::class)]
#[UsesClass(ProjectionResult::class)]
#[UsesClass(ProjectSummaryController::class)]
#[UsesClass(ProfitabilityAccess::class)]
#[UsesClass(AccessScope::class)]
#[UsesClass(ProjectContract::class)]
#[UsesClass(ContractPeriod::class)]
#[UsesClass(ProfitabilityServiceProvider::class)]
class ConsumptionTest extends TestCaseWithDatabase
{
    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow('2026-11-18 10:00:00');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function contractWithPeriod(Project $project, string $schedule, string $startsOn, string $endsOn, int $budgetSeconds): ContractPeriod
    {
        $contract = ProjectContract::query()->create([
            'organization_id' => $project->organization_id,
            'project_id' => $project->getKey(),
            'service' => 'SEO retainer',
            'schedule' => $schedule,
            'starts_on' => $startsOn,
            'ends_on' => null,
            'amount_cents' => 300000,
            'budget_seconds' => $budgetSeconds,
        ]);

        return ContractPeriod::query()->create([
            'organization_id' => $project->organization_id,
            'contract_id' => $contract->getKey(),
            'starts_on' => $startsOn,
            'ends_on' => $endsOn,
            'amount_cents' => 300000,
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

    /**
     * @return array<string, int>
     */
    private function consumedByMonth(TestResponse $response): array
    {
        $months = $response->json('data.period.months');
        $this->assertIsArray($months);
        $consumed = [];
        foreach ($months as $month) {
            $this->assertIsArray($month);
            $consumed[(string) $month['month']] = (int) $month['consumed_seconds'];
        }

        return $consumed;
    }

    public function test_month_boundary_is_decided_in_europe_madrid(): void
    {
        // Arrange: a quarter October to December; Madrid is UTC+1 after the October change
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->contractWithPeriod($project, 'quarterly', '2026-10-01', '2026-12-31', 432000);
        // 2026-10-31 23:30 local: October
        $this->workEntry($data->member, $project, '2026-10-31 22:30:00', 1800);
        // 2026-11-01 00:30 local: November
        $this->workEntry($data->member, $project, '2026-10-31 23:30:00', 3600);
        $this->actAs($data->user);

        // Act
        $response = $this->getSummary($data->organization, $project->getKey());

        // Assert
        $response->assertOk();
        $this->assertSame([
            '2026-10-01' => 1800,
            '2026-11-01' => 3600,
            '2026-12-01' => 0,
        ], $this->consumedByMonth($response));
        $response->assertJsonPath('data.period.consumed_seconds', 5400);
        $response->assertJsonPath('data.period.still_to_consume_seconds', 432000 - 5400);
        $response->assertJsonPath('data.period.status', 'on_track');
        // 35 of the quarter's 66 weekdays elapsed by Wednesday 18 November: the run rate is shown
        $response->assertJsonPath('data.period.run_rate_seconds', (int) round(5400 * 66 / 35));
    }

    public function test_dst_spring_boundary(): void
    {
        // Arrange: an annual period; Madrid is UTC+2 after the change of 29 March 2026
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->contractWithPeriod($project, 'annual', '2026-01-01', '2026-12-31', 720000);
        // 2026-03-31 23:30 local: March
        $this->workEntry($data->member, $project, '2026-03-31 21:30:00', 1800);
        // 2026-04-01 00:30 local: April
        $this->workEntry($data->member, $project, '2026-03-31 22:30:00', 3600);
        // 2026-10-25 is the autumn change: 23:30 UTC that day is already 26 October 00:30 local
        $this->workEntry($data->member, $project, '2026-10-25 23:30:00', 900);
        $this->actAs($data->user);

        // Act
        $response = $this->getSummary($data->organization, $project->getKey());

        // Assert
        $response->assertOk();
        $consumed = $this->consumedByMonth($response);
        $this->assertSame(1800, $consumed['2026-03-01']);
        $this->assertSame(3600, $consumed['2026-04-01']);
        $this->assertSame(900, $consumed['2026-10-01']);
        $this->assertCount(12, $consumed);
    }

    public function test_running_entry_counts_up_to_now(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->contractWithPeriod($project, 'monthly', '2026-11-01', '2026-11-30', 144000);
        TimeEntry::factory()
            ->forMember($data->member)
            ->forProject($project)
            ->start(Carbon::parse('2026-11-18 08:00:00', 'UTC'))
            ->active()
            ->create(['description' => '']);
        $this->actAs($data->user);

        // Act
        $response = $this->getSummary($data->organization, $project->getKey());

        // Assert: now is 10:00 UTC
        $response->assertOk();
        $response->assertJsonPath('data.period.consumed_seconds', 7200);
        $this->assertSame(7200, $this->consumedByMonth($response)['2026-11-01']);
    }

    public function test_breaks_and_other_projects_never_count(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $other = $this->billableProject($data->organization);
        $this->contractWithPeriod($project, 'monthly', '2026-11-01', '2026-11-30', 144000);
        $this->workEntry($data->member, $project, '2026-11-10 09:00:00', 3600);
        $this->workEntry($data->member, $other, '2026-11-10 11:00:00', 5400);
        $break = TimeEntry::factory()
            ->forMember($data->member)
            ->isBreak()
            ->startWithDuration(Carbon::parse('2026-11-10 10:00:00', 'UTC'), 1800)
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
        $response->assertJsonPath('data.period.cost_cents', 0);
        $response->assertJsonPath('data.period.unpriced_cost_seconds', 3600);
    }

    public function test_entries_of_placeholder_members_count(): void
    {
        // Arrange: a former team member kept as a placeholder (D-11: their past hours still count)
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->contractWithPeriod($project, 'monthly', '2026-11-01', '2026-11-30', 144000);
        $placeholder = Member::factory()->forOrganization($data->organization)->role(Role::Placeholder)->create();
        $this->workEntry($placeholder, $project, '2026-11-03 09:00:00', 7200);
        $this->workEntry($data->member, $project, '2026-11-04 09:00:00', 3600);
        $this->actAs($data->user);

        // Act
        $response = $this->getSummary($data->organization, $project->getKey());

        // Assert
        $response->assertOk();
        $response->assertJsonPath('data.period.consumed_seconds', 10800);
        $response->assertJsonPath('data.period.still_to_consume_seconds', 144000 - 10800);
    }
}
