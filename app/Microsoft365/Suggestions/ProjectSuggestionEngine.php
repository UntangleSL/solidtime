<?php

declare(strict_types=1);

namespace App\Microsoft365\Suggestions;

/**
 * Ranks projects for a meeting from the user's own past conversions (RULE-03, D-06, D-07).
 *
 * Simple and explainable on purpose: every feature the target meeting shares with a past link adds
 * weight x idf x decay to that link's project, where
 *  - weight depends on the feature kind (organizer and external people > domains > subject words;
 *    internal colleagues weigh least),
 *  - idf(f) = min(IDF_CAP, ln(1 + N / df(f))) over the history rows, so ubiquitous features fade and
 *    one rare word cannot dominate beyond IDF_CAP,
 *  - decay = 0.5 ^ (age_days / HALF_LIFE_DAYS).
 * Only the first suggestion may be confident: score >= MIN_SCORE, score >= MARGIN x the second, and
 * backed by two or more links or by an organizer, person or domain match (RESEARCH Pitfall 8).
 *
 * Broadcast guard: when the target or a past link has more than BROADCAST_LIMIT attendees (all-hands),
 * that pair matches only on the organizer and subject words; attendees and domains are ignored.
 * Forgotten series (RESEARCH Pitfall 9): rows of $excludeSeries flagged forgotten (links created before
 * the forget) never score, otherwise "forget" would be undone at once by the same history.
 *
 * All weights and thresholds below are starting values to tune after owner UAT (RESEARCH A1).
 *
 * Pure: arrays in, value objects out; no database, no framework state (Octane safe).
 */
final class ProjectSuggestionEngine
{
    public const int BROADCAST_LIMIT = 25;

    public const float W_ORGANIZER_EXTERNAL = 4.0;

    public const float W_ORGANIZER_INTERNAL = 2.0;

    public const float W_PERSON_EXTERNAL = 3.0;

    public const float W_PERSON_INTERNAL = 1.0;

    public const float W_DOMAIN = 2.0;

    public const float W_TOKEN = 1.0;

    public const float IDF_CAP = 3.0;

    public const float HALF_LIFE_DAYS = 90.0;

    public const float MIN_SCORE = 3.0;

    public const float MARGIN = 1.5;

    public const int DEFAULT_LIMIT = 3;

    private const string FIELD_PERSON = 'person';

    private const string FIELD_DOMAIN = 'domain';

    private const string FIELD_TOKEN = 'token';

