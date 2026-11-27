<?php

declare(strict_types=1);

namespace App\Profitability;

use App\Models\TimeEntry;
use App\Profitability\Access\ProfitabilityAccess;
use App\Profitability\Http\Middleware\ShareProfitabilityInertiaData;
use App\Profitability\Reporting\ConsumptionQuery;
use App\Profitability\TimeEntries\EnforceBillableOnBillableProject;
use App\Service\PermissionStore;
use App\Service\TimezoneService;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Routing\Router;
use Illuminate\Support\ServiceProvider;

/**
 * Entry point of the profitability fork code (contract terms, hour budgets, consumption, chargeability).
 * It is the only thing core knows about: one line in config/app.php. Routes and migrations are loaded
 * from this directory.
 *
 * Inertia data is deliberately not shared from boot(): Octane flushes shared props on every request.
 * boot() only pushes the web-group middleware that shares the `profitability` prop per request.
 */
class ProfitabilityServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Plain binds (no shared instance): the resolver reads the request-scoped PermissionStore and
        // never memoises on itself, so nothing leaks between Octane requests.
        $this->app->bind(ProfitabilityAccess::class, fn (Application $app): ProfitabilityAccess => new ProfitabilityAccess(
            $app->make(PermissionStore::class),
        ));
        $this->app->bind(ConsumptionQuery::class, fn (Application $app): ConsumptionQuery => new ConsumptionQuery(
            $app->make(TimezoneService::class),
        ));
    }

    public function boot(Router $router): void
    {
        // The profitability prop is shared per request from this middleware (see its docblock for why).
        $router->pushMiddlewareToGroup('web', ShareProfitabilityInertiaData::class);

        // D-05: one saving listener covers the API, the importers and the Outlook conversion, because all
        // of them end in TimeEntry::save(). Resolved per event so no state outlives an Octane request.
        TimeEntry::saving(static function (TimeEntry $entry): void {
            app(EnforceBillableOnBillableProject::class)->handle($entry);
        });

        // Every route file of the module, in a stable order: later plans add their own file here
        // without editing this provider.
        $routeFiles = glob(__DIR__.'/routes/*.php');
        if ($routeFiles !== false) {
            sort($routeFiles);
            foreach ($routeFiles as $routeFile) {
                $this->loadRoutesFrom($routeFile);
            }
        }

        $this->loadMigrationsFrom(__DIR__.'/database/migrations');
    }
}
