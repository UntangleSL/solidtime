<?php

declare(strict_types=1);

namespace App\Microsoft365\Auth;

use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\RedirectResponse;

/**
 * The seam between the sign-in flow and the OAuth library.
 *
 * Implementations must build every provider object per call and keep no state, so one visitor can
 * never receive the identity of another (Octane keeps the worker alive between requests).
 * Implementations throw on any failure; the controller turns that into a safe login page.
 */
interface MicrosoftOAuthGateway
{
    /**
     * Send the visitor to Microsoft (state and PKCE are stored in the session by the implementation).
     */
    public function redirect(Request $request): RedirectResponse;

    /**
     * Complete the authorization code flow of the current callback request.
     */
    public function authenticate(Request $request): MicrosoftIdentity;
}
