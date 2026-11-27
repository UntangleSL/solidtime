<?php

declare(strict_types=1);

use App\Profitability\Http\Controllers\AssignmentController;
use Illuminate\Support\Facades\Route;

// Profitability settings: project managers and account managers (D-10, D-12, D-16). Web group only
// (session + CSRF), never under api/. Only Owner and Admin reach them; everyone else gets a plain 404.
// Every id is a uuid looked up inside the route organization.
Route::middleware(['web', 'auth:web', 'auth.session', 'verified'])
    ->prefix('profitability/organizations/{organization}/settings')
    ->group(function (): void {
        // Clients, billable projects and members with their current assignments
        Route::get('/managers', [AssignmentController::class, 'index'])
            ->whereUuid('organization')
            ->middleware('throttle:120,1,profitability-read:')
            ->name('profitability.settings.managers');

        Route::middleware(['check-organization-blocked', 'throttle:60,1,profitability-write:'])
            ->group(function (): void {
                Route::post('/projects/{project}/managers', [AssignmentController::class, 'addProjectManager'])
                    ->whereUuid(['organization', 'project'])
                    ->name('profitability.settings.project-managers.store');
                Route::delete('/projects/{project}/managers/{memberId}', [AssignmentController::class, 'removeProjectManager'])
                    ->whereUuid(['organization', 'project', 'memberId'])
                    ->name('profitability.settings.project-managers.destroy');
                Route::post('/clients/{client}/account-managers', [AssignmentController::class, 'addAccountManager'])
                    ->whereUuid(['organization', 'client'])
                    ->name('profitability.settings.account-managers.store');
                Route::delete('/clients/{client}/account-managers/{memberId}', [AssignmentController::class, 'removeAccountManager'])
                    ->whereUuid(['organization', 'client', 'memberId'])
                    ->name('profitability.settings.account-managers.destroy');
            });
    });
