<?php

declare(strict_types=1);

namespace Tests\Unit\Profitability;

use App\Models\Project;
use App\Profitability\Access\AccessScope;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * The profitability access decision table (D-11, D-12, D-16), proven without a database: projects are
 * built in memory with a forced key and never saved.
 */
#[CoversClass(AccessScope::class)]
class AccessScopeTest extends TestCase
{
    private const string PROJECT_P = '0b6c1a2e-0000-4000-8000-000000000001';

    private const string PROJECT_OF_C = '0b6c1a2e-0000-4000-8000-000000000002';

    private const string PROJECT_OF_OTHER_CLIENT = '0b6c1a2e-0000-4000-8000-000000000003';

    private const string PROJECT_WITHOUT_CLIENT = '0b6c1a2e-0000-4000-8000-000000000004';

    private const string CLIENT_C = '1c7d2b3f-0000-4000-8000-00000000000c';

    private const string CLIENT_D = '1c7d2b3f-0000-4000-8000-00000000000d';

    private const string CLIENT_OTHER = '1c7d2b3f-0000-4000-8000-0000000000ff';

    private static function project(string $id, ?string $clientId): Project
    {
        $project = new Project;
        $project->forceFill(['id' => $id, 'client_id' => $clientId, 'is_billable' => true]);

        return $project;
    }

    /**
     * Project id and client id; the project is built inside the test, after the application booted.
     *
     * @return array<string, array{0: string, 1: string|null}>
     */
    public static function anyProject(): array
    {
        return [
            'project of client C' => [self::PROJECT_OF_C, self::CLIENT_C],
            'project of another client' => [self::PROJECT_OF_OTHER_CLIENT, self::CLIENT_OTHER],
            'project without client' => [self::PROJECT_WITHOUT_CLIENT, null],
        ];
    }

    #[DataProvider('anyProject')]
    public function test_full_scope_grants_everything_on_any_project(string $projectId, ?string $clientId): void
    {
        // Arrange
        $project = self::project($projectId, $clientId);
        $scope = AccessScope::full();

        // Act & Assert
        $this->assertTrue($scope->isFull());
        $this->assertTrue($scope->hasAnyAccess());
        $this->assertTrue($scope->canViewProject($project));
        $this->assertTrue($scope->canEditTerms($project));
        $this->assertTrue($scope->canEditPlan($project));
        $this->assertTrue($scope->hasMoneyFor($project));
        $this->assertTrue($scope->hasAnyMoney());
        $this->assertTrue($scope->canViewClient($project->client_id));
        $this->assertSame(['projects', 'clients', 'people', 'settings'], $scope->views());
    }

    #[DataProvider('anyProject')]
    public function test_no_scope_grants_nothing_on_any_project(string $projectId, ?string $clientId): void
    {
        // Arrange
        $project = self::project($projectId, $clientId);
        $scope = AccessScope::none();

        // Act & Assert
        $this->assertFalse($scope->isFull());
        $this->assertFalse($scope->hasAnyAccess());
        $this->assertFalse($scope->canViewProject($project));
        $this->assertFalse($scope->canEditTerms($project));
        $this->assertFalse($scope->canEditPlan($project));
        $this->assertFalse($scope->hasMoneyFor($project));
        $this->assertFalse($scope->hasAnyMoney());
        $this->assertFalse($scope->canViewClient($project->client_id));
        $this->assertSame([], $scope->views());
        $this->assertSame([], $scope->managedProjectIds());
        $this->assertSame([], $scope->accountClientIds());
    }

    public function test_project_manager_sees_hours_and_edits_the_plan_of_their_project_only(): void
    {
        // Arrange
        $scope = new AccessScope(false, [self::PROJECT_P], []);
        $managed = self::project(self::PROJECT_P, self::CLIENT_D);
        $sameClient = self::project(self::PROJECT_OF_OTHER_CLIENT, self::CLIENT_D);

        // Act & Assert
        $this->assertFalse($scope->isFull());
        $this->assertTrue($scope->hasAnyAccess());
        $this->assertTrue($scope->canViewProject($managed));
        $this->assertTrue($scope->canEditPlan($managed));
        $this->assertFalse($scope->canEditTerms($managed));
        $this->assertFalse($scope->hasMoneyFor($managed));
        $this->assertFalse($scope->hasAnyMoney());
        $this->assertFalse($scope->canViewClient(self::CLIENT_D));
        $this->assertFalse($scope->canViewProject($sameClient));
        $this->assertFalse($scope->canEditPlan($sameClient));
        $this->assertSame(['projects'], $scope->views());
        $this->assertSame([self::PROJECT_P], $scope->managedProjectIds());
    }

