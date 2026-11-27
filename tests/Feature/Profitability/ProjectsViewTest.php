<?php

declare(strict_types=1);

namespace Tests\Feature\Profitability;

use App\Enums\Role;
use App\Models\Client;
use App\Models\Member;
use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use App\Profitability\Access\AccessScope;
use App\Profitability\Access\ProfitabilityAccess;
use App\Profitability\Http\Controllers\ProjectsViewController;
use App\Profitability\Models\ClientAccountManager;
use App\Profitability\Models\ContractPeriod;
use App\Profitability\Models\ProjectContract;
use App\Profitability\Models\ProjectManager;
use App\Profitability\ProfitabilityServiceProvider;
use App\Profitability\Reporting\ConsumptionQuery;
use App\Profitability\Reporting\ProjectBalanceService;
use App\Profitability\Reporting\Projection;
use App\Profitability\Reporting\ProjectionResult;
use App\Profitability\TimeEntries\LegacyNonBillableQuery;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

/**
 * The by-project view of the Profitability page (D-14): rows by scope (D-11), money only on the rows the
 * caller has money for, the contract filter, and the legacy non-billable notice for Owner/Admin (D-05).
 *
 * Fixture: client A with project "Alpha" and client B with project "Bravo", both under a monthly contract
 * with a current November 2026 period (40 h, 300000 cents); today is 2026-11-18.
 */
#[CoversClass(ProjectsViewController::class)]
#[CoversClass(ProjectBalanceService::class)]
#[UsesClass(ConsumptionQuery::class)]
#[UsesClass(Projection::class)]
#[UsesClass(ProjectionResult::class)]
#[UsesClass(LegacyNonBillableQuery::class)]
#[UsesClass(ProfitabilityAccess::class)]
#[UsesClass(AccessScope::class)]
#[UsesClass(ProjectContract::class)]
#[UsesClass(ContractPeriod::class)]
#[UsesClass(ProjectManager::class)]
#[UsesClass(ClientAccountManager::class)]
#[UsesClass(ProfitabilityServiceProvider::class)]
class ProjectsViewTest extends TestCaseWithDatabase
{
    private const string MONEY_KEY = '/(amount|cost|margin|revenue|cents)/i';

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

    /**
     * @return object{clientA: Client, clientB: Client, alpha: Project, bravo: Project}
     */
    private function portfolio(Organization $organization): object
    {
        $clientA = Client::factory()->forOrganization($organization)->create(['name' => 'Client A']);
        $clientB = Client::factory()->forOrganization($organization)->create(['name' => 'Client B']);
        $alpha = Project::factory()->forOrganization($organization)->forClient($clientA)->billable()->create(['name' => 'Alpha']);
        $bravo = Project::factory()->forOrganization($organization)->forClient($clientB)->billable()->create(['name' => 'Bravo']);
        $this->contract($alpha, '2026-01-01', null, [['2026-11-01', '2026-11-30']]);
        $this->contract($bravo, '2026-01-01', null, [['2026-11-01', '2026-11-30']]);

        return (object) ['clientA' => $clientA, 'clientB' => $clientB, 'alpha' => $alpha, 'bravo' => $bravo];
    }

    /**
     * A monthly contract with the given periods (local dates, both inclusive).
     *
     * @param  list<array{0: string, 1: string}>  $periods
     */
    private function contract(Project $project, string $startsOn, ?string $endsOn, array $periods): ProjectContract
    {
        $contract = ProjectContract::query()->create([
            'organization_id' => $project->organization_id,
            'project_id' => $project->getKey(),
            'service' => 'SEO retainer',
            'schedule' => 'monthly',
            'starts_on' => $startsOn,
            'ends_on' => $endsOn,
            'amount_cents' => 300000,
            'budget_seconds' => 144000,
        ]);
        foreach ($periods as [$from, $to]) {
            ContractPeriod::query()->create([
                'organization_id' => $project->organization_id,
                'contract_id' => $contract->getKey(),
                'starts_on' => $from,
                'ends_on' => $to,
                'amount_cents' => 300000,
                'budget_seconds' => 144000,
            ]);
        }

        return $contract;
    }

