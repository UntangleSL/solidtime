<?php

declare(strict_types=1);

use App\Profitability\Http\Controllers\ClientsViewController;
use App\Profitability\Http\Controllers\ProjectsViewController;
use Illuminate\Support\Facades\Route;

// The by-project view of the Profitability page (D-14): projects in the caller's scope with hours,
// projection, status and, where allowed, money (D-11). Web group only (session + CSRF), never under
// api/. The provider loads every file of this directory.
Route::middleware(['web', 'auth:web', 'auth.session', 'verified'])
    ->prefix('profitability')
    ->group(function (): void {
        Route::get('/organizations/{organization}/views/projects', [ProjectsViewController::class, 'index'])
            ->whereUuid('organization')
            ->middleware('throttle:120,1,profitability-read:')
            ->name('profitability.views.projects');

        // The by-client view (BUDG-06, D-07): Owner/Admin and account managers only, always with money.
        Route::get('/organizations/{organization}/views/clients', [ClientsViewController::class, 'index'])
            ->whereUuid('organization')
            ->middleware('throttle:120,1,profitability-read:')
            ->name('profitability.views.clients');
    });
