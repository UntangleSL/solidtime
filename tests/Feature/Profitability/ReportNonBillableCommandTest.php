<?php

declare(strict_types=1);

namespace Tests\Feature\Profitability;

use App\Models\Member;
use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Profitability\Console\ReportNonBillableCommand;
use App\Profitability\ProfitabilityServiceProvider;
use App\Profitability\TimeEntries\EnforceBillableOnBillableProject;
use App\Profitability\TimeEntries\LegacyNonBillableQuery;
use Illuminate\Support\Carbon;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

/**
 * D-05: legacy non-billable work time on billable projects is reported, read-only.
 */
#[CoversClass(ReportNonBillableCommand::class)]
#[CoversClass(LegacyNonBillableQuery::class)]
#[UsesClass(EnforceBillableOnBillableProject::class)]
#[UsesClass(ProfitabilityServiceProvider::class)]
class ReportNonBillableCommandTest extends TestCaseWithDatabase
{
    private Organization $organizationA;

    private Organization $organizationB;

    private Project $projectOne;

    private Project $projectTwo;

    private Project $projectB;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow('2026-11-18 10:00:00');

        $this->organizationA = Organization::factory()->create();
        $this->organizationB = Organization::factory()->create();
        $memberA = Member::factory()->forOrganization($this->organizationA)->create();
        $memberB = Member::factory()->forOrganization($this->organizationB)->create();
        $this->projectOne = Project::factory()->forOrganization($this->organizationA)->billable(5000)->create();
        $this->projectTwo = Project::factory()->forOrganization($this->organizationA)->billable(6000)->create();
        $this->projectB = Project::factory()->forOrganization($this->organizationB)->billable(7000)->create();
        $nonBillableProject = Project::factory()->forOrganization($this->organizationA)->create();

        // Project one: a legacy entry (1 h) and an imported one (30 min), 2 entries, 1.5 h
        $this->legacy($memberA, $this->projectOne, '2026-11-02 09:00:00', 3600);
        TimeEntry::factory()->forMember($memberA)->forProject($this->projectOne)->notBillable()
            ->startWithDuration(Carbon::parse('2026-11-03 09:00:00'), 1800)->create(['is_imported' => true]);
        // Project two: a legacy entry (2 h) and a running legacy entry (30 min up to now), 2 entries, 2.5 h
        $this->legacy($memberA, $this->projectTwo, '2026-11-04 09:00:00', 7200);
        $this->legacy($memberA, $this->projectTwo, '2026-11-18 09:30:00', null);
        // Organization B: one legacy entry (1 h)
        $this->legacy($memberB, $this->projectB, '2026-11-05 09:00:00', 3600);

        // Controls that never count: a billable entry, a non-billable project, a break
        TimeEntry::factory()->forMember($memberA)->forProject($this->projectOne)->billable()
            ->startWithDuration(Carbon::parse('2026-11-06 09:00:00'), 3600)->create();
        $this->legacy($memberA, $nonBillableProject, '2026-11-07 09:00:00', 3600);
        /** @var TimeEntry $break */
        $break = TimeEntry::factory()->forMember($memberA)->forProject($this->projectOne)->isBreak()
            ->startWithDuration(Carbon::parse('2026-11-08 09:00:00'), 3600)->make(['description' => '']);
        $break->saveQuietly();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_the_report_prints_the_counts_and_one_line_per_project(): void
    {
        // Act and assert
        $this->artisan('profitability:report-nonbillable')
            ->expectsOutput('organizations: 2')
            ->expectsOutput('projects: 3')
            ->expectsOutput('entries: 5')
            ->expectsOutput('hours: 5.0')
            ->expectsOutput('project '.$this->projectOne->getKey().' 2 1.5')
            ->expectsOutput('project '.$this->projectTwo->getKey().' 2 2.5')
            ->expectsOutput('project '.$this->projectB->getKey().' 1 1.0')
            ->assertExitCode(0)
            ->run();
    }

    public function test_the_report_changes_no_row(): void
    {
        // Arrange
        $before = $this->snapshot();

        // Act
        $this->artisan('profitability:report-nonbillable')->assertExitCode(0)->run();

        // Assert
        $this->assertSame($before, $this->snapshot());
        $this->assertSame(8, count($before));
    }

    public function test_the_organization_option_limits_the_report(): void
    {
        // Act and assert
        $this->artisan('profitability:report-nonbillable', ['--organization' => $this->organizationB->getKey()])
            ->expectsOutput('organizations: 1')
            ->expectsOutput('projects: 1')
            ->expectsOutput('entries: 1')
            ->expectsOutput('hours: 1.0')
            ->expectsOutput('project '.$this->projectB->getKey().' 1 1.0')
            ->doesntExpectOutput('project '.$this->projectOne->getKey().' 2 1.5')
            ->assertExitCode(0)
            ->run();
    }

    public function test_seconds_for_sums_an_organization_and_its_projects(): void
    {
        // Arrange
        $query = new LegacyNonBillableQuery;

        // Act and assert
        $this->assertSame(14400, $query->secondsFor($this->organizationA->getKey()));
        $this->assertSame(5400, $query->secondsFor($this->organizationA->getKey(), [$this->projectOne->getKey()]));
        $this->assertSame(0, $query->secondsFor($this->organizationA->getKey(), []));
        $this->assertSame(0, $query->secondsFor($this->organizationA->getKey(), [$this->projectB->getKey()]));
        $this->assertSame(3600, $query->secondsFor($this->organizationB->getKey()));
    }

    /**
     * A non-billable entry written without model events, as it was stored before D-05.
     */
    private function legacy(Member $member, Project $project, string $start, ?int $seconds): void
    {
        $factory = TimeEntry::factory()->forMember($member)->forProject($project)->notBillable();
        $factory = $seconds === null
            ? $factory->start(Carbon::parse($start))->state(['end' => null])
            : $factory->startWithDuration(Carbon::parse($start), $seconds);
        /** @var TimeEntry $entry */
        $entry = $factory->make(['description' => '']);
        $entry->saveQuietly();
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function snapshot(): array
    {
        return TimeEntry::query()
            ->orderBy('id')
            ->get(['id', 'billable', 'billable_rate', 'updated_at'])
            ->map(fn (TimeEntry $entry): array => [
                'id' => $entry->getKey(),
                'billable' => $entry->billable,
                'billable_rate' => $entry->billable_rate,
                'updated_at' => $entry->updated_at?->toIso8601String(),
            ])
            ->all();
    }
}
