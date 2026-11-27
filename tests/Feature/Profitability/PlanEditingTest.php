<?php

declare(strict_types=1);

namespace Tests\Feature\Profitability;

use App\Enums\Role;
use App\Models\Client;
use App\Models\Member;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Profitability\Access\AccessScope;
use App\Profitability\Access\ProfitabilityAccess;
use App\Profitability\Enums\ContractSchedule;
use App\Profitability\Http\Controllers\PlanController;
use App\Profitability\Http\Controllers\ProjectSummaryController;
use App\Profitability\Http\Requests\PlanRequest;
use App\Profitability\Models\ClientAccountManager;
use App\Profitability\Models\ContractPeriod;
use App\Profitability\Models\ContractPeriodMonth;
use App\Profitability\Models\ProjectContract;
use App\Profitability\Models\ProjectManager;
use App\Profitability\Periods\PeriodBounds;
use App\Profitability\Periods\PeriodCalendar;
use App\Profitability\Periods\PeriodMaterializer;
use App\Profitability\Periods\PlanDistributor;
use App\Profitability\ProfitabilityServiceProvider;
use App\Profitability\Reporting\ConsumptionQuery;
use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

/**
 * The project manager rebalances the months of a period (BUDG-04, D-02, D-03, D-12): uneven months are
 * fine, the total must stay the period's hours, a closed period keeps its plan, and only the project's
 * managers, Owner and Admin may write.
 *
 * A quarterly contract of 120 h from 2026-07-01; today is 2026-11-18 in Europe/Madrid, so Jul-Sep is
 * closed, Oct-Dec is current and Jan-Mar 2027 is upcoming.
 */
#[CoversClass(PlanController::class)]
#[CoversClass(PlanRequest::class)]
#[UsesClass(ProjectSummaryController::class)]
#[UsesClass(ProfitabilityAccess::class)]
#[UsesClass(AccessScope::class)]
#[UsesClass(ContractSchedule::class)]
#[UsesClass(ProjectContract::class)]
#[UsesClass(ContractPeriod::class)]
#[UsesClass(ContractPeriodMonth::class)]
#[UsesClass(ProjectManager::class)]
#[UsesClass(ClientAccountManager::class)]
#[UsesClass(PeriodBounds::class)]
#[UsesClass(PeriodCalendar::class)]
#[UsesClass(PeriodMaterializer::class)]
#[UsesClass(PlanDistributor::class)]
#[UsesClass(ConsumptionQuery::class)]
#[UsesClass(ProfitabilityServiceProvider::class)]
class PlanEditingTest extends TestCaseWithDatabase
{
    private const int HOUR = 3600;

    /** 120 hours sold per quarter */
    private const int SOLD = 432000;

