<?php

declare(strict_types=1);

namespace App\Profitability\Http\Middleware;

use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Profitability\Access\AccessScope;
use App\Profitability\Access\ProfitabilityAccess;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

/**
 * Shares the `profitability` prop with every Inertia page (D-11, D-16, D-17).
 *
 * - No signed-in user, no current organization or no access (Employee, core Manager without an
 *   assignment, placeholder): exactly `['enabled' => false]`, nothing else.
 * - With access, on every page: `enabled`, `url` (nav href), `views` (the tabs of the page) and the nav
 *   label only.
 * - On the project page, only when the route project belongs to the current organization and the
 *   scope may view it: `organization_url`, `project.summary_url` and the label tree.
 * - On the profitability page: `organization_url` and the label tree.
 *
 * The label tree holds the `money` group only for scopes with money and the `admin` group only for
 * Owner/Admin, so the copy never hints at money a scope cannot see.
 *
 * Only flags, URLs and copy go in: never a figure, never another user's id, never a money key.
 *
 * It lives in a web-group middleware, not in the provider boot(): Octane flushes the Inertia shared
 * props before every request, so anything shared at boot time would disappear after the first one.
 * The closure is lazy: pages that are not Inertia responses never resolve the scope.
 */
class ShareProfitabilityInertiaData
{
    public function __construct(private readonly ProfitabilityAccess $access) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        Inertia::share('profitability', function () use ($request): array {
            $user = Auth::guard('web')->user();
            if (! $user instanceof User || $user->current_team_id === null) {
                return ['enabled' => false];
            }

            /** @var Organization|null $organization */
            $organization = Organization::query()->whereKey($user->current_team_id)->first();
            if ($organization === null) {
                return ['enabled' => false];
            }

            $scope = $this->access->forUser($organization, $user);
            if (! $scope->hasAnyAccess()) {
                return ['enabled' => false];
            }

            $data = [
                'enabled' => true,
                'url' => url('profitability'),
                'views' => $scope->views(),
                'labels' => [
                    'nav' => $this->translate('profitability.nav', 'Profitability'),
                ],
            ];

            $organizationUrl = url('profitability/organizations/'.$organization->getKey());

            if ($request->routeIs('projects.show')) {
                $project = $this->visibleProject($request, $organization, $scope);
                if ($project !== null) {
                    $data['organization_url'] = $organizationUrl;
                    $data['project'] = [
                        'summary_url' => $organizationUrl.'/projects/'.$project->getKey().'/summary',
                    ];
                    $data['labels'] = $this->labels($scope);
                }
            } elseif ($request->routeIs('profitability')) {
                $data['organization_url'] = $organizationUrl;
                $data['labels'] = $this->labels($scope);
            }

            return $data;
        });

        return $next($request);
    }

    /**
     * The route project, only when it belongs to the current organization and the scope may view it.
     * The project page route is a plain closure with a string id: it is checked as a uuid before the
     * query, so a malformed id never reaches PostgreSQL.
     */
    private function visibleProject(Request $request, Organization $organization, AccessScope $scope): ?Project
    {
        $id = $request->route('project');
        if (! is_string($id) || ! Str::isUuid($id)) {
            return null;
        }

        /** @var Project|null $project */
        $project = Project::query()
            ->whereBelongsTo($organization, 'organization')
            ->whereKey($id)
            ->first();
        if ($project === null || ! $scope->canViewProject($project)) {
            return null;
        }

        return $project;
    }

    /**
     * Every `profitability.*` string, resolved for the current locale. The key set comes from the English
     * file (the Spanish mirror has the same keys, enforced by ProfitabilityLangTest). The `money` group
     * is dropped unless the scope has money anywhere and the `admin` group unless it is Owner/Admin.
     *
     * @return array<string, mixed>
     */
    private function labels(AccessScope $scope): array
    {
        $english = trans('profitability', [], 'en');
        if (! is_array($english)) {
            return [];
        }

        if (! $scope->hasAnyMoney()) {
            unset($english['money']);
        }
        if (! $scope->isFull()) {
            unset($english['admin']);
        }

        return $this->resolve($english, 'profitability');
    }

    /**
     * @param  array<array-key, mixed>  $node
     * @return array<string, mixed>
     */
    private function resolve(array $node, string $prefix): array
    {
        $labels = [];
        foreach ($node as $key => $value) {
            $path = $prefix.'.'.$key;
            $labels[(string) $key] = is_array($value)
                ? $this->resolve($value, $path)
                : $this->translate($path, is_string($value) ? $value : '');
        }

        return $labels;
    }

    private function translate(string $key, string $fallback): string
    {
        $value = __($key);

        return is_string($value) ? $value : $fallback;
    }
}
