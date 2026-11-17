<?php

declare(strict_types=1);

namespace Tests\Feature\Appearance;

use App\Appearance\AppearanceResolver;
use App\Appearance\AppearanceServiceProvider;
use App\Appearance\Http\Controllers\OrganizationIconController;
use App\Appearance\Http\Middleware\ShareAppearanceInertiaData;
use App\Appearance\Http\Requests\OrganizationIconRequest;
use App\Appearance\Listeners\DeleteOrganizationIconFile;
use App\Appearance\Models\OrganizationIcon;
use App\Enums\Role;
use App\Events\BeforeOrganizationDeletion;
use App\Models\Member;
use App\Models\Organization;
use App\Models\User;
use App\Service\DeletionService;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCaseWithDatabase;

#[CoversClass(OrganizationIconController::class)]
#[CoversClass(DeleteOrganizationIconFile::class)]
#[UsesClass(OrganizationIconRequest::class)]
#[UsesClass(OrganizationIcon::class)]
#[UsesClass(AppearanceResolver::class)]
#[UsesClass(ShareAppearanceInertiaData::class)]
#[UsesClass(AppearanceServiceProvider::class)]
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

    /**
     * A blank image of the given size encoded with GD (png, jpeg or gif).
     */
    private function gdImage(int $width, int $height, string $format = 'png'): string
    {
        $image = imagecreatetruecolor($width, $height);
        $this->assertNotFalse($image);
        ob_start();
        match ($format) {
            'png' => imagepng($image),
            'jpeg' => imagejpeg($image),
            'gif' => imagegif($image),
        };
        $bytes = ob_get_clean();
        $this->assertIsString($bytes);

        return $bytes;
    }

    private function storeUrl(Organization $organization): string
    {
        return route('organizations.icon.store', ['organization' => $organization->getKey()], false);
    }

    private function destroyUrl(Organization $organization): string
    {
        return route('organizations.icon.destroy', ['organization' => $organization->getKey()], false);
    }

    /**
     * Uploads test.png as the organization owner and returns the stored path.
     */
    private function uploadAsOwner(User $owner, Organization $organization): string
    {
        $this->actingAs($owner, 'web');
        $this->postJson($this->storeUrl($organization), ['icon' => $this->dataUrl($this->samplePng())])
            ->assertStatus(200);
        $icon = $this->iconFor($organization);
        $this->assertNotNull($icon);
        $this->disk()->assertExists($icon->path);

        return $icon->path;
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

    public function test_jpeg_is_stored_with_a_jpeg_extension(): void
    {
        // Arrange
        $this->fakeDisk();
        $data = $this->createUserWithRole(Role::Owner);
        $this->actingAs($data->user, 'web');

        // Act
        $response = $this->postJson($this->storeUrl($data->organization), [
            'icon' => $this->dataUrl($this->gdImage(128, 128, 'jpeg'), 'image/jpeg'),
        ]);

        // Assert
        $response->assertStatus(200);
        $files = $this->storedIcons();
        $this->assertCount(1, $files);
        $this->assertMatchesRegularExpression('/^organization-icons\/[0-9a-f-]{36}\.(jpg|jpeg)$/', $files[0]);
    }

    public function test_remove_deletes_row_and_file(): void
    {
        // Arrange
        $disk = $this->fakeDisk();
        $data = $this->createUserWithRole(Role::Owner);
        $path = $this->uploadAsOwner($data->user, $data->organization);

        // Act
        $response = $this->deleteJson($this->destroyUrl($data->organization));

        // Assert
        $response->assertStatus(204);
        $this->assertNull($this->iconFor($data->organization));
        $disk->assertMissing($path);
        $this->assertSame([], $this->storedIcons());

        // Act: removing again is a no-op
        $again = $this->deleteJson($this->destroyUrl($data->organization));

        // Assert
        $again->assertStatus(204);
    }

    public function test_admin_can_remove(): void
    {
        // Arrange
        $disk = $this->fakeDisk();
        $data = $this->createUserWithRole(Role::Admin);
        $path = $this->uploadAsOwner($data->owner, $data->organization);
        $this->actingAs($data->user, 'web');

        // Act
        $response = $this->deleteJson($this->destroyUrl($data->organization));

        // Assert
        $response->assertStatus(204);
        $this->assertNull($this->iconFor($data->organization));
        $disk->assertMissing($path);
    }

    public function test_permission_matrix(): void
    {
        foreach ([Role::Manager, Role::Employee] as $role) {
            // Arrange
            $disk = $this->fakeDisk();
            $data = $this->createUserWithRole($role);
            $path = $this->uploadAsOwner($data->owner, $data->organization);
            $this->actingAs($data->user, 'web');

            // Act
            $store = $this->postJson($this->storeUrl($data->organization), [
                'icon' => $this->dataUrl($this->samplePng()),
            ]);
            $destroy = $this->deleteJson($this->destroyUrl($data->organization));

            // Assert
            $store->assertStatus(403);
            $destroy->assertStatus(403);
            $icon = $this->iconFor($data->organization);
            $this->assertNotNull($icon, $role->value);
            $this->assertSame($path, $icon->path);
            $disk->assertExists($path);
            $this->assertSame([$path], $this->storedIcons(), $role->value);
        }

        // Arrange: the owner of another organization
        $disk = $this->fakeDisk();
        $target = $this->createUserWithRole(Role::Owner);
        $path = $this->uploadAsOwner($target->user, $target->organization);
        $outsider = $this->createUserWithRole(Role::Owner);
        $this->actingAs($outsider->user, 'web');

        // Act
        $store = $this->postJson($this->storeUrl($target->organization), [
            'icon' => $this->dataUrl($this->samplePng()),
        ]);
        $destroy = $this->deleteJson($this->destroyUrl($target->organization));

        // Assert
        $store->assertStatus(403);
        $destroy->assertStatus(403);
        $icon = $this->iconFor($target->organization);
        $this->assertNotNull($icon);
        $this->assertSame($path, $icon->path);
        $disk->assertExists($path);
        $this->assertNull($this->iconFor($outsider->organization));
    }

    public function test_guest_gets_401_json(): void
    {
        // Arrange
        $this->fakeDisk();
        $data = $this->createUserWithRole(Role::Owner);

        // Act
        $store = $this->postJson($this->storeUrl($data->organization), [
            'icon' => $this->dataUrl($this->samplePng()),
        ]);
        $destroy = $this->deleteJson($this->destroyUrl($data->organization));

        // Assert
        $store->assertStatus(401);
        $destroy->assertStatus(401);
        $this->assertSame(0, OrganizationIcon::query()->count());
        $this->assertSame([], $this->storedIcons());
    }

    public function test_unknown_and_non_uuid_organizations_are_404(): void
    {
        // Arrange
        $this->fakeDisk();
        $data = $this->createUserWithRole(Role::Owner);
        $this->actingAs($data->user, 'web');
        $body = ['icon' => $this->dataUrl($this->samplePng())];
        $unknown = (string) Str::uuid();

        // Act
        $unknownStore = $this->postJson('/organizations/'.$unknown.'/icon', $body);
        $unknownDestroy = $this->deleteJson('/organizations/'.$unknown.'/icon');
        $invalidStore = $this->postJson('/organizations/not-a-uuid/icon', $body);
        $invalidDestroy = $this->deleteJson('/organizations/not-a-uuid/icon');

        // Assert
        $unknownStore->assertStatus(404);
        $unknownDestroy->assertStatus(404);
        $invalidStore->assertStatus(404);
        $invalidDestroy->assertStatus(404);
        $this->assertSame(0, OrganizationIcon::query()->count());
        $this->assertSame([], $this->storedIcons());
    }

    public function test_validation_matrix(): void
    {
        // Arrange
        $this->fakeDisk();
        $data = $this->createUserWithRole(Role::Owner);
        $this->actingAs($data->user, 'web');
        $csv = file_get_contents(resource_path('testfiles/generic_projects_import_test_1.csv'));
        $this->assertIsString($csv);
        $svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">'
            .'<script>alert(1)</script><rect width="64" height="64"/></svg>';
        $rejected = [
            'missing' => null,
            'not a string' => 12345,
            'not base64' => 'data:image/png;base64,***not base64***',
            'csv' => $this->dataUrl($csv, 'image/png'),
            'svg' => $this->dataUrl($svg, 'image/svg+xml'),
            'gif' => $this->dataUrl($this->gdImage(64, 64, 'gif'), 'image/gif'),
            'png over 1 MiB' => $this->dataUrl($this->samplePng().str_repeat("\0", 1024 * 1024)),
        ];
        $wrongSize = [
            '16 x 16' => $this->dataUrl($this->gdImage(16, 16)),
            '1100 x 40' => $this->dataUrl($this->gdImage(1100, 40)),
            '40 x 1100' => $this->dataUrl($this->gdImage(40, 1100)),
        ];

        foreach ($rejected as $case => $icon) {
            // Act
            $response = $this->postJson($this->storeUrl($data->organization), $icon === null ? [] : ['icon' => $icon]);

            // Assert
            $this->assertSame(422, $response->status(), $case);
            $response->assertJsonValidationErrors(['icon']);
        }
        foreach ($wrongSize as $case => $icon) {
            // Act
            $response = $this->postJson($this->storeUrl($data->organization), ['icon' => $icon]);

            // Assert
            $this->assertSame(422, $response->status(), $case);
            $response->assertJsonValidationErrors(['icon' => __('branding.validation.icon_dimensions')]);
        }
        $this->assertSame(0, OrganizationIcon::query()->count());
        $this->assertSame([], $this->storedIcons());

        foreach (['32 x 32' => $this->gdImage(32, 32), '1024 x 1024' => $this->gdImage(1024, 1024), 'test.png' => $this->samplePng()] as $case => $bytes) {
            // Act
            $response = $this->postJson($this->storeUrl($data->organization), ['icon' => $this->dataUrl($bytes)]);

            // Assert
            $this->assertSame(200, $response->status(), $case);
        }
        $this->assertSame(1, OrganizationIcon::query()->count());
        $this->assertCount(1, $this->storedIcons());
    }

    public function test_prop_lists_only_the_users_organizations(): void
    {
        // Arrange
        $disk = $this->fakeDisk();
        $data = $this->createUserWithRole(Role::Owner);
        $organizationA = $data->organization;
        $organizationB = Organization::factory()->withOwner(User::factory()->create())->create();
        Member::factory()->forUser($data->user)->forOrganization($organizationB)->role(Role::Employee)->create();
        $organizationC = $this->createUserWithRole(Role::Owner)->organization;
        $iconA = OrganizationIcon::query()->create([
            'organization_id' => $organizationA->getKey(),
            'path' => 'organization-icons/'.Str::uuid().'.png',
        ]);
        OrganizationIcon::query()->create([
            'organization_id' => $organizationC->getKey(),
            'path' => 'organization-icons/'.Str::uuid().'.png',
        ]);
        $this->actingAs($data->user, 'web');

        // Act
        $response = $this->get(route('dashboard', [], false));

        // Assert
        $response->assertStatus(200);
        $response->assertInertia(fn (AssertableInertia $page) => $page
            ->where('appearance.org_icons', [$organizationA->getKey() => $disk->url($iconA->path)])
            ->etc());
    }

    public function test_guest_prop_has_empty_org_icons(): void
    {
        // Arrange
        $this->fakeDisk();
        $data = $this->createUserWithRole(Role::Owner);
        OrganizationIcon::query()->create([
            'organization_id' => $data->organization->getKey(),
            'path' => 'organization-icons/'.Str::uuid().'.png',
        ]);

        // Act
        $response = $this->get(route('login', [], false));

        // Assert
        $response->assertStatus(200);
        $response->assertInertia(fn (AssertableInertia $page) => $page
            ->where('appearance.org_icons', [])
            ->etc());
    }

    public function test_deleting_an_organization_removes_its_icon_file(): void
    {
        // Arrange
        $disk = $this->fakeDisk();
        $data = $this->createUserWithRole(Role::Owner);
        $other = $this->createUserWithRole(Role::Owner);
        $path = $this->uploadAsOwner($data->user, $data->organization);
        $otherPath = $this->uploadAsOwner($other->user, $other->organization);

        // Act
        app(DeletionService::class)->deleteOrganization($data->organization);

        // Assert
        $this->assertNull(Organization::query()->find($data->organization->getKey()));
        $this->assertNull($this->iconFor($data->organization));
        $disk->assertMissing($path);
        $disk->assertExists($otherPath);
        $this->assertNotNull($this->iconFor($other->organization));
    }

    public function test_the_deletion_listener_is_registered(): void
    {
        // Act
        $listeners = Event::getRawListeners()[BeforeOrganizationDeletion::class] ?? [];

        // Assert
        $this->assertContains(DeleteOrganizationIconFile::class, $listeners);
    }
}
