<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Microsoft365\Auth\MicrosoftIdentity;
use App\Microsoft365\Auth\MicrosoftIdentityResolver;
use App\Microsoft365\Auth\MicrosoftSignInException;
use App\Microsoft365\Auth\MicrosoftSignInFailure;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Models\Organization;
use App\Models\User;
use Closure;
use Illuminate\Database\Connection;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

#[CoversClass(MicrosoftIdentityResolver::class)]
#[UsesClass(MicrosoftSignInException::class)]
#[UsesClass(MicrosoftSignInFailure::class)]
#[UsesClass(MicrosoftIdentity::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(MicrosoftAccount::class)]
class MicrosoftIdentityResolverTest extends TestCaseWithDatabase
{
    use InteractsWithMicrosoft365;

    public function test_unique_violation_is_retried_once_and_yields_one_user(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $winner = User::factory()->create(['email' => 'ada@example.test']);
        $insertCompetingRow = $this->competingRowInserter($winner);
        $creatingCalls = 0;
        MicrosoftAccount::creating(function () use (&$creatingCalls, $insertCompetingRow): void {
            $creatingCalls++;
            if ($creatingCalls !== 1) {
                return;
            }
            // The competitor commits its row between our lookup and our insert: our insert violates
            // the unique index. Our rollback also takes the row of this simulation away, so it is
            // put back at the outer level right before the retry opens its transaction.
            $insertCompetingRow();
            $restored = false;
            DB::beforeStartingTransaction(function () use (&$restored, $insertCompetingRow): void {
                if (! $restored) {
                    $restored = true;
                    $insertCompetingRow();
                }
            });
        });
        $userCount = User::query()->count();

        // Act
        $user = $this->resolver()->resolve($this->microsoftIdentity(), null);

        // Assert
        $this->assertSame($winner->getKey(), $user->getKey());
        $this->assertSame(1, $creatingCalls);
        $this->assertSame($userCount, User::query()->count());
        $this->assertSame(1, User::query()->where('email', '=', 'ada@example.test')->count());
        $this->assertSame(1, MicrosoftAccount::query()
            ->where('tenant_id', '=', self::MICROSOFT_TEST_TENANT_ID)
            ->where('microsoft_oid', '=', self::MICROSOFT_TEST_OBJECT_ID)
            ->count());
    }

    public function test_second_unique_violation_surfaces_generic_failure(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $winner = User::factory()->create(['email' => 'ada@example.test']);
        $insertCompetingRow = $this->competingRowInserter($winner);
        $creatingCalls = 0;
        MicrosoftAccount::creating(function () use (&$creatingCalls, $insertCompetingRow): void {
            $creatingCalls++;
            $insertCompetingRow();
        });

        // Act
        try {
            $this->resolver()->resolve($this->microsoftIdentity(), null);
            $this->fail('Expected a MicrosoftSignInException');
        } catch (MicrosoftSignInException $e) {
            // Assert
            $this->assertSame(MicrosoftSignInFailure::Generic, $e->reason);
        }
        $this->assertSame(2, $creatingCalls);
        $this->assertSame(0, MicrosoftAccount::query()->count());
    }

    public function test_resolution_takes_the_advisory_lock(): void
    {
        // Arrange
        $organization = Organization::factory()->create();
        $this->configureMicrosoft365($organization);
        $statements = [];
        DB::listen(function (QueryExecuted $query) use (&$statements): void {
            $statements[] = ['sql' => $query->sql, 'bindings' => $query->bindings];
        });

        // Act
        $this->resolver()->resolve($this->microsoftIdentity([
            'tenantId' => strtoupper(self::MICROSOFT_TEST_TENANT_ID),
            'objectId' => strtoupper(self::MICROSOFT_TEST_OBJECT_ID),
        ]), null);

        // Assert
        $locks = array_values(array_filter($statements, fn (array $statement): bool => str_contains($statement['sql'], 'pg_advisory_xact_lock')));
        $this->assertCount(1, $locks);
        $this->assertSame(
            ['microsoft:'.self::MICROSOFT_TEST_TENANT_ID.':'.self::MICROSOFT_TEST_OBJECT_ID],
            $locks[0]['bindings']
        );
    }

    private function resolver(): MicrosoftIdentityResolver
    {
        return $this->app->make(MicrosoftIdentityResolver::class);
    }

    /**
     * Inserts the row a concurrent sign-in of the same identity would have committed.
     */
    private function competingRowInserter(User $winner): Closure
    {
        return function () use ($winner): void {
            /** @var Connection $connection */
            $connection = DB::connection();
            $connection->table('microsoft_accounts')->insert([
                'id' => (string) Str::uuid(),
                'user_id' => $winner->getKey(),
                'tenant_id' => self::MICROSOFT_TEST_TENANT_ID,
                'microsoft_oid' => self::MICROSOFT_TEST_OBJECT_ID,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        };
    }
}
