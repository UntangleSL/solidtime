<?php

declare(strict_types=1);

namespace App\Microsoft365\Graph;

use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

/**
 * Pulls a user's Outlook meetings for a window from Microsoft Graph into the outlook_meetings cache.
 *
 * Read-only towards Graph and never touches time entries: Outlook changes must not modify or delete
 * existing time entries (PROJECT.md data safety).
 */
final class OutlookMeetingSyncService
{
    private const int UPSERT_CHUNK = 200;

    public function __construct(
        private readonly GraphCalendarClient $client,
        private readonly OutlookMeetingEligibility $eligibility,
    ) {}

    public function sync(User $user, CarbonImmutable $start, CarbonImmutable $end, bool $force = false): SyncOutcome
    {
        $account = MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->first();
        if ($account === null || ! $account->isConnected()) {
            return new SyncOutcome(SyncStatus::NotConnected);
        }

        $syncStartedAt = CarbonImmutable::now('UTC');

        $result = $this->client->calendarView(
            fn (?string $rejected): string => (string) $account->access_token,
            $start,
            $end,
        );

        $rows = [];
        foreach ($result['events'] as $event) {
            // The filter runs before any row is built: an ineligible event's subject never reaches a query
            if (! $this->eligibility->isEligible($event)) {
                continue;
            }
            $row = $this->buildRow($user, $event, $syncStartedAt);
            if ($row !== null) {
                $rows[$row['graph_id']] = $row;
            }
        }

        $this->store(array_values($rows));

        if ($result['failure'] !== null) {
            return new SyncOutcome($result['failure'], $result['retry_after']);
        }

        return new SyncOutcome(SyncStatus::Ok, null, $syncStartedAt, ! $result['complete']);
    }

    /**
     * Graph answers with "2026-10-20T08:00:00.0000000" and a time zone name. Only UTC is accepted,
     * because the request asks for UTC: anything else is a contract violation and is skipped.
     *
     * @param  array<mixed>  $dateTimeTimeZone
     */
    public static function parseGraphUtc(array $dateTimeTimeZone): ?CarbonImmutable
    {
        $dateTime = $dateTimeTimeZone['dateTime'] ?? null;
        $timeZone = $dateTimeTimeZone['timeZone'] ?? null;
        if (! is_string($dateTime) || $timeZone !== 'UTC') {
            return null;
        }
        if (preg_match('/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?$/', $dateTime, $matches) !== 1) {
            return null;
        }

        return CarbonImmutable::createFromFormat('Y-m-d\TH:i:s', $matches[1], 'UTC');
    }

    /**
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>|null
     */
    private function buildRow(User $user, array $event, CarbonImmutable $seenAt): ?array
    {
        $startsAt = is_array($event['start'] ?? null) ? self::parseGraphUtc($event['start']) : null;
        $endsAt = is_array($event['end'] ?? null) ? self::parseGraphUtc($event['end']) : null;
        if ($startsAt === null || $endsAt === null || $endsAt < $startsAt) {
            return null;
        }

        $originalStart = $event['originalStart'] ?? null;
        $originalStartAt = null;
        if (is_string($originalStart)) {
            try {
                $originalStartAt = CarbonImmutable::parse($originalStart)->utc()->format('Y-m-d H:i:s');
            } catch (\Throwable) {
                $originalStartAt = null;
            }
        }

        $organizer = $event['organizer'] ?? null;
        $organizerEmail = is_array($organizer) ? ($organizer['emailAddress'] ?? null) : null;
        $organizerName = is_array($organizerEmail) ? ($organizerEmail['name'] ?? null) : null;

        $subject = $event['subject'] ?? null;
        $seriesMasterId = $event['seriesMasterId'] ?? null;
        $showAs = $event['showAs'] ?? null;
        $type = $event['type'] ?? null;

        return [
            'id' => (string) Str::uuid(),
            'user_id' => $user->getKey(),
            'graph_id' => $event['id'],
            'series_master_id' => is_string($seriesMasterId) ? Str::limit($seriesMasterId, 255, '') : null,
            'original_start' => $originalStartAt,
            'event_type' => is_string($type) ? Str::limit($type, 20, '') : 'singleInstance',
            'subject' => is_string($subject) ? $subject : null,
            'starts_at' => $startsAt->format('Y-m-d H:i:s'),
            'ends_at' => $endsAt->format('Y-m-d H:i:s'),
            'organizer_name' => is_string($organizerName) ? Str::limit($organizerName, 255, '') : null,
            'is_organizer' => ($event['isOrganizer'] ?? false) === true,
            'is_online_meeting' => ($event['isOnlineMeeting'] ?? false) === true,
            'show_as' => is_string($showAs) ? Str::limit($showAs, 20, '') : null,
            'web_link' => $this->httpsUrlOrNull($event['webLink'] ?? null),
            'last_seen_at' => $seenAt->format('Y-m-d H:i:s'),
            'gone_at' => null,
        ];
    }

    private function httpsUrlOrNull(mixed $url): ?string
    {
        if (! is_string($url)) {
            return null;
        }
        $parts = parse_url($url);

        return is_array($parts) && ($parts['scheme'] ?? null) === 'https' && ($parts['host'] ?? '') !== ''
            ? $url
            : null;
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     */
    private function store(array $rows): void
    {
        foreach (array_chunk($rows, self::UPSERT_CHUNK) as $chunk) {
            // Explicit update list: never id, user_id, graph_id, dismissed_at or created_at
            OutlookMeeting::query()->upsert($chunk, ['user_id', 'graph_id'], [
                'series_master_id',
                'original_start',
                'event_type',
                'subject',
                'starts_at',
                'ends_at',
                'organizer_name',
                'is_organizer',
                'is_online_meeting',
                'show_as',
                'web_link',
                'last_seen_at',
                'gone_at',
            ]);
        }
    }
}
