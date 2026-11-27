<?php

declare(strict_types=1);

use App\Profitability\Http\Controllers\PeopleSettingsController;
use Illuminate\Support\Facades\Route;

// Profitability settings of Owner and Admin (D-12, D-16): dated hourly costs and working weeks per
// person, and the explicit absence projects. Web group only (session + CSRF), never under api/. Every
// id is a uuid looked up inside the route organization; anything else is a plain 404. Writes are
// blocked for blocked organizations.
Route::middleware(['web', 'auth:web', 'auth.session', 'verified'])
    ->prefix('profitability/organizations/{organization}/settings')
    ->group(function (): void {
        Route::get('/people', [PeopleSettingsController::class, 'index'])
            ->whereUuid('organization')
            ->middleware('throttle:120,1,profitability-read:')
            ->name('profitability.settings.people');

        Route::post('/people/{member}/cost-rates', [PeopleSettingsController::class, 'storeCostRate'])
            ->whereUuid(['organization', 'member'])
            ->middleware(['check-organization-blocked', 'throttle:60,1,profitability-write:'])
            ->name('profitability.settings.people.cost-rates.store');
        Route::delete('/people/{member}/cost-rates/{rate}', [PeopleSettingsController::class, 'destroyCostRate'])
            ->whereUuid(['organization', 'member', 'rate'])
            ->middleware(['check-organization-blocked', 'throttle:60,1,profitability-write:'])
            ->name('profitability.settings.people.cost-rates.destroy');
    });
