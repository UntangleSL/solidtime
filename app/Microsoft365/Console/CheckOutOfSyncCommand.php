<?php

declare(strict_types=1);

namespace App\Microsoft365\Console;

use App\Microsoft365\Jobs\CheckOutOfSyncForUser;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\OutOfSync\OutOfSyncScope;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

/**
 * The daily out-of-sync check (D-11), scheduled from Microsoft365ServiceProvider: queues one
 * CheckOutOfSyncForUser job per user whose account is connected, has no active Graph back-off and has at
 * least one active link in the window, each dispatch delayed by microsoft365.out_of_sync
 * .dispatch_stagger_seconds more than the previous one so the users' Graph calls do not bunch up.
 *
 * Output holds counts only (no email, id or name), like m365:check. Does nothing, and exits 0, while
 * the integration is not configured.
 */
class CheckOutOfSyncCommand extends Command
{
    /**
     * @var string
     */
    protected $signature = 'm365:check-out-of-sync {--dry-run : Count the users without queuing a check}';

    /**
     * @var string
     */
    protected $description = 'Queue the daily Outlook out-of-sync check of every connected user';

    public function handle(MicrosoftConfig $config, OutOfSyncScope $scope): int
    {
        if (! $config->isConfigured()) {
            $this->line('configured: no');

            return self::SUCCESS;
        }

        $now = CarbonImmutable::now('UTC');
        /** @var array<string, true> $userIds */
        $userIds = [];
        $accounts = MicrosoftAccount::query()->connected()->with('user')->orderBy('id')->get();
        foreach ($accounts as $account) {
            if ($account->calendarAccessState() !== 'connected' || $account->backoffRemainingSeconds() !== null) {
                continue;
            }
            $user = $account->user;
            $userId = (string) $user->getKey();
            if (isset($userIds[$userId]) || ! $scope->activeLinks($user, $now)->exists()) {
                continue;
            }
            $userIds[$userId] = true;
        }

        $dryRun = (bool) $this->option('dry-run');
        $stagger = $this->staggerSeconds();
        $dispatched = 0;
        if (! $dryRun) {
            foreach (array_keys($userIds) as $i => $userId) {
                CheckOutOfSyncForUser::dispatch((string) $userId)->delay(now()->addSeconds($i * $stagger));
                $dispatched++;
            }
        }

        $this->line('users: '.count($userIds));
        $this->line('dispatched: '.$dispatched.($dryRun ? ' (dry run)' : ''));

        return self::SUCCESS;
    }

    private function staggerSeconds(): int
    {
        $value = config('microsoft365.out_of_sync.dispatch_stagger_seconds', 10);

        return is_int($value) && $value >= 0 ? $value : 10;
    }
}
