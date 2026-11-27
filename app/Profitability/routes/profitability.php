<?php

declare(strict_types=1);

use App\Profitability\Http\Controllers\ProfitabilityPageController;
use App\Profitability\Http\Controllers\ProjectSummaryController;
use Illuminate\Support\Facades\Route;

// Profitability reads for the Inertia pages. Web group only (session + CSRF), never under api/ so
// openapi.json is untouched and Passport tokens never reach contract data. Every id is validated as a
// uuid and looked up inside the route organization and the caller's scope: a foreign or unknown id is a
// plain 404 (never a 403 oracle).
Route::middleware(['web', 'auth:web', 'auth.session', 'verified'])
    ->prefix('profitability')
    ->group(function (): void {
        // The Profitability page (D-14): 404 without access (D-16). Its tabs and copy come from the
        // shared `profitability` prop, which carries the full label tree on this route name.
        Route::get('/', [ProfitabilityPageController::class, 'show'])
            ->name('profitability');

        // Hours sold and consumed of the project's current contract period (BUDG-03)
        Route::get('/organizations/{organization}/projects/{project}/summary', [ProjectSummaryController::class, 'show'])
            ->whereUuid(['organization', 'project'])
            ->middleware('throttle:120,1,profitability-read:')
            ->name('profitability.projects.summary');
    });
