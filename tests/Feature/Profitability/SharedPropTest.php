<?php

declare(strict_types=1);

namespace Tests\Feature\Profitability;

use App\Enums\Role;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Profitability\Access\AccessScope;
use App\Profitability\Access\ProfitabilityAccess;
use App\Profitability\Http\Middleware\ShareProfitabilityInertiaData;
use App\Profitability\ProfitabilityServiceProvider;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

#[CoversClass(ShareProfitabilityInertiaData::class)]
#[UsesClass(ProfitabilityAccess::class)]
#[UsesClass(AccessScope::class)]
#[UsesClass(ProfitabilityServiceProvider::class)]
class SharedPropTest extends TestCaseWithDatabase
{
    private const string MONEY_KEY = '/(amount|cost|margin|revenue|cents)/i';

    /**
     * createUserWithRole associates the current organization of a non-owner without saving it.
     */
    private function actAs(User $user): void
    {
        $user->save();
        $this->actingAs($user);
    }

    private function billableProject(Organization $organization): Project
    {
        return Project::factory()->forOrganization($organization)->billable()->create();
    }

    /**
     * @return array<string, mixed>
     */
    private function profitabilityProp(TestResponse $response): array
    {
        $response->assertStatus(200);
        $prop = null;
        $response->assertInertia(function (AssertableInertia $page) use (&$prop): void {
            $prop = $page->toArray()['props']['profitability'] ?? null;
        });
        $this->assertIsArray($prop);

        /** @var array<string, mixed> $prop */
        return $prop;
    }

    /**
     * Every key (at any depth) of the array that looks like money.
     *
     * @param  array<array-key, mixed>  $data
     * @return list<string>
     */
    private function moneyKeys(array $data, string $prefix = ''): array
    {
        $found = [];
        foreach ($data as $key => $value) {
            $path = $prefix === '' ? (string) $key : $prefix.'.'.$key;
            if (preg_match(self::MONEY_KEY, (string) $key) === 1) {
                $found[] = $path;
            }
            if (is_array($value)) {
                $found = [...$found, ...$this->moneyKeys($value, $path)];
            }
        }

        return $found;
    }

    public function test_employee_gets_only_enabled_false(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Employee);
        $this->actAs($data->user);

        // Act
        $prop = $this->profitabilityProp($this->get(route('dashboard', [], false)));

        // Assert
        $this->assertSame(['enabled' => false], $prop);
    }

    public function test_owner_gets_flags_url_views_and_nav_label_only_on_the_dashboard(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $this->actAs($data->user);

        // Act
        $prop = $this->profitabilityProp($this->get(route('dashboard', [], false)));

        // Assert: no organization URL, no project block, no copy beyond the nav label
        $this->assertSame([
            'enabled' => true,
            'url' => url('profitability'),
            'views' => ['projects', 'clients', 'people', 'settings'],
            'labels' => ['nav' => 'Profitability'],
        ], $prop);
    }

    public function test_owner_on_a_billable_project_page_gets_the_summary_url_and_the_full_tree_with_money_and_admin(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $project = $this->billableProject($data->organization);
        $this->actAs($data->user);

        // Act
        $prop = $this->profitabilityProp($this->get(route('projects.show', ['project' => $project->getKey()], false)));

        // Assert
        $organizationUrl = url('profitability/organizations/'.$data->organization->getKey());
        $this->assertTrue($prop['enabled']);
        $this->assertSame($organizationUrl, $prop['organization_url']);
        $this->assertSame(['summary_url' => $organizationUrl.'/projects/'.$project->getKey().'/summary'], $prop['project']);
        // The URL the client fetches is exactly the named summary route
        $this->assertSame(route('profitability.projects.summary', [
            'organization' => $data->organization->getKey(),
            'project' => $project->getKey(),
        ]), $prop['project']['summary_url']);

        $labels = $prop['labels'];
        $this->assertIsArray($labels);
        $this->assertSame('Profitability', $labels['nav']);
        $this->assertSame('Contract', $labels['summary']['title']);
        $this->assertSame('Hours sold', $labels['kpi']['hours_sold']);
        // Placeholders reach the client unfilled
        $this->assertSame('Since :date', $labels['summary']['since']);
        $this->assertSame('Amount sold', $labels['money']['kpi']['amount_sold']);
        // The full tree mirrors the English file key by key
        $english = trans('profitability', [], 'en');
        $this->assertIsArray($english);
        $this->assertSame(array_keys($english), array_keys($labels));
    }

    public function test_owner_on_a_project_of_another_organization_gets_no_project_block(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $other = $this->createUserWithRole(Role::Owner);
        $foreignProject = $this->billableProject($other->organization);
        $this->actAs($data->user);

        // Act
        $prop = $this->profitabilityProp($this->get(route('projects.show', ['project' => $foreignProject->getKey()], false)));

        // Assert: the base prop only, nothing about the foreign project
        $this->assertTrue($prop['enabled']);
        $this->assertArrayNotHasKey('project', $prop);
        $this->assertArrayNotHasKey('organization_url', $prop);
        $this->assertSame(['nav' => 'Profitability'], $prop['labels']);
        $this->assertStringNotContainsString($foreignProject->getKey(), (string) json_encode($prop));
    }

    public function test_no_money_key_anywhere_in_the_employee_props(): void
    {
        // Arrange: an employee on a billable project page of their own organization
        $data = $this->createUserWithRole(Role::Employee);
        $project = $this->billableProject($data->organization);
        $this->actAs($data->user);

        // Act
        $onProject = $this->profitabilityProp($this->get(route('projects.show', ['project' => $project->getKey()], false)));
        $onDashboard = $this->profitabilityProp($this->get(route('dashboard', [], false)));

        // Assert
        $this->assertSame(['enabled' => false], $onProject);
        $this->assertSame(['enabled' => false], $onDashboard);
        $this->assertSame([], $this->moneyKeys($onProject));
        $this->assertSame([], $this->moneyKeys($onDashboard));
    }

    public function test_a_malformed_project_id_on_the_project_page_adds_no_project_block(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $this->actAs($data->user);

        // Act
        $prop = $this->profitabilityProp($this->get('/projects/not-a-uuid'));

        // Assert
        $this->assertTrue($prop['enabled']);
        $this->assertArrayNotHasKey('project', $prop);
        $this->assertSame(['nav' => 'Profitability'], $prop['labels']);
    }
}
