<?php

declare(strict_types=1);

namespace App\Appearance;

use App\Appearance\Http\Requests\AppearanceUpdateRequest;
use App\Appearance\Models\UserAppearanceSetting;
use App\Models\User;
use Illuminate\Support\Facades\Auth;

/**
 * Reads a user's stored appearance for the Inertia prop and for the pre-paint partial.
 *
 * Stateless (plain bind, never a shared instance, Octane-safe): the per-request memo lives on the
 * current request's attributes, so the prop and the pre-paint partial cost one query together.
 * Values are re-validated on read: anything that is not a known theme or preset is shared as null,
 * so a removed preset or a hand-edited row never reaches the page or the inline script.
 */
class AppearanceResolver
{
    /**
     * @return array{theme: string|null, accent: string|null}
     */
    public function settingsFor(?User $user): array
    {
        if ($user === null) {
            return ['theme' => null, 'accent' => null];
        }

        $attributes = request()->attributes;
        $key = 'appearance.settings.'.$user->getKey();
        $memo = $attributes->get($key);
        if (is_array($memo)) {
            /** @var array{theme: string|null, accent: string|null} $memo */
            return $memo;
        }

        $setting = UserAppearanceSetting::query()->where('user_id', '=', $user->getKey())->first();
        $theme = $setting?->theme;
        $accent = $setting?->accent;
        $settings = [
            'theme' => is_string($theme) && in_array($theme, AppearanceUpdateRequest::THEMES, true) ? $theme : null,
            'accent' => is_string($accent) && AccentPreset::tryFrom($accent) !== null ? $accent : null,
        ];
        $attributes->set($key, $settings);

        return $settings;
    }

    /**
     * What the pre-paint partial needs for the session user (nulls for guests).
     *
     * @return array{theme: string|null, accent: string|null, accents: list<string>}
     */
    public function bootPayload(): array
    {
        $settings = $this->settingsFor($this->sessionUser());

        return [
            'theme' => $settings['theme'],
            'accent' => $settings['accent'],
            'accents' => AccentPreset::values(),
        ];
    }

    /**
     * The `appearance` Inertia prop: the session user's own values, the preset ids, the update URL
     * (null for guests) and the phase copy for the current locale.
     *
     * @return array{theme: string|null, accent: string|null, accents: list<string>, update_url: string|null, labels: array<string, string>, presets: array<string, string>}
     */
    public function sharedProps(): array
    {
        $user = $this->sessionUser();
        $settings = $this->settingsFor($user);

        return [
            'theme' => $settings['theme'],
            'accent' => $settings['accent'],
            'accents' => AccentPreset::values(),
            'update_url' => $user !== null ? route('appearance.update') : null,
            'labels' => $this->strings('branding.ui'),
            'presets' => $this->strings('branding.presets'),
        ];
    }

    private function sessionUser(): ?User
    {
        $user = Auth::guard('web')->user();

        return $user instanceof User ? $user : null;
    }

    /**
     * A translated group as a flat map of strings (anything else is dropped).
     *
     * @return array<string, string>
     */
    private function strings(string $group): array
    {
        $translated = __($group);
        if (! is_array($translated)) {
            return [];
        }

        $strings = [];
        foreach ($translated as $key => $value) {
            if (is_string($value)) {
                $strings[(string) $key] = $value;
            }
        }

        return $strings;
    }
}
