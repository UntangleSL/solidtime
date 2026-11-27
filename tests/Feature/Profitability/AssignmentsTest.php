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
use App\Profitability\Http\Controllers\AssignmentController;
use App\Profitability\Http\Requests\AssignmentRequest;
use App\Profitability\Models\ClientAccountManager;
use App\Profitability\Models\ProjectManager;
use App\Profitability\ProfitabilityServiceProvider;
use App\Service\PermissionStore;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

/**
 * Owner and Admin manage project managers and account managers (D-10, D-12, D-16, A7, A8); nobody else
 * reaches the settings endpoints, and core roles stay untouched (BUDG-07).
 */
#[CoversClass(AssignmentController::class)]
#[CoversClass(AssignmentRequest::class)]
#[UsesClass(ProfitabilityAccess::class)]
#[UsesClass(AccessScope::class)]
#[UsesClass(ProjectManager::class)]
#[UsesClass(ClientAccountManager::class)]
#[UsesClass(ProfitabilityServiceProvider::class)]
class AssignmentsTest extends TestCaseWithDatabase
{
    /**
     * createUserWithRole associates the current organization of a non-owner without saving it.
     */
    private function actAs(User $user): void
    {
        $user->save();
        $this->actingAs($user);
    }

    private function namedMember(Organization $organization, string $name, Role $role = Role::Employee): Member
    {
        $user = User::factory()->create(['name' => $name]);

        return Member::factory()->forUser($user)->forOrganization($organization)->role($role)->create();
    }

    private function listManagers(Organization $organization): TestResponse
    {
        return $this->getJson(route('profitability.settings.managers', [
            'organization' => $organization->getKey(),
        ], false));
    }

    private function addProjectManager(Organization $organization, string $projectId, string $memberId): TestResponse
    {
        return $this->postJson(route('profitability.settings.project-managers.store', [
            'organization' => $organization->getKey(),
            'project' => $projectId,
        ], false), ['member_id' => $memberId]);
    }

    private function removeProjectManager(Organization $organization, string $projectId, string $memberId): TestResponse
    {
        return $this->deleteJson(route('profitability.settings.project-managers.destroy', [
            'organization' => $organization->getKey(),
            'project' => $projectId,
            'member' => $memberId,
        ], false));
    }

    private function addAccountManager(Organization $organization, string $clientId, string $memberId): TestResponse
    {
        return $this->postJson(route('profitability.settings.account-managers.store', [
            'organization' => $organization->getKey(),
            'client' => $clientId,
        ], false), ['member_id' => $memberId]);
    }

    private function removeAccountManager(Organization $organization, string $clientId, string $memberId): TestResponse
    {
        return $this->deleteJson(route('profitability.settings.account-managers.destroy', [
            'organization' => $organization->getKey(),
            'client' => $clientId,
            'member' => $memberId,
        ], false));
    }

    private function projectManagerRows(string $projectId): int
    {
        return ProjectManager::query()->where('project_id', '=', $projectId)->count();
    }

    private function accountManagerRows(string $clientId): int
    {
        return ClientAccountManager::query()->where('client_id', '=', $clientId)->count();
    }

