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
use App\Profitability\Http\Controllers\ProjectSummaryController;
use App\Profitability\Models\ClientAccountManager;
use App\Profitability\Models\ContractPeriod;
use App\Profitability\Models\ProjectContract;
use App\Profitability\Models\ProjectManager;
use App\Profitability\ProfitabilityServiceProvider;
use App\Profitability\Reporting\ConsumptionQuery;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

/**
 * Project and account manager assignments drive what a non-admin reads of the project summary
 * (D-10, D-11, D-16): a project manager gets the hours of the projects they manage and never money, an
 * account manager gets every project of their clients and may edit the terms, and a core role alone
 * grants nothing.
 */
#[CoversClass(ProfitabilityAccess::class)]
#[CoversClass(AccessScope::class)]
#[UsesClass(ProjectSummaryController::class)]
#[UsesClass(ConsumptionQuery::class)]
#[UsesClass(ProjectManager::class)]
#[UsesClass(ClientAccountManager::class)]
#[UsesClass(ProjectContract::class)]
#[UsesClass(ContractPeriod::class)]
#[UsesClass(ProfitabilityServiceProvider::class)]
class ScopedSummaryAccessTest extends TestCaseWithDatabase
{
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
     * Client A with two billable projects (the first with a contract and its current period) and client B
     * with one billable project under contract.
     *
     * @return object{clientA: Client, clientB: Client, projectA: Project, secondProjectA: Project, projectB: Project}
     */
    private function portfolio(Organization $organization): object
    {
        $clientA = Client::factory()->forOrganization($organization)->create(['name' => 'Client A']);
        $clientB = Client::factory()->forOrganization($organization)->create(['name' => 'Client B']);
        $projectA = Project::factory()->forOrganization($organization)->forClient($clientA)->billable()->create();
        $secondProjectA = Project::factory()->forOrganization($organization)->forClient($clientA)->billable()->create();
        $projectB = Project::factory()->forOrganization($organization)->forClient($clientB)->billable()->create();
        $this->contractWithNovemberPeriod($projectA);
        $this->contractWithNovemberPeriod($projectB);

        return (object) [
            'clientA' => $clientA,
            'clientB' => $clientB,
            'projectA' => $projectA,
            'secondProjectA' => $secondProjectA,
            'projectB' => $projectB,
        ];
    }

    private function contractWithNovemberPeriod(Project $project): ContractPeriod
    {
        $contract = ProjectContract::query()->create([
            'organization_id' => $project->organization_id,
            'project_id' => $project->getKey(),
            'service' => 'SEO retainer',
            'schedule' => 'monthly',
            'starts_on' => '2026-01-01',
            'ends_on' => null,
            'amount_cents' => 250000,
            'budget_seconds' => 72000,
        ]);

        return ContractPeriod::query()->create([
            'organization_id' => $project->organization_id,
            'contract_id' => $contract->getKey(),
            'starts_on' => '2026-11-01',
            'ends_on' => '2026-11-30',
            'amount_cents' => 250000,
            'budget_seconds' => 72000,
        ]);
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

    private function getSummary(Organization $organization, string $projectId): TestResponse
    {
        return $this->getJson(route('profitability.projects.summary', [
            'organization' => $organization->getKey(),
            'project' => $projectId,
        ], false));
    }

    public function test_employee_project_manager_reads_hours_without_money(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Employee);
        $portfolio = $this->portfolio($data->organization);
        $this->assignProjectManager($portfolio->projectA, $data->member);
        $this->actAs($data->user);

        // Act
        $response = $this->getSummary($data->organization, $portfolio->projectA->getKey());

        // Assert
        $response->assertOk();
        $response->assertJsonPath('data.project_id', $portfolio->projectA->getKey());
        $response->assertJsonPath('data.can_edit_plan', true);
        $response->assertJsonPath('data.can_edit_terms', false);
        $response->assertJsonPath('data.period.budget_seconds', 72000);
        $json = $response->json();
        $this->assertIsArray($json);
        $this->assertNoKeyMatches($json, '/(amount|cost|margin|revenue|cents)/i');
    }

    public function test_project_manager_gets_404_on_a_project_they_do_not_manage(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Employee);
        $portfolio = $this->portfolio($data->organization);
        $this->assignProjectManager($portfolio->projectA, $data->member);
        $this->actAs($data->user);

        // Act
        $sameClient = $this->getSummary($data->organization, $portfolio->secondProjectA->getKey());
        $otherClient = $this->getSummary($data->organization, $portfolio->projectB->getKey());

