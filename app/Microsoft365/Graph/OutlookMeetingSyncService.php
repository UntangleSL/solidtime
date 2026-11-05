<?php

declare(strict_types=1);

namespace App\Microsoft365\Graph;

use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookSyncWindow;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
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
        private readonly MicrosoftTokenService $tokens,
    ) {}

    /**
     * Guards in order: account state, persisted back-off, reuse window / minimum interval, per-user lock.
     * Every guard answers without a Graph request. The lock only keeps concurrent requests of one user
     * from traversing twice (D-11, D-12); services stay stateless, so nothing is kept on this object.
     */
    public function sync(User $user, CarbonImmutable $start, CarbonImmutable $end, bool $force = false): SyncOutcome
    {
        $account = MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->first();
        $early = $this->guard($account, $user, $start, $end, $force);
        if ($early !== null) {
            return $early;
        }
        assert($account !== null);

        $lock = Cache::lock('m365:meetings-sync:'.$user->getKey(), $this->intConfig('lock_seconds', 20));
        if (! $lock->get()) {
            // A sync of this user is running: its result lands in the cache, which the client re-reads
            return new SyncOutcome(SyncStatus::Coalesced, null, $this->windowSyncedAt($user, $start, $end));
        }

        try {
            // A sync that finished (or a back-off it set) while this request was getting the lock
            $account = MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->first();
            $early = $this->guard($account, $user, $start, $end, $force);
            if ($early !== null) {
                return $early;
            }
            assert($account !== null);

            return $this->traverse($user, $account, $start, $end);
        } finally {
            $lock->release();
        }
    }

    /**
     * @return SyncOutcome|null the outcome that answers without any Graph request, or null to go on
     */
    private function guard(?MicrosoftAccount $account, User $user, CarbonImmutable $start, CarbonImmutable $end, bool $force): ?SyncOutcome
    {
        $state = $account?->calendarAccessState() ?? 'not_connected';
        if ($account === null || $state === 'not_connected') {
            return new SyncOutcome(SyncStatus::NotConnected);
        }
        if ($state === 'reconnect') {
            return new SyncOutcome(SyncStatus::Reconnect);
        }

        // graph_backoff_until: set from a Retry-After answer, honoured without any Graph request
        $backoff = $account->backoffRemainingSeconds();
        if ($backoff !== null) {
            return new SyncOutcome(SyncStatus::Throttled, $backoff);
        }

        // A forced sync (the Sync button) skips the reuse window but never the minimum interval
        $window = $force
            ? $this->intConfig('min_interval_seconds', 10)
            : $this->intConfig('reuse_seconds', 60);
        $syncedAt = $this->windowSyncedAt($user, $start, $end);
        if ($syncedAt !== null && CarbonImmutable::now()->lessThan($syncedAt->addSeconds($window))) {
            return new SyncOutcome(SyncStatus::Reused, null, $syncedAt);
        }

        return null;
    }

    private function traverse(User $user, MicrosoftAccount $account, CarbonImmutable $start, CarbonImmutable $end): SyncOutcome
    {
        $syncStartedAt = CarbonImmutable::now('UTC');

        $result = $this->client->calendarView(
            fn (?string $rejected): string => $this->tokens->accessToken($account, $rejected),
            $start,
            $end,
        );

        if ($result['failure'] === SyncStatus::NoMailbox) {
            // Not an error: the user has no Exchange Online mailbox. Nothing to store or reconcile.
            Log::info('Outlook sync: no mailbox');

            return new SyncOutcome(SyncStatus::NoMailbox);
        }

        $rows = [];
        $ineligibleIds = [];
        $nonUtc = 0;
        foreach ($result['events'] as $event) {
            // The filter runs before any row is built: an ineligible event's subject never reaches a query
            if (! $this->eligibility->isEligible($event)) {
                if (is_string($event['id'] ?? null)) {
                    $ineligibleIds[] = $event['id'];
                }

                continue;
            }
            if ($this->isNonUtc($event)) {
                $nonUtc++;

                continue;
            }
            $row = $this->buildRow($user, $event, $syncStartedAt);
            if ($row !== null) {
                $rows[$row['graph_id']] = $row;
            }
        }

        $this->store(array_values($rows));
        // A positive sighting, so it holds after a partial or failed traversal too
        $this->scrubIneligible($user, $ineligibleIds);

        if ($nonUtc > 0) {
            // Count only: no subject, id or time of the skipped events is logged
            Log::warning('Outlook meetings skipped', ['reason' => 'non_utc', 'count' => $nonUtc]);
        }

        if ($result['failure'] === SyncStatus::Reconnect) {
            // Graph kept rejecting a fresh token (or a refresh proved the grant dead): persist the state
            $this->tokens->markReconnectRequired($account);
        }

        if ($result['failure'] !== null) {
            return $this->failureOutcome($user, $result['failure'], $result['retry_after'], $result['http_status']);
        }

        if ($result['complete']) {
            // Only a complete traversal proves that an unseen meeting is gone (never after a partial one)
            $this->markUnseenGone($user, $start, $end, $syncStartedAt);
        }

        // A traversal with a failure records no sync window
        $this->recordWindow($user, $start, $end, $syncStartedAt);

        return new SyncOutcome(SyncStatus::Ok, null, $syncStartedAt, ! $result['complete']);
    }

    private function failureOutcome(User $user, SyncStatus $failure, ?int $retryAfter, ?int $httpStatus): SyncOutcome
    {
        if ($failure === SyncStatus::Throttled) {
            $seconds = $retryAfter ?? RetryAfter::DEFAULT_SECONDS;
            // Persisted, so every later request of this user waits without a Graph call (D-12)
            MicrosoftAccount::query()
                ->where('user_id', '=', $user->getKey())
                ->update(['graph_backoff_until' => CarbonImmutable::now('UTC')->addSeconds($seconds)->format('Y-m-d H:i:s')]);
            Log::warning('Outlook sync degraded', ['status' => 'throttled', 'http_status' => $httpStatus]);

            return new SyncOutcome(SyncStatus::Throttled, $seconds);
        }

        if ($failure === SyncStatus::Unavailable) {
            Log::warning('Outlook sync degraded', ['status' => 'unavailable', 'http_status' => $httpStatus]);
        }

        return new SyncOutcome($failure, $retryAfter);
    }

    private function windowSyncedAt(User $user, CarbonImmutable $start, CarbonImmutable $end): ?CarbonImmutable
    {
        $window = OutlookSyncWindow::query()
            ->where('user_id', '=', $user->getKey())
            ->where('window_start', '=', $start->utc()->format('Y-m-d H:i:s'))
            ->where('window_end', '=', $end->utc()->format('Y-m-d H:i:s'))
            ->first();

        return $window?->synced_at->toImmutable();
    }

    /**
     * A cached meeting that came back cancelled, private or otherwise ineligible is hidden and scrubbed:
     * it never keeps a title, organizer or link that Outlook no longer allows us to show (T-03-13).
     *
     * @param  list<string>  $graphIds
     */
    private function scrubIneligible(User $user, array $graphIds): void
    {
        $now = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s');
        foreach (array_chunk(array_values(array_unique($graphIds)), self::UPSERT_CHUNK) as $chunk) {
            OutlookMeeting::query()
                ->where('user_id', '=', $user->getKey())
                ->whereIn('graph_id', $chunk)
                ->whereNull('gone_at')
                ->update(['gone_at' => $now]);
            OutlookMeeting::query()
                ->where('user_id', '=', $user->getKey())
                ->whereIn('graph_id', $chunk)
                ->update(['subject' => null, 'organizer_name' => null, 'web_link' => null]);
        }
    }

    /**
     * Rows of the window that this complete traversal did not see: moved out, removed or declined in
     * Outlook. Same overlap predicate as the calendarView request (starts before the end, ends after the
     * start), so a long meeting that only touches the window is judged by the same rule Graph used.
     * Rows are never deleted: the audit of what was shown and a later link to time entries stay intact.
     */
    private function markUnseenGone(User $user, CarbonImmutable $start, CarbonImmutable $end, CarbonImmutable $syncStartedAt): void
    {
        OutlookMeeting::query()
            ->where('user_id', '=', $user->getKey())
            ->where('starts_at', '<', $end->utc()->format('Y-m-d H:i:s'))
            ->where('ends_at', '>', $start->utc()->format('Y-m-d H:i:s'))
            ->where('last_seen_at', '<', $syncStartedAt->format('Y-m-d H:i:s'))
            ->whereNull('gone_at')
            ->update(['gone_at' => CarbonImmutable::now('UTC')->format('Y-m-d H:i:s')]);
    }

    private function intConfig(string $key, int $default): int
    {
        $value = config('microsoft365.graph.'.$key, $default);

        return is_int($value) && $value > 0 ? $value : $default;
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
     * The request asks for UTC, so another zone name is a contract violation: such events are skipped.
     *
     * @param  array<string, mixed>  $event
     */
    private function isNonUtc(array $event): bool
    {
        foreach (['start', 'end'] as $key) {
            $value = $event[$key] ?? null;
            if (is_array($value) && ($value['timeZone'] ?? null) !== 'UTC') {
                return true;
            }
        }

        return false;
    }

    private function recordWindow(User $user, CarbonImmutable $start, CarbonImmutable $end, CarbonImmutable $syncedAt): void
    {
        OutlookSyncWindow::query()->upsert([[
            'id' => (string) Str::uuid(),
            'user_id' => $user->getKey(),
            'window_start' => $start->utc()->format('Y-m-d H:i:s'),
            'window_end' => $end->utc()->format('Y-m-d H:i:s'),
            'synced_at' => $syncedAt->format('Y-m-d H:i:s'),
        ]], ['user_id', 'window_start', 'window_end'], ['synced_at']);
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
