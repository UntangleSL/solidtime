<?php

declare(strict_types=1);

namespace App\Microsoft365\Http\Controllers;

use App\Microsoft365\Auth\MicrosoftIdentityResolver;
use App\Microsoft365\Auth\MicrosoftOAuthGateway;
use App\Service\TimezoneService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\RedirectResponse as SymfonyRedirectResponse;
use Throwable;

/**
 * Both actions receive the gateway by method injection so a later gate can answer 404 before the
 * container resolves it.
 */
class MicrosoftAuthController extends Controller
{
    private const string TIMEZONE_SESSION_KEY = 'microsoft.timezone';

    public function redirect(Request $request, MicrosoftOAuthGateway $gateway, TimezoneService $timezoneService): SymfonyRedirectResponse
    {
        if (Auth::guard('web')->check()) {
            return redirect()->route('dashboard');
        }

        $timezone = $this->validTimezone($request->query('timezone'), $timezoneService);
        if ($timezone === null) {
            $request->session()->forget(self::TIMEZONE_SESSION_KEY);
        } else {
            $request->session()->put(self::TIMEZONE_SESSION_KEY, $timezone);
        }

        return $gateway->redirect($request);
    }

    public function callback(Request $request, MicrosoftOAuthGateway $gateway, MicrosoftIdentityResolver $resolver): RedirectResponse
    {
        if (Auth::guard('web')->check()) {
            $request->session()->forget(self::TIMEZONE_SESSION_KEY);

            return redirect()->route('dashboard');
        }

        try {
            $timezone = $request->session()->get(self::TIMEZONE_SESSION_KEY);
            $identity = $gateway->authenticate($request);
            $user = $resolver->resolve($identity, is_string($timezone) ? $timezone : null);

            // Entra already asked for MFA, so Fortify's two-factor challenge is skipped on purpose.
            // login() regenerates the session id. No remember-me: passwordless users cannot use it.
            Auth::guard('web')->login($user, false);

            return redirect()->route('dashboard');
        } catch (Throwable $e) {
            // Fixed reason and class only: the exception text can carry token-derived data.
            Log::error('Microsoft sign-in failed', ['reason' => 'unexpected', 'exception' => $e::class]);

            return redirect()->route('login')->with('message', __('microsoft365.error.generic'));
        } finally {
            $request->session()->forget(self::TIMEZONE_SESSION_KEY);
        }
    }

    /**
     * A browser timezone is kept only when it is a real IANA name (or a legacy alias of one).
     */
    private function validTimezone(mixed $candidate, TimezoneService $timezoneService): ?string
    {
        if (! is_string($candidate) || $candidate === '' || strlen($candidate) > 64) {
            return null;
        }
        if ($timezoneService->isValid($candidate)) {
            return $candidate;
        }
        $mapped = $timezoneService->mapLegacyTimezone($candidate);

        return $mapped !== null && $timezoneService->isValid($mapped) ? $mapped : null;
    }
}
