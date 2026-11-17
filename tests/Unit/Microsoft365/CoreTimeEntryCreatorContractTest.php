<?php

declare(strict_types=1);

namespace Tests\Unit\Microsoft365;

use App\Http\Controllers\Api\V1\TimeEntryController;
use App\Http\Requests\V1\TimeEntry\TimeEntryStoreRequest;
use App\Microsoft365\TimeEntries\CoreTimeEntryCreator;
use App\Models\Organization;
use Illuminate\Http\Resources\Json\JsonResource;
use PHPUnit\Framework\Attributes\CoversNothing;
use ReflectionMethod;
use ReflectionNamedType;
use Tests\TestCase;

/**
 * CoreTimeEntryCreator calls core's create action in-process (Phase 4 D-10). If an upstream merge changes
 * that action's signature, this test fails in CI instead of the conversion failing in production.
 */
#[CoversNothing]
class CoreTimeEntryCreatorContractTest extends TestCase
{
    public function test_core_store_signature_is_unchanged(): void
    {
        // Arrange
        $method = new ReflectionMethod(TimeEntryController::class, 'store');

        // Act
        $parameters = $method->getParameters();
        $types = array_map(function (\ReflectionParameter $parameter): string {
            $type = $parameter->getType();

            return $type instanceof ReflectionNamedType ? $type->getName() : '';
        }, $parameters);
        $return = $method->getReturnType();

        // Assert
        $this->assertTrue($method->isPublic());
        $this->assertCount(2, $parameters);
        $this->assertSame([Organization::class, TimeEntryStoreRequest::class], $types);
        $this->assertInstanceOf(ReflectionNamedType::class, $return);
        $this->assertSame(JsonResource::class, $return->getName());
    }

    public function test_creator_is_not_final_so_tests_can_replace_it(): void
    {
        // Arrange
        $method = new ReflectionMethod(CoreTimeEntryCreator::class, 'create');

        // Assert
        $this->assertFalse((new \ReflectionClass(CoreTimeEntryCreator::class))->isFinal());
        $this->assertTrue($method->isPublic());
    }
}
