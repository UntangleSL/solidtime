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
use App\Profitability\Http\Controllers\ClientsViewController;
use App\Profitability\Models\ClientAccountManager;
use App\Profitability\Models\ContractPeriod;
use App\Profitability\Models\ContractPeriodMonth;
use App\Profitability\Models\MemberCostRate;
use App\Profitability\Models\ProjectContract;
use App\Profitability\Models\ProjectManager;
use App\Profitability\Periods\PeriodCalendar;
use App\Profitability\Periods\PeriodMaterializer;
use App\Profitability\ProfitabilityServiceProvider;
use App\Profitability\Reporting\ClientRollupService;
use App\Profitability\Reporting\ConsumptionQuery;
use App\Profitability\Reporting\ProjectBalanceService;
use App\Profitability\Reporting\Projection;
use App\Profitability\Reporting\ProjectionResult;
use App\Profitability\Reporting\ReportRange;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

/**
 * The by-client view of the Profitability page (BUDG-06): the account manager's portfolio with money
 * (D-07, D-11), straight-line monthly revenue (D-19), planned hours per month (D-02), the dated hourly
 * cost (D-08) and the scope edges (D-16).
 *
 * Today is Wednesday 2026-11-18 (Europe/Madrid); This month is November 2026, This quarter October to
 * December 2026. Rows are matched by name, never by insertion order (PostgreSQL orders uuids).
 */
#[CoversClass(ClientsViewController::class)]
#[CoversClass(ClientRollupService::class)]
#[CoversClass(ConsumptionQuery::class)]
#[UsesClass(ProjectBalanceService::class)]
#[UsesClass(Projection::class)]
#[UsesClass(ProjectionResult::class)]
#[UsesClass(ReportRange::class)]
#[UsesClass(PeriodMaterializer::class)]
#[UsesClass(PeriodCalendar::class)]
#[UsesClass(ProfitabilityAccess::class)]
#[UsesClass(AccessScope::class)]
#[UsesClass(ProjectContract::class)]
#[UsesClass(ContractPeriod::class)]
#[UsesClass(ContractPeriodMonth::class)]
#[UsesClass(MemberCostRate::class)]
#[UsesClass(ProjectManager::class)]
#[UsesClass(ClientAccountManager::class)]
#[UsesClass(ProfitabilityServiceProvider::class)]
class ClientsViewTest extends TestCaseWithDatabase
{
    private const string PER_PERSON_KEY = '/(member|person|people|user|entr)/i';

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
     * A contract with one period and its monthly plan (local dates, both inclusive). The contract starts
     * with the period, so the materializer only adds the periods after it.
     *
     * @param  array<string, int>  $plan  planned seconds per month (Y-m-01)
     */
    private function contract(Project $project, string $schedule, string $startsOn, string $endsOn, int $amountCents, int $budgetSeconds, array $plan): ContractPeriod
    {
        $contract = ProjectContract::query()->create([
            'organization_id' => $project->organization_id,
            'project_id' => $project->getKey(),
            'service' => 'SEO retainer',
            'schedule' => $schedule,
            'starts_on' => $startsOn,
            'ends_on' => null,
            'amount_cents' => $amountCents,
            'budget_seconds' => $budgetSeconds,
        ]);
        $period = ContractPeriod::query()->create([
            'organization_id' => $project->organization_id,
            'contract_id' => $contract->getKey(),
            'starts_on' => $startsOn,
            'ends_on' => $endsOn,
            'amount_cents' => $amountCents,
            'budget_seconds' => $budgetSeconds,
        ]);
        foreach ($plan as $month => $seconds) {
            $row = new ContractPeriodMonth(['period_id' => $period->getKey(), 'month' => $month, 'planned_seconds' => $seconds]);
            $row->forceFill(['organization_id' => $project->organization_id]);
            $row->save();
        }

        return $period;
    }

