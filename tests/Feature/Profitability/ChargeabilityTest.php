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
use App\Profitability\Http\Controllers\PeopleViewController;
use App\Profitability\Models\AbsenceProject;
use App\Profitability\Models\MemberWorkWeek;
use App\Profitability\ProfitabilityServiceProvider;
use App\Profitability\Reporting\AvailableHoursCalculator;
use App\Profitability\Reporting\ChargeabilityQuery;
use App\Profitability\Reporting\ChargeabilityService;
use App\Profitability\Reporting\ConsumptionQuery;
use App\Profitability\Reporting\ReportRange;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

#[CoversClass(PeopleViewController::class)]
#[CoversClass(ChargeabilityService::class)]
#[CoversClass(ChargeabilityQuery::class)]
#[UsesClass(AvailableHoursCalculator::class)]
#[UsesClass(ReportRange::class)]
#[UsesClass(MemberWorkWeek::class)]
#[UsesClass(AbsenceProject::class)]
#[UsesClass(ProfitabilityAccess::class)]
#[UsesClass(AccessScope::class)]
#[UsesClass(ConsumptionQuery::class)]
#[UsesClass(ProfitabilityServiceProvider::class)]
class ChargeabilityTest extends TestCaseWithDatabase
{
    private const int HOUR = 3600;

