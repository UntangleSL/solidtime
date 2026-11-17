<?php

declare(strict_types=1);

namespace App\Microsoft365\Suggestions;

use App\Models\Organization;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;

/**
 * The labelled history the learned suggestions rank from (RULE-03): the user's own past conversions,
 * each one the project of the entry behind an Outlook meeting link plus the keyed-hash signals stored on
 * that link at conversion time (05-05).
 *
 * Only the session user's own data (D-06, T-05-30): links of the user whose entry still belongs to the
 * user (an entry reassigned by core no longer counts) and lives in the given organization, with a
 * project. Nobody else's links or entries are ever read.
 *
 * Bounded (RESEARCH A3, T-05-34): one query, the most recent MAX_ROWS links of the last WINDOW_DAYS days.
 * A link of a forgotten series created up to the forget is flagged, so the engine can keep it from
 * suggesting its own series again (D-11, RESEARCH Pitfall 9). Rows with an unknown signals version are
 * skipped. Read only, stateless (Octane).
 */
final class SuggestionHistory
{
    public const int MAX_ROWS = 2000;

    public const int WINDOW_DAYS = 365;

    /**
     * @return list<array{project_id: string, age_days: float, series: ?string, forgotten: bool, signals: array<string, mixed>}>
     */
    public function load(User $user, Organization $organization): array
    {
        $now = CarbonImmutable::now('UTC');

        $rows = DB::table('outlook_meeting_links as l')
            ->join('time_entries as te', function (JoinClause $join): void {
                // The entry must still be the user's own: an entry reassigned by core no longer counts
                $join->on('te.id', '=', 'l.time_entry_id')
                    ->on('te.user_id', '=', 'l.user_id');
            })
            ->leftJoin('outlook_series_settings as s', function (JoinClause $join): void {
                $join->on('s.user_id', '=', 'l.user_id')
                    ->on('s.series_master_id', '=', 'l.series_master_id');
            })
            ->where('l.user_id', '=', $user->getKey())
            ->where('te.organization_id', '=', $organization->getKey())
            ->whereNotNull('te.project_id')
            ->whereNotNull('l.signals')
            ->where('l.created_at', '>=', $now->subDays(self::WINDOW_DAYS)->format('Y-m-d H:i:s'))
            ->select(['te.project_id', 'l.series_master_id', 'l.signals', 'l.created_at'])
            // "Forget this series" (D-11): the links created up to forgotten_at
            ->selectRaw('(s.forgotten_at IS NOT NULL AND l.created_at <= s.forgotten_at) AS forgotten')
            ->orderByDesc('l.created_at')
            ->orderByDesc('l.id')
            ->limit(self::MAX_ROWS)
            ->get();

        $history = [];
        foreach ($rows as $row) {
            /** @var object{project_id: string, series_master_id: string|null, signals: string|null, created_at: string, forgotten: bool|null} $row */
            $signals = $this->signals($row->signals);
            if ($signals === null) {
                continue;
            }
            $createdAt = CarbonImmutable::parse((string) $row->created_at, 'UTC');
            $history[] = [
                'project_id' => (string) $row->project_id,
                'age_days' => max(0.0, ($now->getTimestamp() - $createdAt->getTimestamp()) / 86400),
                'series' => $row->series_master_id !== null && $row->series_master_id !== '' ? (string) $row->series_master_id : null,
                'forgotten' => (bool) $row->forgotten,
                'signals' => $signals,
            ];
        }

        return $history;
    }

    /**
     * The stored payload, or null when it is not a payload of the current version.
     *
     * @return array<string, mixed>|null
     */
    private function signals(?string $json): ?array
    {
        if ($json === null || $json === '') {
            return null;
        }
        $decoded = json_decode($json, true);
        if (! is_array($decoded) || ($decoded['v'] ?? null) !== MeetingSignals::VERSION) {
            return null;
        }

        /** @var array<string, mixed> $decoded */
        return $decoded;
    }
}