    /**
     * @param  array<string, mixed>  $target  hashed payload of the target meeting (MeetingSignals::hashed, same secret)
     * @param  array<string, ?string>  $labels  target hash => readable value (person => display name or null, domain => bare domain)
     * @param  list<array{project_id: string, age_days: float|int, series: ?string, forgotten: bool, signals: array<string, mixed>}>  $history
     * @return list<Suggestion>
     */
    public static function rank(array $target, array $labels, array $history, ?string $excludeSeries = null, int $limit = self::DEFAULT_LIMIT): array
    {
        if ($limit < 1) {
            return [];
        }

        $targetSignals = self::signals($target);
        $targetBroadcast = $targetSignals['n'] > self::BROADCAST_LIMIT;
        $features = self::targetFeatures($targetSignals);
        if ($features === []) {
            return [];
        }

        $rows = [];
        foreach ($history as $row) {
            if ($excludeSeries !== null && $row['series'] === $excludeSeries && $row['forgotten']) {
                continue;
            }
            $signals = self::signals($row['signals']);
            $rows[] = [
                'project_id' => $row['project_id'],
                'decay' => 0.5 ** (max(0.0, (float) $row['age_days']) / self::HALF_LIFE_DAYS),
                'broadcast' => $signals['n'] > self::BROADCAST_LIMIT,
                'organizer' => $signals['o'] === null ? [] : [$signals['o'] => true],
                'sets' => self::rowSets($signals),
            ];
        }
        if ($rows === []) {
            return [];
        }

        $total = count($rows);
        $idf = [];
        foreach ($features as $key => $feature) {
            $df = 0;
            foreach ($rows as $row) {
                if (isset($row['sets'][$feature['field']][$feature['hash']])) {
                    $df++;
                }
            }
            $idf[$key] = $df === 0 ? 0.0 : min(self::IDF_CAP, log(1 + $total / $df));
        }

        /** @var array<string, array{score: float, rows: int, features: array<string, array{kind: string, hash: string, contribution: float, rows: int}>}> $projects */
        $projects = [];
        foreach ($rows as $row) {
            $rowScore = 0.0;
            $shared = [];
            $guarded = $targetBroadcast || $row['broadcast'];
            foreach ($features as $key => $feature) {
                if ($idf[$key] <= 0.0) {
                    continue;
                }
                // Broadcast guard: only the organizer and subject words count for this pair, and a
                // broadcast link offers only its own organizer as a person.
                if ($guarded && $feature['kind'] !== Reason::KIND_ORGANIZER && $feature['kind'] !== Reason::KIND_SUBJECT) {
                    continue;
                }
                $set = $feature['field'] === self::FIELD_PERSON && $row['broadcast']
                    ? $row['organizer']
                    : $row['sets'][$feature['field']];
                if (! isset($set[$feature['hash']])) {
                    continue;
                }
                $contribution = $feature['weight'] * $idf[$key] * $row['decay'];
                $rowScore += $contribution;
                $shared[$key] = $contribution;
            }
            if ($rowScore <= 0.0) {
                continue;
            }

            $projectId = $row['project_id'];
            $project = $projects[$projectId] ?? ['score' => 0.0, 'rows' => 0, 'features' => []];
            $project['score'] += $rowScore;
            $project['rows']++;
            foreach ($shared as $key => $contribution) {
                $entry = $project['features'][$key] ?? [
                    'kind' => $features[$key]['kind'],
                    'hash' => $features[$key]['hash'],
                    'contribution' => 0.0,
                    'rows' => 0,
                ];
                $entry['contribution'] += $contribution;
                $entry['rows']++;
                $project['features'][$key] = $entry;
            }
            $projects[$projectId] = $project;
        }

        // score desc, then project id; keys may be ints when an id is numeric
        uksort($projects, static function (int|string $a, int|string $b) use ($projects): int {
            return [$projects[$b]['score'], (string) $a] <=> [$projects[$a]['score'], (string) $b];
        });

        $suggestions = [];
        $scores = array_column($projects, 'score');
        $second = $scores[1] ?? null;
        foreach ($projects as $projectId => $project) {
            $ordered = self::orderFeatures($project['features']);
            if ($ordered === []) {
                continue;
            }
            $confident = $suggestions === []
                && $project['score'] >= self::MIN_SCORE
                && ($second === null || $project['score'] >= self::MARGIN * $second)
                && ($project['rows'] >= 2 || $ordered[0]['kind'] !== Reason::KIND_SUBJECT);

            $suggestions[] = new Suggestion(
                projectId: (string) $projectId,
                score: $project['score'],
                confident: $confident,
                reason: self::reason($ordered, $labels),
            );
            if (count($suggestions) === $limit) {
                break;
            }
        }

        return $suggestions;
    }

    /**
     * @param  array{o: ?string, oi: bool, a: list<string>, i: list<string>, d: list<string>, t: list<string>, n: int}  $target
     * @return array<string, array{kind: 'domain'|'person'|'organizer'|'subject', field: string, hash: string, weight: float}>
     */
    private static function targetFeatures(array $target): array
    {
        $features = [];
        if ($target['o'] !== null) {
            $features['p:'.$target['o']] = [
                'kind' => Reason::KIND_ORGANIZER,
                'field' => self::FIELD_PERSON,
                'hash' => $target['o'],
                'weight' => $target['oi'] ? self::W_ORGANIZER_INTERNAL : self::W_ORGANIZER_EXTERNAL,
            ];
        }
        foreach ([[$target['a'], self::W_PERSON_EXTERNAL], [$target['i'], self::W_PERSON_INTERNAL]] as [$hashes, $weight]) {
            foreach ($hashes as $hash) {
                $features['p:'.$hash] ??= [
                    'kind' => Reason::KIND_PERSON,
                    'field' => self::FIELD_PERSON,
                    'hash' => $hash,
                    'weight' => $weight,
                ];
            }
        }
        foreach ($target['d'] as $hash) {
            $features['d:'.$hash] = ['kind' => Reason::KIND_DOMAIN, 'field' => self::FIELD_DOMAIN, 'hash' => $hash, 'weight' => self::W_DOMAIN];
        }
        foreach ($target['t'] as $hash) {
            $features['t:'.$hash] = ['kind' => Reason::KIND_SUBJECT, 'field' => self::FIELD_TOKEN, 'hash' => $hash, 'weight' => self::W_TOKEN];
        }

        return $features;
    }

