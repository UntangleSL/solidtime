<?php

declare(strict_types=1);

use App\Profitability\Http\Controllers\PeopleViewController;
use Illuminate\Support\Facades\Route;

// The by-person view of the Profitability page (CHRG-03): chargeability against target per person, Owner
// and Admin only (D-16). Web group only (session + CSRF), never under api/. Its own route file so it
// never collides with the other views; the provider loads every file of this directory.
Route::middleware(['web', 'auth:web', 'auth.session', 'verified'])
    ->prefix('profitability')
    ->group(function (): void {
        Route::get('/organizations/{organization}/views/people', [PeopleViewController::class, 'index'])
            ->whereUuid('organization')
            ->middleware('throttle:120,1,profitability-read:')
            ->name('profitability.views.people');
    });
