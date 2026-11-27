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
use App\Profitability\Http\Controllers\ProjectSummaryController;
use App\Profitability\Models\ClientAccountManager;
use App\Profitability\Models\ContractPeriod;
use App\Profitability\Models\MemberCostRate;
use App\Profitability\Models\ProjectContract;
use App\Profitability\Models\ProjectManager;
use App\Profitability\ProfitabilityServiceProvider;
use App\Profitability\Reporting\ConsumptionQuery;
use App\Profitability\Reporting\ProjectBalanceService;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

/**
 * Money in the project summary (BUDG-05, BUDG-06; D-07, D-08, D-11, D-19): cost is each entry's
 * duration times the hourly cost in force on the entry's local start date for its member, people without
 * a cost row are unpriced (never free), revenue is spread evenly over the months of the period, and the
 * money keys exist only for Owner, Admin and account managers of the client.
 *
 * Fixture: member A costs 3000 cents/h from 2026-01-01 and 4000 from 2026-11-10; member B has no cost;
 * the November 2026 period sold 40 h for 300000 cents; today is 2026-11-18 (Europe/Madrid).
 */
#[CoversClass(ProjectBalanceService::class)]
#[CoversClass(ConsumptionQuery::class)]
#[CoversClass(ProjectSummaryController::class)]
#[UsesClass(ProfitabilityAccess::class)]
#[UsesClass(AccessScope::class)]
#[UsesClass(ProjectContract::class)]
#[UsesClass(ContractPeriod::class)]
#[UsesClass(MemberCostRate::class)]
#[UsesClass(ProjectManager::class)]
#[UsesClass(ClientAccountManager::class)]
#[UsesClass(ProfitabilityServiceProvider::class)]
class DatedCostTest extends TestCaseWithDatabase
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
     * @return object{data: object, client: Client, project: Project, memberA: Member, memberB: Member}
     */
    private function fixture(Role $role = Role::Owner): object
    {
        $data = $this->createUserWithRole($role);
        $client = Client::factory()->forOrganization($data->organization)->create(['name' => 'Client A']);
        $project = Project::factory()->forOrganization($data->organization)->forClient($client)->billable()->create();
        $memberA = Member::factory()->forOrganization($data->organization)->role(Role::Employee)->create();
        $memberB = Member::factory()->forOrganization($data->organization)->role(Role::Employee)->create();
        $this->costRate($memberA, '2026-01-01', 3000);
        $this->costRate($memberA, '2026-11-10', 4000);
        $this->contractWithPeriod($project, 'monthly', '2026-11-01', '2026-11-30', 144000, 300000);

        return (object) [
            'data' => $data,
            'client' => $client,
            'project' => $project,
            'memberA' => $memberA,
            'memberB' => $memberB,
        ];
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

    private function contractWithPeriod(Project $project, string $schedule, string $startsOn, string $endsOn, int $budgetSeconds, int $amountCents): ContractPeriod
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

        return ContractPeriod::query()->create([
            'organization_id' => $project->organization_id,
            'contract_id' => $contract->getKey(),
            'starts_on' => $startsOn,
            'ends_on' => $endsOn,
            'amount_cents' => $amountCents,
            'budget_seconds' => $budgetSeconds,
        ]);
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

    public function test_cost_uses_the_rate_effective_on_each_entry_date(): void
    {
        // Arrange
        $fixture = $this->fixture();
        $this->workEntry($fixture->memberA, $fixture->project, '2026-11-05 09:00:00', 3600);
        $this->workEntry($fixture->memberA, $fixture->project, '2026-11-12 09:00:00', 3600);
        $this->actAs($fixture->data->user);

        // Act
        $response = $this->getSummary($fixture->data->organization, $fixture->project->getKey());

        // Assert
        $response->assertOk();
        $response->assertJsonPath('data.period.consumed_seconds', 7200);
        $response->assertJsonPath('data.period.cost_cents', 7000);
        $response->assertJsonPath('data.period.unpriced_cost_seconds', 0);
    }

    public function test_rate_date_is_the_entry_local_start_date(): void
    {
        // Arrange: 2026-11-09 23:30 UTC is 2026-11-10 00:30 in Madrid, the first day of the 4000 rate;
        // 2026-11-09 22:30 UTC is still 2026-11-09 23:30 in Madrid
        $fixture = $this->fixture();
        $this->workEntry($fixture->memberA, $fixture->project, '2026-11-09 23:30:00', 3600);
        $this->workEntry($fixture->memberA, $fixture->project, '2026-11-09 21:30:00', 3600);
        $this->actAs($fixture->data->user);

        // Act
        $response = $this->getSummary($fixture->data->organization, $fixture->project->getKey());

        // Assert
        $response->assertOk();
        $response->assertJsonPath('data.period.cost_cents', 7000);
    }

    public function test_a_retroactive_rate_changes_only_entries_from_its_date(): void
    {
        // Arrange
        $fixture = $this->fixture();
        $this->workEntry($fixture->memberA, $fixture->project, '2026-11-05 09:00:00', 3600);
        $this->workEntry($fixture->memberA, $fixture->project, '2026-11-11 09:00:00', 3600);
        $this->workEntry($fixture->memberA, $fixture->project, '2026-11-13 09:00:00', 3600);
        $this->actAs($fixture->data->user);
        $before = $this->getSummary($fixture->data->organization, $fixture->project->getKey());

        // Act: a cost row entered today but effective from 12 November
        $this->costRate($fixture->memberA, '2026-11-12', 5000);
        $after = $this->getSummary($fixture->data->organization, $fixture->project->getKey());

        // Assert
        $before->assertOk();
        $before->assertJsonPath('data.period.cost_cents', 3000 + 4000 + 4000);
        $after->assertOk();
        $after->assertJsonPath('data.period.cost_cents', 3000 + 4000 + 5000);
    }

    public function test_member_without_rate_is_unpriced_not_free(): void
    {
        // Arrange
        $fixture = $this->fixture();
        $this->workEntry($fixture->memberA, $fixture->project, '2026-11-05 09:00:00', 3600);
        $this->workEntry($fixture->memberB, $fixture->project, '2026-11-06 09:00:00', 3600);
        $this->actAs($fixture->data->user);

        // Act
        $response = $this->getSummary($fixture->data->organization, $fixture->project->getKey());

        // Assert
        $response->assertOk();
        $response->assertJsonPath('data.period.consumed_seconds', 7200);
        $response->assertJsonPath('data.period.cost_cents', 3000);
        $response->assertJsonPath('data.period.unpriced_cost_seconds', 3600);
        // November is the only month of the period and it has started: the whole amount is revenue
        $response->assertJsonPath('data.period.revenue_to_date_cents', 300000);
        $response->assertJsonPath('data.period.margin_cents', 300000 - 3000);
    }

    public function test_owner_and_account_manager_see_money_keys(): void
    {
        // Arrange
        $fixture = $this->fixture(Role::Employee);
        $assignment = new ClientAccountManager(['client_id' => $fixture->client->getKey(), 'member_id' => $fixture->data->member->getKey()]);
        $assignment->organization_id = $fixture->data->organization->getKey();
        $assignment->save();
        $this->workEntry($fixture->memberA, $fixture->project, '2026-11-05 09:00:00', 3600);
        $moneyKeys = ['amount_cents', 'revenue_to_date_cents', 'cost_cents', 'margin_cents', 'unpriced_cost_seconds'];

        // Act
        $this->actAs($fixture->data->owner);
        $owner = $this->getSummary($fixture->data->organization, $fixture->project->getKey());
        $this->actAs($fixture->data->user);
        $accountManager = $this->getSummary($fixture->data->organization, $fixture->project->getKey());

        // Assert
        foreach ([$owner, $accountManager] as $response) {
            $response->assertOk();
            $period = $response->json('data.period');
            $this->assertIsArray($period);
            foreach ($moneyKeys as $key) {
                $this->assertArrayHasKey($key, $period);
            }
            $response->assertJsonPath('data.period.amount_cents', 300000);
            $response->assertJsonPath('data.period.cost_cents', 3000);
        }
    }

    public function test_project_manager_sees_no_money_key(): void
    {
        // Arrange
        $fixture = $this->fixture(Role::Employee);
        $assignment = new ProjectManager(['project_id' => $fixture->project->getKey(), 'member_id' => $fixture->data->member->getKey()]);
        $assignment->organization_id = $fixture->data->organization->getKey();
        $assignment->save();
        $this->workEntry($fixture->memberA, $fixture->project, '2026-11-05 09:00:00', 3600);
        $this->workEntry($fixture->memberB, $fixture->project, '2026-11-06 09:00:00', 3600);
        $this->actAs($fixture->data->user);

        // Act
        $response = $this->getSummary($fixture->data->organization, $fixture->project->getKey());

        // Assert
        $response->assertOk();
        $response->assertJsonPath('data.period.consumed_seconds', 7200);
        $json = $response->json();
        $this->assertIsArray($json);
        $this->assertNoKeyMatches($json, self::MONEY_KEY);
    }

    public function test_revenue_to_date_is_straight_line_per_month(): void
    {
        // Arrange: a quarterly period October to December; on 18 November two of its three months started
        $data = $this->createUserWithRole(Role::Owner);
        $project = Project::factory()->forOrganization($data->organization)->billable()->create();
        $member = Member::factory()->forOrganization($data->organization)->role(Role::Employee)->create();
        $this->costRate($member, '2026-01-01', 3000);
        $this->contractWithPeriod($project, 'quarterly', '2026-10-01', '2026-12-31', 432000, 300000);
        $this->workEntry($member, $project, '2026-10-15 09:00:00', 7200);
        $this->actAs($data->user);

        // Act
        $response = $this->getSummary($data->organization, $project->getKey());

        // Assert
        $response->assertOk();
        $response->assertJsonPath('data.period.starts_on', '2026-10-01');
        $response->assertJsonPath('data.period.amount_cents', 300000);
        $response->assertJsonPath('data.period.revenue_to_date_cents', 200000);
        $response->assertJsonPath('data.period.cost_cents', 6000);
        $response->assertJsonPath('data.period.margin_cents', 200000 - 6000);
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
