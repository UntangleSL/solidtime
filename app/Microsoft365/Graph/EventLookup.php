<?php

declare(strict_types=1);

namespace App\Microsoft365\Graph;

use Carbon\CarbonImmutable;

/**
 * Result of GraphCalendarClient::event(). Times are UTC. `httpStatus` is the status of the deciding Graph
 * answer, for the caller's log line only; the Graph id, times and body are never logged.
 */
final readonly class EventLookup
{
    private function __construct(
        public EventLookupStatus $status,
        public ?CarbonImmutable $start = null,
        public ?CarbonImmutable $end = null,
        public bool $allDay = false,
        public ?int $retryAfter = null,
        public ?int $httpStatus = null,
    ) {}

    public static function present(CarbonImmutable $start, CarbonImmutable $end, bool $allDay, ?int $httpStatus = 200): self
    {
        return new self(EventLookupStatus::Present, $start, $end, $allDay, null, $httpStatus);
    }

    /**
     * The times are informative only (null when Graph sent none usable): a cancellation is decisive anyway.
     */
    public static function cancelled(?CarbonImmutable $start, ?CarbonImmutable $end, bool $allDay, ?int $httpStatus = 200): self
    {
        return new self(EventLookupStatus::Cancelled, $start, $end, $allDay, null, $httpStatus);
    }

    public static function removed(int $httpStatus = 404): self
    {
        return new self(EventLookupStatus::Removed, httpStatus: $httpStatus);
    }

    public static function unknown(?int $httpStatus = null): self
    {
        return new self(EventLookupStatus::Unknown, httpStatus: $httpStatus);
    }

    public static function throttled(int $retryAfter, ?int $httpStatus = null): self
    {
        return new self(EventLookupStatus::Throttled, retryAfter: $retryAfter, httpStatus: $httpStatus);
    }

    public static function reconnect(?int $httpStatus = null): self
    {
        return new self(EventLookupStatus::Reconnect, httpStatus: $httpStatus);
    }
}
