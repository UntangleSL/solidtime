<?php

declare(strict_types=1);

namespace Tests\Feature\Profitability;

use App\Enums\Role;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Profitability\Access\AccessScope;
use App\Profitability\Access\ProfitabilityAccess;
use App\Profitability\Enums\ContractSchedule;
use App\Profitability\Http\Controllers\ContractTermsController;
use App\Profitability\Http\Controllers\ProjectSummaryController;
use App\Profitability\Http\Requests\ContractTermsRequest;
use App\Profitability\Models\ContractPeriod;
use App\Profitability\Models\ContractPeriodMonth;
use App\Profitability\Models\ProjectContract;
use App\Profitability\Periods\PeriodBounds;
use App\Profitability\Periods\PeriodCalendar;
use App\Profitability\Periods\PeriodMaterializer;
use App\Profitability\Periods\PlanDistributor;
use App\Profitability\ProfitabilityServiceProvider;
use App\Profitability\Reporting\ConsumptionQuery;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

#[CoversClass(ContractTermsController::class)]
#[CoversClass(ContractTermsRequest::class)]
#[CoversClass(PeriodMaterializer::class)]
#[CoversClass(ProjectSummaryController::class)]
#[UsesClass(ContractSchedule::class)]
#[UsesClass(PeriodBounds::class)]
#[UsesClass(PeriodCalendar::class)]
#[UsesClass(PlanDistributor::class)]
#[UsesClass(ProjectContract::class)]
#[UsesClass(ContractPeriod::class)]
#[UsesClass(ContractPeriodMonth::class)]
#[UsesClass(ProfitabilityAccess::class)]
#[UsesClass(AccessScope::class)]
#[UsesClass(ConsumptionQuery::class)]
#[UsesClass(ProfitabilityServiceProvider::class)]
class ContractTermsTest extends TestCaseWithDatabase
{
    /** 40 hours */
    private const int FORTY_HOURS = 144000;

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

    private function billableProject(Organization $organization): Project
    {
        return Project::factory()->forOrganization($organization)->billable()->create();
    }

