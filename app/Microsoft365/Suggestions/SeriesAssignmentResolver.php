<?php

declare(strict_types=1);

namespace App\Microsoft365\Suggestions;

use App\Microsoft365\Models\OutlookMeeting;
use App\Models\Organization;
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
 * organization (T-05-01). The latest conversion is then filtered through the core booking rules
 * (BookableProjects, T-05-03): a project the user can no longer book gives no assignment, with no
 * fallback to an older conversion; a done task and tags that no longer exist are dropped silently.
 *
 * Stateless (Octane).
 */
final readonly class SeriesAssignmentResolver
{
    public function __construct(private BookableProjects $bookable) {}

    /**
     * Assignments of the given meetings, keyed by meeting id. One query for all visible series plus
     * batched lookups by id, whatever the number of meetings (T-05-05).
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

        $seriesIds = array_map(fn (int|string $series): string => (string) $series, array_keys($meetingIdsBySeries));
        $assignments = [];
        foreach ($this->assignmentsBySeries($user, $organization, $seriesIds) as $series => $assignment) {
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
        if ($rows === []) {
            return [];
        }

        $projectIds = [];
        $taskIds = [];
        $tagIds = [];
        foreach ($rows as $row) {
            if ($row['project_id'] !== null) {
                $projectIds[] = $row['project_id'];
                if ($row['task_id'] !== null) {
                    $taskIds[] = $row['task_id'];
                }
                array_push($tagIds, ...$row['tags']);
            }
        }
        $projects = $this->bookable->projects($user, $organization, array_values(array_unique($projectIds)));
        $tasks = $this->bookable->openTasks($organization, array_values(array_unique($taskIds)));
        $existingTags = array_flip($this->bookable->existingTags($organization, array_values(array_unique($tagIds))));

        $assignments = [];
        foreach ($rows as $series => $row) {
            $projectId = $row['project_id'];
            // No project, or one the user can no longer book: nothing to pre-assign, and no fallback to
            // an older conversion of the series
            if ($projectId === null || ! isset($projects[$projectId])) {
                continue;
            }
            $project = $projects[$projectId];

            // A done task, or one that no longer belongs to the project, is dropped silently
            $taskId = $row['task_id'];
            $task = $taskId !== null ? ($tasks[$taskId] ?? null) : null;
            if ($task === null || $task['project_id'] !== $projectId) {
                $taskId = null;
                $task = null;
            }

            $assignments[$series] = new Assignment(
                projectId: $projectId,
                projectName: $project['name'],
                projectColor: $project['color'],
                clientName: $project['client_name'],
                taskId: $taskId,
                taskName: $task['name'] ?? null,
                tags: array_values(array_filter($row['tags'], fn (string $tagId): bool => isset($existingTags[$tagId]))),
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
     * Tag ids of an entry (time_entries.tags is a jsonb array of ids without a foreign key).
     *
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
}