    /**
     * @param  array{o: ?string, oi: bool, a: list<string>, i: list<string>, d: list<string>, t: list<string>, n: int}  $signals
     * @return array<string, array<string, true>>
     */
    private static function rowSets(array $signals): array
    {
        $people = array_merge($signals['o'] === null ? [] : [$signals['o']], $signals['a'], $signals['i']);

        return [
            self::FIELD_PERSON => array_fill_keys($people, true),
            self::FIELD_DOMAIN => array_fill_keys($signals['d'], true),
            self::FIELD_TOKEN => array_fill_keys($signals['t'], true),
        ];
    }

    /**
     * Strongest feature first: contribution desc, then kind (organizer, person, domain, subject), then hash.
     *
     * @param  array<string, array{kind: string, hash: string, contribution: float, rows: int}>  $features
     * @return list<array{kind: string, hash: string, contribution: float, rows: int}>
     */
    private static function orderFeatures(array $features): array
    {
        $priority = [Reason::KIND_ORGANIZER => 0, Reason::KIND_PERSON => 1, Reason::KIND_DOMAIN => 2, Reason::KIND_SUBJECT => 3];
        $ordered = array_values($features);
        usort($ordered, static fn (array $x, array $y): int => [$y['contribution'], $priority[$x['kind']] ?? 9, $x['hash']]
            <=> [$x['contribution'], $priority[$y['kind']] ?? 9, $y['hash']]);

        return $ordered;
    }

    /**
     * The strongest feature with a readable value from the target meeting. Values are display names or
     * bare domains only, never a full address: a person without a display name falls back to the
     * strongest shared domain of the project (normally that person's domain), then to the next feature.
     * Subject reasons carry no value.
     *
     * @param  non-empty-list<array{kind: string, hash: string, contribution: float, rows: int}>  $ordered
     * @param  array<string, ?string>  $labels
     */
    private static function reason(array $ordered, array $labels): Reason
    {
        foreach ($ordered as $index => $feature) {
            $kind = self::kind($feature['kind']);
            if ($kind === Reason::KIND_SUBJECT) {
                return new Reason($kind, $feature['rows'], null);
            }
            $label = $labels[$feature['hash']] ?? null;
            // a display name that is itself an address is not shown
            if ($label !== null && $label !== '' && ($kind === Reason::KIND_DOMAIN || ! str_contains($label, '@'))) {
                return new Reason($kind, $feature['rows'], $label);
            }
            if ($index === 0 && $kind !== Reason::KIND_DOMAIN) {
                foreach ($ordered as $candidate) {
                    $domain = $labels[$candidate['hash']] ?? null;
                    if ($candidate['kind'] === Reason::KIND_DOMAIN && $domain !== null && $domain !== '') {
                        return new Reason(Reason::KIND_DOMAIN, $candidate['rows'], $domain);
                    }
                }
            }
        }

        $strongest = $ordered[0];

        return new Reason(self::kind($strongest['kind']), $strongest['rows'], null);
    }

    /**
     * @return 'domain'|'person'|'organizer'|'subject'
     */
    private static function kind(string $kind): string
    {
        return match ($kind) {
            Reason::KIND_ORGANIZER => Reason::KIND_ORGANIZER,
            Reason::KIND_PERSON => Reason::KIND_PERSON,
            Reason::KIND_DOMAIN => Reason::KIND_DOMAIN,
            default => Reason::KIND_SUBJECT,
        };
    }

    /**
     * Reads a stored or target payload defensively (jsonb may be old or partial).
     *
     * @param  array<string, mixed>  $raw
     * @return array{o: ?string, oi: bool, a: list<string>, i: list<string>, d: list<string>, t: list<string>, n: int}
     */
    private static function signals(array $raw): array
    {
        /** @return list<string> */
        $list = static function (mixed $value): array {
            $items = [];
            foreach (is_array($value) ? $value : [] as $item) {
                if (is_string($item) && $item !== '') {
                    $items[] = $item;
                }
            }

            return $items;
        };

        return [
            'o' => is_string($raw['o'] ?? null) && $raw['o'] !== '' ? $raw['o'] : null,
            'oi' => ($raw['oi'] ?? false) === true,
            'a' => $list($raw['a'] ?? null),
            'i' => $list($raw['i'] ?? null),
            'd' => $list($raw['d'] ?? null),
            't' => $list($raw['t'] ?? null),
            'n' => is_int($raw['n'] ?? null) ? $raw['n'] : 0,
        ];
    }
}
