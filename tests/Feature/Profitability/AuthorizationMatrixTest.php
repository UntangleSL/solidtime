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
use App\Profitability\Http\Controllers\AbsenceProjectsController;
use App\Profitability\Http\Controllers\AssignmentController;
use App\Profitability\Http\Controllers\ClientsViewController;
use App\Profitability\Http\Controllers\ContractTermsController;
use App\Profitability\Http\Controllers\PeopleSettingsController;
use App\Profitability\Http\Controllers\PeopleViewController;
use App\Profitability\Http\Controllers\PlanController;
use App\Profitability\Http\Controllers\ProfitabilityPageController;
use App\Profitability\Http\Controllers\ProjectSummaryController;
use App\Profitability\Http\Controllers\ProjectsViewController;
use App\Profitability\Http\Middleware\ShareProfitabilityInertiaData;
use App\Profitability\Models\AbsenceProject;
use App\Profitability\Models\ClientAccountManager;
use App\Profitability\Models\ContractPeriod;
use App\Profitability\Models\ContractPeriodMonth;
use App\Profitability\Models\MemberCostRate;
use App\Profitability\Models\MemberWorkWeek;
use App\Profitability\Models\ProjectContract;
use App\Profitability\Models\ProjectManager;
use App\Profitability\Periods\PeriodMaterializer;
use App\Profitability\ProfitabilityServiceProvider;
use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

/**
 * Every profitability route against every scope (D-11, D-12, D-16, RESEARCH Pitfall 4): Owner and Admin
 * reach everything, the account manager of client A reads and edits the terms of A's projects with money,
 * the project manager of project PA reads its hours and plans its months without ever receiving a money
 * key, and an employee, a core manager without an assignment and the Owner of another organization get a
 * plain 404 everywhere.
 *
 * Every request runs inside its own savepoint that is rolled back afterwards, so one scope's write never
 * changes what the next scope sees. Write bodies are valid, so the scope check and not the validation
 * answers.
 *
 * The Owner of another organization points its current organization at the tested one (where it is no
 * member), as PageAccessTest does: that is the only way the organization-less page route can be asked for
 * the tested organization. The routes with an organization in the URL answer from the route organization.
 */
#[CoversClass(ProfitabilityAccess::class)]
#[CoversClass(AccessScope::class)]
#[UsesClass(ProfitabilityPageController::class)]
#[UsesClass(ProjectSummaryController::class)]
#[UsesClass(ContractTermsController::class)]
#[UsesClass(PlanController::class)]
#[UsesClass(ProjectsViewController::class)]
#[UsesClass(ClientsViewController::class)]
#[UsesClass(PeopleViewController::class)]
#[UsesClass(AssignmentController::class)]
#[UsesClass(PeopleSettingsController::class)]
#[UsesClass(AbsenceProjectsController::class)]
#[UsesClass(ShareProfitabilityInertiaData::class)]
#[UsesClass(ProjectContract::class)]
#[UsesClass(ContractPeriod::class)]
#[UsesClass(ContractPeriodMonth::class)]
#[UsesClass(ProjectManager::class)]
#[UsesClass(ClientAccountManager::class)]
#[UsesClass(MemberCostRate::class)]
#[UsesClass(MemberWorkWeek::class)]
#[UsesClass(AbsenceProject::class)]
#[UsesClass(PeriodMaterializer::class)]
#[UsesClass(ProfitabilityServiceProvider::class)]
class AuthorizationMatrixTest extends TestCaseWithDatabase
{
    private const int HOUR = 3600;

    /** 120 hours sold per quarter on project PA */
    private const int SOLD = 432000;

    /** The callers, in the order the matrix columns use. */
    private const array SCOPES = ['owner', 'admin', 'account_manager', 'project_manager', 'employee', 'manager', 'foreign_owner'];

    /** The scopes that see money on project PA (D-11). */
    private const array MONEY_SCOPES = ['owner', 'admin', 'account_manager'];

    /** Every scope gets a 404 (D-16): the expectation of the routes only Owner and Admin reach. */
    private const array FULL_ONLY = [
        'owner' => 'ok',
        'admin' => 'ok',
        'account_manager' => 404,
        'project_manager' => 404,
        'employee' => 404,
        'manager' => 404,
        'foreign_owner' => 404,
    ];

