<?php

declare(strict_types=1);

namespace App\Appearance;

use App\Appearance\Http\Middleware\ShareAppearanceInertiaData;
use App\Appearance\Listeners\DeleteOrganizationIconFile;
use App\Events\BeforeOrganizationDeletion;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;

/**
 * Entry point of the appearance fork code (per-user theme and accent). It is the only thing core
 * knows about: one line in config/app.php. Routes and migrations are loaded from this directory.
 *
 * Inertia data is deliberately not shared from boot(): Octane flushes shared props on every request.
 */
class AppearanceServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Plain bind (no shared instance): the resolver memoises on the current request, never on itself.
        $this->app->bind(AppearanceResolver::class, fn (): AppearanceResolver => new AppearanceResolver);
    }

    public function boot(Router $router): void
    {
        // The appearance prop is shared per request from this middleware (see its docblock for why).
        $router->pushMiddlewareToGroup('web', ShareAppearanceInertiaData::class);

        // Organization icon files are removed with the organization (Filament action and user deletion
        // included: they all go through DeletionService::deleteOrganization)
        Event::listen(BeforeOrganizationDeletion::class, DeleteOrganizationIconFile::class);

        $this->loadRoutesFrom(__DIR__.'/routes/appearance.php');
        $this->loadMigrationsFrom(__DIR__.'/database/migrations');
    }
}
