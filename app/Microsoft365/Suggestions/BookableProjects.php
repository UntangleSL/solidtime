<?php

declare(strict_types=1);

namespace App\Microsoft365\Suggestions;

use App\Models\Client;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Tag;
use App\Models\Task;
use App\Models\User;
use App\Service\PermissionStore;

/**
 * What the user can still book in an organization, with display names (Phase 5 T-05-03). Mirrors the
 * core project rule of TimeEntryStoreRequest (project of the organization; unless the user may create
 * entries for everyone or view all projects, only public projects or projects the user is a member of)
 * and adds what the confirm dialog would reject anyway: archived projects, done tasks and tags that no
 * longer exist. It must match what core accepts at confirm time; core still re-validates there.
 *
 * Stateless (Octane): every answer is a fresh batched query by id.
 */
final readonly class BookableProjects
{
    public function __construct(private PermissionStore $permissions) {}

    /**
     * Usable projects among the given ids, keyed by id.
     *
     * @param  list<string>  $projectIds
     * @return array<string, array{name: string, color: string, client_name: string|null}>
     */
    public function projects(User $user, Organization $organization, array $projectIds): array
    {
        if ($projectIds === []) {
            return [];
        }

        $query = Project::query()
            ->whereBelongsTo($organization, 'organization')
            ->whereIn('projects.id', $projectIds)
            ->whereNull('projects.archived_at');
        if (! $this->permissions->userHas($organization, $user, 'time-entries:create:all')
            && ! $this->permissions->userHas($organization, $user, 'projects:view:all')) {
            $query->visibleByEmployee($user);
        }

        $rows = $query
            ->select(['projects.id', 'projects.name', 'projects.color'])
            ->addSelect(['client_name' => Client::query()->select('clients.name')->whereColumn('clients.id', 'projects.client_id')])
            ->toBase()
            ->get();

        $projects = [];
        foreach ($rows as $row) {
            /** @var object{id: string, name: string, color: string, client_name: string|null} $row */
            $projects[(string) $row->id] = [
                'name' => (string) $row->name,
                'color' => (string) $row->color,
                'client_name' => $row->client_name !== null ? (string) $row->client_name : null,
            ];
        }

        return $projects;
    }

    /**
     * Tasks of the organization among the given ids that are not done, keyed by id.
     *
     * @param  list<string>  $taskIds
     * @return array<string, array{name: string, project_id: string}>
     */
    public function openTasks(Organization $organization, array $taskIds): array
    {
        if ($taskIds === []) {
            return [];
        }

        $rows = Task::query()
            ->whereBelongsTo($organization, 'organization')
            ->whereIn('id', $taskIds)
            ->whereNull('done_at')
            ->toBase()
            ->get(['id', 'name', 'project_id']);

        $tasks = [];
        foreach ($rows as $row) {
            /** @var object{id: string, name: string, project_id: string} $row */
            $tasks[(string) $row->id] = ['name' => (string) $row->name, 'project_id' => (string) $row->project_id];
        }

        return $tasks;
    }

    /**
     * The given tag ids that still exist in the organization.
     *
     * @param  list<string>  $tagIds
     * @return list<string>
     */
    public function existingTags(Organization $organization, array $tagIds): array
    {
        if ($tagIds === []) {
            return [];
        }

        return array_values(Tag::query()
            ->whereBelongsTo($organization, 'organization')
            ->whereIn('id', $tagIds)
            ->pluck('id')
            ->map(fn (mixed $id): string => (string) $id)
            ->all());
    }
}