    protected function setUp(): void
    {
        parent::setUp();
        // 2026-11-18 11:00 in Europe/Madrid
        Carbon::setTestNow('2026-11-18 10:00:00');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    /**
     * A billable project of a client with the quarterly contract materialized up to the upcoming quarter.
     */
    private function quarterlyProject(Organization $organization, ?Client $client = null): Project
    {
        $client ??= Client::factory()->forOrganization($organization)->create();
        $project = Project::factory()->forOrganization($organization)->forClient($client)->billable()->create();

        /** @var ProjectContract $contract */
        $contract = ProjectContract::query()->create([
            'organization_id' => $organization->getKey(),
            'project_id' => $project->getKey(),
            'service' => 'SEO retainer',
            'schedule' => 'quarterly',
            'starts_on' => '2026-07-01',
            'ends_on' => null,
            'amount_cents' => 900000,
            'budget_seconds' => self::SOLD,
        ]);
        $this->app->make(PeriodMaterializer::class)
            ->ensureThrough($contract, CarbonImmutable::createFromFormat('!Y-m-d', '2026-11-18', 'UTC') ?: CarbonImmutable::now());

        return $project;
    }

    private function period(Project $project, string $startsOn): ContractPeriod
    {
        /** @var ProjectContract $contract */
        $contract = ProjectContract::query()->where('project_id', '=', $project->getKey())->firstOrFail();

        /** @var ContractPeriod $period */
        $period = ContractPeriod::query()
            ->where('contract_id', '=', $contract->getKey())
            ->where('starts_on', '=', $startsOn)
            ->firstOrFail();

        return $period;
    }

    /**
     * @return array<string, int>
     */
    private function planOf(ContractPeriod $period): array
    {
        $plan = [];
        foreach ($period->months()->get() as $month) {
            $plan[$month->month->format('Y-m-d')] = $month->planned_seconds;
        }

        return $plan;
    }

    /**
     * @param  array<string, int>  $hoursByMonth
     * @return array{months: list<array{month: string, planned_seconds: int}>}
     */
    private function body(array $hoursByMonth): array
    {
        $months = [];
        foreach ($hoursByMonth as $month => $hours) {
            $months[] = ['month' => $month, 'planned_seconds' => $hours * self::HOUR];
        }

        return ['months' => $months];
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function putPlan(Organization $organization, string $projectId, string $periodId, array $body): TestResponse
    {
        return $this->putJson(route('profitability.periods.plan', [
            'organization' => $organization->getKey(),
            'project' => $projectId,
            'period' => $periodId,
        ], false), $body);
    }

    private function assignProjectManager(Project $project, Member $member): void
    {
        $assignment = new ProjectManager(['project_id' => $project->getKey(), 'member_id' => $member->getKey()]);
        $assignment->organization_id = $project->organization_id;
        $assignment->save();
    }

    private function assignAccountManager(Client $client, Member $member): void
    {
        $assignment = new ClientAccountManager(['client_id' => $client->getKey(), 'member_id' => $member->getKey()]);
        $assignment->organization_id = $client->organization_id;
        $assignment->save();
    }

    /**
     * createUserWithRole associates the current organization of a non-owner without saving it.
     */
    private function actAs(User $user): void
    {
        $user->save();
        $this->actingAs($user);
    }

    public function test_project_manager_saves_a_front_loaded_plan_and_the_summary_shows_it(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Employee);
        $project = $this->quarterlyProject($data->organization);
        $this->assignProjectManager($project, $data->member);
        $current = $this->period($project, '2026-10-01');
        $this->actAs($data->user);

        // Act
        $response = $this->putPlan($data->organization, $project->getKey(), $current->getKey(), $this->body([
            '2026-10-01' => 60,
            '2026-11-01' => 40,
            '2026-12-01' => 20,
        ]));
        $summary = $this->getJson(route('profitability.projects.summary', [
            'organization' => $data->organization->getKey(),
            'project' => $project->getKey(),
        ], false));

        // Assert
        $response->assertNoContent();
        $this->assertSame([
            '2026-10-01' => 60 * self::HOUR,
            '2026-11-01' => 40 * self::HOUR,
            '2026-12-01' => 20 * self::HOUR,
        ], $this->planOf($current));
        $summary->assertOk();
        $summary->assertJsonPath('data.period.id', $current->getKey());
        $summary->assertJsonPath('data.period.months.*.month', ['2026-10-01', '2026-11-01', '2026-12-01']);
        $summary->assertJsonPath('data.period.months.*.planned_seconds', [60 * self::HOUR, 40 * self::HOUR, 20 * self::HOUR]);
        // The period's hours sold never change through the plan
        $summary->assertJsonPath('data.period.budget_seconds', self::SOLD);
    }

    public function test_owner_and_admin_may_save_the_plan(): void
    {
        foreach ([Role::Owner, Role::Admin] as $role) {
            // Arrange
            $data = $this->createUserWithRole($role);
            $project = $this->quarterlyProject($data->organization);
            $current = $this->period($project, '2026-10-01');
            $this->actAs($data->user);

            // Act
            $response = $this->putPlan($data->organization, $project->getKey(), $current->getKey(), $this->body([
                '2026-10-01' => 50,
                '2026-11-01' => 50,
                '2026-12-01' => 20,
            ]));

            // Assert
            $response->assertNoContent();
            $this->assertSame([
                '2026-10-01' => 50 * self::HOUR,
                '2026-11-01' => 50 * self::HOUR,
                '2026-12-01' => 20 * self::HOUR,
            ], $this->planOf($current), $role->value);
        }
    }

    public function test_sum_mismatch_is_422_with_the_delta_copy(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->quarterlyProject($data->organization);
        $current = $this->period($project, '2026-10-01');
        $before = $this->planOf($current);
        $this->actAs($data->user);

        // Act: 110 h planned of 120 h sold
        $response = $this->putPlan($data->organization, $project->getKey(), $current->getKey(), $this->body([
            '2026-10-01' => 60,
            '2026-11-01' => 40,
            '2026-12-01' => 10,
        ]));

        // Assert
        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['months']);
        $message = $response->json('errors.months.0');
        $this->assertIsString($message);
        $this->assertStringContainsString('110 h', $message);
        $this->assertStringContainsString('120 h', $message);
        $this->assertStringContainsString('10 h', $message);
        $this->assertSame(__('profitability.validation.plan_sum', ['x' => '110 h', 'sold' => '120 h', 'n' => '10']), $message);
        $this->assertSame($before, $this->planOf($current));
    }

