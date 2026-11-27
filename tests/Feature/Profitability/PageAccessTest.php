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
use App\Profitability\Http\Controllers\ProfitabilityPageController;
use App\Profitability\Http\Middleware\ShareProfitabilityInertiaData;
use App\Profitability\Models\ClientAccountManager;
use App\Profitability\Models\ProjectManager;
use App\Profitability\ProfitabilityServiceProvider;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

/**
 * The Profitability page exists only for the scopes D-16 allows: Owner/Admin (four tabs), account managers
 * (Projects and Clients, no admin copy) and project managers (Projects only, no money copy). Employees, core
 * managers without an assignment and users outside the organization get a plain 404.
 */
#[CoversClass(ProfitabilityPageController::class)]
#[UsesClass(ShareProfitabilityInertiaData::class)]
#[UsesClass(ProfitabilityAccess::class)]
#[UsesClass(AccessScope::class)]
#[UsesClass(ProjectManager::class)]
#[UsesClass(ClientAccountManager::class)]
#[UsesClass(ProfitabilityServiceProvider::class)]
class PageAccessTest extends TestCaseWithDatabase
{
    /**
     * createUserWithRole associates the current organization of a non-owner without saving it.
     */
    private function actAs(User $user): void
    {
        $user->save();
        $this->actingAs($user);
    }

    private function getPage(): TestResponse
    {
        return $this->get(route('profitability', [], false));
    }

    /**
     * The `profitability` prop of a 200 response that rendered the Profitability component.
     *
     * @return array<string, mixed>
     */
    private function pageProp(TestResponse $response): array
    {
        $response->assertOk();
        $prop = null;
        $response->assertInertia(function (AssertableInertia $page) use (&$prop): void {
            $page->component('Profitability');
            $prop = $page->toArray()['props']['profitability'] ?? null;
        });
        $this->assertIsArray($prop);

        /** @var array<string, mixed> $prop */
        return $prop;
    }

    /**
     * @param  array<string, mixed>  $prop
     * @return array<string, mixed>
     */
    private function labels(array $prop): array
    {
        $labels = $prop['labels'] ?? null;
        $this->assertIsArray($labels);

        /** @var array<string, mixed> $labels */
        return $labels;
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

    public function test_owner_and_admin_get_the_page_with_all_four_views(): void
    {
        foreach ([Role::Owner, Role::Admin] as $role) {
            // Arrange
            $data = $this->createUserWithRole($role);
            $this->actAs($data->user);

            // Act
            $prop = $this->pageProp($this->getPage());

            // Assert
            $this->assertSame(['projects', 'clients', 'people', 'settings'], $prop['views'], $role->value);
            $this->assertSame(url('profitability/organizations/'.$data->organization->getKey()), $prop['organization_url']);
            $labels = $this->labels($prop);
            $this->assertArrayHasKey('money', $labels);
            $this->assertArrayHasKey('admin', $labels);
        }
    }

    public function test_account_manager_gets_projects_and_clients_without_the_admin_copy(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Employee);
        $client = Client::factory()->forOrganization($data->organization)->create();
        $this->assignAccountManager($client, $data->member);
        $this->actAs($data->user);

        // Act
        $prop = $this->pageProp($this->getPage());

        // Assert
        $this->assertSame(['projects', 'clients'], $prop['views']);
        $labels = $this->labels($prop);
        $this->assertArrayHasKey('money', $labels);
        $this->assertArrayNotHasKey('admin', $labels);
    }

    public function test_project_manager_gets_projects_only_without_the_money_copy(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Employee);
        $project = Project::factory()->forOrganization($data->organization)->billable()->create();
        $this->assignProjectManager($project, $data->member);
        $this->actAs($data->user);

        // Act
        $prop = $this->pageProp($this->getPage());

        // Assert
        $this->assertSame(['projects'], $prop['views']);
        $labels = $this->labels($prop);
        $this->assertArrayNotHasKey('money', $labels);
        $this->assertArrayNotHasKey('admin', $labels);
        $this->assertArrayHasKey('projects', $labels);
    }

    public function test_employee_gets_a_404(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Employee);
        $this->actAs($data->user);

        // Act
        $response = $this->getPage();

        // Assert
        $response->assertNotFound();
    }

    public function test_core_manager_without_an_assignment_gets_a_404(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Manager);
        $this->actAs($data->user);

        // Act
        $response = $this->getPage();

        // Assert
        $response->assertNotFound();
    }

    public function test_a_user_of_another_organization_gets_a_404(): void
    {
        // Arrange: the owner of organization B points its current organization at A, where it is no member
        $a = $this->createUserWithRole(Role::Owner);
        $b = $this->createUserWithRole(Role::Owner);
        $b->user->current_team_id = $a->organization->getKey();
        $this->actAs($b->user);

        // Act
        $response = $this->getPage();

        // Assert
        $response->assertNotFound();
    }

    public function test_guest_is_redirected_to_login(): void
    {
        // Act
        $response = $this->get(route('profitability', [], false));

        // Assert
        $response->assertRedirect(route('login', [], false));
    }
}
