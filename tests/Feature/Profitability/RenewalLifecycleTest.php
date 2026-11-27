<?php

declare(strict_types=1);

namespace Tests\Feature\Profitability;

use App\Enums\Role;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Profitability\Access\AccessScope;
use App\Profitability\Access\ProfitabilityAccess;
use App\Profitability\Console\RenewPeriodsCommand;
use App\Profitability\Enums\ContractSchedule;
use App\Profitability\Http\Controllers\ProjectSummaryController;
use App\Profitability\Models\ContractPeriod;
use App\Profitability\Models\ContractPeriodMonth;
use App\Profitability\Models\ProjectContract;
use App\Profitability\Periods\PeriodBounds;
use App\Profitability\Periods\PeriodCalendar;
use App\Profitability\Periods\PeriodMaterializer;
use App\Profitability\Periods\PlanDistributor;
use App\Profitability\Periods\RecordRenewalPause;
use App\Profitability\ProfitabilityServiceProvider;
use App\Profitability\Reporting\ConsumptionQuery;
use Carbon\CarbonImmutable;
use Illuminate\Console\Scheduling\Event;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use Laravel\Passport\Passport;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

/**
 * The renewal lifecycle (BUDG-02, D-04, D-18): a daily safety-net command scheduled from the fork
 * provider creates the periods that became due, idempotently, and skips archived projects; archiving a
 * project pauses renewal and un-archiving resumes it from the current month without back-filling.
 */
