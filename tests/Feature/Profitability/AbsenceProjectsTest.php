<?php

declare(strict_types=1);

namespace Tests\Feature\Profitability;

use App\Enums\Role;
use App\Models\Client;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Profitability\Access\AccessScope;
use App\Profitability\Access\ProfitabilityAccess;
use App\Profitability\Http\Controllers\AbsenceProjectsController;
use App\Profitability\Http\Requests\AbsenceProjectsRequest;
use App\Profitability\Models\AbsenceProject;
use App\Profitability\ProfitabilityServiceProvider;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

#[CoversClass(AbsenceProjectsController::class)]
#[CoversClass(AbsenceProjectsRequest::class)]
#[UsesClass(AbsenceProject::class)]
#[UsesClass(ProfitabilityAccess::class)]
#[UsesClass(AccessScope::class)]
#[UsesClass(ProfitabilityServiceProvider::class)]
class AbsenceProjectsTest extends TestCaseWithDatabase
{
    /**
     * createUserWithRole associates the current organization of a non-owner without saving it.
     */
    private function actAs(User $user): void
    {
        $user->save();
        $this->actingAs($user);
    }

    private function getAbsence(Organization $organization): TestResponse
    {
        return $this->getJson(route('profitability.settings.absence', [
            'organization' => $organization->getKey(),
        ], false));
    }

    /**
     * @param  array<int, string>  $projectIds
     */
    private function putAbsence(Organization $organization, array $projectIds): TestResponse
    {
        return $this->putJson(route('profitability.settings.absence.update', [
            'organization' => $organization->getKey(),
        ], false), ['project_ids' => $projectIds]);
    }

    private function project(Organization $organization, string $name): Project
    {
        return Project::factory()->forOrganization($organization)->create(['name' => $name]);
    }

    private function mark(Project $project): AbsenceProject
    {
        return AbsenceProject::query()->create([
            'organization_id' => $project->organization_id,
            'project_id' => $project->getKey(),
        ]);
    }

    /**
     * @return list<string>
     */
    private function markedIds(Organization $organization): array
    {
        /** @var list<string> $ids */
        $ids = AbsenceProject::query()
            ->where('organization_id', '=', $organization->getKey())
            ->orderBy('project_id')
            ->pluck('project_id')
            ->all();

        return $ids;
    }

    public function test_admin_marks_and_unmarks_absence_projects(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Admin);
        $client = Client::factory()->forOrganization($data->organization)->create(['name' => 'Internal']);
        $holidays = Project::factory()->forOrganization($data->organization)->forClient($client)->create(['name' => 'B holidays']);
        $publicHolidays = Project::factory()->forOrganization($data->organization)->archived()->create(['name' => 'C public holidays']);
        $work = $this->project($data->organization, 'A client work');
        $this->actAs($data->user);

        // Act: mark two, then keep one
        $mark = $this->putAbsence($data->organization, [$holidays->getKey(), $publicHolidays->getKey()]);
        $afterMark = $this->getAbsence($data->organization);
        $unmark = $this->putAbsence($data->organization, [$holidays->getKey()]);
        $afterUnmark = $this->getAbsence($data->organization);
        $clear = $this->putAbsence($data->organization, []);

        // Assert
        $mark->assertNoContent();
        $afterMark->assertOk();
        $afterMark->assertJsonPath('data.project_ids', [$holidays->getKey(), $publicHolidays->getKey()]);
        $afterMark->assertJsonPath('data.projects', [
            ['id' => $work->getKey(), 'name' => 'A client work', 'client_name' => null, 'is_archived' => false],
            ['id' => $holidays->getKey(), 'name' => 'B holidays', 'client_name' => 'Internal', 'is_archived' => false],
            ['id' => $publicHolidays->getKey(), 'name' => 'C public holidays', 'client_name' => null, 'is_archived' => true],
        ]);
        $unmark->assertNoContent();
        $afterUnmark->assertJsonPath('data.project_ids', [$holidays->getKey()]);
        $clear->assertNoContent();
        $this->assertSame([], $this->markedIds($data->organization));
    }

    public function test_foreign_project_id_is_rejected(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $other = $this->createUserWithRole(Role::Owner);
        $own = $this->project($data->organization, 'Holidays');
        $foreign = $this->project($other->organization, 'Holidays');
        $this->mark($own);
        $this->actAs($data->user);

        // Act
        $foreignId = $this->putAbsence($data->organization, [$own->getKey(), $foreign->getKey()]);
        $unknownId = $this->putAbsence($data->organization, ['00000000-0000-4000-8000-000000000000']);
        $notUuid = $this->putAbsence($data->organization, ['not-a-uuid']);
        $duplicate = $this->putAbsence($data->organization, [$own->getKey(), $own->getKey()]);
        $missing = $this->putJson(route('profitability.settings.absence.update', [
            'organization' => $data->organization->getKey(),
        ], false), []);

        // Assert: nothing changed
        $foreignId->assertStatus(422);
        $foreignId->assertJsonValidationErrors(['project_ids']);
        $unknownId->assertStatus(422);
        $unknownId->assertJsonValidationErrors(['project_ids']);
        $notUuid->assertStatus(422);
        $notUuid->assertJsonValidationErrors(['project_ids.0']);
        $duplicate->assertStatus(422);
        $missing->assertStatus(422);
        $missing->assertJsonValidationErrors(['project_ids']);
        $this->assertSame([$own->getKey()], $this->markedIds($data->organization));
        $this->assertSame([], $this->markedIds($other->organization));
    }

    public function test_non_admin_scopes_get_404(): void
    {
        foreach ([Role::Employee, Role::Manager] as $role) {
            // Arrange
            $data = $this->createUserWithRole($role);
            $project = $this->project($data->organization, 'Holidays');
            $this->actAs($data->user);

            // Act
            $list = $this->getAbsence($data->organization);
            $update = $this->putAbsence($data->organization, [$project->getKey()]);

            // Assert
            $list->assertNotFound();
            $update->assertNotFound();
            $this->assertSame([], $this->markedIds($data->organization));
        }

        // An Owner of another organization gets the same 404
        $data = $this->createUserWithRole(Role::Owner);
        $other = $this->createUserWithRole(Role::Owner);
        $this->actAs($data->user);
        $this->getAbsence($other->organization)->assertNotFound();
        $this->putAbsence($other->organization, [])->assertNotFound();
    }

    public function test_deleting_the_project_removes_the_marker(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $holidays = $this->project($data->organization, 'Holidays');
        $publicHolidays = $this->project($data->organization, 'Public holidays');
        $this->mark($holidays);
        $kept = $this->mark($publicHolidays);

        // Act: a bulk delete without Eloquent events, as core does
        Project::query()->whereKey($holidays->getKey())->delete();

        // Assert
        $this->assertSame([$publicHolidays->getKey()], $this->markedIds($data->organization));
        $this->assertNotNull($kept->fresh());
    }

    public function test_names_alone_mark_nothing(): void
    {
        // Arrange: the D-06 holiday project names, never marked
        $data = $this->createUserWithRole(Role::Owner);
        $this->project($data->organization, 'Vacaciones');
        $this->project($data->organization, 'Festivo');
        $this->actAs($data->user);

        // Act
        $response = $this->getAbsence($data->organization);

        // Assert
        $response->assertOk();
        $response->assertJsonPath('data.project_ids', []);
        $response->assertJsonCount(2, 'data.projects');
        $this->assertSame([], $this->markedIds($data->organization));
    }
}
