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

    /**
     * Written by redirect() for an authenticated Connect, read (and removed) by callback(). It is the
     * only source of the connect intent: the callback query is never consulted (D-19).
     */
    private const string INTENT_SESSION_KEY = 'microsoft.intent';

    private const string CONNECT_USER_SESSION_KEY = 'microsoft.connect_user_id';

    private const string CONNECT_INTENT = 'connect';

    private const string NOTICE_FLASH_KEY = 'microsoft365.notice';

    public function redirect(Request $request, MicrosoftOAuthGateway $gateway, TimezoneService $timezoneService): SymfonyRedirectResponse
    {
        $isAuthenticated = Auth::guard('web')->check();
        $connect = $request->query('intent') === self::CONNECT_INTENT;

        // The branch order is binding: connect is decided before the authenticated dashboard shortcut.
        if ($connect && ! $isAuthenticated) {
            return redirect()->route('login');
        }

        if ($connect) {
            $request->session()->put(self::INTENT_SESSION_KEY, self::CONNECT_INTENT);
            $request->session()->put(self::CONNECT_USER_SESSION_KEY, Auth::guard('web')->id());
            $request->session()->forget(self::TIMEZONE_SESSION_KEY);

            return $gateway->redirect($request);
        }

        if ($isAuthenticated) {
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
        // Read-and-forget: both keys are gone on every exit path. The intent comes from the session
        // state redirect() wrote for an authenticated user, never from the callback query.
        $intent = $request->session()->pull(self::INTENT_SESSION_KEY);
        $connectUserId = $request->session()->pull(self::CONNECT_USER_SESSION_KEY);

        // Evaluated BEFORE the authenticated-user shortcut below, otherwise a signed-in user could
        // never complete a connect (the callback would answer with the dashboard redirect).
        if ($intent === self::CONNECT_INTENT) {
            return $this->completeConnect($request, $gateway, $guard, $resolver, $connectUserId);
        }

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

            // Entra is the second factor, so Fortify's two-factor challenge is skipped on purpose (D-06).
            // login() regenerates the session id. No remember-me, ever: passwordless users cannot use
            // it and a long-lived cookie would outlive an Entra account disable (D-20).
            Auth::guard('web')->login($user, false);

            // Evidence for the D-06 design, never a decision input: a sign-in whose token lacks the mfa
            // claim is not refused (Security Defaults prompt based on risk). Nothing identifying is logged.
            Log::info('Microsoft sign-in completed', ['amr_mfa' => $identity->mfaEvidence()]);

            // The intended URL is written server-side by the guest middleware only (for example
            // /oauth/authorize from the desktop app or the browser extension); no request value steers it.
            return redirect()->intended(route('dashboard'));
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
     * The authenticated Connect callback: links or re-connects the identity of the signed-in user and
     * returns to the profile with a notice. No login happens, the session user stays the same.
     */
    private function completeConnect(
        Request $request,
        MicrosoftOAuthGateway $gateway,
        MicrosoftIdentityGuard $guard,
        MicrosoftIdentityResolver $resolver,
        mixed $connectUserId,
    ): RedirectResponse {
        try {
            $user = Auth::guard('web')->user();
            if ($user === null) {
                // The session lost its user: nothing to link to, so the visitor starts from the login page.
                throw new MicrosoftSignInException(MicrosoftSignInFailure::Interrupted);
            }
            if (! is_string($connectUserId) || (string) $user->getKey() !== $connectUserId) {
                throw new MicrosoftSignInException(MicrosoftSignInFailure::Interrupted);
            }

            $error = $request->query('error');
            if ($error !== null) {
                throw new MicrosoftSignInException(
                    $error === 'access_denied' ? MicrosoftSignInFailure::Cancelled : MicrosoftSignInFailure::Generic,
                    $this->providerCode($request->query('error_description')),
                );
            }

            $identity = $gateway->authenticate($request);
            $guard->check($identity);
            $resolver->connect($identity, $user);

            return redirect()->route('profile.show')
                ->with(self::NOTICE_FLASH_KEY, __('microsoft365.ui.connected_notice'));
        } catch (MicrosoftSignInException $e) {
            Log::warning('Microsoft connect rejected', [
                'reason' => $e->reason->value,
                'provider_code' => $e->providerCode,
            ]);

            return $this->connectFailureResponse($e->reason);
        } catch (Throwable $e) {
            Log::error('Microsoft connect failed', ['reason' => 'unexpected', 'exception' => $e::class]);

            return $this->connectFailureResponse(MicrosoftSignInFailure::Generic);
        }
    }

    private function connectFailureResponse(MicrosoftSignInFailure $reason): RedirectResponse
    {
        if (! Auth::guard('web')->check()) {
            return redirect()->route('login')->with('message', __($reason->messageKey()));
        }

        return redirect()->route('profile.show')->with(self::NOTICE_FLASH_KEY, __($reason->messageKey()));
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
