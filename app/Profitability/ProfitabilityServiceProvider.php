<?php

declare(strict_types=1);

namespace App\Profitability;

use App\Profitability\Access\ProfitabilityAccess;
use App\Profitability\Reporting\ConsumptionQuery;
use App\Service\PermissionStore;
use App\Service\TimezoneService;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Support\ServiceProvider;

/**
 * Entry point of the profitability fork code (contract terms, hour budgets, consumption, chargeability).
 * It is the only thing core knows about: one line in config/app.php. Routes and migrations are loaded
 * from this directory.
 *
 * Inertia data is deliberately not shared from boot(): Octane flushes shared props on every request.
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

    public function boot(): void
    {
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
