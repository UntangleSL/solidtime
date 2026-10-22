<?php

declare(strict_types=1);

use App\Microsoft365\Http\Controllers\MicrosoftAuthController;
use App\Microsoft365\Http\Middleware\EnsureMicrosoftIsEnabled;
use Illuminate\Support\Facades\Route;

Route::middleware(['web', EnsureMicrosoftIsEnabled::class, 'throttle:30,1'])->group(function (): void {
    Route::get('/auth/microsoft/redirect', [MicrosoftAuthController::class, 'redirect'])->name('microsoft.redirect');
    Route::get('/auth/microsoft/callback', [MicrosoftAuthController::class, 'callback'])->name('microsoft.callback');
});
