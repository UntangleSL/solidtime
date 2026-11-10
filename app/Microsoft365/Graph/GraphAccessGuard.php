<?php

declare(strict_types=1);

namespace App\Microsoft365\Graph;

use STS\FilamentImpersonate\ImpersonateManager;
use Throwable;

/**
 * The one place that knows about admin impersonation (D-22). While an admin acts as a user, nothing
 * Outlook-related may be read, rendered or requested on that user's behalf: the token service, the
 * sync service, the meeting endpoints and the shared calendar prop all ask this guard first.
 *
 * Stateless on purpose (Octane): the answer is read from the session on every call, never kept.
 */
final class GraphAccessGuard
{
    /**
     * True while the current session is an impersonation. Fails closed: when the check itself cannot
     * be answered, access counts as blocked.
     */
    public function blocked(): bool
    {
        try {
            return app(ImpersonateManager::class)->isImpersonating();
        } catch (Throwable) {
            return true;
        }
    }
}
