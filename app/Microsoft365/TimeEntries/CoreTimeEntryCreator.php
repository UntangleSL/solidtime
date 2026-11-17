<?php

declare(strict_types=1);

namespace App\Microsoft365\TimeEntries;

use App\Exceptions\Api\ApiException;
use App\Http\Controllers\Api\V1\TimeEntryController;
use App\Http\Requests\V1\TimeEntry\TimeEntryStoreRequest;
use App\Models\Organization;
use App\Models\TimeEntry;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\Request;
use Illuminate\Routing\Redirector;
use Illuminate\Validation\ValidationException;
use LogicException;
use Symfony\Component\HttpFoundation\InputBag;

/**
 * The only fork class that knows how core creates a time entry (Phase 4 D-10). It builds a real
 * TimeEntryStoreRequest and runs core's TimeEntryController::store() in-process, so every manual-entry
 * rule applies unchanged: permissions, member and project visibility, the organization's opt-in overlap
 * check, the billable lock, billable_rate and the spent-time recalculation jobs. No core file is edited
 * and no time entry model is ever built here.
 *
 * Payload keys: member_id, project_id, task_id, tags, billable, description, start, end, type.
 *
 * Not final on purpose: tests bind a double for it in the container.
 */
class CoreTimeEntryCreator
{
    /**
     * @param  array<string, mixed>  $payload
     *
     * @throws ValidationException core validation messages, unchanged
     * @throws AuthorizationException missing time-entries:create permission
     * @throws ApiException core API errors (for example an overlapping entry)
     */
    public function create(Request $base, Organization $organization, array $payload): TimeEntry
    {
        // Keeps the session, user resolver and route resolver (the {organization} parameter the core
        // request reads). createFrom shares the json bag with $base, so every input source is replaced
        // by a fresh bag holding only this payload: nothing leaks between meetings of a batch.
        $request = TimeEntryStoreRequest::createFrom($base);
        $request->setJson(new InputBag($payload));
        $request->request = new InputBag($payload);
        $request->query = new InputBag([]);
        $request->setContainer(app())->setRedirector(app(Redirector::class));
        $request->validateResolved();

        $entry = app(TimeEntryController::class)->store($organization, $request)->resource;
        if (! $entry instanceof TimeEntry) {
            throw new LogicException('Core store() no longer returns a time entry resource.');
        }

        return $entry;
    }
}
