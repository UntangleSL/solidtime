<?php

declare(strict_types=1);

namespace App\Microsoft365\Graph;

use Carbon\CarbonImmutable;
use Closure;
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
     * Fetches every page of the window. $token is called before each request with null.
     *
     * @param  Closure(?string): string  $token
     * @return array{events: list<array<string, mixed>>, complete: bool, failure: SyncStatus|null, retry_after: int|null}
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

        $events = [];
        $pages = 0;
        $nextUrl = $url;

        while ($nextUrl !== null) {
            if ($pages >= $maxPages) {
                // A nextLink is still present: the window is cut short
                return ['events' => $events, 'complete' => false, 'failure' => null, 'retry_after' => null];
            }
            $pages++;

            try {
                $accessToken = $token(null);
            } catch (GraphException $exception) {
                return ['events' => $events, 'complete' => false, 'failure' => $exception->status, 'retry_after' => $exception->retryAfter];
            }

            $response = Http::withHeaders(['Prefer' => self::PREFER, 'Accept' => 'application/json'])
                ->withToken($accessToken)
                ->connectTimeout($connectTimeout)
                ->timeout($timeout)
                ->get($nextUrl);

            if (! $response->successful()) {
                return ['events' => $events, 'complete' => false, 'failure' => SyncStatus::Unavailable, 'retry_after' => null];
            }

            $body = $response->json();
            if (! is_array($body)) {
                return ['events' => $events, 'complete' => false, 'failure' => SyncStatus::Unavailable, 'retry_after' => null];
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
                return ['events' => $events, 'complete' => false, 'failure' => SyncStatus::Unavailable, 'retry_after' => null];
            }
        }

        return ['events' => $events, 'complete' => true, 'failure' => null, 'retry_after' => null];
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