    /**
     * Every route served by App\Profitability\Http\Controllers: method, route parameters (route parameter =>
     * fixture key), body (a key of validBody() or null) and the expected status per scope ('ok' is the
     * route's success status, `success`). A new profitability route must get a row here
     * (test_every_profitability_route_is_in_the_matrix). Never weaken an expectation to make it pass: a
     * mismatch is a defect.
     */
    private const array MATRIX = [
        'profitability' => [
            'method' => 'GET',
            'params' => [],
            'body' => null,
            'success' => 200,
            'expect' => ['owner' => 'ok', 'admin' => 'ok', 'account_manager' => 'ok', 'project_manager' => 'ok', 'employee' => 404, 'manager' => 404, 'foreign_owner' => 404],
        ],
        'profitability.projects.summary' => [
            'method' => 'GET',
            'params' => ['organization' => 'organization', 'project' => 'project_a'],
            'body' => null,
            'success' => 200,
            'expect' => ['owner' => 'ok', 'admin' => 'ok', 'account_manager' => 'ok', 'project_manager' => 'ok', 'employee' => 404, 'manager' => 404, 'foreign_owner' => 404],
        ],
        'profitability.projects.contract' => [
            'method' => 'PUT',
            'params' => ['organization' => 'organization', 'project' => 'project_a'],
            'body' => 'contract',
            'success' => 204,
            'expect' => ['owner' => 'ok', 'admin' => 'ok', 'account_manager' => 'ok', 'project_manager' => 404, 'employee' => 404, 'manager' => 404, 'foreign_owner' => 404],
        ],
        'profitability.periods.plan' => [
            'method' => 'PUT',
            'params' => ['organization' => 'organization', 'project' => 'project_a', 'period' => 'period'],
            'body' => 'plan',
            'success' => 204,
            'expect' => ['owner' => 'ok', 'admin' => 'ok', 'account_manager' => 404, 'project_manager' => 'ok', 'employee' => 404, 'manager' => 404, 'foreign_owner' => 404],
        ],
        'profitability.views.projects' => [
            'method' => 'GET',
            'params' => ['organization' => 'organization'],
            'body' => null,
            'success' => 200,
            'expect' => ['owner' => 'ok', 'admin' => 'ok', 'account_manager' => 'ok', 'project_manager' => 'ok', 'employee' => 404, 'manager' => 404, 'foreign_owner' => 404],
        ],
        'profitability.views.clients' => [
            'method' => 'GET',
            'params' => ['organization' => 'organization'],
            'body' => null,
            'success' => 200,
            'expect' => ['owner' => 'ok', 'admin' => 'ok', 'account_manager' => 'ok', 'project_manager' => 404, 'employee' => 404, 'manager' => 404, 'foreign_owner' => 404],
        ],
        'profitability.views.people' => [
            'method' => 'GET',
            'params' => ['organization' => 'organization'],
            'body' => null,
            'success' => 200,
            'expect' => self::FULL_ONLY,
        ],
        'profitability.settings.managers' => [
            'method' => 'GET',
            'params' => ['organization' => 'organization'],
            'body' => null,
            'success' => 200,
            'expect' => self::FULL_ONLY,
        ],
        'profitability.settings.project-managers.store' => [
            'method' => 'POST',
            'params' => ['organization' => 'organization', 'project' => 'project_a'],
            'body' => 'assign_employee',
            'success' => 204,
            'expect' => self::FULL_ONLY,
        ],
        'profitability.settings.project-managers.destroy' => [
            'method' => 'DELETE',
            'params' => ['organization' => 'organization', 'project' => 'project_a', 'memberId' => 'project_manager_member'],
            'body' => null,
            'success' => 204,
            'expect' => self::FULL_ONLY,
        ],
        'profitability.settings.account-managers.store' => [
            'method' => 'POST',
            'params' => ['organization' => 'organization', 'client' => 'client_a'],
            'body' => 'assign_employee',
            'success' => 204,
            'expect' => self::FULL_ONLY,
        ],
        'profitability.settings.account-managers.destroy' => [
            'method' => 'DELETE',
            'params' => ['organization' => 'organization', 'client' => 'client_a', 'memberId' => 'account_manager_member'],
            'body' => null,
            'success' => 204,
            'expect' => self::FULL_ONLY,
        ],
        'profitability.settings.people' => [
            'method' => 'GET',
            'params' => ['organization' => 'organization'],
            'body' => null,
            'success' => 200,
            'expect' => self::FULL_ONLY,
        ],
        'profitability.settings.people.cost_rates.store' => [
            'method' => 'POST',
            'params' => ['organization' => 'organization', 'memberId' => 'employee_member'],
            'body' => 'cost_rate',
            'success' => 201,
            'expect' => self::FULL_ONLY,
        ],
        'profitability.settings.people.cost_rates.destroy' => [
            'method' => 'DELETE',
            'params' => ['organization' => 'organization', 'memberId' => 'employee_member', 'rate' => 'cost_rate'],
            'body' => null,
            'success' => 204,
            'expect' => self::FULL_ONLY,
        ],
        'profitability.settings.people.work_weeks.store' => [
            'method' => 'POST',
            'params' => ['organization' => 'organization', 'memberId' => 'employee_member'],
            'body' => 'work_week',
            'success' => 201,
            'expect' => self::FULL_ONLY,
        ],
        'profitability.settings.people.work_weeks.destroy' => [
            'method' => 'DELETE',
            'params' => ['organization' => 'organization', 'memberId' => 'employee_member', 'week' => 'work_week'],
            'body' => null,
            'success' => 204,
            'expect' => self::FULL_ONLY,
        ],
        'profitability.settings.absence' => [
            'method' => 'GET',
            'params' => ['organization' => 'organization'],
            'body' => null,
            'success' => 200,
            'expect' => self::FULL_ONLY,
        ],
        'profitability.settings.absence.update' => [
            'method' => 'PUT',
            'params' => ['organization' => 'organization'],
            'body' => 'absence',
            'success' => 204,
            'expect' => self::FULL_ONLY,
        ],
    ];

