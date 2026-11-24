<?php

declare(strict_types=1);

namespace Tests\Unit\Microsoft365;

use App\Http\Controllers\Api\V1\TimeEntryController;
use App\Http\Requests\V1\TimeEntry\TimeEntryUpdateRequest;
use App\Microsoft365\TimeEntries\CoreTimeEntryUpdater;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Routing\Route;
use Illuminate\Routing\Router;
use PHPUnit\Framework\Attributes\CoversNothing;
use ReflectionClass;
use ReflectionMethod;
use ReflectionNamedType;
use ReflectionParameter;
use Tests\TestCase;

/**
 * CoreTimeEntryUpdater calls core's update action in-process, bound to core's own route (Phase 6 D-04,
 * D-12). If an upstream merge changes that action's signature, its return type, the route's name or
 * parameters, or drops the blocked-organization middleware the updater replicates, this test fails
 * locally and in CI instead of every auto adjust silently turning into a moved flag in production.
 *
 * No database: the router is booted by the application, the rest is reflection.
 */
#[CoversNothing]
class CoreTimeEntryUpdaterContractTest extends TestCase
{
    public function test_core_update_signature_is_unchanged(): void
    {
        // Arrange
        $method = new ReflectionMethod(TimeEntryController::class, 'update');

        // Act
        $parameters = $method->getParameters();
        $types = array_map(static function (ReflectionParameter $parameter): string {
            $type = $parameter->getType();

            return $type instanceof ReflectionNamedType ? $type->getName() : '';
        }, $parameters);
        $return = $method->getReturnType();

        // Assert
        $this->assertTrue($method->isPublic());
        $this->assertCount(3, $parameters);
        $this->assertSame([Organization::class, TimeEntry::class, TimeEntryUpdateRequest::class], $types);
        $this->assertInstanceOf(ReflectionNamedType::class, $return);
        $this->assertSame(JsonResource::class, $return->getName());
    }

    public function test_core_update_route_is_unchanged(): void
    {
        // Arrange: the inner name of routes/api.php is v1.time-entries.update, inside the 'api.' group
        $this->assertSame('api.v1.time-entries.update', CoreTimeEntryUpdater::ROUTE);

        // Act
        $route = app(Router::class)->getRoutes()->getByName(CoreTimeEntryUpdater::ROUTE);

        // Assert
        $this->assertInstanceOf(Route::class, $route);
        $this->assertSame(['PUT'], $route->methods());
        $this->assertSame(TimeEntryController::class.'@update', $route->getActionName());
        $this->assertSame(['organization', 'timeEntry'], $route->parameterNames());
        $this->assertContains('check-organization-blocked', $route->middleware());
    }

    public function test_updater_signature_is_unchanged_and_replaceable(): void
    {
        // Arrange
        $method = new ReflectionMethod(CoreTimeEntryUpdater::class, 'updateTimes');

        // Act
        $types = array_map(static function (ReflectionParameter $parameter): string {
            $type = $parameter->getType();

            return $type instanceof ReflectionNamedType ? $type->getName() : '';
        }, $method->getParameters());
        $return = $method->getReturnType();

        // Assert: 06-09 and 06-10 call it, tests bind a double for it (not final)
        $this->assertFalse((new ReflectionClass(CoreTimeEntryUpdater::class))->isFinal());
        $this->assertTrue($method->isPublic());
        $this->assertSame([User::class, TimeEntry::class, 'string', 'string'], $types);
        $this->assertInstanceOf(ReflectionNamedType::class, $return);
        $this->assertSame(TimeEntry::class, $return->getName());
    }

    public function test_updater_keeps_no_static_state(): void
    {
        // Arrange
        $class = new ReflectionClass(CoreTimeEntryUpdater::class);

        // Act
        $static = array_filter($class->getProperties(), static fn (\ReflectionProperty $property): bool => $property->isStatic());

        // Assert: Octane workers share the class between requests and jobs
        $this->assertSame([], $static);
    }
}