        // Assert
        $sameClient->assertNotFound();
        $otherClient->assertNotFound();
        $this->assertNull($otherClient->json('data'));
    }

    public function test_account_manager_reads_every_project_of_their_client_and_may_edit_terms(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Employee);
        $portfolio = $this->portfolio($data->organization);
        $this->assignAccountManager($portfolio->clientA, $data->member);
        $this->actAs($data->user);

        // Act
        $underContract = $this->getSummary($data->organization, $portfolio->projectA->getKey());
        $withoutContract = $this->getSummary($data->organization, $portfolio->secondProjectA->getKey());

        // Assert
        $underContract->assertOk();
        $underContract->assertJsonPath('data.project_id', $portfolio->projectA->getKey());
        $underContract->assertJsonPath('data.can_edit_terms', true);
        $underContract->assertJsonPath('data.can_edit_plan', false);
        $underContract->assertJsonPath('data.period.budget_seconds', 72000);
        $withoutContract->assertOk();
        $withoutContract->assertJsonPath('data.project_id', $portfolio->secondProjectA->getKey());
        $withoutContract->assertJsonPath('data.can_edit_terms', true);
        $withoutContract->assertJsonPath('data.contract', null);
    }

    public function test_account_manager_gets_404_on_another_clients_project(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Manager);
        $portfolio = $this->portfolio($data->organization);
        $clientless = Project::factory()->forOrganization($data->organization)->billable()->create();
        $this->assignAccountManager($portfolio->clientA, $data->member);
        $this->actAs($data->user);

        // Act
        $otherClient = $this->getSummary($data->organization, $portfolio->projectB->getKey());
        $withoutClient = $this->getSummary($data->organization, $clientless->getKey());

        // Assert
        $otherClient->assertNotFound();
        $withoutClient->assertNotFound();
    }

    public function test_manager_role_without_assignment_gets_404_and_prop_disabled(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Manager);
        $portfolio = $this->portfolio($data->organization);
        // Another member's assignment gives this core Manager nothing
        $other = Member::factory()->forOrganization($data->organization)->role(Role::Employee)->create();
        $this->assignProjectManager($portfolio->projectA, $other);
        $this->assignAccountManager($portfolio->clientA, $other);
        $this->actAs($data->user);

        // Act
        $responses = [
            $this->getSummary($data->organization, $portfolio->projectA->getKey()),
            $this->getSummary($data->organization, $portfolio->secondProjectA->getKey()),
            $this->getSummary($data->organization, $portfolio->projectB->getKey()),
        ];
        $dashboard = $this->get(route('dashboard', [], false));

        // Assert
        foreach ($responses as $response) {
            $response->assertNotFound();
            $this->assertNull($response->json('data'));
        }
        $scope = app(ProfitabilityAccess::class)->forUser($data->organization, $data->user);
        $this->assertFalse($scope->hasAnyAccess());
        $this->assertSame([], $scope->views());
        $dashboard->assertOk();
        $dashboard->assertInertia(fn (AssertableInertia $page) => $page
            ->where('profitability', ['enabled' => false])
            ->etc());
    }

    public function test_assignment_in_another_organization_grants_nothing(): void
    {
        // Arrange: the user is an employee of both organizations and manages a project and a client in
        // the foreign one only
        $data = $this->createUserWithRole(Role::Employee);
        $portfolio = $this->portfolio($data->organization);
        $foreign = $this->createUserWithRole(Role::Owner);
        $foreignPortfolio = $this->portfolio($foreign->organization);
        $foreignMember = Member::factory()->forUser($data->user)->forOrganization($foreign->organization)
            ->role(Role::Employee)->create();
        $this->assignProjectManager($foreignPortfolio->projectA, $foreignMember);
        $this->assignAccountManager($foreignPortfolio->clientA, $foreignMember);
        $this->actAs($data->user);

        // Act
        $ownProject = $this->getSummary($data->organization, $portfolio->projectA->getKey());
        $foreignProjectThroughOwnOrganization = $this->getSummary($data->organization, $foreignPortfolio->projectA->getKey());

        // Assert
        $ownProject->assertNotFound();
        $foreignProjectThroughOwnOrganization->assertNotFound();
        $scope = app(ProfitabilityAccess::class)->forUser($data->organization, $data->user);
        $this->assertFalse($scope->hasAnyAccess());
        $this->assertSame([], $scope->managedProjectIds());
        $this->assertSame([], $scope->accountClientIds());
    }

    public function test_placeholder_with_an_assignment_row_gets_nothing(): void
    {
        // Arrange: a row written before the member became a placeholder
        $data = $this->createUserWithRole(Role::Employee);
        $portfolio = $this->portfolio($data->organization);
        $this->assignProjectManager($portfolio->projectA, $data->member);
        $this->assignAccountManager($portfolio->clientA, $data->member);
        $data->member->role = Role::Placeholder->value;
        $data->member->save();
        $this->actAs($data->user);

        // Act
        $response = $this->getSummary($data->organization, $portfolio->projectA->getKey());

        // Assert
        $response->assertNotFound();
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