    /** Money must be absent, not null: no key at any depth may match this (keys only, never values). */
    private const string MONEY_KEY = '/(amount|cost|margin|revenue|cents)/i';

    protected function setUp(): void
    {
        parent::setUp();
        // 2026-11-18 11:00 in Europe/Madrid: the quarter Oct-Dec is current
        Carbon::setTestNow('2026-11-18 10:00:00');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    /**
     * One organization with client A (billable project PA under a quarterly contract with its periods,
     * plan, time and costs) and client B (billable project PB under a monthly contract), the seven callers
     * and the rows the settings routes act on.
     *
     * @return object{users: array<string, User>, ids: array<string, string>}
     */
    private function fixture(): object
    {
        $ownerData = $this->createUserWithRole(Role::Owner);
        $organization = $ownerData->organization;
        $admin = $this->memberOf($organization, Role::Admin);
        $accountManager = $this->memberOf($organization, Role::Employee);
        $projectManager = $this->memberOf($organization, Role::Employee);
        $employee = $this->memberOf($organization, Role::Employee);
        $manager = $this->memberOf($organization, Role::Manager);
        $foreign = $this->createUserWithRole(Role::Owner);
        $foreign->user->current_team_id = $organization->getKey();
        $foreign->user->save();

        $clientA = Client::factory()->forOrganization($organization)->create(['name' => 'Client A']);
        $clientB = Client::factory()->forOrganization($organization)->create(['name' => 'Client B']);
        $projectA = Project::factory()->forOrganization($organization)->forClient($clientA)->billable()->create(['name' => 'PA']);
        $projectB = Project::factory()->forOrganization($organization)->forClient($clientB)->billable()->create(['name' => 'PB']);
        $holidays = Project::factory()->forOrganization($organization)->create(['name' => 'Holidays', 'is_billable' => false]);

        $this->contract($projectA, 'quarterly', '2026-07-01', 900000, self::SOLD);
        $this->contract($projectB, 'monthly', '2026-01-01', 250000, 72000);

        $this->assignProjectManager($projectA, $projectManager->member);
        $this->assignAccountManager($clientA, $accountManager->member);

        // Time on both projects and dated costs, so the money parts of the answers are not empty
        foreach ([[$projectManager->member, $projectA, 2], [$employee->member, $projectA, 1], [$employee->member, $projectB, 3]] as [$member, $project, $hours]) {
            TimeEntry::factory()->forMember($member)->forProject($project)
                ->startWithDuration(Carbon::parse('2026-11-10 08:00:00', 'UTC'), $hours * self::HOUR)
                ->create(['description' => '']);
        }
        $this->costRate($projectManager->member, '2026-01-01', 4000);
        $costRate = $this->costRate($employee->member, '2026-01-01', 3500);
        $workWeek = new MemberWorkWeek([
            'member_id' => $employee->member->getKey(),
            'effective_from' => '2026-01-01',
            'weekly_seconds' => 40 * self::HOUR,
            'chargeability_target_percent' => 80,
        ]);
        $workWeek->forceFill(['organization_id' => $organization->getKey()]);
        $workWeek->save();
        $absence = new AbsenceProject(['project_id' => $holidays->getKey()]);
        $absence->forceFill(['organization_id' => $organization->getKey()]);
        $absence->save();

        return (object) [
            'users' => [
                'owner' => $ownerData->user,
                'admin' => $admin->user,
                'account_manager' => $accountManager->user,
                'project_manager' => $projectManager->user,
                'employee' => $employee->user,
                'manager' => $manager->user,
                'foreign_owner' => $foreign->user,
            ],
            'ids' => [
                'organization' => (string) $organization->getKey(),
                'client_a' => (string) $clientA->getKey(),
                'client_b' => (string) $clientB->getKey(),
                'project_a' => (string) $projectA->getKey(),
                'project_b' => (string) $projectB->getKey(),
                'holidays' => (string) $holidays->getKey(),
                'period' => (string) $this->period($projectA, '2026-10-01')->getKey(),
                'project_manager_member' => (string) $projectManager->member->getKey(),
                'account_manager_member' => (string) $accountManager->member->getKey(),
                'employee_member' => (string) $employee->member->getKey(),
                'cost_rate' => (string) $costRate->getKey(),
                'work_week' => (string) $workWeek->getKey(),
            ],
        ];
    }

    /**
     * A user who is a member of the organization with that role and has it as current organization.
     *
     * @return object{user: User, member: Member}
     */
    private function memberOf(Organization $organization, Role $role): object
    {
        $user = User::factory()->create();
        $member = Member::factory()->forUser($user)->forOrganization($organization)->role($role)->create();
        $user->currentOrganization()->associate($organization);
        $user->save();

        return (object) ['user' => $user, 'member' => $member];
    }

    private function contract(Project $project, string $schedule, string $startsOn, int $amountCents, int $budgetSeconds): void
    {
        /** @var ProjectContract $contract */
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
        $this->app->make(PeriodMaterializer::class)
            ->ensureThrough($contract, CarbonImmutable::createFromFormat('!Y-m-d', '2026-11-18', 'UTC') ?: CarbonImmutable::now());
    }

    private function period(Project $project, string $startsOn): ContractPeriod
    {
        /** @var ProjectContract $contract */
        $contract = ProjectContract::query()->where('project_id', '=', $project->getKey())->firstOrFail();

        /** @var ContractPeriod $period */
        $period = ContractPeriod::query()
            ->where('contract_id', '=', $contract->getKey())
            ->where('starts_on', '=', $startsOn)
            ->firstOrFail();

        return $period;
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

    private function costRate(Member $member, string $effectiveFrom, int $hourlyCostCents): MemberCostRate
    {
        $rate = new MemberCostRate([
            'member_id' => $member->getKey(),
            'effective_from' => $effectiveFrom,
            'hourly_cost_cents' => $hourlyCostCents,
        ]);
        $rate->forceFill(['organization_id' => $member->organization_id]);
        $rate->save();

        return $rate;
    }

    /**
     * A body each route accepts from a caller in scope, so validation never answers first.
     *
     * @param  array<string, string>  $ids
     * @return array<string, mixed>
     */
    private function validBody(string $key, array $ids): array
    {
        return match ($key) {
            // The contract has started: schedule and start stay, apply_to is required
            'contract' => [
                'service' => 'SEO retainer',
                'schedule' => 'quarterly',
                'starts_on' => '2026-07-01',
                'ends_on' => null,
                'budget_seconds' => self::SOLD,
                'amount_cents' => 960000,
                'apply_to' => 'current_and_following',
            ],
            // The current quarter, uneven but adding up to the 120 hours sold
            'plan' => ['months' => [
                ['month' => '2026-10-01', 'planned_seconds' => 60 * self::HOUR],
                ['month' => '2026-11-01', 'planned_seconds' => 40 * self::HOUR],
                ['month' => '2026-12-01', 'planned_seconds' => 20 * self::HOUR],
            ]],
            'assign_employee' => ['member_id' => $ids['employee_member']],
            'cost_rate' => ['effective_from' => '2026-12-01', 'hourly_cost_cents' => 4200],
            'work_week' => ['effective_from' => '2026-12-01', 'weekly_seconds' => 32 * self::HOUR, 'target_percent' => 75],
            'absence' => ['project_ids' => [$ids['holidays']]],
            default => $this->fail('No body for '.$key),
        };
    }

    /**
     * One request of a matrix row, as JSON except for the Inertia page.
     *
     * @param  array<string, string>  $ids
     */
    private function send(string $name, array $ids): TestResponse
    {
        $row = self::MATRIX[$name];
        $parameters = [];
        foreach ($row['params'] as $parameter => $key) {
            $parameters[$parameter] = $ids[$key];
        }
        $uri = route($name, $parameters, false);
        $body = $row['body'] === null ? [] : $this->validBody($row['body'], $ids);

        return match ($row['method']) {
            'GET' => $name === 'profitability' ? $this->get($uri) : $this->getJson($uri),
            'POST' => $this->postJson($uri, $body),
            'PUT' => $this->putJson($uri, $body),
            'DELETE' => $this->deleteJson($uri, $body),
            default => $this->fail('Unknown method '.$row['method'].' for '.$name),
        };
    }

    /**
     * Runs the request as the user inside a savepoint that is rolled back afterwards: no write survives.
     *
     * @param  callable(): TestResponse  $request
     */
    private function isolated(User $user, callable $request): TestResponse
    {
        DB::beginTransaction();
        try {
            $this->actingAs($user);

            return $request();
        } finally {
            DB::rollBack();
        }
    }

    /**
     * The shared `profitability` prop of a 200 Inertia page.
     *
     * @return array<array-key, mixed>
     */
    private function sharedProp(TestResponse $response, string $context): array
    {
        $this->assertSame(200, $response->status(), $context.' must render');
        $prop = null;
        $response->assertInertia(function (AssertableInertia $page) use (&$prop): void {
            $prop = $page->toArray()['props']['profitability'] ?? null;
        });
        $this->assertIsArray($prop, $context.' carries no profitability prop');

        return $prop;
    }

    /**
     * The three pages that carry the shared prop: the dashboard, the project page of PA and the
     * Profitability page.
     *
     * @param  array<string, string>  $ids
     * @return array<string, callable(): TestResponse>
     */
    private function pages(array $ids): array
    {
        return [
            'dashboard' => fn (): TestResponse => $this->get(route('dashboard', [], false)),
            'projects.show' => fn (): TestResponse => $this->get(route('projects.show', ['project' => $ids['project_a']], false)),
            'profitability' => fn (): TestResponse => $this->get(route('profitability', [], false)),
        ];
    }

    public function test_every_route_answers_as_the_matrix_says_for_every_scope(): void
    {
        // Arrange
        $fixture = $this->fixture();
        $ids = $fixture->ids;

        foreach (self::MATRIX as $name => $row) {
            foreach (self::SCOPES as $scope) {
                // Act
                $response = $this->isolated($fixture->users[$scope], fn (): TestResponse => $this->send($name, $ids));

                // Assert
                $expected = $row['expect'][$scope] === 'ok' ? $row['success'] : $row['expect'][$scope];
                $this->assertSame($expected, $response->status(), $name.' as '.$scope.' must answer '.$expected
                    .' (got '.$response->status().': '.mb_substr((string) $response->getContent(), 0, 300).')');

                if ($response->status() !== 200 || $name === 'profitability') {
                    continue;
                }
                $content = (string) $response->getContent();
                $money = in_array($scope, self::MONEY_SCOPES, true);
                if ($name === 'profitability.projects.summary') {
                    // Money on PA for Owner, Admin and the account manager of client A only (D-11)
                    $this->assertSame($money, is_int($response->json('data.period.amount_cents')), $name.' money as '.$scope);
                    $this->assertSame(self::SOLD, $response->json('data.period.budget_seconds'), $name.' hours as '.$scope);
                }
                if ($name === 'profitability.views.projects') {
                    $this->assertStringContainsString($ids['project_a'], $content, $name.' must list PA for '.$scope);
                    $this->assertSame($money, $response->json('meta.money_rows') > 0, $name.' money rows as '.$scope);
                }
                if (in_array($scope, ['account_manager', 'project_manager'], true)) {
                    // Nothing of client B ever reaches a manager of A or of PA
                    $this->assertStringNotContainsString($ids['project_b'], $content, $name.' leaks PB to '.$scope);
                    $this->assertStringNotContainsString($ids['client_b'], $content, $name.' leaks client B to '.$scope);
                }
            }
        }
    }

    public function test_every_profitability_route_is_in_the_matrix(): void
    {
        // Arrange
        $names = [];
        foreach (Route::getRoutes()->getRoutes() as $route) {
            if (str_starts_with($route->getActionName(), 'App\\Profitability\\Http\\Controllers\\')) {
                $names[] = (string) $route->getName();
            }
        }
        sort($names);
        $expected = array_keys(self::MATRIX);
        sort($expected);

        // Assert
        $this->assertSame($expected, $names, 'A new profitability route needs a MATRIX row with its status for every scope');
        $this->assertCount(19, $names);
        foreach (self::MATRIX as $name => $row) {
            $this->assertSame(self::SCOPES, array_keys($row['expect']), $name.' must name every scope in order');
        }
    }

    public function test_project_manager_never_receives_a_money_key(): void
    {
        // Arrange
        $fixture = $this->fixture();
        $ids = $fixture->ids;
        $projectManager = $fixture->users['project_manager'];
        $scanned = [];

        // Act + Assert: every 2xx JSON answer of the matrix
        foreach (array_keys(self::MATRIX) as $name) {
            $response = $this->isolated($projectManager, fn (): TestResponse => $this->send($name, $ids));
            if ($response->status() < 200 || $response->status() >= 300 || $response->status() === 204) {
                continue;
            }
            $json = $name === 'profitability'
                ? $this->sharedProp($response, $name)
                : $response->json();
            $this->assertIsArray($json, $name);
            $this->assertNoKeyMatches($json, self::MONEY_KEY, $name);
            $scanned[] = $name;
        }

        // Act + Assert: the shared prop on the three pages
        foreach ($this->pages($ids) as $page => $request) {
            $prop = $this->sharedProp($this->isolated($projectManager, $request), $page);
            $this->assertTrue($prop['enabled'] ?? null, $page);
            $this->assertNoKeyMatches($prop, self::MONEY_KEY, $page);
            if ($page === 'projects.show') {
                $this->assertIsArray($prop['project'] ?? null, 'the project page of a managed project carries its summary url');
            }
        }

        // Assert: the scan is not vacuous
        sort($scanned);
        $this->assertSame(['profitability', 'profitability.projects.summary', 'profitability.views.projects'], $scanned);
    }

    public function test_unassigned_callers_get_only_enabled_false(): void
    {
        // Arrange
        $fixture = $this->fixture();
        $ids = $fixture->ids;

        foreach (['employee', 'manager'] as $scope) {
            foreach ($this->pages($ids) as $page => $request) {
                // Act
                $response = $this->isolated($fixture->users[$scope], $request);

                // Assert: the Profitability page itself is a plain 404 (no Inertia page, so no prop at all)
                if ($page === 'profitability') {
                    $this->assertSame(404, $response->status(), $page.' as '.$scope);
                    $this->assertStringNotContainsString('profitability/organizations', (string) $response->getContent(), $page.' as '.$scope);

                    continue;
                }
                $this->assertSame(['enabled' => false], $this->sharedProp($response, $page.' as '.$scope), $page.' as '.$scope);
            }
        }
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
