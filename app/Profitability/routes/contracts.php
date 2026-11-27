<?php

declare(strict_types=1);

use App\Profitability\Http\Controllers\ContractTermsController;
use Illuminate\Support\Facades\Route;

// Contract terms writes (BUDG-01). Web group only (session + CSRF), never under api/. The parameter must
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
    });
