<?php

declare(strict_types=1);

namespace App\Microsoft365\Http\Middleware;

use App\Microsoft365\Graph\GraphAccessGuard;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Refuses a Microsoft account action while an admin acts as the user (D-07, D-08): the request never
 * reaches the controller, so nothing is deleted, linked or requested on the user's behalf. The answer
 * is a plain 404 rather than a 403, so the route gives no oracle (D-14/D-22).
 *
 * It does not read the session itself (GraphAccessGuard is the one place that knows about
 * impersonation) and keeps no state between requests (Octane).
 */
class EnsureNotImpersonating
{
    public function __construct(private readonly GraphAccessGuard $access) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if ($this->access->blocked()) {
            abort(404);
        }

        return $next($request);
    }
}
