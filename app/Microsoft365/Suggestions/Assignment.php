<?php

declare(strict_types=1);

namespace App\Microsoft365\Suggestions;

use Carbon\CarbonImmutable;

/**
 * The project a recurring meeting comes pre-assigned to: what the user booked on the most recent
 * conversion of the series, read live from that time entry and filtered through the core booking
 * rules (Phase 5 RULE-01, D-02, D-05). Never stored anywhere: it is derived on every read.
 */
final readonly class Assignment
{
    /**
     * @param  list<string>  $tags
     */
    public function __construct(
        public string $projectId,
        public string $projectName,
        public string $projectColor,
        public ?string $clientName,
        public ?string $taskId,
        public ?string $taskName,
        public array $tags,
        public bool $billable,
        public CarbonImmutable $convertedAt,
    ) {}

    /**
     * @return array{project_id: string, project_name: string, project_color: string, client_name: string|null, task_id: string|null, task_name: string|null, tags: list<string>, billable: bool, converted_at: string}
     */
    public function toArray(): array
    {
        return [
            'project_id' => $this->projectId,
            'project_name' => $this->projectName,
            'project_color' => $this->projectColor,
            'client_name' => $this->clientName,
            'task_id' => $this->taskId,
            'task_name' => $this->taskName,
            'tags' => $this->tags,
            'billable' => $this->billable,
            'converted_at' => $this->convertedAt->utc()->format('Y-m-d\TH:i:s\Z'),
        ];
    }
}
