<?php

declare(strict_types=1);

namespace App\Microsoft365\Graph;

use RuntimeException;

/**
 * A Graph-side failure that maps onto a SyncStatus. The message is fixed and carries no data:
 * Graph bodies and tokens must never end up in a log line or an exception report.
 */
final class GraphException extends RuntimeException
{
    public function __construct(
        public readonly SyncStatus $status,
        public readonly ?int $retryAfter = null,
        public readonly ?string $providerCode = null,
    ) {
        parent::__construct('Microsoft Graph request failed');
    }
}
