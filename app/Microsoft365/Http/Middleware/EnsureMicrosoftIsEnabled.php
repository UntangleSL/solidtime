<?php

declare(strict_types=1);

namespace App\Microsoft365\Http\Middleware;

use App\Microsoft365\MicrosoftConfig;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Turns the Microsoft routes off (404) when client id, secret or tenant id is missing or blank.
 * It runs before the controller, so the OAuth gateway is never resolved for a disabled install.
 */
class EnsureMicrosoftIsEnabled
{
    public function __construct(private readonly MicrosoftConfig $config) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->config->isConfigured()) {
            abort(404);
        }

        return $next($request);
    }
}
