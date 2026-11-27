<?php

declare(strict_types=1);

namespace Tests\Feature\Profitability;

use App\Enums\Role;
use App\Models\Member;
use App\Models\Organization;
use App\Models\User;
use App\Profitability\Access\AccessScope;
use App\Profitability\Access\ProfitabilityAccess;
use App\Profitability\Http\Controllers\PeopleSettingsController;
use App\Profitability\Http\Requests\CostRateRequest;
use App\Profitability\Models\MemberCostRate;
use App\Profitability\ProfitabilityServiceProvider;
use App\Profitability\Reporting\ConsumptionQuery;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

#[CoversClass(PeopleSettingsController::class)]
#[CoversClass(CostRateRequest::class)]
#[UsesClass(MemberCostRate::class)]
#[UsesClass(ProfitabilityAccess::class)]
#[UsesClass(AccessScope::class)]
#[UsesClass(ConsumptionQuery::class)]
#[UsesClass(ProfitabilityServiceProvider::class)]
class PeopleSettingsTest extends TestCaseWithDatabase
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
     * createUserWithRole associates the current organization of a non-owner without saving it.
     */
    private function actAs(User $user): void
    {
        $user->save();
        $this->actingAs($user);
    }

    private function getPeople(Organization $organization): TestResponse
    {
        return $this->getJson(route('profitability.settings.people', [
            'organization' => $organization->getKey(),
        ], false));
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function postCostRate(Organization $organization, string $memberId, array $body): TestResponse
    {
        return $this->postJson(route('profitability.settings.people.cost-rates.store', [
            'organization' => $organization->getKey(),
            'member' => $memberId,
        ], false), $body);
    }

    private function deleteCostRate(Organization $organization, string $memberId, string $rateId): TestResponse
    {
        return $this->deleteJson(route('profitability.settings.people.cost-rates.destroy', [
            'organization' => $organization->getKey(),
            'member' => $memberId,
            'rate' => $rateId,
        ], false));
    }

    private function costRate(Member $member, string $effectiveFrom, int $cents): MemberCostRate
    {
        return MemberCostRate::query()->create([
            'organization_id' => $member->organization_id,
            'member_id' => $member->getKey(),
            'effective_from' => $effectiveFrom,
            'hourly_cost_cents' => $cents,
        ]);
    }

    /**
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<string, mixed>
     */
    private function rowOf(array $rows, string $memberId): array
    {
        foreach ($rows as $row) {
            if ($row['member_id'] === $memberId) {
                return $row;
            }
        }
        $this->fail('Member '.$memberId.' is not in the people list');
    }

    public function test_admin_adds_a_cost_and_the_list_shows_it_as_current(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Admin);
        $employee = Member::factory()->forOrganization($data->organization)->role(Role::Employee)->create();
        $this->actAs($data->user);

        // Act
        $store = $this->postCostRate($data->organization, $employee->getKey(), [
            'effective_from' => '2026-11-01',
            'hourly_cost_cents' => 3500,
        ]);
        $list = $this->getPeople($data->organization);

        // Assert
        $store->assertCreated();
        $store->assertJsonPath('data.effective_from', '2026-11-01');
        $store->assertJsonPath('data.hourly_cost_cents', 3500);
        $rate = MemberCostRate::query()->where('member_id', '=', $employee->getKey())->sole();
        $this->assertSame($data->organization->getKey(), $rate->organization_id);
        $store->assertJsonPath('data.id', $rate->getKey());

        $list->assertOk();
        /** @var array<int, array<string, mixed>> $rows */
        $rows = $list->json('data');
        // The admin, the owner and the employee
        $this->assertCount(3, $rows);
        $row = $this->rowOf($rows, $employee->getKey());
        $this->assertSame('employee', $row['role']);
        $this->assertFalse($row['is_placeholder']);
        $this->assertSame(3500, $row['hourly_cost_cents']);
        $this->assertSame('2026-11-01', $row['since']);
        $this->assertNull($row['weekly_seconds']);
        $this->assertNull($row['target_percent']);
        $this->assertSame([
            ['id' => $rate->getKey(), 'effective_from' => '2026-11-01', 'hourly_cost_cents' => 3500],
        ], $row['cost_rates']);
        $this->assertSame([], $row['work_weeks']);
        // Sorted by name
        $names = array_map(fn (array $row): string => mb_strtolower((string) $row['name']), $rows);
        $sorted = $names;
        sort($sorted);
        $this->assertSame($sorted, $names);
        // The member's sale rate is a separate value and is never written
        $this->assertNull($employee->fresh()?->billable_rate);
    }

    public function test_a_later_cost_applies_from_its_date_only(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $january = $this->costRate($data->member, '2026-01-01', 3000);
        $december = $this->costRate($data->member, '2026-12-01', 4000);
        $this->actAs($data->user);

        // Act
        $response = $this->getPeople($data->organization);

        // Assert: today is 2026-11-18, the December row is not in force yet
        $response->assertOk();
        /** @var array<int, array<string, mixed>> $rows */
        $rows = $response->json('data');
        $row = $this->rowOf($rows, $data->member->getKey());
        $this->assertSame(3000, $row['hourly_cost_cents']);
        $this->assertSame('2026-01-01', $row['since']);
        $this->assertSame([
            ['id' => $december->getKey(), 'effective_from' => '2026-12-01', 'hourly_cost_cents' => 4000],
            ['id' => $january->getKey(), 'effective_from' => '2026-01-01', 'hourly_cost_cents' => 3000],
        ], $row['cost_rates']);
    }

    public function test_duplicate_effective_date_is_rejected(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $this->costRate($data->member, '2026-11-01', 3000);
        $this->actAs($data->user);

        // Act
        $response = $this->postCostRate($data->organization, $data->member->getKey(), [
            'effective_from' => '2026-11-01',
            'hourly_cost_cents' => 5000,
        ]);

        // Assert
        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['effective_from' => __('profitability.validation.duplicate_date')]);
        $this->assertSame(1, MemberCostRate::query()->where('member_id', '=', $data->member->getKey())->count());
        $this->assertSame(3000, MemberCostRate::query()->where('member_id', '=', $data->member->getKey())->sole()->hourly_cost_cents);
    }

    public function test_cost_input_is_validated(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $this->actAs($data->user);

        // Act
        $response = $this->postCostRate($data->organization, $data->member->getKey(), [
            'effective_from' => '01/11/2026',
            'hourly_cost_cents' => -1,
        ]);

        // Assert
        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['effective_from', 'hourly_cost_cents']);
        $this->assertSame(0, MemberCostRate::query()->count());
    }

    public function test_placeholder_member_can_have_a_cost(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $placeholderUser = User::factory()->placeholder()->create();
        $placeholder = Member::factory()->forUser($placeholderUser)->forOrganization($data->organization)->role(Role::Placeholder)->create();
        $this->actAs($data->user);

        // Act
        $store = $this->postCostRate($data->organization, $placeholder->getKey(), [
            'effective_from' => '2025-01-01',
            'hourly_cost_cents' => 2500,
        ]);
        $list = $this->getPeople($data->organization);

        // Assert
        $store->assertCreated();
        /** @var array<int, array<string, mixed>> $rows */
        $rows = $list->json('data');
        $row = $this->rowOf($rows, $placeholder->getKey());
        $this->assertTrue($row['is_placeholder']);
        $this->assertSame('placeholder', $row['role']);
        $this->assertSame(2500, $row['hourly_cost_cents']);
    }

    public function test_cost_row_of_another_organization_is_404(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $other = $this->createUserWithRole(Role::Owner);
        $foreignRate = $this->costRate($other->member, '2026-01-01', 3000);
        $ownRate = $this->costRate($data->member, '2026-01-01', 3000);
        $this->actAs($data->user);

        // Act
        $foreignMemberStore = $this->postCostRate($data->organization, $other->member->getKey(), [
            'effective_from' => '2026-02-01',
            'hourly_cost_cents' => 1,
        ]);
        $foreignMemberDelete = $this->deleteCostRate($data->organization, $other->member->getKey(), $foreignRate->getKey());
        $foreignRateOnOwnMember = $this->deleteCostRate($data->organization, $data->member->getKey(), $foreignRate->getKey());
        $foreignOrganization = $this->deleteCostRate($other->organization, $other->member->getKey(), $foreignRate->getKey());
        $foreignList = $this->getPeople($other->organization);
        $unknownRate = $this->deleteCostRate($data->organization, $data->member->getKey(), '00000000-0000-4000-8000-000000000000');

        // Assert
        $foreignMemberStore->assertNotFound();
        $foreignMemberDelete->assertNotFound();
        $foreignRateOnOwnMember->assertNotFound();
        $foreignOrganization->assertNotFound();
        $foreignList->assertNotFound();
        $unknownRate->assertNotFound();
        $this->assertSame(0, MemberCostRate::query()->where('effective_from', '=', '2026-02-01')->count());
        $this->assertNotNull($foreignRate->fresh());
        $this->assertNotNull($ownRate->fresh());
    }

    public function test_admin_deletes_a_cost_row(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Admin);
        $rate = $this->costRate($data->member, '2026-01-01', 3000);
        $this->actAs($data->user);

        // Act
        $response = $this->deleteCostRate($data->organization, $data->member->getKey(), $rate->getKey());

        // Assert
        $response->assertNoContent();
        $this->assertNull($rate->fresh());
    }

    public function test_employee_and_core_manager_get_404(): void
    {
        foreach ([Role::Employee, Role::Manager] as $role) {
            // Arrange
            $data = $this->createUserWithRole($role);
            $rate = $this->costRate($data->ownerMember, '2026-01-01', 3000);
            $this->actAs($data->user);

            // Act
            $list = $this->getPeople($data->organization);
            $store = $this->postCostRate($data->organization, $data->member->getKey(), [
                'effective_from' => '2026-02-01',
                'hourly_cost_cents' => 1,
            ]);
            $delete = $this->deleteCostRate($data->organization, $data->ownerMember->getKey(), $rate->getKey());

            // Assert
            $list->assertNotFound();
            $store->assertNotFound();
            $delete->assertNotFound();
            $this->assertNotNull($rate->fresh());
            $this->assertSame(0, MemberCostRate::query()->where('member_id', '=', $data->member->getKey())->count());
        }
    }

    public function test_deleting_the_member_deletes_its_cost_rows(): void
    {
        // Arrange
        $data = $this->createUserWithRole(Role::Owner);
        $employee = Member::factory()->forOrganization($data->organization)->role(Role::Employee)->create();
        $this->costRate($employee, '2026-01-01', 3000);
        $this->costRate($employee, '2026-06-01', 3200);
        $kept = $this->costRate($data->member, '2026-01-01', 4000);

        // Act: a bulk delete without Eloquent events, as core does
        Member::query()->whereKey($employee->getKey())->delete();

        // Assert
        $this->assertSame(0, MemberCostRate::query()->where('member_id', '=', $employee->getKey())->count());
        $this->assertNotNull($kept->fresh());
    }
}
