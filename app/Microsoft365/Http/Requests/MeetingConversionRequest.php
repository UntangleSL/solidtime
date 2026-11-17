<?php

declare(strict_types=1);

namespace App\Microsoft365\Http\Requests;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\ProhibitedIf;

/**
 * Turns one or several of the session user's Outlook meetings into time entries (Phase 4). The body
 * names meetings, never a user or a member: the owner of the entries is always the session user's
 * member in the route organization, and the meeting subject is read on the server (D-13).
 *
 * Single mode (exactly one id) may also carry the description and custom start/end of the mini form
 * (D-03). With several ids every meeting keeps its own time and subject (D-07).
 */
class MeetingConversionRequest extends FormRequest
{
    public const string FORMAT = 'Y-m-d\TH:i:s\Z';

    /** Largest batch: bounds the per-meeting core calls of one request (T-04-05). */
    public const int MAX_MEETINGS = 50;

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, string|Closure|ValidationRule|ProhibitedIf>>
     */
    public function rules(): array
    {
        $several = fn (): bool => is_array($this->input('meeting_ids')) && count($this->input('meeting_ids')) > 1;

        return [
            'meeting_ids' => ['required', 'array', 'min:1', 'max:'.self::MAX_MEETINGS],
            'meeting_ids.*' => ['required', 'string', 'uuid', 'distinct'],
            // A project is required (D-02); whether the user may book on it is core's check
            'project_id' => ['required', 'string', 'uuid'],
            'task_id' => ['nullable', 'string', 'uuid'],
            'tags' => ['sometimes', 'nullable', 'array'],
            'tags.*' => ['string', 'uuid'],
            'billable' => ['required', 'boolean'],
            // Single mode only: several meetings each take their own subject
            'description' => ['nullable', 'string', 'max:5000', Rule::prohibitedIf($several)],
            // Single mode only, both or neither; an end is always sent so no running timer is ever started
            'start' => ['nullable', 'string', 'date_format:'.self::FORMAT, 'required_with:end', Rule::prohibitedIf($several)],
            'end' => ['nullable', 'string', 'date_format:'.self::FORMAT, 'required_with:start', 'after:start', Rule::prohibitedIf($several)],
        ];
    }

    /**
     * @return list<string>
     */
    public function meetingIds(): array
    {
        /** @var array<int, string> $ids */
        $ids = $this->validated('meeting_ids');

        return array_values($ids);
    }

    public function isSingle(): bool
    {
        return count($this->meetingIds()) === 1;
    }

    public function projectId(): string
    {
        return (string) $this->validated('project_id');
    }

    public function taskId(): ?string
    {
        $value = $this->validated('task_id');

        return is_string($value) ? $value : null;
    }

    /**
     * @return list<string>
     */
    public function tags(): array
    {
        $value = $this->validated('tags');
        if (! is_array($value)) {
            return [];
        }

        return array_values(array_filter($value, 'is_string'));
    }

    public function billable(): bool
    {
        return $this->boolean('billable');
    }

    /**
     * The description typed in the single-mode form, or null to use the meeting subject.
     */
    public function description(): ?string
    {
        $value = $this->validated('description');

        return is_string($value) ? $value : null;
    }

    /**
     * @return array{start: string, end: string}|null
     */
    public function customTimes(): ?array
    {
        $start = $this->validated('start');
        $end = $this->validated('end');
        if (! is_string($start) || ! is_string($end)) {
            return null;
        }

        return ['start' => $start, 'end' => $end];
    }
}
