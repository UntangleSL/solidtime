<?php

declare(strict_types=1);

use App\Appearance\Http\Controllers\AppearanceController;
use Illuminate\Support\Facades\Route;

// Web group (session + CSRF), never under api/, so openapi.json is untouched (D-05). No id parameter:
// the route only ever acts on the current user.
Route::middleware(['web', 'auth:web', 'auth.session', 'verified'])->group(function (): void {
    Route::put('/user/appearance', [AppearanceController::class, 'update'])
        ->middleware('throttle:60,1,appearance:')
        ->name('appearance.update');
});
