<?php

declare(strict_types=1);

namespace App\Appearance\Http\Middleware;

use App\Appearance\AppearanceResolver;
use Closure;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

/**
 * Shares the `appearance` prop with every Inertia page: the signed-in user's own theme and accent
 * (null when unset), the preset ids, the update URL (null for guests) and the phase copy. Nothing
 * about other users is ever part of the payload.
 *
 * It lives in a web-group middleware, not in the provider boot(): Octane flushes the Inertia shared
 * props before every request, so anything shared at boot time would disappear after the first one.
 * The value is a closure, so it is evaluated lazily, once per Inertia response.
 */
class ShareAppearanceInertiaData
{
    public function __construct(
        private readonly AppearanceResolver $resolver,
    ) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        Inertia::share('appearance', fn (): array => $this->resolver->sharedProps());

        return $next($request);
    }
}