    public function test_account_manager_sees_money_and_edits_terms_of_their_clients_projects(): void
    {
        // Arrange
        $scope = new AccessScope(false, [], [self::CLIENT_C]);
        $ofClient = self::project(self::PROJECT_OF_C, self::CLIENT_C);

        // Act & Assert
        $this->assertFalse($scope->isFull());
        $this->assertTrue($scope->hasAnyAccess());
        $this->assertTrue($scope->canViewProject($ofClient));
        $this->assertTrue($scope->canEditTerms($ofClient));
        $this->assertTrue($scope->hasMoneyFor($ofClient));
        $this->assertFalse($scope->canEditPlan($ofClient));
        $this->assertTrue($scope->hasAnyMoney());
        $this->assertTrue($scope->canViewClient(self::CLIENT_C));
        $this->assertFalse($scope->canViewClient(null));
        $this->assertFalse($scope->canViewClient(self::CLIENT_OTHER));
        $this->assertSame(['projects', 'clients'], $scope->views());
        $this->assertSame([self::CLIENT_C], $scope->accountClientIds());
    }

    /**
     * @return array<string, array{0: string, 1: string|null}>
     */
    public static function outsideTheAccountManagersClient(): array
    {
        return [
            'project of another client' => [self::PROJECT_OF_OTHER_CLIENT, self::CLIENT_OTHER],
            'project without client' => [self::PROJECT_WITHOUT_CLIENT, null],
        ];
    }

    #[DataProvider('outsideTheAccountManagersClient')]
    public function test_account_manager_gets_nothing_outside_their_clients(string $projectId, ?string $clientId): void
    {
        // Arrange
        $project = self::project($projectId, $clientId);
        $scope = new AccessScope(false, [], [self::CLIENT_C]);

        // Act & Assert
        $this->assertFalse($scope->canViewProject($project));
        $this->assertFalse($scope->canEditTerms($project));
        $this->assertFalse($scope->canEditPlan($project));
        $this->assertFalse($scope->hasMoneyFor($project));
    }

    public function test_project_manager_and_account_manager_combined_get_money_only_for_the_account(): void
    {
        // Arrange: project manager of P (client D) and account manager of client C
        $scope = new AccessScope(false, [self::PROJECT_P], [self::CLIENT_C]);
        $managed = self::project(self::PROJECT_P, self::CLIENT_D);
        $ofClient = self::project(self::PROJECT_OF_C, self::CLIENT_C);
        $elsewhere = self::project(self::PROJECT_OF_OTHER_CLIENT, self::CLIENT_OTHER);

        // Act & Assert
        $this->assertTrue($scope->canViewProject($managed));
        $this->assertTrue($scope->canEditPlan($managed));
        $this->assertFalse($scope->canEditTerms($managed));
        $this->assertFalse($scope->hasMoneyFor($managed));

        $this->assertTrue($scope->canViewProject($ofClient));
        $this->assertTrue($scope->canEditTerms($ofClient));
        $this->assertTrue($scope->hasMoneyFor($ofClient));
        $this->assertFalse($scope->canEditPlan($ofClient));

        $this->assertFalse($scope->canViewProject($elsewhere));
        $this->assertFalse($scope->hasMoneyFor($elsewhere));

        $this->assertTrue($scope->hasAnyMoney());
        $this->assertFalse($scope->canViewClient(self::CLIENT_D));
        $this->assertSame(['projects', 'clients'], $scope->views());
    }

    public function test_project_manager_and_account_manager_of_the_same_project_get_everything_on_it(): void
    {
        // Arrange
        $scope = new AccessScope(false, [self::PROJECT_OF_C], [self::CLIENT_C]);
        $project = self::project(self::PROJECT_OF_C, self::CLIENT_C);

        // Act & Assert
        $this->assertTrue($scope->canViewProject($project));
        $this->assertTrue($scope->canEditPlan($project));
        $this->assertTrue($scope->canEditTerms($project));
        $this->assertTrue($scope->hasMoneyFor($project));
        $this->assertFalse($scope->isFull());
    }
}
