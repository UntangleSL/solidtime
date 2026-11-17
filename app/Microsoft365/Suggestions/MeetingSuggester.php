<?php

declare(strict_types=1);

namespace App\Microsoft365\Suggestions;

use App\Microsoft365\Models\OutlookMeeting;
use App\Models\Organization;
use App\Models\User;

/**
 * Learned project suggestions for the meetings of one calendar read (RULE-03, D-06, D-07, D-09).
 *
 * Per read: the user's own labelled history is loaded once (SuggestionHistory), the rows whose project
 * the user can no longer book are dropped (BookableProjects, one batched query, T-05-32), then every
 * meeting is ranked by the pure engine against that history. Nothing leaves the server but project
 * display data and the reason (a display name or bare domain of the user's own meeting, a count); the
 * score and the attendee data never do (T-05-31). Suggestions never pre-assign (D-08): the dialog only
 * offers them.
 *
 * The cost does not depend on the number of meetings (T-05-34): no meeting means no query at all,
 * otherwise a fixed handful (identity, history, bookable projects). Read only, stateless (Octane).
 */
final readonly class MeetingSuggester
{
    public function __construct(
        private SuggestionHistory $history,
        private BookableProjects $bookable,
        private MeetingSignalInput $signalInput,
    ) {}

    /**
     * Serialized suggestions keyed by meeting id; a meeting without any has no key.
     *
     * @param  iterable<OutlookMeeting>  $meetings
     * @return array<string, list<array<string, mixed>>>
     */
    public function forMeetings(User $user, Organization $organization, iterable $meetings): array
    {
        $targets = [];
        foreach ($meetings as $meeting) {
            // Only the user's own meetings are ever ranked (D-06)
            if ($meeting->user_id === $user->getKey()) {
                $targets[] = $meeting;
            }
        }
        if ($targets === []) {
            return [];
        }

        $history = $this->history->load($user, $organization);
        if ($history === []) {
            return [];
        }

        // Only projects the user can still book are ever suggested (archived, left private project...)
        $projectIds = array_values(array_unique(array_map(fn (array $row): string => $row['project_id'], $history)));
        $projects = $this->bookable->projects($user, $organization, $projectIds);
        $history = array_values(array_filter($history, fn (array $row): bool => isset($projects[$row['project_id']])));
        if ($history === []) {
            return [];
        }

        $identity = $this->signalInput->identity($user);
        $secret = (string) config('app.key');

        $suggestions = [];
        foreach ($targets as $meeting) {
            $features = MeetingSignals::features($this->signalInput->fromMeeting($meeting), $identity['own'], $identity['internal']);
            $ranked = ProjectSuggestionEngine::rank(
                MeetingSignals::hashed($features, $secret),
                MeetingSignals::labels($features, $secret),
                $history,
                // A forgotten series must not suggest itself from its pre-forget links (RESEARCH Pitfall 9)
                excludeSeries: $meeting->series_master_id,
            );
            if ($ranked === []) {
                continue;
            }

            $list = [];
            foreach ($ranked as $suggestion) {
                $project = $projects[$suggestion->projectId] ?? null;
                if ($project === null) {
                    continue;
                }
                $list[] = $suggestion->toArray() + [
                    'project_name' => $project['name'],
                    'project_color' => $project['color'],
                    'client_name' => $project['client_name'],
                ];
            }
            if ($list !== []) {
                $suggestions[$meeting->id] = $list;
            }
        }

        return $suggestions;
    }
}
