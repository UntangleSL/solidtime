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
use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

/**
 * The contract period lifecycle (BUDG-01, BUDG-02, BUDG-04; D-03, D-04, D-18): the summary lists and
 * selects periods, started contracts are edited without touching closed periods, and the lazy
 * materializer renews correctly across gaps, end dates, archives and pauses.
 *
 * "Today" is 2026-11-18 in Europe/Madrid throughout.
 */
#[CoversClass(PeriodMaterializer::class)]
#[CoversClass(ProjectSummaryController::class)]
#[CoversClass(ContractTermsController::class)]
#[CoversClass(ContractPeriod::class)]
#[UsesClass(ContractTermsRequest::class)]
#[UsesClass(ContractSchedule::class)]
#[UsesClass(PeriodBounds::class)]
#[UsesClass(PeriodCalendar::class)]
#[UsesClass(PlanDistributor::class)]
#[UsesClass(ProjectContract::class)]
#[UsesClass(ContractPeriodMonth::class)]
#[UsesClass(ProfitabilityAccess::class)]
#[UsesClass(AccessScope::class)]
#[UsesClass(ConsumptionQuery::class)]
#[UsesClass(ProfitabilityServiceProvider::class)]
class PeriodMaterializerTest extends TestCaseWithDatabase
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
     * Contract terms stored directly, without any period yet.
     *
     * @param  array<string, mixed>  $overrides
     */
    private function contract(Project $project, array $overrides = []): ProjectContract
    {
        /** @var ProjectContract $contract */
        $contract = ProjectContract::query()->create(array_merge([
            'organization_id' => $project->organization_id,
            'project_id' => $project->getKey(),
            'service' => 'SEO retainer',
            'schedule' => 'monthly',
            'starts_on' => '2026-11-01',
            'ends_on' => null,
            'amount_cents' => 300000,
            'budget_seconds' => self::FORTY_HOURS,
        ], $overrides));

        return $contract;
    }

    private function materialize(ProjectContract $contract, string $today): void
    {
        $this->app->make(PeriodMaterializer::class)
            ->ensureThrough($contract, CarbonImmutable::createFromFormat('!Y-m-d', $today, 'UTC') ?: CarbonImmutable::now());
    }

    private function contractOf(Project $project): ProjectContract
    {
        /** @var ProjectContract $contract */
        $contract = ProjectContract::query()->where('project_id', '=', $project->getKey())->firstOrFail();

        return $contract;
    }

    /**
     * @return list<array{starts_on: string, ends_on: string, budget_seconds: int, amount_cents: int}>
     */
    private function periodsOf(ProjectContract $contract): array
    {
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
     * @return list<string>
     */
    private function startsOf(ProjectContract $contract): array
    {
        return array_map(static fn (array $period): string => $period['starts_on'], $this->periodsOf($contract));
    }

    private function periodStarting(ProjectContract $contract, string $startsOn): ContractPeriod
    {
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

    private function workEntry(Member $member, Project $project, string $startUtc, int $seconds): TimeEntry
    {
        return TimeEntry::factory()
            ->forMember($member)
            ->forProject($project)
            ->startWithDuration(Carbon::parse($startUtc, 'UTC'), $seconds)
            ->create(['description' => '']);
    }

    private function getSummary(Organization $organization, string $projectId, ?string $periodId = null): TestResponse
    {
        $parameters = [
            'organization' => $organization->getKey(),
            'project' => $projectId,
        ];
        if ($periodId !== null) {
            $parameters['period'] = $periodId;
        }

        return $this->getJson(route('profitability.projects.summary', $parameters, false));
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
            'starts_on' => '2026-10-01',
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

    // --- Summary: period list and selection (BUDG-04) ---

    public function test_summary_lists_periods_newest_first_and_selects_one(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->contract($project, ['starts_on' => '2026-09-01']);
        // 10 September, 11:00 local
        $this->workEntry($data->member, $project, '2026-09-10 09:00:00', 3600);
        $this->workEntry($data->member, $project, '2026-11-05 09:00:00', 1800);
        $this->actAs($data->user);

        // Act
        $response = $this->getSummary($data->organization, $project->getKey());

        // Assert
        $response->assertOk();
        $response->assertJsonPath('data.periods.*.starts_on', ['2026-12-01', '2026-11-01', '2026-10-01', '2026-09-01']);
        $response->assertJsonPath('data.periods.*.ends_on', ['2026-12-31', '2026-11-30', '2026-10-31', '2026-09-30']);
        $response->assertJsonPath('data.periods.*.state', ['upcoming', 'current', 'closed', 'closed']);
        $response->assertJsonPath('data.period.starts_on', '2026-11-01');
        $response->assertJsonPath('data.period.state', 'current');
        $response->assertJsonPath('data.period.consumed_seconds', 1800);
        $september = $response->json('data.periods.3.id');
        $this->assertIsString($september);

        // Act
        $selected = $this->getSummary($data->organization, $project->getKey(), $september);

        // Assert
        $selected->assertOk();
        $selected->assertJsonPath('data.period.id', $september);
        $selected->assertJsonPath('data.period.starts_on', '2026-09-01');
        $selected->assertJsonPath('data.period.ends_on', '2026-09-30');
        $selected->assertJsonPath('data.period.state', 'closed');
        $selected->assertJsonPath('data.period.budget_seconds', self::FORTY_HOURS);
        $selected->assertJsonPath('data.period.consumed_seconds', 3600);
        $selected->assertJsonPath('data.period.months', [
            ['month' => '2026-09-01', 'planned_seconds' => self::FORTY_HOURS, 'consumed_seconds' => 3600],
        ]);
        // The list is the same whatever period is selected
        $selected->assertJsonPath('data.periods.*.starts_on', ['2026-12-01', '2026-11-01', '2026-10-01', '2026-09-01']);
    }

    public function test_default_period_is_current_then_latest_started_then_first_upcoming(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $running = $this->billableProject($data->organization);
        $this->contract($running, ['starts_on' => '2026-10-01']);
        $ended = $this->billableProject($data->organization);
        $this->contract($ended, ['starts_on' => '2026-06-01', 'ends_on' => '2026-09-30']);
        $future = $this->billableProject($data->organization);
        $futureContract = $this->contract($future, ['starts_on' => '2027-01-01']);
        $this->materialize($futureContract, '2026-11-18');
        // A second upcoming period: the default must still be the first one
        ContractPeriod::query()->create([
            'organization_id' => $future->organization_id,
            'contract_id' => $futureContract->getKey(),
            'starts_on' => '2027-02-01',
            'ends_on' => '2027-02-28',
            'amount_cents' => 300000,
            'budget_seconds' => self::FORTY_HOURS,
        ]);
        $this->actAs($data->user);

        // Act
        $current = $this->getSummary($data->organization, $running->getKey());
        $latestStarted = $this->getSummary($data->organization, $ended->getKey());
        $firstUpcoming = $this->getSummary($data->organization, $future->getKey());

        // Assert
        $current->assertOk();
        $current->assertJsonPath('data.period.starts_on', '2026-11-01');
        $current->assertJsonPath('data.period.state', 'current');

        $latestStarted->assertOk();
        $latestStarted->assertJsonPath('data.periods.*.starts_on', ['2026-09-01', '2026-08-01', '2026-07-01', '2026-06-01']);
        $latestStarted->assertJsonPath('data.period.starts_on', '2026-09-01');
        $latestStarted->assertJsonPath('data.period.state', 'closed');

        $firstUpcoming->assertOk();
        $firstUpcoming->assertJsonPath('data.periods.*.starts_on', ['2027-02-01', '2027-01-01']);
        $firstUpcoming->assertJsonPath('data.period.starts_on', '2027-01-01');
        $firstUpcoming->assertJsonPath('data.period.state', 'upcoming');
    }

    public function test_foreign_period_id_is_404(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->contract($project);
        $sibling = $this->billableProject($data->organization);
        $siblingContract = $this->contract($sibling);
        $this->materialize($siblingContract, '2026-11-18');
        $siblingPeriod = $this->periodStarting($siblingContract, '2026-11-01');
        $withoutContract = $this->billableProject($data->organization);
        $other = $this->createUserWithRole(Role::Owner);
        $otherProject = $this->billableProject($other->organization);
        $otherContract = $this->contract($otherProject);
        $this->materialize($otherContract, '2026-11-18');
        $otherPeriod = $this->periodStarting($otherContract, '2026-11-01');
        $this->actAs($data->user);

        // Act and assert: a period of another contract, of another organization, an unknown or a
        // malformed id, and a period id on a project without contract are all the same 404
        $this->getSummary($data->organization, $project->getKey(), $siblingPeriod->getKey())->assertNotFound();
        $this->getSummary($data->organization, $project->getKey(), $otherPeriod->getKey())->assertNotFound();
        $this->getSummary($data->organization, $project->getKey(), Str::uuid()->toString())->assertNotFound();
        $this->getSummary($data->organization, $project->getKey(), 'not-a-uuid')->assertNotFound();
        $this->getSummary($data->organization, $withoutContract->getKey(), $siblingPeriod->getKey())->assertNotFound();
        $this->getSummary($data->organization, $project->getKey())->assertOk();
    }
}
