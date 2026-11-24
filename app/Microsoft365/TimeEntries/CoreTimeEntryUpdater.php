<?php

declare(strict_types=1);

namespace App\Microsoft365\TimeEntries;

use App\Exceptions\Api\ApiException;
use App\Exceptions\Api\OrganizationHasNoSubscriptionButMultipleMembersException;
use App\Http\Controllers\Api\V1\TimeEntryController;
use App\Http\Requests\V1\TimeEntry\TimeEntryUpdateRequest;
use App\Microsoft365\Http\Requests\MeetingConversionRequest;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Service\BillingContract;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Routing\Redirector;
use Illuminate\Routing\Route;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;
use LogicException;
use Symfony\Component\HttpFoundation\InputBag;

/**
 * The only fork class that knows how core updates a time entry (Phase 6 D-04, D-12), the update twin of
 * CoreTimeEntryCreator. It builds a real TimeEntryUpdateRequest and runs core's
 * TimeEntryController::update() in-process, so every manual-edit rule applies unchanged: permissions
 * (time-entries:update:own|all), the organization's opt-in overlap check, the validation of start and
 * end, and the spent-time recalculation jobs. No core file is edited and no time entry column is ever
 * written here.
 *
 * - Payload: start and end only (MeetingConversionRequest::FORMAT, UTC), so the description, project,
 *   task, tags and billable flag stay exactly as the user left them.
 * - Route: the request is bound to the real core route, because core's request reads its route
 *   parameters (timeEntry, organization). Its full name is api.v1.time-entries.update: the
 *   v1.time-entries.update route of routes/api.php inside the 'api.' group. The route object is cloned
 *   before binding, so the shared route of the router never keeps this call's parameters (Octane).
 * - Organization: always the entry's own, never the user's current team (links are not org-scoped).
 *   The in-process call skips core's check-organization-blocked middleware, so the same check runs here
 *   first.
 * - Acting user: core reads Auth::user(). In an HTTP request the session user must be the actor and is
 *   used as is. With nobody signed in (a queued job) the actor is set on the web guard for the call and
 *   forgotten in `finally`: the queue worker resets scoped instances between jobs but not auth guards,
 *   so without the reset the next job would run as this user. Any other signed-in user is refused.
 *
 * Not final on purpose: tests bind a double for it in the container.
 */
class CoreTimeEntryUpdater
{
    public const string ROUTE = 'api.v1.time-entries.update';

    /**
     * @param  string  $start  MeetingConversionRequest::FORMAT, UTC
     * @param  string  $end  MeetingConversionRequest::FORMAT, UTC
     *
     * @throws ValidationException core validation messages, unchanged
     * @throws AuthorizationException missing time-entries:update permission
     * @throws ApiException core API errors (an overlapping entry, a blocked organization)
     * @throws LogicException another signed-in user, a missing route, or core no longer returning a time entry
     */
    public function updateTimes(User $actor, TimeEntry $entry, string $start, string $end): TimeEntry
    {
        $organization = Organization::query()->whereKey($entry->organization_id)->first();
        if ($organization === null) {
            throw new LogicException('The time entry has no organization.');
        }
        if (app(BillingContract::class)->isBlocked($organization)) {
            throw new OrganizationHasNoSubscriptionButMultipleMembersException;
        }

        $guard = Auth::guard('web');
        $signedIn = $guard->id();
        $setHere = false;
        if ($signedIn === null) {
            $guard->setUser($actor);
            $setHere = true;
        } elseif ($signedIn !== $actor->getKey()) {
            throw new LogicException('Time entries are only updated for the signed-in user.');
        }

        try {
            // Core resolves permissions through the default guard: it must see the actor too
            if (Auth::id() !== $actor->getKey()) {
                throw new LogicException('The default guard does not resolve to the acting user.');
            }

            $request = $this->request($actor, $organization, $entry, ['start' => $start, 'end' => $end]);
            $updated = app(TimeEntryController::class)->update($organization, $entry, $request)->resource;
            if (! $updated instanceof TimeEntry) {
                throw new LogicException('Core update() no longer returns a time entry resource.');
            }

            return $updated;
        } finally {
            if ($setHere) {
                $guard->forgetUser();
            }
        }
    }

    /**
     * @param  array{start: string, end: string}  $payload
     */
    private function request(User $actor, Organization $organization, TimeEntry $entry, array $payload): TimeEntryUpdateRequest
    {
        $shared = app(Router::class)->getRoutes()->getByName(self::ROUTE);
        if (! $shared instanceof Route) {
            throw new LogicException('Core route '.self::ROUTE.' no longer exists.');
        }

        $request = TimeEntryUpdateRequest::create(
            route(self::ROUTE, ['organization' => $organization->getKey(), 'timeEntry' => $entry->getKey()], false),
            'PUT',
            server: ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'],
        );
        // Only this payload, in every input source the request reads
        $request->setJson(new InputBag($payload));
        $request->request = new InputBag($payload);
        $request->query = new InputBag([]);

        $route = clone $shared;
        $route->bind($request);
        $route->setParameter('organization', $organization);
        $route->setParameter('timeEntry', $entry);
        $request->setRouteResolver(static fn (): Route => $route);
        $request->setUserResolver(static fn (): User => $actor);
        $request->setContainer(app())->setRedirector(app(Redirector::class));
        $request->validateResolved();

        return $request;
    }

    /**
     * A UTC 'Y-m-d H:i:s' time (the rules' format) in the format core's request validates.
     */
    public static function format(string $utc): string
    {
        return CarbonImmutable::parse($utc, 'UTC')->format(MeetingConversionRequest::FORMAT);
    }
}
