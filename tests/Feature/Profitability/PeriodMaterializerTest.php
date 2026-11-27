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

    // --- Editing contracts (BUDG-01; D-03, D-04, UI-D9) ---

    public function test_editing_before_start_replaces_the_schedule(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->actAs($data->user);
        $this->putTerms($data->organization, $project->getKey(), $this->terms(['starts_on' => '2027-01-01']))
            ->assertNoContent();
        $contract = $this->contractOf($project);
        $this->assertSame(['2027-01-01'], $this->startsOf($contract));

        // Act: nothing has started, so no apply_to is needed and the schedule may change
        $response = $this->putTerms($data->organization, $project->getKey(), $this->terms([
            'service' => 'Content retainer',
            'schedule' => 'quarterly',
            'starts_on' => '2027-02-01',
            'budget_seconds' => 432000,
            'amount_cents' => 900000,
        ]));

        // Assert
        $response->assertNoContent();
        $contract->refresh();
        $this->assertSame(ContractSchedule::Quarterly, $contract->schedule);
        $this->assertSame('2027-02-01', $contract->starts_on->format('Y-m-d'));
        $this->assertSame('Content retainer', $contract->service);
        $this->assertSame([
            ['starts_on' => '2027-02-01', 'ends_on' => '2027-04-30', 'budget_seconds' => 432000, 'amount_cents' => 900000],
        ], $this->periodsOf($contract));
        $this->assertSame(
            ['2027-02-01' => 144000, '2027-03-01' => 144000, '2027-04-01' => 144000],
            $this->planOf($this->periodStarting($contract, '2027-02-01')),
        );
        // The January period's plan row went with it
        $this->assertSame(3, ContractPeriodMonth::query()->where('organization_id', '=', $data->organization->getKey())->count());
    }

    public function test_apply_to_current_rescales_the_current_plan_and_keeps_closed_periods(): void
    {
        // Arrange: quarterly from July, 120 h per quarter
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->actAs($data->user);
        $quarterly = ['schedule' => 'quarterly', 'starts_on' => '2026-07-01'];
        $this->putTerms($data->organization, $project->getKey(), $this->terms($quarterly + [
            'budget_seconds' => 432000,
            'amount_cents' => 900000,
        ]))->assertNoContent();
        $contract = $this->contractOf($project);
        $current = $this->periodStarting($contract, '2026-10-01');
        // The project manager front-loaded the current quarter: 60 h, 40 h, 20 h
        foreach (['2026-10-01' => 216000, '2026-11-01' => 144000, '2026-12-01' => 72000] as $month => $seconds) {
            ContractPeriodMonth::query()
                ->where('period_id', '=', $current->getKey())
                ->where('month', '=', $month)
                ->update(['planned_seconds' => $seconds]);
        }

        // Act: 60 h per quarter from this period on
        $response = $this->putTerms($data->organization, $project->getKey(), $this->terms($quarterly + [
            'budget_seconds' => 216000,
            'amount_cents' => 450000,
            'apply_to' => 'current_and_following',
        ]));

        // Assert
        $response->assertNoContent();
        $this->assertSame([
            ['starts_on' => '2026-07-01', 'ends_on' => '2026-09-30', 'budget_seconds' => 432000, 'amount_cents' => 900000],
            ['starts_on' => '2026-10-01', 'ends_on' => '2026-12-31', 'budget_seconds' => 216000, 'amount_cents' => 450000],
            ['starts_on' => '2027-01-01', 'ends_on' => '2027-03-31', 'budget_seconds' => 216000, 'amount_cents' => 450000],
        ], $this->periodsOf($contract));
        // Closed: untouched
        $this->assertSame(
            ['2026-07-01' => 144000, '2026-08-01' => 144000, '2026-09-01' => 144000],
            $this->planOf($this->periodStarting($contract, '2026-07-01')),
        );
        // Current: the same 3:2:1 shape, rescaled to 60 h
        $this->assertSame(
            ['2026-10-01' => 108000, '2026-11-01' => 72000, '2026-12-01' => 36000],
            $this->planOf($this->periodStarting($contract, '2026-10-01')),
        );
        // Upcoming: a fresh even plan
        $this->assertSame(
            ['2027-01-01' => 72000, '2027-02-01' => 72000, '2027-03-01' => 72000],
            $this->planOf($this->periodStarting($contract, '2027-01-01')),
        );
        $contract->refresh();
        $this->assertSame(216000, $contract->budget_seconds);
        $this->assertSame(450000, $contract->amount_cents);
    }

    public function test_apply_to_next_period_leaves_the_current_period(): void
    {
        // Arrange: monthly from October: October closed, November current, December upcoming
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->actAs($data->user);
        $this->putTerms($data->organization, $project->getKey(), $this->terms())->assertNoContent();
        $contract = $this->contractOf($project);

        // Act: 20 h per month from December on
        $response = $this->putTerms($data->organization, $project->getKey(), $this->terms([
            'budget_seconds' => 72000,
            'amount_cents' => 150000,
            'apply_to' => 'next_period',
        ]));

        // Assert
        $response->assertNoContent();
        $this->assertSame([
            ['starts_on' => '2026-10-01', 'ends_on' => '2026-10-31', 'budget_seconds' => self::FORTY_HOURS, 'amount_cents' => 300000],
            ['starts_on' => '2026-11-01', 'ends_on' => '2026-11-30', 'budget_seconds' => self::FORTY_HOURS, 'amount_cents' => 300000],
            ['starts_on' => '2026-12-01', 'ends_on' => '2026-12-31', 'budget_seconds' => 72000, 'amount_cents' => 150000],
        ], $this->periodsOf($contract));
        $this->assertSame(['2026-11-01' => self::FORTY_HOURS], $this->planOf($this->periodStarting($contract, '2026-11-01')));
        $this->assertSame(['2026-12-01' => 72000], $this->planOf($this->periodStarting($contract, '2026-12-01')));
        $contract->refresh();
        $this->assertSame(72000, $contract->budget_seconds);
    }

    public function test_apply_to_is_required_once_started(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->actAs($data->user);
        $this->putTerms($data->organization, $project->getKey(), $this->terms())->assertNoContent();
        $contract = $this->contractOf($project);
        $before = $this->periodsOf($contract);

        // Act
        $response = $this->putTerms($data->organization, $project->getKey(), $this->terms([
            'budget_seconds' => 72000,
        ]));

        // Assert
        $response->assertUnprocessable();
        $response->assertJsonValidationErrors(['apply_to']);
        $this->assertSame($before, $this->periodsOf($contract));
        $contract->refresh();
        $this->assertSame(self::FORTY_HOURS, $contract->budget_seconds);
    }

    public function test_schedule_change_after_start_is_rejected(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->actAs($data->user);
        $this->putTerms($data->organization, $project->getKey(), $this->terms())->assertNoContent();
        $contract = $this->contractOf($project);
        $before = $this->periodsOf($contract);

        // Act
        $schedule = $this->putTerms($data->organization, $project->getKey(), $this->terms([
            'schedule' => 'quarterly',
            'apply_to' => 'current_and_following',
        ]));
        $start = $this->putTerms($data->organization, $project->getKey(), $this->terms([
            'starts_on' => '2026-10-15',
            'apply_to' => 'current_and_following',
        ]));

        // Assert
        $schedule->assertUnprocessable();
        $schedule->assertJsonValidationErrors([
            'schedule' => 'The schedule and start date can\'t change once a period has started.',
        ]);
        $start->assertUnprocessable();
        $start->assertJsonValidationErrors(['starts_on']);
        $contract->refresh();
        $this->assertSame(ContractSchedule::Monthly, $contract->schedule);
        $this->assertSame('2026-10-01', $contract->starts_on->format('Y-m-d'));
        $this->assertSame($before, $this->periodsOf($contract));
    }

    public function test_end_date_trims_upcoming_periods(): void
    {
        // Arrange: October closed, November current, December upcoming
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->actAs($data->user);
        $this->putTerms($data->organization, $project->getKey(), $this->terms())->assertNoContent();
        $contract = $this->contractOf($project);

        // Act
        $response = $this->putTerms($data->organization, $project->getKey(), $this->terms([
            'ends_on' => '2026-11-30',
            'apply_to' => 'current_and_following',
        ]));
        $summary = $this->getSummary($data->organization, $project->getKey());

        // Assert
        $response->assertNoContent();
        $this->assertSame([
            ['starts_on' => '2026-10-01', 'ends_on' => '2026-10-31', 'budget_seconds' => self::FORTY_HOURS, 'amount_cents' => 300000],
            ['starts_on' => '2026-11-01', 'ends_on' => '2026-11-30', 'budget_seconds' => self::FORTY_HOURS, 'amount_cents' => 300000],
        ], $this->periodsOf($contract));
        // December's plan row went with it, and a read does not bring the period back
        $this->assertSame(2, ContractPeriodMonth::query()->where('organization_id', '=', $data->organization->getKey())->count());
        $summary->assertOk();
        $summary->assertJsonPath('data.contract.ends_on', '2026-11-30');
        $summary->assertJsonPath('data.periods.*.starts_on', ['2026-11-01', '2026-10-01']);
    }

    public function test_end_date_before_the_current_period_is_rejected(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->actAs($data->user);
        $this->putTerms($data->organization, $project->getKey(), $this->terms())->assertNoContent();
        $contract = $this->contractOf($project);
        $before = $this->periodsOf($contract);

        // Act: the current period starts on 1 November
        $response = $this->putTerms($data->organization, $project->getKey(), $this->terms([
            'ends_on' => '2026-10-31',
            'apply_to' => 'current_and_following',
        ]));

        // Assert
        $response->assertUnprocessable();
        $response->assertJsonValidationErrors([
            'ends_on' => 'The end date can\'t be before the start of the current period.',
        ]);
        $contract->refresh();
        $this->assertNull($contract->ends_on);
        $this->assertSame($before, $this->periodsOf($contract));
    }

    // --- Materializer lifecycle (BUDG-02; D-04, D-18) ---

    public function test_materialization_is_idempotent(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $contract = $this->contract($project, ['starts_on' => '2026-09-01']);

        // Act
        $this->materialize($contract, '2026-11-18');
        $periodIds = ContractPeriod::query()->where('contract_id', '=', $contract->getKey())->orderBy('starts_on')->pluck('id')->all();
        $monthIds = ContractPeriodMonth::query()->whereIn('period_id', $periodIds)->orderBy('month')->pluck('id')->all();
        $this->materialize($contract, '2026-11-18');

        // Assert
        $this->assertSame(['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01'], $this->startsOf($contract));
        $this->assertSame(
            $periodIds,
            ContractPeriod::query()->where('contract_id', '=', $contract->getKey())->orderBy('starts_on')->pluck('id')->all(),
        );
        $this->assertSame(
            $monthIds,
            ContractPeriodMonth::query()->whereIn('period_id', $periodIds)->orderBy('month')->pluck('id')->all(),
        );
        $this->assertCount(4, $monthIds);
    }

    public function test_existing_rows_are_never_duplicated_when_inserted_concurrently(): void
    {
        // Arrange: October and November exist; a concurrent read already inserted December with its own values
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $contract = $this->contract($project, ['starts_on' => '2026-10-01']);
        $this->materialize($contract, '2026-10-20');
        $this->assertSame(['2026-10-01', '2026-11-01'], $this->startsOf($contract));
        ContractPeriod::query()->create([
            'organization_id' => $project->organization_id,
            'contract_id' => $contract->getKey(),
            'starts_on' => '2026-12-01',
            'ends_on' => '2026-12-31',
            'amount_cents' => 1,
            'budget_seconds' => 7200,
        ]);

        // Act
        $this->materialize($contract, '2026-12-05');
        // The unique key turns a second insert of the same start into a no-op
        $duplicate = ContractPeriod::query()->insertOrIgnore([
            'id' => Str::uuid()->toString(),
            'organization_id' => $project->organization_id,
            'contract_id' => $contract->getKey(),
            'starts_on' => '2026-12-01',
            'ends_on' => '2026-12-31',
            'amount_cents' => 300000,
            'budget_seconds' => self::FORTY_HOURS,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Assert
        $this->assertSame(0, $duplicate);
        $this->assertSame([
            ['starts_on' => '2026-10-01', 'ends_on' => '2026-10-31', 'budget_seconds' => self::FORTY_HOURS, 'amount_cents' => 300000],
            ['starts_on' => '2026-11-01', 'ends_on' => '2026-11-30', 'budget_seconds' => self::FORTY_HOURS, 'amount_cents' => 300000],
            ['starts_on' => '2026-12-01', 'ends_on' => '2026-12-31', 'budget_seconds' => 7200, 'amount_cents' => 1],
            ['starts_on' => '2027-01-01', 'ends_on' => '2027-01-31', 'budget_seconds' => self::FORTY_HOURS, 'amount_cents' => 300000],
        ], $this->periodsOf($contract));
        // The existing December row was neither updated nor given plan rows
        $this->assertSame([], $this->planOf($this->periodStarting($contract, '2026-12-01')));
        $this->assertSame(['2027-01-01' => self::FORTY_HOURS], $this->planOf($this->periodStarting($contract, '2027-01-01')));
    }

    public function test_creates_the_current_and_the_next_period_after_a_long_gap(): void
    {
        // Arrange: last read in June
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $contract = $this->contract($project, ['starts_on' => '2026-06-01']);
        $this->materialize($contract, '2026-06-10');
        $this->assertSame(['2026-06-01', '2026-07-01'], $this->startsOf($contract));

        // Act: the next read is in November
        $this->materialize($contract, '2026-11-18');

        // Assert
        $this->assertSame(
            ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01'],
            $this->startsOf($contract),
        );
        foreach ($this->periodsOf($contract) as $period) {
            $this->assertSame(self::FORTY_HOURS, $period['budget_seconds']);
            $this->assertSame(
                [substr($period['starts_on'], 0, 8).'01' => self::FORTY_HOURS],
                $this->planOf($this->periodStarting($contract, $period['starts_on'])),
            );
        }
    }

    public function test_no_period_starts_after_the_end_date(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $midDecember = $this->contract($this->billableProject($data->organization), [
            'starts_on' => '2026-06-01',
            'ends_on' => '2026-12-15',
        ]);
        $endOfNovember = $this->contract($this->billableProject($data->organization), [
            'starts_on' => '2026-06-01',
            'ends_on' => '2026-11-30',
        ]);

        // Act
        $this->materialize($midDecember, '2026-11-18');
        $this->materialize($endOfNovember, '2026-11-18');
        // Long after the end
        $this->materialize($midDecember, '2027-03-01');
        $this->materialize($endOfNovember, '2027-03-01');

        // Assert: December starts on or before 15 December, so it exists (periods are not cut at the end date)
        $this->assertSame(
            ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01'],
            $this->startsOf($midDecember),
        );
        $this->assertSame('2026-12-31', $this->periodsOf($midDecember)[6]['ends_on']);
        $this->assertSame(
            ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'],
            $this->startsOf($endOfNovember),
        );
    }

    public function test_nothing_is_created_while_the_project_is_archived(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $archived = Project::factory()->forOrganization($data->organization)->billable()->archived()->create();
        $neverMaterialized = $this->contract($archived, ['starts_on' => '2026-06-01']);
        $paused = $this->billableProject($data->organization);
        $pausedContract = $this->contract($paused, ['starts_on' => '2026-06-01']);
        $this->materialize($pausedContract, '2026-06-10');
        $paused->archived_at = Carbon::parse('2026-07-15 10:00:00', 'UTC');
        $paused->save();
        $this->actAs($data->user);

        // Act
        $this->materialize($neverMaterialized, '2026-11-18');
        $this->materialize($pausedContract, '2026-11-18');
        $summary = $this->getSummary($data->organization, $archived->getKey());

        // Assert
        $this->assertSame([], $this->startsOf($neverMaterialized));
        $this->assertSame(['2026-06-01', '2026-07-01'], $this->startsOf($pausedContract));
        $summary->assertOk();
        $summary->assertJsonPath('data.contract.archived', true);
        $summary->assertJsonPath('data.periods', []);
        $summary->assertJsonPath('data.period', null);
    }

    public function test_resume_on_skips_the_paused_months(): void
    {
        // Arrange: both contracts were read in June, then paused in July
        $data = $this->createUserWithRole(Role::Owner);
        $fromFirst = $this->contract($this->billableProject($data->organization), ['starts_on' => '2026-06-01']);
        $midMonth = $this->contract($this->billableProject($data->organization), ['starts_on' => '2026-06-01']);
        $this->materialize($fromFirst, '2026-06-10');
        $this->materialize($midMonth, '2026-06-10');
        $fromFirst->paused_on = CarbonImmutable::parse('2026-07-20');
        $fromFirst->resume_on = CarbonImmutable::parse('2026-10-01');
        $fromFirst->save();
        $midMonth->paused_on = CarbonImmutable::parse('2026-07-20');
        $midMonth->resume_on = CarbonImmutable::parse('2026-10-15');
        $midMonth->save();

        // Act
        $this->materialize($fromFirst, '2026-11-18');
        $this->materialize($midMonth, '2026-11-18');

        // Assert: August and September are never back-filled
        $this->assertSame(
            ['2026-06-01', '2026-07-01', '2026-10-01', '2026-11-01', '2026-12-01'],
            $this->startsOf($fromFirst),
        );
        // A resume on the 15th: a stub to the end of October, prorated (17 of 31 days), then full months
        $this->assertSame([
            ['starts_on' => '2026-06-01', 'ends_on' => '2026-06-30', 'budget_seconds' => self::FORTY_HOURS, 'amount_cents' => 300000],
            ['starts_on' => '2026-07-01', 'ends_on' => '2026-07-31', 'budget_seconds' => self::FORTY_HOURS, 'amount_cents' => 300000],
            ['starts_on' => '2026-10-15', 'ends_on' => '2026-10-31', 'budget_seconds' => 79200, 'amount_cents' => 164516],
            ['starts_on' => '2026-11-01', 'ends_on' => '2026-11-30', 'budget_seconds' => self::FORTY_HOURS, 'amount_cents' => 300000],
            ['starts_on' => '2026-12-01', 'ends_on' => '2026-12-31', 'budget_seconds' => self::FORTY_HOURS, 'amount_cents' => 300000],
        ], $this->periodsOf($midMonth));
        $this->assertSame(['2026-10-01' => 79200], $this->planOf($this->periodStarting($midMonth, '2026-10-15')));
    }

    public function test_quarterly_and_annual_grids(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $quarterly = $this->contract($this->billableProject($data->organization), [
            'schedule' => 'quarterly',
            'starts_on' => '2026-01-01',
            'budget_seconds' => 432000,
            'amount_cents' => 900000,
        ]);
        $quarterlyStub = $this->contract($this->billableProject($data->organization), [
            'schedule' => 'quarterly',
            'starts_on' => '2026-11-10',
            'budget_seconds' => 432000,
            'amount_cents' => 900000,
        ]);
        $annual = $this->contract($this->billableProject($data->organization), [
            'schedule' => 'annual',
            'starts_on' => '2025-03-01',
            'budget_seconds' => 1728000,
            'amount_cents' => 3600000,
        ]);

        // Act
        $this->materialize($quarterly, '2026-11-18');
        $this->materialize($quarterlyStub, '2026-11-18');
        $this->materialize($annual, '2026-11-18');

        // Assert
        $this->assertSame([
            ['starts_on' => '2026-01-01', 'ends_on' => '2026-03-31', 'budget_seconds' => 432000, 'amount_cents' => 900000],
            ['starts_on' => '2026-04-01', 'ends_on' => '2026-06-30', 'budget_seconds' => 432000, 'amount_cents' => 900000],
            ['starts_on' => '2026-07-01', 'ends_on' => '2026-09-30', 'budget_seconds' => 432000, 'amount_cents' => 900000],
            ['starts_on' => '2026-10-01', 'ends_on' => '2026-12-31', 'budget_seconds' => 432000, 'amount_cents' => 900000],
            ['starts_on' => '2027-01-01', 'ends_on' => '2027-03-31', 'budget_seconds' => 432000, 'amount_cents' => 900000],
        ], $this->periodsOf($quarterly));
        $this->assertSame(
            ['2026-10-01' => 144000, '2026-11-01' => 144000, '2026-12-01' => 144000],
            $this->planOf($this->periodStarting($quarterly, '2026-10-01')),
        );

        // 10 to 30 November: 21 of 30 days of one month's share (40 h, 3000.00)
        $this->assertSame([
            ['starts_on' => '2026-11-10', 'ends_on' => '2026-11-30', 'budget_seconds' => 100800, 'amount_cents' => 210000],
            ['starts_on' => '2026-12-01', 'ends_on' => '2027-02-28', 'budget_seconds' => 432000, 'amount_cents' => 900000],
        ], $this->periodsOf($quarterlyStub));

        $this->assertSame([
            ['starts_on' => '2025-03-01', 'ends_on' => '2026-02-28', 'budget_seconds' => 1728000, 'amount_cents' => 3600000],
            ['starts_on' => '2026-03-01', 'ends_on' => '2027-02-28', 'budget_seconds' => 1728000, 'amount_cents' => 3600000],
            ['starts_on' => '2027-03-01', 'ends_on' => '2028-02-29', 'budget_seconds' => 1728000, 'amount_cents' => 3600000],
        ], $this->periodsOf($annual));
        $plan = $this->planOf($this->periodStarting($annual, '2026-03-01'));
        $this->assertCount(12, $plan);
        $this->assertSame('2026-03-01', array_key_first($plan));
        $this->assertSame('2027-02-01', array_key_last($plan));
        $this->assertSame([144000], array_values(array_unique($plan)));
    }
}
