<?php

declare(strict_types=1);

namespace App\Microsoft365\Suggestions;

/**
 * Why a project was suggested (D-06): the single strongest feature the target meeting shares with the
 * user's past conversions of that project. The value is readable text taken from the target meeting
 * itself (a display name or a bare domain), never a full address; subject reasons carry no value.
 */
final readonly class Reason
{
    public const string KIND_ORGANIZER = 'organizer';

    public const string KIND_PERSON = 'person';

    public const string KIND_DOMAIN = 'domain';

    public const string KIND_SUBJECT = 'subject';

    /**
     * @param  'domain'|'person'|'organizer'|'subject'  $kind
     * @param  int  $count  past conversions of the project sharing the feature
     */
    public function __construct(
        public string $kind,
        public int $count,
        public ?string $value,
    ) {}

    /**
     * @return array{kind: string, count: int, value: ?string}
     */
    public function toArray(): array
    {
        return [
            'kind' => $this->kind,
            'count' => $this->count,
            'value' => $this->value,
        ];
    }
}
