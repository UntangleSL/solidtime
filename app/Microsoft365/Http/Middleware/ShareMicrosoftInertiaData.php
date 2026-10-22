<?php

declare(strict_types=1);

namespace App\Microsoft365\Http\Middleware;

use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

/**
 * Shares the `microsoft` prop with every Inertia page (the login page reads it) and, on the profile
 * page only, the signed-in user's `account` state.
 *
 * It lives in a web-group middleware, not in the provider boot(): Octane flushes the Inertia shared
 * props before every request, so anything shared at boot time would disappear after the first one.
 * Only public values go in: whether the integration is on, URLs, labels, booleans, the Microsoft
 * email and a one-time notice. Nothing token-related is ever part of the payload.
 */
class ShareMicrosoftInertiaData
{
    public function __construct(private readonly MicrosoftConfig $config) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        Inertia::share('microsoft', function () use ($request): array {
            if (! $this->config->isConfigured()) {
                return ['enabled' => false];
            }

            $data = [
                'enabled' => true,
                'login_url' => route('microsoft.redirect'),
                'labels' => [
                    'sign_in' => __('microsoft365.ui.sign_in'),
                    'sign_in_hint' => __('microsoft365.ui.sign_in_hint'),
                ],
            ];

            // Computed on the profile page only: every other page runs no extra query.
            if ($request->routeIs('profile.show')) {
                $user = Auth::guard('web')->user();
                if ($user instanceof User) {
                    $data['account'] = $this->account($request, $user);
                }
            }

            return $data;
        });

        return $next($request);
    }

    /**
     * @return array<string, mixed>
     */
    private function account(Request $request, User $user): array
    {
        $account = MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->first();
        $email = $account?->microsoft_email;
        $notice = $request->session()->get('microsoft365.notice');

        return [
            'linked' => $account !== null,
            'connected' => $account?->isConnected() ?? false,
            'email' => $email,
            'has_password' => $user->password !== null,
            'connect_url' => route('microsoft.redirect', ['intent' => 'connect']),
            'disconnect_url' => route('microsoft.account.destroy'),
            'notice' => is_string($notice) ? $notice : null,
            'labels' => [
                'section_title' => __('microsoft365.ui.section_title'),
                'section_description' => __('microsoft365.ui.section_description'),
                'connected_as' => $email === null ? '' : __('microsoft365.ui.connected_as', ['email' => $email]),
                'not_connected' => __('microsoft365.ui.not_connected'),
                'disconnected_status' => __('microsoft365.ui.disconnected_status'),
                'connect' => __('microsoft365.ui.connect'),
                'disconnect' => __('microsoft365.ui.disconnect'),
                'disconnect_title' => __('microsoft365.ui.disconnect_title'),
                'disconnect_body' => __('microsoft365.ui.disconnect_body'),
                'disconnect_body_passwordless' => __('microsoft365.ui.disconnect_body_passwordless'),
                'cancel' => __('microsoft365.ui.cancel'),
            ],
        ];
    }
}
