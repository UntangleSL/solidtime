<?php

declare(strict_types=1);

namespace App\Microsoft365\Http\Controllers;

use App\Microsoft365\Auth\MicrosoftIdentityGuard;
use App\Microsoft365\Auth\MicrosoftIdentityResolver;
use App\Microsoft365\Auth\MicrosoftOAuthGateway;
use App\Microsoft365\Auth\MicrosoftSignInException;
use App\Microsoft365\Auth\MicrosoftSignInFailure;
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

    public function callback(
        Request $request,
        MicrosoftOAuthGateway $gateway,
        MicrosoftIdentityGuard $guard,
        MicrosoftIdentityResolver $resolver,
    ): RedirectResponse {
        if (Auth::guard('web')->check()) {
            $request->session()->forget(self::TIMEZONE_SESSION_KEY);

            return redirect()->route('dashboard');
        }

        try {
            // The visitor came back with an error (for example "access_denied"): nothing to exchange.
            $error = $request->query('error');
            if ($error !== null) {
                throw new MicrosoftSignInException(
                    $error === 'access_denied' ? MicrosoftSignInFailure::Cancelled : MicrosoftSignInFailure::Generic,
                    $this->providerCode($request->query('error_description')),
                );
            }

            $timezone = $request->session()->get(self::TIMEZONE_SESSION_KEY);
            $identity = $gateway->authenticate($request);
            $guard->check($identity);
            $user = $resolver->resolve($identity, is_string($timezone) ? $timezone : null);

            // Entra already asked for MFA, so Fortify's two-factor challenge is skipped on purpose.
            // login() regenerates the session id. No remember-me: passwordless users cannot use it.
            Auth::guard('web')->login($user, false);

            return redirect()->route('dashboard');
        } catch (MicrosoftSignInException $e) {
            // Fixed reason and AADSTS code only: provider text, emails, ids and tokens never get logged.
            Log::warning('Microsoft sign-in rejected', [
                'reason' => $e->reason->value,
                'provider_code' => $e->providerCode,
            ]);

            return redirect()->route('login')->with('message', __($e->reason->messageKey()));
        } catch (Throwable $e) {
            // Fixed reason and class only: the exception text can carry token-derived data.
            Log::error('Microsoft sign-in failed', ['reason' => 'unexpected', 'exception' => $e::class]);

            return redirect()->route('login')->with('message', __(MicrosoftSignInFailure::Generic->messageKey()));
        } finally {
            $request->session()->forget(self::TIMEZONE_SESSION_KEY);
        }
    }

    /**
     * Reduces the untrusted error_description to the first Entra error code (AADSTS followed by digits).
     * The description text itself is never kept.
     */
    private function providerCode(mixed $description): ?string
    {
        if (! is_string($description) || preg_match('/AADSTS\d+/', $description, $matches) !== 1) {
            return null;
        }

        return $matches[0];
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