    public function test_owner_lists_clients_billable_projects_and_assignable_members(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $organization = $data->organization;
        $zoe = $this->namedMember($organization, 'Zoe Zapata');
        $ana = $this->namedMember($organization, 'Ana Alonso', Role::Manager);
        $this->namedMember($organization, 'Pablo Placeholder', Role::Placeholder);
        $clientB = Client::factory()->forOrganization($organization)->create(['name' => 'Beta']);
        $clientA = Client::factory()->forOrganization($organization)->create(['name' => 'Alpha']);
        $project = Project::factory()->forOrganization($organization)->forClient($clientA)->billable()
            ->create(['name' => 'Retainer']);
        Project::factory()->forOrganization($organization)->forClient($clientA)
            ->create(['name' => 'Internal', 'is_billable' => false]);
        Project::factory()->forOrganization($organization)->forClient($clientB)->billable()->archived()
            ->create(['name' => 'Old campaign']);
        $this->actAs($data->user);
        $this->addAccountManager($organization, $clientA->getKey(), $zoe->getKey())->assertNoContent();
        $this->addAccountManager($organization, $clientA->getKey(), $ana->getKey())->assertNoContent();
        $this->addProjectManager($organization, $project->getKey(), $zoe->getKey())->assertNoContent();

        // Act
        $response = $this->listManagers($organization);

        // Assert
        $response->assertOk();
        $response->assertJsonPath('data.clients.0.id', $clientA->getKey());
        $response->assertJsonPath('data.clients.0.name', 'Alpha');
        $response->assertJsonPath('data.clients.0.account_managers', [
            ['member_id' => $ana->getKey(), 'name' => 'Ana Alonso'],
            ['member_id' => $zoe->getKey(), 'name' => 'Zoe Zapata'],
        ]);
        $response->assertJsonPath('data.clients.1.id', $clientB->getKey());
        $response->assertJsonPath('data.clients.1.account_managers', []);
        $response->assertJsonCount(1, 'data.projects');
        $response->assertJsonPath('data.projects.0', [
            'id' => $project->getKey(),
            'name' => 'Retainer',
            'client_id' => $clientA->getKey(),
            'client_name' => 'Alpha',
            'project_managers' => [['member_id' => $zoe->getKey(), 'name' => 'Zoe Zapata']],
        ]);
        $members = $response->json('data.members');
        $this->assertIsArray($members);
        $memberIds = array_column($members, 'member_id');
        $this->assertContains($zoe->getKey(), $memberIds);
        $this->assertContains($ana->getKey(), $memberIds);
        $this->assertContains($data->member->getKey(), $memberIds);
        $this->assertNotContains(Role::Placeholder->value, array_column($members, 'role'));
        $names = array_column($members, 'name');
        $sorted = $names;
        usort($sorted, 'strnatcasecmp');
        $this->assertSame($sorted, $names);
    }

    public function test_owner_adds_a_project_manager_twice_and_keeps_one_row_then_removes_it(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = Project::factory()->forOrganization($data->organization)->billable()->create();
        $member = $this->namedMember($data->organization, 'Paula Manager');
        $this->actAs($data->user);

        // Act
        $first = $this->addProjectManager($data->organization, $project->getKey(), $member->getKey());
        $second = $this->addProjectManager($data->organization, $project->getKey(), $member->getKey());
        $rowsAfterAdd = $this->projectManagerRows($project->getKey());
        $removed = $this->removeProjectManager($data->organization, $project->getKey(), $member->getKey());
        $removedAgain = $this->removeProjectManager($data->organization, $project->getKey(), $member->getKey());

        // Assert
        $first->assertNoContent();
        $second->assertNoContent();
        $this->assertSame(1, $rowsAfterAdd);
        $removed->assertNoContent();
        $removedAgain->assertNoContent();
        $this->assertSame(0, $this->projectManagerRows($project->getKey()));
    }

    public function test_admin_adds_an_account_manager_idempotently_and_removes_it(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Admin);
        $client = Client::factory()->forOrganization($data->organization)->create();
        $member = $this->namedMember($data->organization, 'Carla Account', Role::Manager);
        $this->actAs($data->user);

        // Act
        $first = $this->addAccountManager($data->organization, $client->getKey(), $member->getKey());
        $second = $this->addAccountManager($data->organization, $client->getKey(), $member->getKey());
        $rowsAfterAdd = $this->accountManagerRows($client->getKey());
        /** @var ClientAccountManager $row */
        $row = ClientAccountManager::query()->where('client_id', '=', $client->getKey())->firstOrFail();
        $removed = $this->removeAccountManager($data->organization, $client->getKey(), $member->getKey());

