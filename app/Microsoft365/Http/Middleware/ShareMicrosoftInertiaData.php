<?php

declare(strict_types=1);

namespace App\Microsoft365\Http\Middleware;

use App\Microsoft365\MicrosoftConfig;
use Closure;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

/**
 * Shares the public `microsoft` prop with every Inertia page (the login page reads it).
 *
 * It lives in a web-group middleware, not in the provider boot(): Octane flushes the Inertia shared
 * props before every request, so anything shared at boot time would disappear after the first one.
 * Only public values go in: whether the integration is on, the button URL and the button labels.
 */
class ShareMicrosoftInertiaData
{
    public function __construct(private readonly MicrosoftConfig $config) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        Inertia::share('microsoft', fn (): array => $this->config->isConfigured()
            ? [
                'enabled' => true,
                'login_url' => route('microsoft.redirect'),
                'labels' => [
                    'sign_in' => __('microsoft365.ui.sign_in'),
                    'sign_in_hint' => __('microsoft365.ui.sign_in_hint'),
                ],
            ]
            : ['enabled' => false]);

        return $next($request);
    }
}