    private function workEntry(Member $member, Project $project, string $startUtc, int $seconds): TimeEntry
    {
        return TimeEntry::factory()
            ->forMember($member)
            ->forProject($project)
            ->billable()
            ->startWithDuration(Carbon::parse($startUtc, 'UTC'), $seconds)
            ->create(['description' => '']);
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

    private function getProjects(Organization $organization, ?string $contract = null): TestResponse
    {
        $parameters = ['organization' => $organization->getKey()];
        if ($contract !== null) {
            $parameters['contract'] = $contract;
        }

        return $this->getJson(route('profitability.views.projects', $parameters, false));
    }

    /**
     * @return list<string>
     */
    private function names(TestResponse $response): array
    {
        $rows = $response->json('data');
        $this->assertIsArray($rows);

        return array_values(array_map(fn (mixed $row): string => is_array($row) ? (string) $row['name'] : '', $rows));
    }

    /**
     * @return array<string, mixed>
     */
    private function rowNamed(TestResponse $response, string $name): array
    {
        $rows = $response->json('data');
        $this->assertIsArray($rows);
        foreach ($rows as $row) {
            if (is_array($row) && $row['name'] === $name) {
                return $row;
            }
        }
        $this->fail('No row named '.$name);
    }

    public function test_owner_sees_all_contract_projects_with_money_and_the_legacy_notice(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $portfolio = $this->portfolio($data->organization);
        $this->workEntry($data->member, $portfolio->alpha, '2026-11-10 09:00:00', 3600);
        // A legacy non-billable entry on a billable project, written before D-05 (bulk update, no events)
        $legacy = $this->workEntry($data->member, $portfolio->bravo, '2026-11-11 09:00:00', 1800);
        TimeEntry::query()->whereKey($legacy->getKey())->update(['billable' => false]);
        $this->actAs($data->user);

        // Act
        $response = $this->getProjects($data->organization);

        // Assert
        $response->assertOk();
        $this->assertSame(['Alpha', 'Bravo'], $this->names($response));
        $response->assertJsonPath('meta.total_rows', 2);
        $response->assertJsonPath('meta.money_rows', 2);
        $response->assertJsonPath('meta.nonbillable_legacy_seconds', 1800);
        $alpha = $this->rowNamed($response, 'Alpha');
        $this->assertSame($portfolio->alpha->getKey(), $alpha['project_id']);
        $this->assertSame('Client A', $alpha['client_name']);
        $this->assertSame('monthly', $alpha['schedule']);
        $this->assertFalse($alpha['archived']);
        $this->assertIsArray($alpha['period']);
        $this->assertSame('2026-11-01', $alpha['period']['starts_on']);
        $this->assertSame('current', $alpha['period']['state']);
        $this->assertSame(144000, $alpha['budget_seconds']);
        $this->assertSame(3600, $alpha['consumed_seconds']);
        $this->assertSame(144000 - 3600, $alpha['still_to_consume_seconds']);
        $this->assertSame('on_track', $alpha['status']);
        $this->assertTrue($alpha['can_edit_terms']);
        $this->assertTrue($alpha['can_edit_plan']);
        $this->assertSame(300000, $alpha['amount_cents']);
        $this->assertSame(0, $alpha['cost_cents']);
        $this->assertSame(3600, $alpha['unpriced_cost_seconds']);
        $this->assertArrayHasKey('margin_cents', $alpha);
        $this->assertArrayNotHasKey('months', $alpha);
    }

    public function test_account_manager_sees_only_their_clients_projects_with_money(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Employee);
        $portfolio = $this->portfolio($data->organization);
        $this->assignAccountManager($portfolio->clientA, $data->member);
        $this->actAs($data->user);

        // Act
        $response = $this->getProjects($data->organization);

        // Assert
        $response->assertOk();
        $this->assertSame(['Alpha'], $this->names($response));
        $response->assertJsonPath('meta.total_rows', 1);
        $response->assertJsonPath('meta.money_rows', 1);
        $response->assertJsonMissingPath('meta.nonbillable_legacy_seconds');
        $alpha = $this->rowNamed($response, 'Alpha');
        $this->assertSame(300000, $alpha['amount_cents']);
        $this->assertTrue($alpha['can_edit_terms']);
        $this->assertFalse($alpha['can_edit_plan']);
    }

    public function test_project_manager_sees_only_managed_projects_without_any_money_key(): void
    {
        // Arrange: also manager of a billable project without contract terms
        $data = $this->createUserWithRole(Role::Employee);
        $portfolio = $this->portfolio($data->organization);
        $charlie = Project::factory()->forOrganization($data->organization)->forClient($portfolio->clientA)->billable()->create(['name' => 'Charlie']);
        $this->assignProjectManager($portfolio->bravo, $data->member);
        $this->assignProjectManager($charlie, $data->member);
        $this->workEntry($data->member, $portfolio->bravo, '2026-11-10 09:00:00', 3600);
        $this->actAs($data->user);

        // Act
        $active = $this->getProjects($data->organization);
        $all = $this->getProjects($data->organization, 'all');
        $without = $this->getProjects($data->organization, 'without');

        // Assert
        $active->assertOk();
        $this->assertSame(['Bravo'], $this->names($active));
        $active->assertJsonPath('meta.money_rows', 0);
        $bravo = $this->rowNamed($active, 'Bravo');
        $this->assertSame(3600, $bravo['consumed_seconds']);
        $this->assertFalse($bravo['can_edit_terms']);
        $this->assertTrue($bravo['can_edit_plan']);
        $this->assertSame(['Bravo', 'Charlie'], $this->names($all));
        // Setting terms belongs to the account side: nothing to list for a project manager
        $this->assertSame([], $this->names($without));
        foreach ([$active, $all, $without] as $response) {
            $json = $response->json();
            $this->assertIsArray($json);
            $this->assertNoKeyMatches($json, self::MONEY_KEY);
            $response->assertJsonMissingPath('meta.nonbillable_legacy_seconds');
        }
    }

