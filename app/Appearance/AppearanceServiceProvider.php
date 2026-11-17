<?php

declare(strict_types=1);

namespace App\Appearance;

use Illuminate\Routing\Router;
use Illuminate\Support\ServiceProvider;

/**
 * Entry point of the appearance fork code (per-user theme and accent). It is the only thing core
 * knows about: one line in config/app.php. Routes and migrations are loaded from this directory.
 */
class AppearanceServiceProvider extends ServiceProvider
{
    public function boot(Router $router): void
    {
        $this->loadRoutesFrom(__DIR__.'/routes/appearance.php');
        $this->loadMigrationsFrom(__DIR__.'/database/migrations');
    }
}
