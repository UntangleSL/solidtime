<?php

declare(strict_types=1);

namespace Tests\Feature\Appearance;

use App\Appearance\Http\Controllers\OrganizationIconController;
use App\Appearance\Http\Requests\OrganizationIconRequest;
use App\Appearance\Models\OrganizationIcon;
use App\Enums\Role;
use App\Models\Organization;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

#[CoversClass(OrganizationIconController::class)]
#[UsesClass(OrganizationIconRequest::class)]
#[UsesClass(OrganizationIcon::class)]
class OrganizationIconTest extends TestCaseWithDatabase
{
    private function disk(): Filesystem
    {
        return Storage::disk((string) config('filesystems.public'));
    }

    private function fakeDisk(): Filesystem
    {
        Storage::fake((string) config('filesystems.public'));

        return $this->disk();
    }

    private function samplePng(): string
    {
        $png = file_get_contents(resource_path('testfiles/test.png'));
        $this->assertIsString($png);

        return $png;
    }

    private function dataUrl(string $bytes, string $mime = 'image/png'): string
    {
        return 'data:'.$mime.';base64,'.base64_encode($bytes);
    }

    private function iconFor(Organization $organization): ?OrganizationIcon
    {
        return OrganizationIcon::query()->where('organization_id', '=', $organization->getKey())->first();
    }

    /**
     * @return list<string>
     */
    private function storedIcons(): array
    {
        return array_values($this->disk()->files('organization-icons'));
    }

    public function test_owner_uploads_an_icon(): void
    {
        // Arrange
        $disk = $this->fakeDisk();
        $data = $this->createUserWithRole(Role::Owner);
        $this->actingAs($data->user, 'web');

        // Act
        $response = $this->postJson(route('organizations.icon.store', ['organization' => $data->organization->getKey()], false), [
            'icon' => $this->dataUrl($this->samplePng()),
        ]);

        // Assert
        $response->assertStatus(200);
        $url = $response->json('url');
        $this->assertIsString($url);
        $this->assertStringContainsString('organization-icons/', $url);
        $files = $this->storedIcons();
        $this->assertCount(1, $files);
        $this->assertStringEndsWith('.png', $files[0]);
        $this->assertSame($this->samplePng(), $disk->get($files[0]));
        $this->assertSame(1, OrganizationIcon::query()->count());
        $icon = $this->iconFor($data->organization);
        $this->assertNotNull($icon);
        $this->assertSame($files[0], $icon->path);
        $this->assertSame($disk->url($icon->path), $url);
    }

    public function test_admin_can_upload(): void
    {
        // Arrange
        $this->fakeDisk();
        $data = $this->createUserWithRole(Role::Admin);
        $this->actingAs($data->user, 'web');

        // Act
        $response = $this->postJson(route('organizations.icon.store', ['organization' => $data->organization->getKey()], false), [
            'icon' => $this->dataUrl($this->samplePng()),
        ]);

        // Assert
        $response->assertStatus(200);
        $this->assertNotNull($this->iconFor($data->organization));
        $this->assertCount(1, $this->storedIcons());
    }

    public function test_replacing_deletes_the_previous_file(): void
    {
        // Arrange
        $disk = $this->fakeDisk();
        $data = $this->createUserWithRole(Role::Owner);
        $this->actingAs($data->user, 'web');
        $url = route('organizations.icon.store', ['organization' => $data->organization->getKey()], false);
        $this->postJson($url, ['icon' => $this->dataUrl($this->samplePng())])->assertStatus(200);
        $first = $this->iconFor($data->organization);
        $this->assertNotNull($first);
        $firstPath = $first->path;

        // Act
        $response = $this->postJson($url, ['icon' => $this->dataUrl($this->samplePng())]);

        // Assert
        $response->assertStatus(200);
        $this->assertSame(1, OrganizationIcon::query()->count());
        $second = $this->iconFor($data->organization);
        $this->assertNotNull($second);
        $this->assertNotSame($firstPath, $second->path);
        $disk->assertMissing($firstPath);
        $disk->assertExists($second->path);
        $this->assertSame([$second->path], $this->storedIcons());
    }

    public function test_routes_are_web_session_routes(): void
    {
        foreach (['organizations.icon.store' => 'POST', 'organizations.icon.destroy' => 'DELETE'] as $name => $method) {
            // Act
            $route = Route::getRoutes()->getByName($name);

            // Assert
            $this->assertNotNull($route, $name);
            $this->assertSame('organizations/{organization}/icon', $route->uri());
            $this->assertContains($method, $route->methods());
            $this->assertStringStartsNotWith('api/', $route->uri());
            $middleware = $route->gatherMiddleware();
            $this->assertContains('web', $middleware);
            $this->assertContains('auth:web', $middleware);
            $this->assertContains('auth.session', $middleware);
            $this->assertContains('verified', $middleware);
            $this->assertContains('throttle:20,1,org-icon:', $middleware);
            $this->assertArrayHasKey('organization', $route->wheres);
            $this->assertMatchesRegularExpression('/^'.$route->wheres['organization'].'$/', '9a7f2c4e-1b3d-4e5f-8a6b-7c8d9e0f1a2b');
            $this->assertDoesNotMatchRegularExpression('/^'.$route->wheres['organization'].'$/', 'not-a-uuid');
        }
    }
}
