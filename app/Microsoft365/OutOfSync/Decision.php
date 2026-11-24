<?php

declare(strict_types=1);

namespace App\Microsoft365\OutOfSync;

/**
 * The outcome of OutOfSyncRules::decide for one link and one observation.
 *
 * - reason: the flag reason of a Flag decision ('moved', 'cancelled' or 'removed'), null otherwise.
 * - start / end: UTC 'Y-m-d H:i:s' target slot of AutoAdjust and Resync, and the new Outlook slot of a
 *   moved flag ("old -> new", the Adjust target).
 * - allDay: a moved flag whose meeting became all-day (D-18, Adjust hidden).
 */
final readonly class Decision
{
    public const string REASON_MOVED = 'moved';

    public const string REASON_CANCELLED = 'cancelled';

    public const string REASON_REMOVED = 'removed';

    public function __construct(
        public DecisionAction $action,
        public ?string $reason = null,
        public ?string $start = null,
        public ?string $end = null,
        public bool $allDay = false,
    ) {}

    public static function nothing(): self
    {
        return new self(DecisionAction::Nothing);
    }

    public static function clearFlag(): self
    {
        return new self(DecisionAction::ClearFlag);
    }

    public static function release(): self
    {
        return new self(DecisionAction::Release);
    }

    public static function autoAdjust(string $start, string $end): self
    {
        return new self(DecisionAction::AutoAdjust, null, $start, $end);
    }

    public static function resync(string $start, string $end): self
    {
        return new self(DecisionAction::Resync, null, $start, $end);
    }

    public static function flagMoved(string $start, string $end, bool $allDay = false): self
    {
        return new self(DecisionAction::Flag, self::REASON_MOVED, $start, $end, $allDay);
    }

    public static function flagCancelled(): self
    {
        return new self(DecisionAction::Flag, self::REASON_CANCELLED);
    }

    public static function flagRemoved(): self
    {
        return new self(DecisionAction::Flag, self::REASON_REMOVED);
    }
}
