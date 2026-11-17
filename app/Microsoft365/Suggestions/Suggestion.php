<?php

declare(strict_types=1);

namespace App\Microsoft365\Suggestions;

/**
 * One ranked project for a meeting (RULE-03, D-07). The score stays on the server: toArray() omits it,
 * the client only learns the order, whether the first one is confident and the reason.
 */
final readonly class Suggestion
{
    public function __construct(
        public string $projectId,
        public float $score,
        public bool $confident,
        public Reason $reason,
    ) {}

    /**
     * @return array{project_id: string, confident: bool, reason: array{kind: string, count: int, value: ?string}}
     */
    public function toArray(): array
    {
        return [
            'project_id' => $this->projectId,
            'confident' => $this->confident,
            'reason' => $this->reason->toArray(),
        ];
    }
}
