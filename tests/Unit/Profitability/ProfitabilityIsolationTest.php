<?php

declare(strict_types=1);

namespace Tests\Unit\Profitability;

use App\Enums\Role;
use Illuminate\Support\Facades\File;
use PHPUnit\Framework\Attributes\CoversNothing;
use Tests\TestCase;

/**
 * Static canaries over the source tree, so they run in every CI job without a database or git: the
 * profitability fork stays isolated from core (mergeability, D-10). Core knows it through one provider
 * line in config/app.php, its routes live in the module (web group, never in core route files or in
 * openapi.json), core roles and permissions are unchanged, and the module neither audits nor reads the
 * environment.
 */
#[CoversNothing]
class ProfitabilityIsolationTest extends TestCase
{
    private const string MODULE_DIRECTORY = 'app/Profitability/';

    private function relative(string $path): string
    {
        $base = str_replace('\\', '/', base_path()).'/';
        $path = str_replace('\\', '/', $path);

        return str_starts_with($path, $base) ? substr($path, strlen($base)) : $path;
    }

    /**
     * Every PHP file of app/, keyed by its path relative to the repository root.
     *
     * @return array<string, string>
     */
    private function applicationSources(): array
    {
        $sources = [];
        foreach (File::allFiles(app_path()) as $file) {
            if ($file->getExtension() === 'php') {
                $sources[$this->relative($file->getPathname())] = $file->getContents();
            }
        }

        return $sources;
    }

    public function test_module_is_referenced_only_by_the_provider_line(): void
    {
        // Arrange
        $sources = $this->applicationSources();
        $config = File::get(config_path('app.php'));

        // Act: a namespace reference, in code or in a string (App\Profitability or App\\Profitability)
        $outside = [];
        $inside = 0;
        foreach ($sources as $path => $contents) {
            if (str_starts_with($path, self::MODULE_DIRECTORY)) {
                $inside++;

                continue;
            }
            if (preg_match('/App\\\\{1,2}Profitability\b/', $contents) === 1) {
                $outside[] = $path;
            }
        }
        $providerLines = array_values(array_filter(
            preg_split('/\R/', $config) ?: [],
            static fn (string $line): bool => str_contains($line, 'ProfitabilityServiceProvider'),
        ));

        // Assert: the scan saw the module, so it cannot pass vacuously
        $this->assertGreaterThanOrEqual(40, $inside, 'app/Profitability holds too few PHP files for the scan to be meaningful');
        $this->assertSame([], $outside, 'Core code references the profitability module');
        $this->assertCount(2, $providerLines, 'config/app.php must name ProfitabilityServiceProvider exactly twice (use line and providers entry)');
        $this->assertSame('use App\Profitability\ProfitabilityServiceProvider;', trim($providerLines[0]));
        $this->assertSame('ProfitabilityServiceProvider::class,', trim($providerLines[1]));
    }

    public function test_no_profitability_route_in_core_route_files_or_openapi(): void
    {
        // Arrange
        $web = File::get(base_path('routes/web.php'));
        $api = File::get(base_path('routes/api.php'));
        $openapi = File::get(base_path('openapi.json'));

        // Assert
        $this->assertStringNotContainsStringIgnoringCase('profitab', $web, 'routes/web.php names the profitability module');
        $this->assertStringNotContainsStringIgnoringCase('profitab', $api, 'routes/api.php names the profitability module');
        $this->assertStringNotContainsString('/profitability', $openapi, 'openapi.json documents a profitability route');
        $this->assertNotEmpty(glob(app_path('Profitability/routes/*.php')) ?: [], 'The module routes moved out of app/Profitability/routes');
    }

    public function test_core_roles_and_permission_store_are_unchanged(): void
    {
        // Arrange
        $roles = array_map(static fn (Role $role): string => $role->value, Role::cases());
        $permissionStore = File::get(app_path('Service/PermissionStore.php'));

        // Assert: project and account managers are fork assignments, never core roles (D-10)
        $this->assertSame(['owner', 'admin', 'manager', 'employee', 'placeholder'], $roles);
        $this->assertStringNotContainsStringIgnoringCase('profitab', $permissionStore);
        $this->assertStringNotContainsStringIgnoringCase('account_manager', $permissionStore);
        $this->assertStringNotContainsStringIgnoringCase('project_manager', $permissionStore);
    }

    public function test_module_has_no_audit_trait_and_no_env_calls(): void
    {
        // Arrange
        $module = [];
        foreach ($this->applicationSources() as $path => $contents) {
            if (str_starts_with($path, self::MODULE_DIRECTORY)) {
                $module[$path] = $contents;
            }
        }

        // Act
        $audited = [];
        $env = [];
        foreach ($module as $path => $contents) {
            if (preg_match('/OwenIt\\\\{1,2}Auditing|\bAuditable\b|\bCustomAuditable\b|\bAuditableThroughParent\b|\bAuditableWithoutOwner\b/', $contents) === 1) {
                $audited[] = $path;
            }
            // A bare env( call, not a method such as $app->env( or Str::env(
            if (preg_match('/(?<![\w$>:\\\\])env\s*\(/', $contents) === 1) {
                $env[] = $path;
            }
        }

        // Assert
        $this->assertNotEmpty($module, 'app/Profitability holds no PHP file');
        $this->assertSame([], $audited, 'The profitability module must not use the auditing contract or trait');
        $this->assertSame([], $env, 'The profitability module must read config, never env()');
    }
}
