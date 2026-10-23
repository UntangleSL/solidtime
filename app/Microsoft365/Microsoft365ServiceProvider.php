<?php

declare(strict_types=1);

namespace App\Microsoft365;

use App\Microsoft365\Auth\MicrosoftOAuthGateway;
use App\Microsoft365\Auth\SocialiteMicrosoftGateway;
use App\Microsoft365\Console\MicrosoftCheckCommand;
use App\Microsoft365\Http\Middleware\ShareMicrosoftInertiaData;
use Illuminate\Routing\Router;
use Illuminate\Support\ServiceProvider;

/**
 * Entry point of the Microsoft 365 fork code. It is the only thing core knows about: one line in
 * config/app.php. Routes and migrations are loaded from this directory.
 *
 * Inertia data is deliberately not shared from boot(): Octane flushes shared props on every request.
 */
class Microsoft365ServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Plain bind (no shared instance): MicrosoftConfig holds no state and must never outlive a request.
        $this->app->bind(MicrosoftConfig::class, fn (): MicrosoftConfig => new MicrosoftConfig);

        // Plain bind, never a shared or request-scoped instance: the gateway builds a fresh Socialite driver per call, and a
        // driver reused across requests would return the previous visitor's cached identity (D-11).
        $this->app->bind(MicrosoftOAuthGateway::class, SocialiteMicrosoftGateway::class);
    }

    public function boot(Router $router): void
    {
        // The microsoft prop is shared per request from this middleware (see its docblock for why).
        $router->pushMiddlewareToGroup('web', ShareMicrosoftInertiaData::class);

        $this->loadRoutesFrom(__DIR__.'/routes/microsoft365.php');
        $this->loadMigrationsFrom(__DIR__.'/database/migrations');

        if ($this->app->runningInConsole()) {
            $this->commands([MicrosoftCheckCommand::class]);
        }
    }
}