    /**
     * createUserWithRole associates the current organization of a non-owner without saving it.
     */
    private function actAs(User $user): void
    {
        $user->save();
        $this->actingAs($user);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function terms(array $overrides = []): array
    {
        return array_merge([
            'service' => 'SEO retainer',
            'schedule' => 'monthly',
            'starts_on' => '2026-11-15',
            'ends_on' => null,
            'budget_seconds' => self::FORTY_HOURS,
            'amount_cents' => 300000,
        ], $overrides);
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function putTerms(Organization $organization, string $projectId, array $body): TestResponse
    {
        return $this->putJson(route('profitability.projects.contract', [
            'organization' => $organization->getKey(),
            'project' => $projectId,
        ], false), $body);
    }

    private function getSummary(Organization $organization, string $projectId): TestResponse
    {
        return $this->getJson(route('profitability.projects.summary', [
            'organization' => $organization->getKey(),
            'project' => $projectId,
        ], false));
    }

    /**
     * @return list<array{starts_on: string, ends_on: string, budget_seconds: int, amount_cents: int}>
     */
    private function periodsOf(Project $project): array
    {
        /** @var ProjectContract $contract */
        $contract = ProjectContract::query()->where('project_id', '=', $project->getKey())->firstOrFail();

        return ContractPeriod::query()
            ->where('contract_id', '=', $contract->getKey())
            ->orderBy('starts_on')
            ->get()
            ->map(fn (ContractPeriod $period): array => [
                'starts_on' => $period->starts_on->format('Y-m-d'),
                'ends_on' => $period->ends_on->format('Y-m-d'),
                'budget_seconds' => $period->budget_seconds,
                'amount_cents' => $period->amount_cents,
            ])
            ->values()
            ->all();
    }

    /**
     * @return array<string, int>
     */
    private function planOf(Project $project, string $startsOn): array
    {
        /** @var ProjectContract $contract */
        $contract = ProjectContract::query()->where('project_id', '=', $project->getKey())->firstOrFail();
        /** @var ContractPeriod $period */
        $period = ContractPeriod::query()
            ->where('contract_id', '=', $contract->getKey())
            ->where('starts_on', '=', $startsOn)
            ->firstOrFail();

        $plan = [];
        foreach (ContractPeriodMonth::query()->where('period_id', '=', $period->getKey())->orderBy('month')->get() as $month) {
            $plan[$month->month->format('Y-m-d')] = $month->planned_seconds;
        }

        return $plan;
    }

    public function test_owner_sets_monthly_terms_and_the_summary_shows_the_stub_period_with_an_even_plan(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->actAs($data->user);

        // Act
        $response = $this->putTerms($data->organization, $project->getKey(), $this->terms());
        $summary = $this->getSummary($data->organization, $project->getKey());

        // Assert
        $response->assertNoContent();
        // Stub 15-30 Nov: 16 of 30 days of 40 h = 21.33 h, nearest half hour 21.5 h; 16/30 of 3000.00
        $this->assertSame([
            ['starts_on' => '2026-11-15', 'ends_on' => '2026-11-30', 'budget_seconds' => 77400, 'amount_cents' => 160000],
            ['starts_on' => '2026-12-01', 'ends_on' => '2026-12-31', 'budget_seconds' => self::FORTY_HOURS, 'amount_cents' => 300000],
        ], $this->periodsOf($project));
        $this->assertSame(['2026-11-01' => 77400], $this->planOf($project, '2026-11-15'));
        $this->assertSame(['2026-12-01' => self::FORTY_HOURS], $this->planOf($project, '2026-12-01'));
        $this->assertDatabaseHas('projects', ['id' => $project->getKey(), 'estimated_time' => $project->estimated_time]);

        $summary->assertOk();
        $summary->assertJsonPath('data.contract.service', 'SEO retainer');
        $summary->assertJsonPath('data.contract.schedule', 'monthly');
        $summary->assertJsonPath('data.contract.starts_on', '2026-11-15');
        $summary->assertJsonPath('data.period.starts_on', '2026-11-15');
        $summary->assertJsonPath('data.period.ends_on', '2026-11-30');
        $summary->assertJsonPath('data.period.budget_seconds', 77400);
        $summary->assertJsonPath('data.period.months', [
            ['month' => '2026-11-01', 'planned_seconds' => 77400, 'consumed_seconds' => 0],
        ]);
    }

    public function test_first_period_values_override_the_proration(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->actAs($data->user);

        // Act
        $response = $this->putTerms($data->organization, $project->getKey(), $this->terms([
            'first_period_budget_seconds' => 90000,
            'first_period_amount_cents' => 175000,
        ]));

        // Assert
        $response->assertNoContent();
        $periods = $this->periodsOf($project);
        $this->assertSame(
            ['starts_on' => '2026-11-15', 'ends_on' => '2026-11-30', 'budget_seconds' => 90000, 'amount_cents' => 175000],
            $periods[0],
        );
        $this->assertSame(['2026-11-01' => 90000], $this->planOf($project, '2026-11-15'));
        // The following periods keep the template terms
        $this->assertSame(self::FORTY_HOURS, $periods[1]['budget_seconds']);
        $this->assertSame(300000, $periods[1]['amount_cents']);
    }

    public function test_one_off_requires_an_end_date(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->actAs($data->user);

        // Act
        $response = $this->putTerms($data->organization, $project->getKey(), $this->terms([
            'schedule' => 'one_off',
            'ends_on' => null,
        ]));

        // Assert
        $response->assertUnprocessable();
        $response->assertJsonValidationErrors(['ends_on' => 'A one-off contract needs an end date.']);
        $this->assertDatabaseMissing('project_contracts', ['project_id' => $project->getKey()]);
    }

    public function test_end_date_must_be_after_start(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->actAs($data->user);

        // Act
        $response = $this->putTerms($data->organization, $project->getKey(), $this->terms([
            'ends_on' => '2026-11-15',
        ]));

        // Assert
        $response->assertUnprocessable();
        $response->assertJsonValidationErrors(['ends_on' => 'The end date must be after the start date.']);
        $this->assertDatabaseMissing('project_contracts', ['project_id' => $project->getKey()]);
    }

    public function test_non_billable_project_is_rejected(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = Project::factory()->forOrganization($data->organization)->create(['is_billable' => false]);
        $this->actAs($data->user);

        // Act
        $response = $this->putTerms($data->organization, $project->getKey(), $this->terms());

        // Assert
        $response->assertUnprocessable();
        $response->assertJsonValidationErrors(['project']);
        $this->assertDatabaseMissing('project_contracts', ['project_id' => $project->getKey()]);
    }

    public function test_employee_and_manager_get_404(): void
    {
        foreach ([Role::Employee, Role::Manager] as $role) {
            // Arrange
            $data = $this->createUserWithRole($role);
            $project = $this->billableProject($data->organization);
            $this->actAs($data->user);

            // Act
            $response = $this->putTerms($data->organization, $project->getKey(), $this->terms());

            // Assert
            $response->assertNotFound();
            $this->assertDatabaseMissing('project_contracts', ['project_id' => $project->getKey()]);
        }
    }

    public function test_admin_may_set_terms(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Admin);
        $project = $this->billableProject($data->organization);
        $this->actAs($data->user);

        // Act
        $response = $this->putTerms($data->organization, $project->getKey(), $this->terms([
            'starts_on' => '2026-11-01',
        ]));

        // Assert
        $response->assertNoContent();
        $this->assertSame([
            ['starts_on' => '2026-11-01', 'ends_on' => '2026-11-30', 'budget_seconds' => self::FORTY_HOURS, 'amount_cents' => 300000],
            ['starts_on' => '2026-12-01', 'ends_on' => '2026-12-31', 'budget_seconds' => self::FORTY_HOURS, 'amount_cents' => 300000],
        ], $this->periodsOf($project));
        $this->assertDatabaseHas('project_contracts', [
            'organization_id' => $data->organization->getKey(),
            'project_id' => $project->getKey(),
            'schedule' => 'monthly',
        ]);
    }

    public function test_existing_terms_are_not_replaced(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->actAs($data->user);
        $this->putTerms($data->organization, $project->getKey(), $this->terms())->assertNoContent();

        // Act: the contract has started, so an edit must say which periods it changes (08-08)
        $response = $this->putTerms($data->organization, $project->getKey(), $this->terms([
            'budget_seconds' => 36000,
        ]));

        // Assert
        $response->assertUnprocessable();
        $response->assertJsonValidationErrors(['apply_to']);
        $this->assertSame(77400, $this->periodsOf($project)[0]['budget_seconds']);
    }

    public function test_quarterly_terms_from_the_first_create_a_three_month_period_with_three_plan_rows(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->actAs($data->user);

        // Act
        $response = $this->putTerms($data->organization, $project->getKey(), $this->terms([
            'schedule' => 'quarterly',
            'starts_on' => '2026-11-01',
            'budget_seconds' => 432000,
            'amount_cents' => 900000,
        ]));
        $summary = $this->getSummary($data->organization, $project->getKey());

        // Assert
        $response->assertNoContent();
        $this->assertSame([
            ['starts_on' => '2026-11-01', 'ends_on' => '2027-01-31', 'budget_seconds' => 432000, 'amount_cents' => 900000],
            ['starts_on' => '2027-02-01', 'ends_on' => '2027-04-30', 'budget_seconds' => 432000, 'amount_cents' => 900000],
        ], $this->periodsOf($project));
        $this->assertSame(
            ['2026-11-01' => 144000, '2026-12-01' => 144000, '2027-01-01' => 144000],
            $this->planOf($project, '2026-11-01'),
        );
        $summary->assertOk();
        $summary->assertJsonPath('data.period.months.*.month', ['2026-11-01', '2026-12-01', '2027-01-01']);
        $summary->assertJsonPath('data.period.months.*.planned_seconds', [144000, 144000, 144000]);
    }
}