    public function test_missing_or_extra_month_is_422(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->quarterlyProject($data->organization);
        $current = $this->period($project, '2026-10-01');
        $before = $this->planOf($current);
        $this->actAs($data->user);

        // Act: December missing (the two months still sum to 120 h)
        $missing = $this->putPlan($data->organization, $project->getKey(), $current->getKey(), $this->body([
            '2026-10-01' => 60,
            '2026-11-01' => 60,
        ]));
        // A month of another quarter in place of December
        $foreign = $this->putPlan($data->organization, $project->getKey(), $current->getKey(), $this->body([
            '2026-10-01' => 40,
            '2026-11-01' => 40,
            '2027-01-01' => 40,
        ]));
        // Every month plus one more
        $extra = $this->putPlan($data->organization, $project->getKey(), $current->getKey(), $this->body([
            '2026-10-01' => 40,
            '2026-11-01' => 40,
            '2026-12-01' => 40,
            '2027-01-01' => 0,
        ]));
        // The same month twice
        $duplicate = $this->putPlan($data->organization, $project->getKey(), $current->getKey(), ['months' => [
            ['month' => '2026-10-01', 'planned_seconds' => 40 * self::HOUR],
            ['month' => '2026-10-01', 'planned_seconds' => 40 * self::HOUR],
            ['month' => '2026-12-01', 'planned_seconds' => 40 * self::HOUR],
        ]]);
        $empty = $this->putPlan($data->organization, $project->getKey(), $current->getKey(), ['months' => []]);

        // Assert
        $missing->assertStatus(422);
        $missing->assertJsonValidationErrors(['months']);
        $foreign->assertStatus(422);
        $foreign->assertJsonValidationErrors(['months']);
        $extra->assertStatus(422);
        $extra->assertJsonValidationErrors(['months']);
        $duplicate->assertStatus(422);
        $empty->assertStatus(422);
        $empty->assertJsonValidationErrors(['months']);
        $this->assertSame($before, $this->planOf($current));
    }

