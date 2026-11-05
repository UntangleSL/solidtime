<?php

declare(strict_types=1);

namespace App\Microsoft365\Http\Requests;

use Carbon\CarbonImmutable;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

/**
 * The visible range of the calendar, always as UTC instants. There is no user id field: both meetings
 * endpoints only ever answer for the session user (CAL-03, D-16).
 */
class MeetingRangeRequest extends FormRequest
{
    public const string FORMAT = 'Y-m-d\TH:i:s\Z';

    /** Longest range a client may ask for: bounds the Graph traversal and the cache read (T-03-35). */
    public const int MAX_DAYS = 35;

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, string>>
     */
    public function rules(): array
    {
        return [
            'start' => ['required', 'string', 'date_format:'.self::FORMAT],
            'end' => ['required', 'string', 'date_format:'.self::FORMAT, 'after:start'],
            // The Sync button: skips the 60 s reuse window, never the 10 s minimum interval
            'force' => ['sometimes', 'boolean'],
        ];
    }

    /**
     * @return array<int, callable(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                if ($validator->errors()->isNotEmpty()) {
                    return;
                }
                if ($this->rangeEnd() > $this->rangeStart()->addDays(self::MAX_DAYS)) {
                    $validator->errors()->add('end', 'The range must not be longer than '.self::MAX_DAYS.' days.');
                }
            },
        ];
    }

    public function force(): bool
    {
        return $this->boolean('force');
    }

    public function rangeStart(): CarbonImmutable
    {
        return $this->parse('start');
    }

    public function rangeEnd(): CarbonImmutable
    {
        return $this->parse('end');
    }

    private function parse(string $key): CarbonImmutable
    {
        $value = $this->validated($key);
        assert(is_string($value));

        return CarbonImmutable::createFromFormat(self::FORMAT, $value, 'UTC') ?? throw new \LogicException('Range was validated');
    }
}