        // Assert
        $first->assertNoContent();
        $second->assertNoContent();
        $this->assertSame(1, $rowsAfterAdd);
        $this->assertSame($data->organization->getKey(), $row->organization_id);
        $this->assertSame($member->getKey(), $row->member_id);
        $removed->assertNoContent();
        $this->assertSame(0, $this->accountManagerRows($client->getKey()));
    }

    public function test_every_non_admin_gets_404_on_every_action(): void
    {
        // Arrange: an account manager, a project manager, a plain employee and a core manager
        $data = $this->createUserWithRole(Role::Owner);
        $organization = $data->organization;
        $client = Client::factory()->forOrganization($organization)->create();
        $project = Project::factory()->forOrganization($organization)->forClient($client)->billable()->create();
        $target = $this->namedMember($organization, 'Target Member');
        $accountManager = $this->namedMember($organization, 'Account Manager');
        $projectManager = $this->namedMember($organization, 'Project Manager');
        $employee = $this->namedMember($organization, 'Plain Employee');
        $coreManager = $this->namedMember($organization, 'Core Manager', Role::Manager);
        $this->actAs($data->user);
        $this->addAccountManager($organization, $client->getKey(), $accountManager->getKey())->assertNoContent();
        $this->addProjectManager($organization, $project->getKey(), $projectManager->getKey())->assertNoContent();
        $this->addAccountManager($organization, $client->getKey(), $target->getKey())->assertNoContent();
        $this->addProjectManager($organization, $project->getKey(), $target->getKey())->assertNoContent();

        foreach ([$accountManager, $projectManager, $employee, $coreManager] as $caller) {
            $user = $caller->user;
            $user->currentOrganization()->associate($organization);
            $this->actAs($user);

            // Act
            $responses = [
                'index' => $this->listManagers($organization),
                'add project manager' => $this->addProjectManager($organization, $project->getKey(), $caller->getKey()),
                'remove project manager' => $this->removeProjectManager($organization, $project->getKey(), $target->getKey()),
                'add account manager' => $this->addAccountManager($organization, $client->getKey(), $caller->getKey()),
                'remove account manager' => $this->removeAccountManager($organization, $client->getKey(), $target->getKey()),
                'add with an empty body' => $this->postJson(route('profitability.settings.project-managers.store', [
                    'organization' => $organization->getKey(),
                    'project' => $project->getKey(),
                ], false), []),
            ];

            // Assert
            foreach ($responses as $action => $response) {
                $this->assertSame(404, $response->status(), $user->name.' must get 404 on '.$action);
            }
        }
        $this->assertSame(2, $this->projectManagerRows($project->getKey()));
        $this->assertSame(2, $this->accountManagerRows($client->getKey()));
    }

    public function test_placeholder_member_cannot_be_assigned(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $client = Client::factory()->forOrganization($data->organization)->create();
        $project = Project::factory()->forOrganization($data->organization)->forClient($client)->billable()->create();
        $placeholder = Member::factory()->forOrganization($data->organization)->role(Role::Placeholder)->create();
        $this->actAs($data->user);

        // Act
        $asProjectManager = $this->addProjectManager($data->organization, $project->getKey(), $placeholder->getKey());
        $asAccountManager = $this->addAccountManager($data->organization, $client->getKey(), $placeholder->getKey());

        // Assert
        $asProjectManager->assertStatus(422);
        $asProjectManager->assertJsonValidationErrors(['member_id']);
        $asAccountManager->assertStatus(422);
        $asAccountManager->assertJsonValidationErrors(['member_id']);
        $this->assertSame(0, $this->projectManagerRows($project->getKey()));
        $this->assertSame(0, $this->accountManagerRows($client->getKey()));
    }

    public function test_member_of_another_organization_or_unknown_member_is_rejected(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $foreign = $this->createUserWithRole(Role::Employee);
        $client = Client::factory()->forOrganization($data->organization)->create();
        $project = Project::factory()->forOrganization($data->organization)->forClient($client)->billable()->create();
        $this->actAs($data->user);

        // Act
        $foreignAsProjectManager = $this->addProjectManager($data->organization, $project->getKey(), $foreign->member->getKey());
        $foreignAsAccountManager = $this->addAccountManager($data->organization, $client->getKey(), $foreign->member->getKey());
        $unknown = $this->addProjectManager($data->organization, $project->getKey(), '7b4c5d3e-1f2a-4b6c-8d9e-0a1b2c3d4e5f');
        $notAUuid = $this->addAccountManager($data->organization, $client->getKey(), 'not-a-uuid');

        // Assert
        foreach ([$foreignAsProjectManager, $foreignAsAccountManager, $unknown, $notAUuid] as $response) {
            $response->assertStatus(422);
            $response->assertJsonValidationErrors(['member_id']);
        }
        $this->assertSame(0, ProjectManager::query()->count());
        $this->assertSame(0, ClientAccountManager::query()->count());
    }

    public function test_project_or_client_of_another_organization_gets_404(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $foreign = $this->createUserWithRole(Role::Owner);
        $member = $this->namedMember($data->organization, 'Own Member');
        $foreignClient = Client::factory()->forOrganization($foreign->organization)->create();
        $foreignProject = Project::factory()->forOrganization($foreign->organization)->forClient($foreignClient)
            ->billable()->create();
        $ownProject = Project::factory()->forOrganization($data->organization)->billable()->create();
        $this->actAs($data->user);

        // Act
        $responses = [
            $this->addProjectManager($data->organization, $foreignProject->getKey(), $member->getKey()),
            $this->removeProjectManager($data->organization, $foreignProject->getKey(), $member->getKey()),
            $this->addAccountManager($data->organization, $foreignClient->getKey(), $member->getKey()),
            $this->removeAccountManager($data->organization, $foreignClient->getKey(), $member->getKey()),
            // A member of another organization in the route of a removal
            $this->removeProjectManager($data->organization, $ownProject->getKey(), $foreign->member->getKey()),
            // An organization the caller is not a member of
            $this->listManagers($foreign->organization),
            $this->addProjectManager($foreign->organization, $foreignProject->getKey(), $foreign->member->getKey()),
        ];

        // Assert
        foreach ($responses as $index => $response) {
            $this->assertSame(404, $response->status(), 'Request '.$index.' must be a 404');
        }
        $this->assertSame(0, ProjectManager::query()->count());
        $this->assertSame(0, ClientAccountManager::query()->count());
    }

    public function test_non_billable_project_cannot_get_a_project_manager(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = Project::factory()->forOrganization($data->organization)->create(['is_billable' => false]);
        $member = $this->namedMember($data->organization, 'Paula Manager');
        $this->actAs($data->user);

        // Act
        $response = $this->addProjectManager($data->organization, $project->getKey(), $member->getKey());

        // Assert
        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['project_id']);
        $this->assertSame(0, $this->projectManagerRows($project->getKey()));
    }

    public function test_deleting_the_member_removes_their_assignments(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $client = Client::factory()->forOrganization($data->organization)->create();
        $project = Project::factory()->forOrganization($data->organization)->forClient($client)->billable()->create();
        $member = $this->namedMember($data->organization, 'Leaving Member');
        $this->actAs($data->user);
        $this->addProjectManager($data->organization, $project->getKey(), $member->getKey())->assertNoContent();
        $this->addAccountManager($data->organization, $client->getKey(), $member->getKey())->assertNoContent();

        // Act: bulk delete, no model events (the cascade lives in the database)
        Member::query()->whereKey($member->getKey())->delete();

        // Assert
        $this->assertSame(0, $this->projectManagerRows($project->getKey()));
        $this->assertSame(0, $this->accountManagerRows($client->getKey()));
    }

    public function test_deleting_the_project_removes_its_project_managers(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = Project::factory()->forOrganization($data->organization)->billable()->create();
        $member = $this->namedMember($data->organization, 'Paula Manager');
        $this->actAs($data->user);
        $this->addProjectManager($data->organization, $project->getKey(), $member->getKey())->assertNoContent();

        // Act
        Project::query()->whereKey($project->getKey())->delete();

        // Assert
        $this->assertSame(0, $this->projectManagerRows($project->getKey()));
        $this->assertTrue(Member::query()->whereKey($member->getKey())->exists());
    }

    public function test_deleting_the_client_removes_its_account_managers(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $client = Client::factory()->forOrganization($data->organization)->create();
        $member = $this->namedMember($data->organization, 'Carla Account');
        $this->actAs($data->user);
        $this->addAccountManager($data->organization, $client->getKey(), $member->getKey())->assertNoContent();

        // Act
        Client::query()->whereKey($client->getKey())->delete();

        // Assert
        $this->assertSame(0, $this->accountManagerRows($client->getKey()));
        $this->assertTrue(Member::query()->whereKey($member->getKey())->exists());
    }

    public function test_core_roles_are_unchanged(): void
    {
        // Act
        $roleKeys = array_keys(PermissionStore::roleDefinitions());
        $enumValues = array_map(fn (Role $role): string => $role->value, Role::cases());
        $permissionStoreSource = file_get_contents(base_path('app/Service/PermissionStore.php'));
        $roleSource = file_get_contents(base_path('app/Enums/Role.php'));

        // Assert
        $expected = ['owner', 'admin', 'manager', 'employee', 'placeholder'];
        $this->assertSame($expected, $roleKeys);
        $this->assertSame($expected, $enumValues);
        $this->assertIsString($permissionStoreSource);
        $this->assertIsString($roleSource);
        $this->assertStringNotContainsStringIgnoringCase('profitab', $permissionStoreSource);
        $this->assertStringNotContainsStringIgnoringCase('profitab', $roleSource);
    }
}