    public function test_closed_period_is_422(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->quarterlyProject($data->organization);
        $closed = $this->period($project, '2026-07-01');
        $before = $this->planOf($closed);
        $this->actAs($data->user);

        // Act: a balanced plan, still refused
        $response = $this->putPlan($data->organization, $project->getKey(), $closed->getKey(), $this->body([
            '2026-07-01' => 60,
            '2026-08-01' => 40,
            '2026-09-01' => 20,
        ]));

        // Assert
        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['months' => __('profitability.validation.period_closed')]);
        $this->assertSame($before, $this->planOf($closed));
    }

    public function test_upcoming_period_plan_may_be_changed(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Employee);
        $project = $this->quarterlyProject($data->organization);
        $this->assignProjectManager($project, $data->member);
        $upcoming = $this->period($project, '2027-01-01');
        $this->actAs($data->user);

        // Act: nothing in January, the rest later in the quarter (half hours allowed)
        $response = $this->putPlan($data->organization, $project->getKey(), $upcoming->getKey(), ['months' => [
            ['month' => '2027-01-01', 'planned_seconds' => 0],
            ['month' => '2027-02-01', 'planned_seconds' => 59 * self::HOUR + 1800],
            ['month' => '2027-03-01', 'planned_seconds' => 60 * self::HOUR + 1800],
        ]]);

        // Assert
        $response->assertNoContent();
        $this->assertSame([
            '2027-01-01' => 0,
            '2027-02-01' => 59 * self::HOUR + 1800,
            '2027-03-01' => 60 * self::HOUR + 1800,
        ], $this->planOf($upcoming));
    }

    public function test_account_manager_without_project_manager_assignment_gets_404(): void
    {
        // Arrange: the account manager may edit the terms and read the summary, not the plan
        $data = $this->createUserWithRole(Role::Employee);
        $client = Client::factory()->forOrganization($data->organization)->create();
        $project = $this->quarterlyProject($data->organization, $client);
        $this->assignAccountManager($client, $data->member);
        $current = $this->period($project, '2026-10-01');
        $before = $this->planOf($current);
        $this->actAs($data->user);

        // Act
        $response = $this->putPlan($data->organization, $project->getKey(), $current->getKey(), $this->body([
            '2026-10-01' => 60,
            '2026-11-01' => 40,
            '2026-12-01' => 20,
        ]));
        // An invalid body is a 404 too: the body is never looked at outside the scope
        $invalid = $this->putPlan($data->organization, $project->getKey(), $current->getKey(), []);
        $summary = $this->getJson(route('profitability.projects.summary', [
            'organization' => $data->organization->getKey(),
            'project' => $project->getKey(),
        ], false));

        // Assert
        $response->assertNotFound();
        $invalid->assertNotFound();
        $summary->assertOk();
        $this->assertSame($before, $this->planOf($current));
    }

    public function test_employee_gets_404(): void
    {
        // Arrange: an employee who manages another project only
        $data = $this->createUserWithRole(Role::Employee);
        $project = $this->quarterlyProject($data->organization);
        $managed = $this->quarterlyProject($data->organization);
        $this->assignProjectManager($managed, $data->member);
        $current = $this->period($project, '2026-10-01');
        $before = $this->planOf($current);
        $plain = $this->createUserWithRole(Role::Employee);
        $plainProject = $this->quarterlyProject($plain->organization);
        $plainCurrent = $this->period($plainProject, '2026-10-01');
        $body = $this->body(['2026-10-01' => 60, '2026-11-01' => 40, '2026-12-01' => 20]);

        // Act
        $this->actAs($data->user);
        $otherProject = $this->putPlan($data->organization, $project->getKey(), $current->getKey(), $body);
        $this->actAs($plain->user);
        $noAssignment = $this->putPlan($plain->organization, $plainProject->getKey(), $plainCurrent->getKey(), $body);

        // Assert
        $otherProject->assertNotFound();
        $noAssignment->assertNotFound();
        $this->assertSame($before, $this->planOf($current));
    }

    public function test_period_of_another_project_is_404(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->quarterlyProject($data->organization);
        $sibling = $this->quarterlyProject($data->organization);
        $siblingCurrent = $this->period($sibling, '2026-10-01');
        $siblingBefore = $this->planOf($siblingCurrent);
        $withoutContract = Project::factory()->forOrganization($data->organization)->billable()->create();
        $other = $this->createUserWithRole(Role::Owner);
        $otherProject = $this->quarterlyProject($other->organization);
        $otherCurrent = $this->period($otherProject, '2026-10-01');
        $body = $this->body(['2026-10-01' => 60, '2026-11-01' => 40, '2026-12-01' => 20]);
        $this->actAs($data->user);

        // Act
        $siblingPeriod = $this->putPlan($data->organization, $project->getKey(), $siblingCurrent->getKey(), $body);
        $noContract = $this->putPlan($data->organization, $withoutContract->getKey(), $siblingCurrent->getKey(), $body);
        $otherOrganizationPeriod = $this->putPlan($data->organization, $project->getKey(), $otherCurrent->getKey(), $body);
        $otherOrganizationProject = $this->putPlan($data->organization, $otherProject->getKey(), $otherCurrent->getKey(), $body);
        $unknown = $this->putPlan($data->organization, $project->getKey(), '00000000-0000-4000-8000-000000000000', $body);

        // Assert
        $siblingPeriod->assertNotFound();
        $noContract->assertNotFound();
        $otherOrganizationPeriod->assertNotFound();
        $otherOrganizationProject->assertNotFound();
        $unknown->assertNotFound();
        $this->assertSame($siblingBefore, $this->planOf($siblingCurrent));
    }
}