    public function test_mixed_scope_rows_carry_money_only_where_allowed(): void
    {
        // Arrange: account manager of client A and project manager of a project of client B
        $data = $this->createUserWithRole(Role::Employee);
        $portfolio = $this->portfolio($data->organization);
        $this->assignAccountManager($portfolio->clientA, $data->member);
        $this->assignProjectManager($portfolio->bravo, $data->member);
        $this->actAs($data->user);

        // Act
        $response = $this->getProjects($data->organization);

        // Assert
        $response->assertOk();
        $this->assertSame(['Alpha', 'Bravo'], $this->names($response));
        $response->assertJsonPath('meta.total_rows', 2);
        $response->assertJsonPath('meta.money_rows', 1);
        $this->assertArrayHasKey('amount_cents', $this->rowNamed($response, 'Alpha'));
        $bravo = $this->rowNamed($response, 'Bravo');
        $this->assertNoKeyMatches($bravo, self::MONEY_KEY);
        $this->assertSame(144000, $bravo['budget_seconds']);
    }

    public function test_filters_active_without_ended_all(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $portfolio = $this->portfolio($data->organization);
        Project::factory()->forOrganization($data->organization)->billable()->create(['name' => 'Charlie']);
        $delta = Project::factory()->forOrganization($data->organization)->billable()->create(['name' => 'Delta']);
        $this->contract($delta, '2026-05-01', '2026-06-30', [['2026-05-01', '2026-05-31'], ['2026-06-01', '2026-06-30']]);
        $echo = Project::factory()->forOrganization($data->organization)->billable()->archived()->create(['name' => 'Echo']);
        $this->contract($echo, '2026-01-01', null, [['2026-11-01', '2026-11-30']]);
        Project::factory()->forOrganization($data->organization)->create(['name' => 'Internal', 'is_billable' => false]);
        Project::factory()->forOrganization($data->organization)->billable()->archived()->create(['name' => 'Foxtrot']);
        $this->actAs($data->user);

        // Act
        $default = $this->getProjects($data->organization);
        $active = $this->getProjects($data->organization, 'active');
        $without = $this->getProjects($data->organization, 'without');
        $ended = $this->getProjects($data->organization, 'ended');
        $all = $this->getProjects($data->organization, 'all');
        $unknown = $this->getProjects($data->organization, 'bogus');

        // Assert
        $this->assertSame(['Alpha', 'Bravo'], $this->names($default));
        $this->assertSame(['Alpha', 'Bravo'], $this->names($active));
        $this->assertSame(['Charlie'], $this->names($without));
        $this->assertSame(['Delta', 'Echo'], $this->names($ended));
        $this->assertSame(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'], $this->names($all));
        $this->assertSame(['Alpha', 'Bravo'], $this->names($unknown));
        // A billable project without terms has no period and no money part
        $charlie = $this->rowNamed($without, 'Charlie');
        $this->assertNull($charlie['period']);
        $this->assertNull($charlie['schedule']);
        $this->assertNull($charlie['status']);
        $this->assertSame(0, $charlie['budget_seconds']);
        $this->assertArrayNotHasKey('amount_cents', $charlie);
        $without->assertJsonPath('meta.money_rows', 0);
        // An ended contract is shown with its latest closed period
        $delta = $this->rowNamed($ended, 'Delta');
        $this->assertIsArray($delta['period']);
        $this->assertSame('2026-06-01', $delta['period']['starts_on']);
        $this->assertSame('closed', $delta['period']['state']);
        $this->assertSame('closed', $delta['status']);
        $this->assertTrue($this->rowNamed($ended, 'Echo')['archived']);
    }

    public function test_employee_and_core_manager_get_404(): void
    {
        // Arrange
        $employee = $this->createUserWithRole(Role::Employee);
        $this->portfolio($employee->organization);
        $manager = $this->createUserWithRole(Role::Manager);
        $this->portfolio($manager->organization);

        // Act
        $this->actAs($employee->user);
        $employeeResponse = $this->getProjects($employee->organization);
        $this->actAs($manager->user);
        $managerResponse = $this->getProjects($manager->organization, 'all');

        // Assert
        $employeeResponse->assertNotFound();
        $this->assertNull($employeeResponse->json('data'));
        $managerResponse->assertNotFound();
        $this->assertNull($managerResponse->json('data'));
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