#[CoversClass(RenewPeriodsCommand::class)]
#[CoversClass(ProfitabilityServiceProvider::class)]
#[CoversClass(RecordRenewalPause::class)]
#[UsesClass(ProjectSummaryController::class)]
#[UsesClass(ProfitabilityAccess::class)]
#[UsesClass(AccessScope::class)]
#[UsesClass(PeriodMaterializer::class)]
#[UsesClass(PeriodCalendar::class)]
#[UsesClass(PeriodBounds::class)]
#[UsesClass(PlanDistributor::class)]
#[UsesClass(ContractSchedule::class)]
#[UsesClass(ProjectContract::class)]
#[UsesClass(ContractPeriod::class)]
#[UsesClass(ContractPeriodMonth::class)]
#[UsesClass(ConsumptionQuery::class)]
class RenewalLifecycleTest extends TestCaseWithDatabase
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
     * A monthly contract from 2026-11-01 (or $startsOn), without any period yet.
     */
    private function monthlyContract(Project $project, string $startsOn = '2026-11-01'): ProjectContract
    {
        /** @var ProjectContract $contract */
        $contract = ProjectContract::query()->create([
            'organization_id' => $project->organization_id,
            'project_id' => $project->getKey(),
            'service' => 'SEO retainer',
            'schedule' => 'monthly',
            'starts_on' => $startsOn,
            'ends_on' => null,
            'amount_cents' => 300000,
            'budget_seconds' => self::FORTY_HOURS,
        ]);

        return $contract;
    }

    private function materialize(ProjectContract $contract, string $today): void
    {
        $this->app->make(PeriodMaterializer::class)
            ->ensureThrough($contract, CarbonImmutable::createFromFormat('!Y-m-d', $today, 'UTC') ?: CarbonImmutable::now());
    }

    /**
     * @return list<string>
     */
    private function startsOf(ProjectContract $contract): array
    {
        return array_values(ContractPeriod::query()
            ->where('contract_id', '=', $contract->getKey())
            ->orderBy('starts_on')
            ->get()
            ->map(static fn (ContractPeriod $period): string => $period->starts_on->format('Y-m-d'))
            ->all());
    }

    /**
     * The renewal events of a freshly built Schedule: the provider may have resolved the singleton during
     * boot already.
     *
     * @return list<Event>
     */
    private function renewalEvents(): array
    {
        $this->app->forgetInstance(Schedule::class);
        $events = array_filter(
            app(Schedule::class)->events(),
            fn (Event $event): bool => is_string($event->command) && str_ends_with($event->command, 'profitability:renew-periods'),
        );

        return array_values($events);
    }

    /**
     * Archives or un-archives the project the way the app does: core's API project update.
     */
    private function setArchived(User $user, Project $project, bool $archived): TestResponse
    {
        Passport::actingAs($user);

        return $this->putJson(route('api.v1.projects.update', [$project->organization_id, $project->getKey()]), [
            'name' => $project->name,
            'color' => $project->color,
            'client_id' => null,
            'is_billable' => true,
            'is_archived' => $archived,
        ]);
    }

    private function readSummary(User $user, Project $project): TestResponse
    {
        $this->actingAs($user, 'web');

        return $this->getJson(route('profitability.projects.summary', [
            'organization' => $project->organization_id,
            'project' => $project->getKey(),
        ], false));
    }

    private function fresh(ProjectContract $contract): ProjectContract
    {
        /** @var ProjectContract $fresh */
        $fresh = ProjectContract::query()->whereKey($contract->getKey())->firstOrFail();

        return $fresh;
    }

    private function plannedIn(ProjectContract $contract, string $month): ?int
    {
        $value = ContractPeriodMonth::query()
            ->whereIn('period_id', ContractPeriod::query()->where('contract_id', '=', $contract->getKey())->select('id'))
            ->where('month', '=', $month)
            ->value('planned_seconds');

        return is_numeric($value) ? (int) $value : null;
    }

    // --- Daily safety net (D-04) ---

    public function test_renewal_is_scheduled_daily_in_the_profitability_timezone(): void
    {
        // Act
        $events = $this->renewalEvents();

        // Assert: one event, every day at 04:30 Madrid time, never two runs at once
        $this->assertCount(1, $events);
        $event = $events[0];
        $this->assertSame('30 4 * * *', $event->expression);
        $timezone = $event->timezone instanceof \DateTimeZone ? $event->timezone->getName() : $event->timezone;
        $this->assertSame('Europe/Madrid', $timezone);
        $this->assertTrue($event->withoutOverlapping);
    }

    public function test_command_creates_the_period_that_became_due(): void
    {
        // Arrange: read on 2026-11-18 (November and December exist), then nobody reads until December
        $organization = Organization::factory()->create();
        $contract = $this->monthlyContract($this->billableProject($organization));
        $this->materialize($contract, '2026-11-18');
        $this->assertSame(['2026-11-01', '2026-12-01'], $this->startsOf($contract));
        // 2026-12-02 05:30 in Europe/Madrid
        Carbon::setTestNow('2026-12-02 04:30:00');

        // Act
        $this->artisan('profitability:renew-periods')
            ->expectsOutput('contracts: 1')
            ->expectsOutput('created: 1')
            ->assertExitCode(0)
            ->run();

        // Assert: January is now the upcoming period, with its even plan
        $this->assertSame(['2026-11-01', '2026-12-01', '2027-01-01'], $this->startsOf($contract));
        $january = ContractPeriod::query()
            ->where('contract_id', '=', $contract->getKey())
            ->where('starts_on', '=', '2027-01-01')
            ->firstOrFail();
        $this->assertSame([self::FORTY_HOURS], array_values($january->months()->pluck('planned_seconds')->all()));
    }

    public function test_command_is_idempotent(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $contract = $this->monthlyContract($this->billableProject($organization));
        $this->materialize($contract, '2026-11-18');
        Carbon::setTestNow('2026-12-02 04:30:00');
        $this->artisan('profitability:renew-periods')->expectsOutput('created: 1')->assertExitCode(0)->run();
        $monthsBefore = ContractPeriodMonth::query()->count();

        // Act
        $this->artisan('profitability:renew-periods')
            ->expectsOutput('contracts: 1')
            ->expectsOutput('created: 0')
            ->assertExitCode(0)
            ->run();

        // Assert
        $this->assertSame(['2026-11-01', '2026-12-01', '2027-01-01'], $this->startsOf($contract));
        $this->assertSame($monthsBefore, ContractPeriodMonth::query()->count());
    }

    public function test_dry_run_writes_nothing(): void
    {
        // Arrange: a contract never read and one read in November
        $organization = Organization::factory()->create();
        $neverRead = $this->monthlyContract($this->billableProject($organization));
        $read = $this->monthlyContract($this->billableProject($organization));
        $this->materialize($read, '2026-11-18');
        Carbon::setTestNow('2026-12-02 04:30:00');

        // Act
        $this->artisan('profitability:renew-periods', ['--dry-run' => true])
            ->expectsOutput('contracts: 2')
            ->expectsOutput('dry-run: nothing written')
            ->doesntExpectOutput('created: 2')
            ->assertExitCode(0)
            ->run();

        // Assert
        $this->assertSame([], $this->startsOf($neverRead));
        $this->assertSame(['2026-11-01', '2026-12-01'], $this->startsOf($read));
    }

    public function test_archived_projects_are_skipped(): void
    {
        // Arrange: an active contract and a contract of an archived project, neither read yet
        $organization = Organization::factory()->create();
        $active = $this->monthlyContract($this->billableProject($organization));
        $archivedProject = Project::factory()->forOrganization($organization)->billable()->archived()->create();
        $archived = $this->monthlyContract($archivedProject);

        // Act
        $this->artisan('profitability:renew-periods')
            ->expectsOutput('contracts: 1')
            ->expectsOutput('created: 2')
            ->assertExitCode(0)
            ->run();

        // Assert
        $this->assertSame(['2026-11-01', '2026-12-01'], $this->startsOf($active));
        $this->assertSame([], $this->startsOf($archived));
    }

    // --- Archive pauses, un-archive resumes (D-18) ---

    public function test_archiving_pauses_and_removes_not_started_periods(): void
    {
        // Arrange: October and November have started, December is upcoming
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $contract = $this->monthlyContract($project, '2026-10-01');
        $this->materialize($contract, '2026-11-18');
        $this->assertSame(['2026-10-01', '2026-11-01', '2026-12-01'], $this->startsOf($contract));

        // Act
        $response = $this->setArchived($data->user, $project, true);
        $summary = $this->readSummary($data->user, $project);

        // Assert: December is gone, the started periods and their plans stay, and a read creates nothing
        $response->assertOk();
        $this->assertSame(['2026-10-01', '2026-11-01'], $this->startsOf($contract));
        $this->assertSame('2026-11-18', $this->fresh($contract)->paused_on?->format('Y-m-d'));
        $this->assertNull($this->fresh($contract)->resume_on);
        $this->assertSame(self::FORTY_HOURS, $this->plannedIn($contract, '2026-11-01'));
        $this->assertNull($this->plannedIn($contract, '2026-12-01'));
        $summary->assertOk();
        $summary->assertJsonPath('data.contract.archived', true);
        $summary->assertJsonPath('data.periods.*.starts_on', ['2026-11-01', '2026-10-01']);
        $this->assertSame(['2026-10-01', '2026-11-01'], $this->startsOf($contract));

        // Act: archiving an archived project again (a new timestamp) changes nothing
        Carbon::setTestNow('2026-12-10 10:00:00');
        $again = $this->setArchived($data->user, $project, true);

        // Assert
        $again->assertOk();
        $this->assertSame('2026-11-18', $this->fresh($contract)->paused_on?->format('Y-m-d'));
        $this->assertSame(['2026-10-01', '2026-11-01'], $this->startsOf($contract));
    }

    public function test_unarchiving_resumes_from_the_current_month_without_back_filling(): void
    {
        // Arrange: archived on 2026-11-18 (December removed)
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $contract = $this->monthlyContract($project, '2026-10-01');
        $this->materialize($contract, '2026-11-18');
        $this->setArchived($data->user, $project, true)->assertOk();
        // 2027-02-10 11:00 in Europe/Madrid
        Carbon::setTestNow('2027-02-10 10:00:00');

        // Act
        $response = $this->setArchived($data->user, $project, false);
        $resumed = $this->fresh($contract);
        $summary = $this->readSummary($data->user, $project);

        // Assert: resume from February; December and January are never back-filled
        $response->assertOk();
        $this->assertSame('2027-02-01', $resumed->resume_on?->format('Y-m-d'));
        $this->assertNull($resumed->paused_on);
        $summary->assertOk();
        $summary->assertJsonPath('data.contract.archived', false);
        $summary->assertJsonPath('data.period.starts_on', '2027-02-01');
        $summary->assertJsonPath('data.period.state', 'current');
        $this->assertSame(['2026-10-01', '2026-11-01', '2027-02-01', '2027-03-01'], $this->startsOf($contract));
    }

    public function test_project_without_contract_is_ignored(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $other = $this->billableProject($data->organization);
        $otherContract = $this->monthlyContract($other, '2026-10-01');
        $this->materialize($otherContract, '2026-11-18');

        // Act
        $archive = $this->setArchived($data->user, $project, true);
        Carbon::setTestNow('2027-02-10 10:00:00');
        $unarchive = $this->setArchived($data->user, $project, false);

        // Assert: no contract appears and the other project's contract is untouched
        $archive->assertOk();
        $unarchive->assertOk();
        $this->assertSame(0, ProjectContract::query()->where('project_id', '=', $project->getKey())->count());
        $this->assertNull($this->fresh($otherContract)->paused_on);
        $this->assertNull($this->fresh($otherContract)->resume_on);
        $this->assertSame(['2026-10-01', '2026-11-01', '2026-12-01'], $this->startsOf($otherContract));
    }
}
