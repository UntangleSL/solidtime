<?php

declare(strict_types=1);

namespace App\Microsoft365\Graph;

/**
 * Reads a Retry-After header from Graph or the token endpoint. The header is untrusted input:
 * only integer seconds are honoured, clamped so a hostile value can neither disable nor lock the sync.
 */
final class RetryAfter
{
    public const int DEFAULT_SECONDS = 30;

    public const int MIN_SECONDS = 1;

    public const int MAX_SECONDS = 300;

    /**
     * Digits only become seconds (1..300). A missing, empty, HTTP-date, negative or unparseable value
     * is the default: Graph also sends dates, and waiting a short fixed time beats guessing.
     */
    public static function seconds(?string $header): int
    {
        if ($header === null || preg_match('/^\d+$/', trim($header)) !== 1) {
            return self::DEFAULT_SECONDS;
        }

        $digits = ltrim(trim($header), '0');
        // More digits than the cap needs also covers integer overflow
        if (strlen($digits) > 6) {
            return self::MAX_SECONDS;
        }

        return max(self::MIN_SECONDS, min(self::MAX_SECONDS, (int) $digits));
    }
}
