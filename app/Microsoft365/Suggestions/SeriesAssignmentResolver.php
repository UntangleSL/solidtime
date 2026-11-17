<?php

declare(strict_types=1);

namespace App\Microsoft365\Suggestions;

use App\Microsoft365\Models\OutlookMeeting;
use App\Models\Client;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;

/**
 * Series pre-assignment (Phase 5 RULE-01, D-02, D-05, D-12): a recurring meeting comes pre-assigned to
 * what the user booked on the most recent conversion of the same series. Nothing is copied into a rule:
 * the assignment is read live from the time entry behind the latest link, so editing that entry moves
 * the series and a newer conversion wins. Read only: nothing is ever converted or changed here.
 *
 * Only the user's own links count whose entry still belongs to the user and lives in the given
 * organization (T-05-01). Stateless (Octane).
 */
final class SeriesAssignmentResolver
{
    /**
     * Assignments of the given meetings, keyed by meeting id. One query for all visible series plus
     * batched name lookups, whatever the number of meetings (T-05-05).
     *
     * @param  iterable<OutlookMeeting>  $meetings
     * @return array<string, Assignment>
     */
    public function forMeetings(User $user, Organization $organization, iterable $meetings): array
    {
        /** @var array<string, list<string>> $meetingIdsBySeries */
        $meetingIdsBySeries = [];
        foreach ($meetings as $meeting) {
            $series = $meeting->series_master_id;
            // Single meetings and dismissed occurrences never carry an assignment (D-03)
            if ($series === null || $series === '' || $meeting->dismissed_at !== null || $meeting->user_id !== $user->getKey()) {
                continue;
            }
            $meetingIdsBySeries[$series][] = $meeting->id;
        }
        if ($meetingIdsBySeries === []) {
            return [];
        }

        $assignments = [];
        foreach ($this->assignmentsBySeries($user, $organization, array_map('strval', array_keys($meetingIdsBySeries))) as $series => $assignment) {
            foreach ($meetingIdsBySeries[$series] ?? [] as $meetingId) {
                $assignments[$meetingId] = $assignment;
            }
        }

        return $assignments;
    }

    /**
     * The assignment of one meeting, for the confirm path.
     */
    public function forMeeting(User $user, Organization $organization, OutlookMeeting $meeting): ?Assignment
    {
        return $this->forMeetings($user, $organization, [$meeting])[$meeting->id] ?? null;
    }

    /**
     * @param  list<string>  $seriesIds
     * @return array<string, Assignment>
     */
    private function assignmentsBySeries(User $user, Organization $organization, array $seriesIds): array
    {
        $rows = $this->latestConversions($user, $organization, $seriesIds);

        $projectIds = [];
        $taskIds = [];
        foreach ($rows as $row) {
            if ($row['project_id'] !== null) {
                $projectIds[] = $row['project_id'];
            }
            if ($row['task_id'] !== null) {
                $taskIds[] = $row['task_id'];
            }
        }
        $projects = $this->projects($organization, array_values(array_unique($projectIds)));
        $tasks = $this->tasks($organization, array_values(array_unique($taskIds)));

        $assignments = [];
        foreach ($rows as $series => $row) {
            $projectId = $row['project_id'];
            // An entry without a project gives nothing to pre-assign
            if ($projectId === null || ! isset($projects[$projectId])) {
                continue;
            }
            $task = $row['task_id'] !== null ? ($tasks[$row['task_id']] ?? null) : null;
            if ($task !== null && $task['project_id'] !== $projectId) {
                $task = null;
            }

            $assignments[$series] = new Assignment(
                projectId: $projectId,
                projectName: $projects[$projectId]['name'],
                projectColor: $projects[$projectId]['color'],
                clientName: $projects[$projectId]['client_name'],
                taskId: $task !== null ? $row['task_id'] : null,
                taskName: $task['name'] ?? null,
                tags: $row['tags'],
                billable: $row['billable'],
                convertedAt: $row['converted_at'],
            );
        }

        return $assignments;
    }

    /**
     * The entry behind the most recent link of each series (latest conversion wins, D-05). Ties on the
     * conversion time go to the later occurrence, then to the link id, so the answer is stable.
     *
     * @param  list<string>  $seriesIds
     * @return array<string, array{project_id: string|null, task_id: string|null, tags: list<string>, billable: bool, converted_at: CarbonImmutable}>
     */
    private function latestConversions(User $user, Organization $organization, array $seriesIds): array
    {
        $rows = DB::table('outlook_meeting_links as l')
            ->join('time_entries as te', function (JoinClause $join): void {
                // The entry must still be the user's own: an entry reassigned by core no longer counts
                $join->on('te.id', '=', 'l.time_entry_id')
                    ->on('te.user_id', '=', 'l.user_id');
            })
            ->where('l.user_id', '=', $user->getKey())
            ->where('te.organization_id', '=', $organization->getKey())
            ->whereIn('l.series_master_id', $seriesIds)
            ->selectRaw('DISTINCT ON (l.series_master_id) l.series_master_id, te.project_id, te.task_id, te.tags, te.billable, l.created_at')
            ->orderBy('l.series_master_id')
            ->orderByDesc('l.created_at')
            ->orderByRaw('l.meeting_starts_at desc nulls last')
            ->orderByDesc('l.id')
            ->get();

        $latest = [];
        foreach ($rows as $row) {
            /** @var object{series_master_id: string, project_id: string|null, task_id: string|null, tags: string|null, billable: bool, created_at: string} $row */
            $latest[(string) $row->series_master_id] = [
                'project_id' => $row->project_id !== null ? (string) $row->project_id : null,
                'task_id' => $row->task_id !== null ? (string) $row->task_id : null,
                'tags' => $this->tagIds($row->tags),
                'billable' => (bool) $row->billable,
                'converted_at' => CarbonImmutable::parse((string) $row->created_at, 'UTC'),
            ];
        }

        return $latest;
    }

    /**
     * @return list<string>
     */
    private function tagIds(?string $json): array
    {
        if ($json === null || $json === '') {
            return [];
        }
        $decoded = json_decode($json, true);
        if (! is_array($decoded)) {
            return [];
        }

        $ids = [];
        foreach ($decoded as $id) {
            if (is_string($id) && $id !== '') {
                $ids[] = $id;
            }
        }

        return array_values(array_unique($ids));
    }

    /**
     * @param  list<string>  $projectIds
     * @return array<string, array{name: string, color: string, client_name: string|null}>
     */
    private function projects(Organization $organization, array $projectIds): array
    {
        if ($projectIds === []) {
            return [];
        }

        $projects = [];
        $rows = Project::query()
            ->whereBelongsTo($organization, 'organization')
            ->whereIn('id', $projectIds)
            ->addSelect(['projects.id', 'projects.name', 'projects.color', 'client_name' => Client::query()->select('name')->whereColumn('clients.id', 'projects.client_id')])
            ->toBase()
            ->get();
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
     * @param  list<string>  $taskIds
     * @return array<string, array{name: string, project_id: string}>
     */
    private function tasks(Organization $organization, array $taskIds): array
    {
        if ($taskIds === []) {
            return [];
        }

        $tasks = [];
        $rows = Task::query()
            ->whereBelongsTo($organization, 'organization')
            ->whereIn('id', $taskIds)
            ->toBase()
            ->get(['id', 'name', 'project_id']);
        foreach ($rows as $row) {
            /** @var object{id: string, name: string, project_id: string} $row */
            $tasks[(string) $row->id] = ['name' => (string) $row->name, 'project_id' => (string) $row->project_id];
        }

        return $tasks;
    }
}
