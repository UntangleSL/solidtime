<?php

declare(strict_types=1);

namespace App\Appearance\Http\Controllers;

use App\Appearance\Http\Requests\AppearanceUpdateRequest;
use App\Appearance\Models\UserAppearanceSetting;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\Auth;

class AppearanceController extends Controller
{
    /**
     * Store the signed-in user's theme and/or accent. Only the keys that were sent are changed; null
     * resets a value. The row always belongs to the session user (no id is read from the request).
     */
    public function update(AppearanceUpdateRequest $request): JsonResponse
    {
        /** @var User $user */
        $user = Auth::guard('web')->user();

        $setting = UserAppearanceSetting::query()->firstOrNew(['user_id' => $user->getKey()]);
        $validated = $request->validated();

        if ($request->has('theme')) {
            $theme = $validated['theme'] ?? null;
            $setting->theme = is_string($theme) ? $theme : null;
        }
        if ($request->has('accent')) {
            $accent = $validated['accent'] ?? null;
            $setting->accent = is_string($accent) ? $accent : null;
        }
        $setting->save();

        return response()->json([
            'theme' => $setting->theme,
            'accent' => $setting->accent,
        ]);
    }
}
