<?php

declare(strict_types=1);

namespace App\Microsoft365\Graph;

use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * Read-only Microsoft Graph calendarView client. Plain class without instance state (Octane safe).
 *
 * The first URL is one literal string: Graph needs the unencoded "$select" / "$orderby" / "$top" names,
 * so a query array would encode them. Every page, including every @odata.nextLink, carries the combined
 * Prefer header, because a page fetched without it returns different event ids (DECISIONS-graph.md).
 */
final class GraphCalendarClient
{
    public const string BASE_URL = 'https://graph.microsoft.com/v1.0/me/calendarView';

    public const string SELECT = 'id,iCalUId,subject,start,end,isAllDay,isCancelled,isOrganizer,responseStatus,type,seriesMasterId,originalStart,organizer,showAs,sensitivity,webLink,isOnlineMeeting';

    public const string PREFER = 'outlook.timezone="UTC", IdType="ImmutableId"';

    /**
     * Graph error codes of a 404 that mean "this user has no usable Exchange Online mailbox" (D-19).
     */
    private const array NO_MAILBOX_CODES = ['MailboxNotEnabledForRESTAPI', 'MailboxNotSupportedForRESTAPI'];

    /**
     * Fetches every page of the window. $token is called before each page with null, and once more with the
     * rejected token after a 401/403 (a forced refresh).
     *
     * Every failure keeps the events collected so far. A traversal cut short by the page cap or the total
     * deadline is partial (complete false, no failure). `http_status` is the status of the failing answer,
     * for the caller's log line only.
     *
     * @param  Closure(?string): string  $token
     * @return array{events: list<array<string, mixed>>, complete: bool, failure: SyncStatus|null, retry_after: int|null, http_status: int|null}
     */
    public function calendarView(Closure $token, CarbonImmutable $start, CarbonImmutable $end): array
    {
        $url = self::BASE_URL
            .'?startDateTime='.rawurlencode($start->utc()->format('Y-m-d\TH:i:s\Z'))
            .'&endDateTime='.rawurlencode($end->utc()->format('Y-m-d\TH:i:s\Z'))
            .'&$select='.self::SELECT
            .'&$orderby=start/dateTime&$top=100';

        $maxPages = $this->intConfig('microsoft365.graph.max_pages', 10);
        $connectTimeout = $this->intConfig('microsoft365.graph.connect_timeout', 3);
        $timeout = $this->intConfig('microsoft365.graph.timeout', 8);
        $deadline = CarbonImmutable::now()->addSeconds($this->intConfig('microsoft365.graph.deadline_seconds', 15));

        $events = [];
        $pages = 0;
        $nextUrl = $url;

        while ($nextUrl !== null) {
            // A nextLink is still present: the window is cut short, never reported as complete
            if ($pages >= $maxPages || CarbonImmutable::now()->greaterThan($deadline)) {
                return $this->result($events, false);
            }
            $pages++;

            try {
                $accessToken = $token(null);
            } catch (GraphException $exception) {
                return $this->tokenFailure($events, $exception);
            }

            try {
                $response = $this->get($nextUrl, $accessToken, $connectTimeout, $timeout);

                if ($response->status() === 401 || $response->status() === 403) {
                    // One forced refresh and one retry of the same page. The single mapping point of
                    // "Graph rejects a fresh token": 03-RESEARCH Assumption A2 (a 403 may become "unavailable").
                    try {
                        $accessToken = $token($accessToken);
                    } catch (GraphException $exception) {
                        return $this->tokenFailure($events, $exception);
                    }
                    $response = $this->get($nextUrl, $accessToken, $connectTimeout, $timeout);
                    if ($response->status() === 401 || $response->status() === 403) {
                        return $this->result($events, false, SyncStatus::Reconnect, null, $response->status());
                    }
                }
            } catch (ConnectionException) {
                // Timeout, refused or reset connection: an outage, the cache keeps serving
                return $this->result($events, false, SyncStatus::Unavailable);
            }

            if (! $response->successful()) {
                return $this->failedResponse($events, $response);
            }

            $body = $response->json();
            if (! is_array($body)) {
                return $this->result($events, false, SyncStatus::Unavailable, null, $response->status());
            }

            $value = $body['value'] ?? [];
            if (is_array($value)) {
                foreach ($value as $event) {
                    if (is_array($event)) {
                        /** @var array<string, mixed> $event */
                        $events[] = $event;
                    }
                }
            }

            // An empty page never ends the traversal: Graph returns empty pages with a nextLink
            $nextLink = $body['@odata.nextLink'] ?? null;
            if ($nextLink === null) {
                $nextUrl = null;
            } elseif (is_string($nextLink) && $this->isGraphUrl($nextLink)) {
                $nextUrl = $nextLink;
            } else {
                return $this->result($events, false, SyncStatus::Unavailable);
            }
        }

        return $this->result($events, true);
    }

