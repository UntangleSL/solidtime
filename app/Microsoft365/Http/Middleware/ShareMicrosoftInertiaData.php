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
 * Shares the `microsoft` prop with every Inertia page (the login page reads it), on the profile page
 * only the signed-in user's `account` state, and on the calendar page only the Outlook `calendar`
 * block (connection state, URLs and the server-rendered copy; never meeting data).
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

            // Calendar page only: state and URLs, the copy, and nothing token-related.
            if ($request->routeIs('calendar')) {
                $user = Auth::guard('web')->user();
                if ($user instanceof User) {
                    $data['calendar'] = $this->calendar($request, $user);
                }
            }

            return $data;
        });

        return $next($request);
    }

    /**
     * @return array{state: string, urls: array{meetings: string, sync: string}, connect_url: string, notice: array{level: string, message: string}|null, labels: array<string, string>}
     */
    private function calendar(Request $request, User $user): array
    {
        $account = MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->first();

        return [
            'state' => $account?->calendarAccessState() ?? 'not_connected',
            'urls' => [
                'meetings' => route('microsoft.meetings.index'),
                'sync' => route('microsoft.meetings.sync'),
            ],
            // Connect and Reconnect start the Phase 2 connect flow and come back to the calendar; the
            // only return value the server accepts is the word `calendar`.
            'connect_url' => route('microsoft.redirect', ['intent' => 'connect', 'return' => 'calendar']),
            'notice' => $this->calendarNotice($request),
            'labels' => $this->calendarLabels(),
        ];
    }

    /**
     * The one-time outcome of a connect that returned to the calendar (flash data lives for exactly
     * the next request). The level is reduced to the two the notification store knows.
     *
     * @return array{level: string, message: string}|null
     */
    private function calendarNotice(Request $request): ?array
    {
        $message = $request->session()->get('microsoft365.notice');
        if (! is_string($message) || $message === '') {
            return null;
        }

        return [
            'level' => $request->session()->get('microsoft365.notice_level') === 'error' ? 'error' : 'success',
            'message' => $message,
        ];
    }

    /**
     * Every `microsoft365.calendar.*` string, resolved for the current locale. The key set comes from
     * the English file (the Spanish mirror has the same keys, enforced by MicrosoftLangTest).
     *
     * @return array<string, string>
     */
    private function calendarLabels(): array
    {
        $english = trans('microsoft365.calendar', [], 'en');
        if (! is_array($english)) {
            return [];
        }

        $labels = [];
        foreach (array_keys($english) as $key) {
            $labels[(string) $key] = __('microsoft365.calendar.'.$key);
        }

        return $labels;
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