    /**
     * A monthly November 2026 contract: 40 h and 300000 cents.
     */
    private function novemberContract(Project $project, int $amountCents = 300000): ContractPeriod
    {
        return $this->contract($project, 'monthly', '2026-11-01', '2026-11-30', $amountCents, 144000, ['2026-11-01' => 144000]);
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

    private function costRate(Member $member, string $effectiveFrom, int $hourlyCostCents): void
    {
        $rate = new MemberCostRate([
            'member_id' => $member->getKey(),
            'effective_from' => $effectiveFrom,
            'hourly_cost_cents' => $hourlyCostCents,
        ]);
        $rate->forceFill(['organization_id' => $member->organization_id]);
        $rate->save();
    }

    private function assignAccountManager(Client $client, Member $member): void
    {
        $assignment = new ClientAccountManager(['client_id' => $client->getKey(), 'member_id' => $member->getKey()]);
        $assignment->organization_id = $client->organization_id;
        $assignment->save();
    }

    private function assignProjectManager(Project $project, Member $member): void
    {
        $assignment = new ProjectManager(['project_id' => $project->getKey(), 'member_id' => $member->getKey()]);
        $assignment->organization_id = $project->organization_id;
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

    private function getClients(Organization $organization, ?string $range = null): TestResponse
    {
        $parameters = ['organization' => $organization->getKey()];
        if ($range !== null) {
            $parameters['range'] = $range;
        }

        return $this->getJson(route('profitability.views.clients', $parameters, false));
    }

    /**
     * @return list<string|null>
     */
    private function clientNames(TestResponse $response): array
    {
        $rows = $response->json('data');
        $this->assertIsArray($rows);

        return array_values(array_map(fn (mixed $row): ?string => is_array($row) && is_string($row['name']) ? $row['name'] : null, $rows));
    }

    /**
     * @return array<string, mixed>
     */
    private function clientRow(TestResponse $response, ?string $clientId): array
    {
        $rows = $response->json('data');
        $this->assertIsArray($rows);
        foreach ($rows as $row) {
            if (is_array($row) && $row['client_id'] === $clientId) {
                return $row;
            }
        }
        $this->fail('No client row '.($clientId ?? 'null'));
    }

    /**
     * @return array<string, mixed>
     */
    private function projectRow(TestResponse $response, Project $project): array
    {
        $rows = $response->json('data');
        $this->assertIsArray($rows);
        foreach ($rows as $row) {
            if (! is_array($row) || ! is_array($row['projects'])) {
                continue;
            }
            foreach ($row['projects'] as $projectRow) {
                if (is_array($projectRow) && $projectRow['project_id'] === $project->getKey()) {
                    return $projectRow;
                }
            }
        }
        $this->fail('No project row '.$project->name);
    }

    public function test_account_manager_sees_only_their_clients_with_money(): void
    {
        // Arrange: client A (managed) and client B (not), one November contract each, 1 h logged on each
        $data = $this->createUserWithRole(Role::Employee);
        $clientA = Client::factory()->forOrganization($data->organization)->create(['name' => 'Client A']);
        $clientB = Client::factory()->forOrganization($data->organization)->create(['name' => 'Client B']);
        $alpha = Project::factory()->forOrganization($data->organization)->forClient($clientA)->billable()->create(['name' => 'Alpha']);
        $bravo = Project::factory()->forOrganization($data->organization)->forClient($clientB)->billable()->create(['name' => 'Bravo']);
        $internal = Project::factory()->forOrganization($data->organization)->billable()->create(['name' => 'No client project']);
        $this->novemberContract($alpha);
        $this->novemberContract($bravo);
        $this->novemberContract($internal);
        $this->costRate($data->member, '2026-01-01', 6000);
        $this->workEntry($data->member, $alpha, '2026-11-10 09:00:00', 3600);
        $this->workEntry($data->member, $bravo, '2026-11-10 11:00:00', 3600);
        $this->assignAccountManager($clientA, $data->member);
        $this->actAs($data->user);

        // Act
        $response = $this->getClients($data->organization);

        // Assert
        $response->assertOk();
        $this->assertSame(['Client A'], $this->clientNames($response));
        $client = $this->clientRow($response, $clientA->getKey());
        $this->assertSame(1, $client['project_count']);
        $this->assertSame(144000, $client['hours_sold_seconds']);
        $this->assertSame(3600, $client['consumed_seconds']);
        $this->assertSame(300000, $client['amount_cents']);
        $this->assertSame(6000, $client['cost_cents']);
        $this->assertSame(294000, $client['margin_cents']);
        $this->assertEqualsWithDelta(98.0, $client['margin_percent'], 0.0001);
        $this->assertSame(0, $client['unpriced_cost_seconds']);
        $this->assertSame('on_track', $client['status']);
        $this->assertIsArray($client['projects']);
        $this->assertCount(1, $client['projects']);
        $project = $this->projectRow($response, $alpha);
        $this->assertSame('Alpha', $project['name']);
        $this->assertSame(300000, $project['amount_cents']);
        $this->assertSame(6000, $project['cost_cents']);
        $this->assertSame('on_track', $project['status']);
        $response->assertJsonPath('meta.totals.amount_cents', 300000);
        $response->assertJsonPath('meta.totals.cost_cents', 6000);
        $response->assertJsonPath('meta.totals.margin_cents', 294000);
        $response->assertJsonPath('meta.range.key', 'this_month');
        // Only client and project aggregates: nothing per person or per entry
        $json = $response->json();
        $this->assertIsArray($json);
        $this->assertNoKeyMatches($json, self::PER_PERSON_KEY);
    }

    public function test_owner_sees_every_client_and_the_no_client_bucket_last(): void
    {
        // Arrange: the clients are created in reverse name order
        $data = $this->createUserWithRole(Role::Owner);
        $zulu = Client::factory()->forOrganization($data->organization)->create(['name' => 'Zulu Corp']);
        $acme = Client::factory()->forOrganization($data->organization)->create(['name' => 'Acme']);
        $internal = Project::factory()->forOrganization($data->organization)->billable()->create(['name' => 'Aardvark retainer']);
        $zuluProject = Project::factory()->forOrganization($data->organization)->forClient($zulu)->billable()->create(['name' => 'Zulu SEO']);
        $acmeOne = Project::factory()->forOrganization($data->organization)->forClient($acme)->billable()->create(['name' => 'Acme two']);
        $acmeTwo = Project::factory()->forOrganization($data->organization)->forClient($acme)->billable()->create(['name' => 'Acme one']);
        // A client without contract projects is not listed
        Client::factory()->forOrganization($data->organization)->create(['name' => 'Bare client']);
        $this->novemberContract($internal, 100000);
        $this->novemberContract($zuluProject, 200000);
        $this->novemberContract($acmeOne, 300000);
        $this->novemberContract($acmeTwo, 400000);
        $this->actAs($data->user);

        // Act
        $response = $this->getClients($data->organization);

        // Assert
        $response->assertOk();
        $this->assertSame(['Acme', 'Zulu Corp', null], $this->clientNames($response));
        $rows = $response->json('data');
        $this->assertIsArray($rows);
        $this->assertNull($rows[2]['client_id']);
        $this->assertSame(1, $rows[2]['project_count']);
        $this->assertSame(100000, $rows[2]['amount_cents']);
        $acmeRow = $this->clientRow($response, $acme->getKey());
        $this->assertSame(2, $acmeRow['project_count']);
        $this->assertSame(700000, $acmeRow['amount_cents']);
        $this->assertSame(288000, $acmeRow['hours_sold_seconds']);
        $this->assertIsArray($acmeRow['projects']);
        $this->assertSame(['Acme one', 'Acme two'], array_column($acmeRow['projects'], 'name'));
        $this->assertSame(200000, $this->clientRow($response, $zulu->getKey())['amount_cents']);
        $response->assertJsonPath('meta.totals.amount_cents', 1000000);
        $response->assertJsonPath('meta.totals.hours_sold_seconds', 4 * 144000);
        $response->assertJsonPath('meta.totals.cost_cents', 0);
    }

    public function test_amount_is_the_straight_line_share_of_months_in_range(): void
    {
        // Arrange: two quarterly October-December periods, 300000 and 100000 cents (100000 / 3 leaves a
        // remainder, which goes to December)
        $data = $this->createUserWithRole(Role::Owner);
        $client = Client::factory()->forOrganization($data->organization)->create(['name' => 'Client A']);
        $even = Project::factory()->forOrganization($data->organization)->forClient($client)->billable()->create(['name' => 'Even']);
        $odd = Project::factory()->forOrganization($data->organization)->forClient($client)->billable()->create(['name' => 'Odd']);
        $plan = ['2026-10-01' => 144000, '2026-11-01' => 144000, '2026-12-01' => 144000];
        $this->contract($even, 'quarterly', '2026-10-01', '2026-12-31', 300000, 432000, $plan);
        $this->contract($odd, 'quarterly', '2026-10-01', '2026-12-31', 100000, 432000, $plan);
        $this->actAs($data->user);

        // Act
        $thisMonth = $this->getClients($data->organization, 'this_month');
        $lastMonth = $this->getClients($data->organization, 'last_month');
        $thisQuarter = $this->getClients($data->organization, 'this_quarter');

        // Assert
        $thisMonth->assertOk();
        $this->assertSame(100000, $this->projectRow($thisMonth, $even)['amount_cents']);
        $this->assertSame(33333, $this->projectRow($thisMonth, $odd)['amount_cents']);
        $this->assertSame(133333, $this->clientRow($thisMonth, $client->getKey())['amount_cents']);
        $this->assertSame(100000, $this->projectRow($lastMonth, $even)['amount_cents']);
        $this->assertSame(33333, $this->projectRow($lastMonth, $odd)['amount_cents']);
        $this->assertSame(300000, $this->projectRow($thisQuarter, $even)['amount_cents']);
        $this->assertSame(100000, $this->projectRow($thisQuarter, $odd)['amount_cents']);
        $thisQuarter->assertJsonPath('meta.totals.amount_cents', 400000);
        $thisQuarter->assertJsonPath('meta.range.from', '2026-10-01');
        $thisQuarter->assertJsonPath('meta.range.to', '2026-12-31');
    }

    public function test_hours_sold_are_the_planned_hours_of_the_range_months(): void
    {
        // Arrange: a quarterly period of 120 h planned front-loaded, 60 / 40 / 20 h
        $data = $this->createUserWithRole(Role::Owner);
        $client = Client::factory()->forOrganization($data->organization)->create(['name' => 'Client A']);
        $project = Project::factory()->forOrganization($data->organization)->forClient($client)->billable()->create(['name' => 'Front-loaded']);
        $this->contract($project, 'quarterly', '2026-10-01', '2026-12-31', 300000, 432000, [
            '2026-10-01' => 216000,
            '2026-11-01' => 144000,
            '2026-12-01' => 72000,
        ]);
        $this->actAs($data->user);

        // Act
        $thisMonth = $this->getClients($data->organization, 'this_month');
        $lastMonth = $this->getClients($data->organization, 'last_month');
        $thisQuarter = $this->getClients($data->organization, 'this_quarter');

        // Assert: November is the second month of the period
        $thisMonth->assertOk();
        $this->assertSame(144000, $this->projectRow($thisMonth, $project)['hours_sold_seconds']);
        $this->assertSame(144000, $this->clientRow($thisMonth, $client->getKey())['hours_sold_seconds']);
        $this->assertSame(216000, $this->projectRow($lastMonth, $project)['hours_sold_seconds']);
        $this->assertSame(432000, $this->projectRow($thisQuarter, $project)['hours_sold_seconds']);
        $thisQuarter->assertJsonPath('meta.totals.hours_sold_seconds', 432000);
    }

    public function test_consumption_is_capped_at_today(): void
    {
        // Arrange: 1 h on 10 November, 2 h dated 25 November (after today) and 30 min on 20 October, at
        // 60.00 per hour; the contract starts in November
        $data = $this->createUserWithRole(Role::Owner);
        $client = Client::factory()->forOrganization($data->organization)->create(['name' => 'Client A']);
        $project = Project::factory()->forOrganization($data->organization)->forClient($client)->billable()->create(['name' => 'Alpha']);
        $this->novemberContract($project);
        $this->costRate($data->member, '2026-01-01', 6000);
        $this->workEntry($data->member, $project, '2026-11-10 09:00:00', 3600);
        $this->workEntry($data->member, $project, '2026-11-25 09:00:00', 7200);
        $this->workEntry($data->member, $project, '2026-10-20 09:00:00', 1800);
        $this->actAs($data->user);

        // Act
        $thisMonth = $this->getClients($data->organization, 'this_month');
        $lastMonth = $this->getClients($data->organization, 'last_month');
        $thisQuarter = $this->getClients($data->organization, 'this_quarter');

        // Assert
        $thisMonth->assertOk();
        $thisMonth->assertJsonPath('meta.range.capped_to', '2026-11-18');
        $thisMonth->assertJsonPath('meta.range.contains_today', true);
        $row = $this->projectRow($thisMonth, $project);
        $this->assertSame(3600, $row['consumed_seconds']);
        $this->assertSame(6000, $row['cost_cents']);
        $this->assertSame(300000 - 6000, $row['margin_cents']);
        $thisMonth->assertJsonPath('meta.totals.consumed_seconds', 3600);
        // A closed range is not capped; time before the contract still counts against the client
        $lastMonth->assertJsonPath('meta.range.capped_to', '2026-10-31');
        $lastMonth->assertJsonPath('meta.range.contains_today', false);
        $october = $this->projectRow($lastMonth, $project);
        $this->assertSame(1800, $october['consumed_seconds']);
        $this->assertSame(3000, $october['cost_cents']);
        $this->assertSame(0, $october['amount_cents']);
        $this->assertSame(5400, $this->projectRow($thisQuarter, $project)['consumed_seconds']);
        $this->assertSame(9000, $this->projectRow($thisQuarter, $project)['cost_cents']);
    }

    public function test_unpriced_hours_are_reported_not_free(): void
    {
        // Arrange: the owner costs 60.00 per hour from 5 November; 1 h on 3 November (before the rate),
        // 1 h on 10 November; an employee without any hourly cost logs 30 min
        $data = $this->createUserWithRole(Role::Owner);
        $employee = Member::factory()->forOrganization($data->organization)->role(Role::Employee)->create();
        $client = Client::factory()->forOrganization($data->organization)->create(['name' => 'Client A']);
        $project = Project::factory()->forOrganization($data->organization)->forClient($client)->billable()->create(['name' => 'Alpha']);
        $this->novemberContract($project);
        $this->costRate($data->member, '2026-11-05', 6000);
        $this->workEntry($data->member, $project, '2026-11-03 09:00:00', 3600);
        $this->workEntry($data->member, $project, '2026-11-10 09:00:00', 3600);
        $this->workEntry($employee, $project, '2026-11-10 11:00:00', 1800);
        $this->actAs($data->user);

        // Act
        $response = $this->getClients($data->organization);

        // Assert
        $response->assertOk();
        $row = $this->projectRow($response, $project);
        $this->assertSame(9000, $row['consumed_seconds']);
        $this->assertSame(6000, $row['cost_cents']);
        $this->assertSame(5400, $row['unpriced_cost_seconds']);
        $this->assertSame(5400, $this->clientRow($response, $client->getKey())['unpriced_cost_seconds']);
        $response->assertJsonPath('meta.totals.unpriced_cost_seconds', 5400);
        $response->assertJsonPath('meta.totals.cost_cents', 6000);
    }

    public function test_project_manager_employee_and_core_manager_get_404(): void
    {
        // Arrange
        $projectManager = $this->createUserWithRole(Role::Employee);
        $client = Client::factory()->forOrganization($projectManager->organization)->create(['name' => 'Client A']);
        $project = Project::factory()->forOrganization($projectManager->organization)->forClient($client)->billable()->create(['name' => 'Alpha']);
        $this->novemberContract($project);
        $this->assignProjectManager($project, $projectManager->member);
        $employee = $this->createUserWithRole(Role::Employee);
        $manager = $this->createUserWithRole(Role::Manager);

        // Act
        $this->actAs($projectManager->user);
        $projectManagerResponse = $this->getClients($projectManager->organization);
        $this->actAs($employee->user);
        $employeeResponse = $this->getClients($employee->organization);
        $this->actAs($manager->user);
        $managerResponse = $this->getClients($manager->organization, 'this_quarter');

        // Assert
        foreach ([$projectManagerResponse, $employeeResponse, $managerResponse] as $response) {
            $response->assertNotFound();
            $this->assertNull($response->json('data'));
            $this->assertNull($response->json('meta'));
        }
    }

    public function test_unknown_range_falls_back_to_this_month(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $client = Client::factory()->forOrganization($data->organization)->create(['name' => 'Client A']);
        $project = Project::factory()->forOrganization($data->organization)->forClient($client)->billable()->create(['name' => 'Alpha']);
        $this->contract($project, 'quarterly', '2026-10-01', '2026-12-31', 300000, 432000, []);
        $this->actAs($data->user);

        // Act
        $unknown = $this->getClients($data->organization, 'bogus');
        $missing = $this->getClients($data->organization);

        // Assert
        foreach ([$unknown, $missing] as $response) {
            $response->assertOk();
            $response->assertJsonPath('meta.range', [
                'key' => 'this_month',
                'from' => '2026-11-01',
                'to' => '2026-11-30',
                'capped_to' => '2026-11-18',
                'contains_today' => true,
            ]);
            $this->assertSame(100000, $this->projectRow($response, $project)['amount_cents']);
        }
    }

    public function test_margin_percent_is_null_without_amount(): void
    {
        // Arrange: a contract sold for 0 with 1 h at 60.00 per hour
        $data = $this->createUserWithRole(Role::Owner);
        $client = Client::factory()->forOrganization($data->organization)->create(['name' => 'Client A']);
        $project = Project::factory()->forOrganization($data->organization)->forClient($client)->billable()->create(['name' => 'Alpha']);
        $this->novemberContract($project, 0);
        $this->costRate($data->member, '2026-01-01', 6000);
        $this->workEntry($data->member, $project, '2026-11-10 09:00:00', 3600);
        $this->actAs($data->user);

        // Act
        $response = $this->getClients($data->organization);

        // Assert
        $response->assertOk();
        $row = $this->projectRow($response, $project);
        $this->assertSame(0, $row['amount_cents']);
        $this->assertSame(-6000, $row['margin_cents']);
        $this->assertArrayHasKey('margin_percent', $row);
        $this->assertNull($row['margin_percent']);
        $clientRow = $this->clientRow($response, $client->getKey());
        $this->assertArrayHasKey('margin_percent', $clientRow);
        $this->assertNull($clientRow['margin_percent']);
        $response->assertJsonPath('meta.totals.margin_cents', -6000);
        $response->assertJsonPath('meta.totals.margin_percent', null);
    }

    /**
     * Fails when any key at any depth of the JSON matches the pattern.
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
