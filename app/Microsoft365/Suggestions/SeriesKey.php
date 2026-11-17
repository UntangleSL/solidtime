<?php

declare(strict_types=1);

namespace App\Microsoft365\Suggestions;

/**
 * Opaque key of a meeting series for the browser (Phase 5 D-13): the calendar can tell that two
 * occurrences belong to the same series without ever seeing a Graph id. A keyed hash, so it cannot be
 * reversed or recomputed without the application key.
 */
final class SeriesKey
{
    private const int LENGTH = 16;

    public static function of(?string $seriesMasterId, string $secret): ?string
    {
        if ($seriesMasterId === null || $seriesMasterId === '') {
            return null;
        }

        return substr(hash_hmac('sha256', 'series|'.$seriesMasterId, $secret), 0, self::LENGTH);
    }
}
