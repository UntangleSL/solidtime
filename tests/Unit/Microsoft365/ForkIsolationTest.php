<?php

declare(strict_types=1);

namespace Tests\Unit\Microsoft365;

use Illuminate\Support\Facades\File;
use PHPUnit\Framework\Attributes\CoversNothing;
use Tests\TestCase;

/**
 * Static canaries over the source tree, so they run in every CI job without a database or git:
 * Graph jobs can only be queued by fork console commands (D-08, RESEARCH Pitfall 2), and the
 * touched-core-files ledger names only paths that exist (OPS-03).
 */
#[CoversNothing]
class ForkIsolationTest extends TestCase
{
    private const string CONSOLE_DIRECTORY = 'app/Microsoft365/Console/';

    /** Top-level locations a ledger path can start with; anything else in backticks is code or prose. */
    private const array LEDGER_PREFIXES = [
        'app/', 'bootstrap/', 'config/', 'database/', 'docker/', 'docs/', 'e2e/', 'extensions/', 'lang/',
        'public/', 'resources/', 'routes/', 'tests/', '.github/', '.claude/', '.planning/',
    ];

    private function relative(string $path): string
    {
        $base = str_replace('\\', '/', base_path()).'/';
        $path = str_replace('\\', '/', $path);

        return str_starts_with($path, $base) ? substr($path, strlen($base)) : $path;
    }

    public function test_fork_jobs_are_dispatched_only_from_fork_console_commands(): void
    {
        // Arrange: every job class of the fork and every PHP file of the application
        $jobs = [];
        foreach (File::files(app_path('Microsoft365/Jobs')) as $file) {
            if ($file->getExtension() === 'php') {
                $jobs[] = $file->getBasename('.php');
            }
        }
        $sources = [];
        foreach (File::allFiles(app_path()) as $file) {
            if ($file->getExtension() === 'php') {
                $sources[$this->relative($file->getPathname())] = $file->getContents();
            }
        }

        // Act: a static dispatch on the class, or a construction of it (which covers dispatch(new Job(...)))
        $sites = [];
        foreach ($jobs as $job) {
            $class = preg_quote($job, '/');
            $pattern = '/\b'.$class.'::(dispatch|dispatchSync|dispatchIf|dispatchUnless|dispatchAfterResponse)\s*\(|\bnew\s+(?:\\\\?[A-Za-z0-9_\\\\]*\\\\)?'.$class.'\s*\(/';
            foreach ($sources as $path => $contents) {
                if (preg_match($pattern, $contents) === 1) {
                    $sites[$job][] = $path;
                }
            }
        }

        // Assert: the scan found the jobs and the known dispatch site, so it cannot pass vacuously
        $this->assertNotEmpty($jobs, 'app/Microsoft365/Jobs holds no job class');
        $this->assertContains('app/Microsoft365/Console/CheckOutOfSyncCommand.php', $sites['CheckOutOfSyncForUser'] ?? []);
        foreach ($sites as $job => $paths) {
            foreach ($paths as $path) {
                // A dispatch from a request would run in the (possibly impersonated) session under QUEUE_CONNECTION=sync
                $this->assertStringStartsWith(self::CONSOLE_DIRECTORY, $path, $job.' is dispatched outside the fork console commands, in '.$path);
            }
        }
    }

    public function test_every_path_in_the_touched_core_files_ledger_exists(): void
    {
        // Arrange
        $ledger = File::get(base_path('docs/m365/TOUCHED-CORE-FILES.md'));

        // Act: backticked tokens that look like repository paths (no whitespace, braces, globs, colons)
        preg_match_all('/`([^`\n]+)`/', $ledger, $matches);
        $paths = [];
        foreach ($matches[1] as $token) {
            if (preg_match('/[\s{}<>*:()]/', $token) === 1) {
                continue;
            }
            foreach (self::LEDGER_PREFIXES as $prefix) {
                if (str_starts_with($token, $prefix)) {
                    $paths[$token] = true;
                    break;
                }
            }
        }

        // Assert
        $this->assertGreaterThanOrEqual(100, count($paths), 'The ledger scan found too few paths to be meaningful');
        foreach (array_keys($paths) as $path) {
            // file_exists, not assertFileExists: the ledger also names directories
            $this->assertTrue(file_exists(base_path($path)), 'docs/m365/TOUCHED-CORE-FILES.md names a stale path: '.$path);
        }
    }
}
