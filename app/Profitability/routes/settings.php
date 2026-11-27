<?php

declare(strict_types=1);

use App\Profitability\Http\Controllers\AbsenceProjectsController;
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

        Route::post('/people/{memberId}/cost-rates', [PeopleSettingsController::class, 'storeCostRate'])
            ->whereUuid(['organization', 'memberId'])
            ->middleware(['check-organization-blocked', 'throttle:60,1,profitability-write:'])
            ->name('profitability.settings.people.cost_rates.store');
        Route::delete('/people/{memberId}/cost-rates/{rate}', [PeopleSettingsController::class, 'destroyCostRate'])
            ->whereUuid(['organization', 'memberId', 'rate'])
            ->middleware(['check-organization-blocked', 'throttle:60,1,profitability-write:'])
            ->name('profitability.settings.people.cost_rates.destroy');

        Route::post('/people/{memberId}/work-weeks', [PeopleSettingsController::class, 'storeWorkWeek'])
            ->whereUuid(['organization', 'memberId'])
            ->middleware(['check-organization-blocked', 'throttle:60,1,profitability-write:'])
            ->name('profitability.settings.people.work_weeks.store');
        Route::delete('/people/{memberId}/work-weeks/{week}', [PeopleSettingsController::class, 'destroyWorkWeek'])
            ->whereUuid(['organization', 'memberId', 'week'])
            ->middleware(['check-organization-blocked', 'throttle:60,1,profitability-write:'])
            ->name('profitability.settings.people.work_weeks.destroy');

        Route::get('/absence-projects', [AbsenceProjectsController::class, 'index'])
            ->whereUuid('organization')
            ->middleware('throttle:120,1,profitability-read:')
            ->name('profitability.settings.absence');
        Route::put('/absence-projects', [AbsenceProjectsController::class, 'update'])
            ->whereUuid('organization')
            ->middleware(['check-organization-blocked', 'throttle:60,1,profitability-write:'])
            ->name('profitability.settings.absence.update');
    });