    /**
     * Maps a non-2xx answer (401/403 are handled before). No in-request retry on throttling: every request
     * counts against the throttling budget, so the caller persists a back-off instead.
     *
     * @param  list<array<string, mixed>>  $events
     * @return array{events: list<array<string, mixed>>, complete: bool, failure: SyncStatus|null, retry_after: int|null, http_status: int|null}
     */
    private function failedResponse(array $events, Response $response): array
    {
        $status = $response->status();

        // 503 and 504 only mean "back off" when Graph says for how long; otherwise they are an outage
        if ($status === 429 || (($status === 503 || $status === 504) && $response->hasHeader('Retry-After'))) {
            return $this->result($events, false, SyncStatus::Throttled, RetryAfter::seconds($response->header('Retry-After')), $status);
        }

        // Allow-list only: any other 404 is unknown territory and stays "unavailable" (03-RESEARCH Assumption A4)
        if ($status === 404 && in_array($response->json('error.code'), self::NO_MAILBOX_CODES, true)) {
            return $this->result($events, false, SyncStatus::NoMailbox, null, $status);
        }

        return $this->result($events, false, SyncStatus::Unavailable, null, $status);
    }

    /**
     * @param  list<array<string, mixed>>  $events
     * @return array{events: list<array<string, mixed>>, complete: bool, failure: SyncStatus|null, retry_after: int|null, http_status: int|null}
     */
    private function tokenFailure(array $events, GraphException $exception): array
    {
        // The token endpoint only ever throttles with a 429
        $httpStatus = $exception->status === SyncStatus::Throttled ? 429 : null;

        return $this->result($events, false, $exception->status, $exception->retryAfter, $httpStatus);
    }

    /**
     * @param  list<array<string, mixed>>  $events
     * @return array{events: list<array<string, mixed>>, complete: bool, failure: SyncStatus|null, retry_after: int|null, http_status: int|null}
     */
    private function result(array $events, bool $complete, ?SyncStatus $failure = null, ?int $retryAfter = null, ?int $httpStatus = null): array
    {
        return ['events' => $events, 'complete' => $complete, 'failure' => $failure, 'retry_after' => $retryAfter, 'http_status' => $httpStatus];
    }

    private function get(string $url, string $accessToken, int $connectTimeout, int $timeout): Response
    {
        return Http::withHeaders(['Prefer' => self::PREFER, 'Accept' => 'application/json'])
            ->withToken($accessToken)
            ->connectTimeout($connectTimeout)
            ->timeout($timeout)
            ->get($url);
    }

    /**
     * The bearer token must never follow a link to another host or over plain http.
     */
    private function isGraphUrl(string $url): bool
    {
        $parts = parse_url($url);

        return is_array($parts)
            && ($parts['scheme'] ?? null) === 'https'
            && ($parts['host'] ?? null) === 'graph.microsoft.com'
            && ! isset($parts['user'])
            && ! isset($parts['port']);
    }

    private function intConfig(string $key, int $default): int
    {
        $value = config($key, $default);

        return is_int($value) && $value > 0 ? $value : $default;
    }
}