    protected function setUp(): void
    {
        parent::setUp();
        // Monday 30 November 2026, 11:00 in Madrid: This month is 1-30 Nov with 21 weekdays
        Carbon::setTestNow('2026-11-30 10:00:00');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    /**
     * createUserWithRole associates the current organization of a non-owner without saving it.
     */
    private function actAs(User $user): void
    {
        $user->save();
        $this->actingAs($user);
    }

    private function getPeople(Organization $organization, ?string $range = null): TestResponse
    {
        $parameters = ['organization' => $organization->getKey()];
        if ($range !== null) {
            $parameters['range'] = $range;
        }

        return $this->getJson(route('profitability.views.people', $parameters, false));
    }

    private function workWeek(Member $member, string $effectiveFrom, int $weeklyHours, int $targetPercent): MemberWorkWeek
    {
        return MemberWorkWeek::query()->create([
            'organization_id' => $member->organization_id,
            'member_id' => $member->getKey(),
            'effective_from' => $effectiveFrom,
            'weekly_seconds' => $weeklyHours * self::HOUR,
            'chargeability_target_percent' => $targetPercent,
        ]);
    }

    private function absenceProject(Organization $organization): Project
    {
        $project = Project::factory()->forOrganization($organization)->create(['is_billable' => false]);
        $marker = new AbsenceProject(['project_id' => $project->getKey()]);
        $marker->forceFill(['organization_id' => $organization->getKey()])->save();

        return $project;
    }

    private function entry(Member $member, ?Project $project, string $startUtc, int $seconds, bool $billable): TimeEntry
    {
        return TimeEntry::factory()
            ->forMember($member)
            ->forProject($project)
            ->startWithDuration(Carbon::parse($startUtc, 'UTC'), $seconds)
            ->create(['description' => '', 'billable' => $billable]);
    }

    /**
     * $count entries of $hoursEach on consecutive days from 2 November, 08:00 UTC.
     */
    private function entries(Member $member, ?Project $project, int $count, int $hoursEach, bool $billable): void
    {
        for ($i = 0; $i < $count; $i++) {
            $day = Carbon::parse('2026-11-02 08:00:00', 'UTC')->addDays($i);
            $this->entry($member, $project, $day->format('Y-m-d H:i:s'), $hoursEach * self::HOUR, $billable);
        }
    }

    /**
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<string, mixed>
     */
    private function rowOf(array $rows, string $memberId): array
    {
        foreach ($rows as $row) {
            if ($row['member_id'] === $memberId) {
                return $row;
            }
        }
        $this->fail('Member '.$memberId.' is not in the people view');
    }

    /**
     * @return array<string, mixed>
     */
    private function personOf(TestResponse $response, string $memberId): array
    {
        /** @var array<int, array<string, mixed>> $rows */
        $rows = $response->json('data');

        return $this->rowOf($rows, $memberId);
    }

    public function test_chargeability_is_billable_over_available_minus_absence(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $this->workWeek($data->member, '2026-01-01', 40, 75);
        $client = Project::factory()->forOrganization($data->organization)->billable()->create();
        $internal = Project::factory()->forOrganization($data->organization)->create(['is_billable' => false]);
        $absence = $this->absenceProject($data->organization);
        // 10 h on the absence project, flagged billable: still absence, never billable
        $this->entry($data->member, $absence, '2026-11-20 08:00:00', 10 * self::HOUR, true);
        $this->entries($data->member, $client, 10, 10, true);
        $this->entry($data->member, $internal, '2026-11-23 08:00:00', 12 * self::HOUR, false);
        $this->entry($data->member, null, '2026-11-24 08:00:00', 8 * self::HOUR, false);
        $this->actAs($data->user);

        // Act
        $response = $this->getPeople($data->organization, 'this_month');

        // Assert
        $response->assertOk();
        $response->assertJsonPath('meta.range', [
            'key' => 'this_month',
            'from' => '2026-11-01',
            'to' => '2026-11-30',
            'capped_to' => '2026-11-30',
            'contains_today' => true,
        ]);
        $person = $this->personOf($response, $data->member->getKey());
        $this->assertSame(40 * self::HOUR, $person['weekly_seconds']);
        // 21 weekdays x 8 h = 168 h, minus 10 h absence
        $this->assertSame(158 * self::HOUR, $person['available_seconds']);
        $this->assertSame(10 * self::HOUR, $person['absence_seconds']);
        $this->assertSame(100 * self::HOUR, $person['billable_seconds']);
        $this->assertSame(20 * self::HOUR, $person['internal_seconds']);
        $this->assertEqualsWithDelta(100 / 158, $person['chargeability'], 1e-9);
        $this->assertSame(75, $person['target_percent']);
        $this->assertEqualsWithDelta(100 / 158 * 100 - 75, $person['gap_points'], 1e-9);
        $this->assertSame('below_target', $person['status']);
        $this->assertFalse($person['is_placeholder']);
    }

    public function test_internal_time_is_not_deducted(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $this->workWeek($data->member, '2026-01-01', 40, 20);
        $client = Project::factory()->forOrganization($data->organization)->billable()->create();
        $this->entries($data->member, $client, 4, 10, true);
        $this->entry($data->member, null, '2026-11-24 08:00:00', 20 * self::HOUR, false);
        // Breaks never count anywhere
        TimeEntry::factory()->forMember($data->member)->isBreak()
            ->startWithDuration(Carbon::parse('2026-11-25 12:00:00', 'UTC'), self::HOUR)
            ->create(['description' => '']);
        $this->actAs($data->user);

        // Act
        $response = $this->getPeople($data->organization);

        // Assert: the default range is This month; internal time stays out of the denominator
        $response->assertOk();
        $response->assertJsonPath('meta.range.key', 'this_month');
        $person = $this->personOf($response, $data->member->getKey());
        $this->assertSame(168 * self::HOUR, $person['available_seconds']);
        $this->assertSame(20 * self::HOUR, $person['internal_seconds']);
        $this->assertSame(0, $person['absence_seconds']);
        $this->assertSame(40 * self::HOUR, $person['billable_seconds']);
        $this->assertEqualsWithDelta(40 / 168, $person['chargeability'], 1e-9);
        $this->assertSame('on_track', $person['status']);
    }

    public function test_member_without_working_week_has_null_chargeability(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $employee = Member::factory()->forOrganization($data->organization)->role(Role::Employee)->create();
        $client = Project::factory()->forOrganization($data->organization)->billable()->create();
        $this->entries($employee, $client, 2, 5, true);
        $this->actAs($data->user);

        // Act
        $response = $this->getPeople($data->organization, 'this_month');

        // Assert
        $response->assertOk();
        $person = $this->personOf($response, $employee->getKey());
        $this->assertSame(10 * self::HOUR, $person['billable_seconds']);
        $this->assertNull($person['weekly_seconds']);
        $this->assertNull($person['available_seconds']);
        $this->assertNull($person['chargeability']);
        $this->assertNull($person['target_percent']);
        $this->assertNull($person['gap_points']);
        $this->assertNull($person['status']);
        // The owner without time and without a working week is listed too
        $owner = $this->personOf($response, $data->member->getKey());
        $this->assertSame(0, $owner['billable_seconds']);
        $this->assertNull($owner['chargeability']);
    }

    public function test_target_is_the_row_effective_at_range_end(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $this->workWeek($data->member, '2026-01-01', 40, 75);
        $this->workWeek($data->member, '2026-11-16', 32, 80);
        $this->actAs($data->user);

        // Act
        $thisMonth = $this->getPeople($data->organization, 'this_month');
        $lastMonth = $this->getPeople($data->organization, 'last_month');
        $bogus = $this->getPeople($data->organization, 'bogus');

        // Assert
        $thisMonth->assertOk();
        $person = $this->personOf($thisMonth, $data->member->getKey());
        $this->assertSame(80, $person['target_percent']);
        $this->assertSame(32 * self::HOUR, $person['weekly_seconds']);
        // 10 weekdays x 8 h + 11 weekdays x 6.4 h = 150.4 h
        $this->assertSame(541440, $person['available_seconds']);

        $lastMonth->assertOk();
        $lastMonth->assertJsonPath('meta.range.from', '2026-10-01');
        $lastMonth->assertJsonPath('meta.range.to', '2026-10-31');
        $lastMonth->assertJsonPath('meta.range.contains_today', false);
        $october = $this->personOf($lastMonth, $data->member->getKey());
        $this->assertSame(75, $october['target_percent']);
        // The working week column shows the current value
        $this->assertSame(32 * self::HOUR, $october['weekly_seconds']);
        // 22 weekdays x 8 h
        $this->assertSame(176 * self::HOUR, $october['available_seconds']);

        $bogus->assertOk();
        $bogus->assertJsonPath('meta.range.key', 'this_month');
    }

    public function test_placeholder_appears_only_with_time_in_range(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $withTime = Member::factory()->forOrganization($data->organization)->role(Role::Placeholder)->create();
        $withoutTime = Member::factory()->forOrganization($data->organization)->role(Role::Placeholder)->create();
        $client = Project::factory()->forOrganization($data->organization)->billable()->create();
        $this->entries($withTime, $client, 1, 3, true);
        // October time only: outside This month
        $this->entry($withoutTime, $client, '2026-10-15 08:00:00', 3 * self::HOUR, true);
        $this->actAs($data->user);

        // Act
        $response = $this->getPeople($data->organization, 'this_month');

        // Assert
        $response->assertOk();
        /** @var array<int, array<string, mixed>> $rows */
        $rows = $response->json('data');
        $ids = array_column($rows, 'member_id');
        $this->assertContains($withTime->getKey(), $ids);
        $this->assertNotContains($withoutTime->getKey(), $ids);
        $placeholder = $this->rowOf($rows, $withTime->getKey());
        $this->assertTrue($placeholder['is_placeholder']);
        $this->assertSame(3 * self::HOUR, $placeholder['billable_seconds']);
    }

    public function test_employee_and_core_manager_get_404(): void
    {
        // Arrange
        $employee = $this->createUserWithRole(Role::Employee);
        $manager = $this->createUserWithRole(Role::Manager);
        $stranger = $this->createUserWithRole(Role::Owner);

        // Act
        $this->actAs($employee->user);
        $employeeResponse = $this->getPeople($employee->organization);
        $this->actAs($manager->user);
        $managerResponse = $this->getPeople($manager->organization);
        $this->actAs($stranger->user);
        $strangerResponse = $this->getPeople($employee->organization);

        // Assert
        $employeeResponse->assertNotFound();
        $managerResponse->assertNotFound();
        $strangerResponse->assertNotFound();
        $this->assertArrayNotHasKey('data', $employeeResponse->json());
    }

    public function test_team_totals(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Admin);
        $this->workWeek($data->ownerMember, '2026-01-01', 40, 75);
        $employee = Member::factory()->forOrganization($data->organization)->role(Role::Employee)->create();
        $this->workWeek($employee, '2026-01-01', 32, 50);
        $noWeek = Member::factory()->forOrganization($data->organization)->role(Role::Employee)->create();
        $client = Project::factory()->forOrganization($data->organization)->billable()->create();
        $absence = $this->absenceProject($data->organization);
        $this->entries($data->ownerMember, $client, 10, 10, true);
        $this->entries($employee, $client, 3, 10, true);
        $this->entry($employee, $absence, '2026-11-20 08:00:00', 8 * self::HOUR, false);
        $this->entry($noWeek, $client, '2026-11-20 08:00:00', 5 * self::HOUR, true);
        $this->entry($noWeek, null, '2026-11-21 08:00:00', 2 * self::HOUR, false);
        $this->actAs($data->user);

        // Act
        $response = $this->getPeople($data->organization, 'this_month');

        // Assert
        $response->assertOk();
        // Owner 168 h; employee 21 x 6.4 h = 134.4 h minus 8 h absence = 126.4 h
        $available = 168 * self::HOUR + 455040;
        $response->assertJsonPath('meta.team.billable_seconds', 135 * self::HOUR);
        $response->assertJsonPath('meta.team.absence_seconds', 8 * self::HOUR);
        $response->assertJsonPath('meta.team.internal_seconds', 2 * self::HOUR);
        $response->assertJsonPath('meta.team.available_seconds', $available);
        // The person without a working week has no denominator and stays out of the ratio
        $this->assertEqualsWithDelta(130 * self::HOUR / $available, $response->json('meta.team.chargeability'), 1e-9);
        $this->assertEqualsWithDelta(
            (168 * self::HOUR * 75 + 455040 * 50) / $available,
            $response->json('meta.team.target_percent'),
            1e-9,
        );
        $this->assertSame(455040, $this->personOf($response, $employee->getKey())['available_seconds']);
    }
}
