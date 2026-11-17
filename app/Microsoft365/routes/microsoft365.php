<?php

declare(strict_types=1);

use App\Microsoft365\Http\Controllers\MeetingConversionController;
use App\Microsoft365\Http\Controllers\MicrosoftAccountController;
use App\Microsoft365\Http\Controllers\MicrosoftAuthController;
use App\Microsoft365\Http\Controllers\OutlookMeetingController;
use App\Microsoft365\Http\Middleware\EnsureMicrosoftIsEnabled;
use Illuminate\Support\Facades\Route;

Route::middleware(['web', EnsureMicrosoftIsEnabled::class, 'throttle:30,1'])->group(function (): void {
    Route::get('/auth/microsoft/redirect', [MicrosoftAuthController::class, 'redirect'])->name('microsoft.redirect');
    Route::get('/auth/microsoft/callback', [MicrosoftAuthController::class, 'callback'])->name('microsoft.callback');
});

// Same stack as core's authenticated group. No route parameter: it only ever acts on the current user.
Route::middleware(['web', EnsureMicrosoftIsEnabled::class, 'auth:web', 'auth.session', 'verified'])->group(function (): void {
    Route::delete('/user/microsoft', [MicrosoftAccountController::class, 'destroy'])->name('microsoft.account.destroy');
});

// Outlook meetings for the calendar. Web group (session + CSRF), never under api/ so openapi.json is untouched.
// Every route only ever acts on the current user: no user id is accepted anywhere.
Route::middleware(['web', EnsureMicrosoftIsEnabled::class, 'auth:web', 'auth.session', 'verified'])
    ->prefix('m365')
    ->group(function (): void {
        // Cache only: never calls Graph
        Route::get('/meetings', [OutlookMeetingController::class, 'index'])
            ->middleware('throttle:60,1,m365-read:')
            ->name('microsoft.meetings.index');
        Route::post('/meetings/sync', [OutlookMeetingController::class, 'sync'])
            ->middleware('throttle:12,1,m365-sync:')
            ->name('microsoft.meetings.sync');
        // One occurrence of the session user's own meeting. The id is validated as a uuid and looked up
        // inside the user's rows, so a foreign or unknown id is a plain 404 (never a 403 oracle).
        Route::post('/meetings/{meeting}/dismiss', [OutlookMeetingController::class, 'dismiss'])
            ->whereUuid('meeting')
            ->middleware('throttle:60,1,m365-dismiss:')
            ->name('microsoft.meetings.dismiss');
        Route::delete('/meetings/{meeting}/dismiss', [OutlookMeetingController::class, 'restore'])
            ->whereUuid('meeting')
            ->middleware('throttle:60,1,m365-dismiss:')
            ->name('microsoft.meetings.restore');
        // Turns the session user's own meetings into time entries in this organization (Phase 4). The
        // parameter must be named `organization`: core's blocked-organization middleware and
        // TimeEntryStoreRequest read it through route model binding. Web group, so openapi.json stays
        // untouched (D-12); the body names meetings only, never a user or member.
        Route::post('/organizations/{organization}/meetings/time-entries', [MeetingConversionController::class, 'store'])
            ->whereUuid('organization')
            ->middleware(['check-organization-blocked', 'throttle:30,1,m365-convert:'])
            ->name('microsoft.meetings.convert');
    });
