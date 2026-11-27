<?php

declare(strict_types=1);

use App\Profitability\Http\Controllers\ContractTermsController;
use App\Profitability\Http\Controllers\PlanController;
use Illuminate\Support\Facades\Route;

// Contract terms and monthly plan writes (BUDG-01, BUDG-04). Web group only (session + CSRF), never under api/. The parameter must
// be named `organization`: core's blocked-organization middleware reads it through route model binding.
// Who may write is checked in the controller; a foreign or unknown project is a plain 404.
Route::middleware(['web', 'auth:web', 'auth.session', 'verified'])
    ->prefix('profitability')
    ->group(function (): void {
        // Saves the contract terms of a project without terms and materializes its periods
        Route::put('/organizations/{organization}/projects/{project}/contract', [ContractTermsController::class, 'upsert'])
            ->whereUuid(['organization', 'project'])
            ->middleware(['check-organization-blocked', 'throttle:60,1,profitability-write:'])
            ->name('profitability.projects.contract');

        // Saves the monthly plan of one period of the project's contract (BUDG-04, D-02, D-12)
        Route::put('/organizations/{organization}/projects/{project}/periods/{period}/plan', [PlanController::class, 'update'])
            ->whereUuid(['organization', 'project', 'period'])
            ->middleware(['check-organization-blocked', 'throttle:60,1,profitability-write:'])
            ->name('profitability.periods.plan');
    });
