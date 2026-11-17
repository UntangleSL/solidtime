<?php

declare(strict_types=1);

use App\Appearance\Http\Controllers\AppearanceController;
use App\Appearance\Http\Controllers\OrganizationIconController;
use Illuminate\Support\Facades\Route;

// Web group (session + CSRF), never under api/, so openapi.json is untouched (D-05). No id parameter:
// the route only ever acts on the current user.
Route::middleware(['web', 'auth:web', 'auth.session', 'verified'])->group(function (): void {
    Route::put('/user/appearance', [AppearanceController::class, 'update'])
        ->middleware('throttle:60,1,appearance:')
        ->name('appearance.update');

    // Organization icon: same web group (never under api/, openapi.json untouched). whereUuid keeps a
    // non-uuid segment away from the uuid column (404 instead of a database error); the permission
    // (organizations:update, membership included) is checked in the controller.
    Route::post('/organizations/{organization}/icon', [OrganizationIconController::class, 'store'])
        ->whereUuid('organization')
        ->middleware('throttle:20,1,org-icon:')
        ->name('organizations.icon.store');
});
