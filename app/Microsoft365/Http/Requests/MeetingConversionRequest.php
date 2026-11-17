<?php

declare(strict_types=1);

namespace App\Microsoft365\Http\Requests;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\ProhibitedIf;
use Illuminate\Validation\Rules\RequiredIf;

/**
 * Turns one or several of the session user's Outlook meetings into time entries (Phase 4). The body
 * names meetings, never a user or a member: the owner of the entries is always the session user's
 * member in the route organization, and the meeting subject is read on the server (D-13).
 *
 * Explicit mode: the body carries the project, task, tags and billable. Single mode (exactly one id)
 * may also carry the description and custom start/end of the mini form (D-03). With several ids every
 * meeting keeps its own time and subject (D-07).
 *
 * Confirm mode (Phase 5 RULE-02, D-03, D-04): `use_series_assignment: true` with meeting ids only. The
 * server resolves each meeting's series assignment at confirm time, so the body may not carry a
 * project, task, tags, billable, description, times or prefill fields (T-05-15).
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
     * @return array<string, array<int, string|Closure|ValidationRule|ProhibitedIf|RequiredIf>>
     */
    public function rules(): array
    {
        $several = fn (): bool => is_array($this->input('meeting_ids')) && count($this->input('meeting_ids')) > 1;
        $series = fn (): bool => $this->boolean('use_series_assignment');
        $explicit = fn (): bool => ! $series();

        return [
            'meeting_ids' => ['required', 'array', 'min:1', 'max:'.self::MAX_MEETINGS],
            'meeting_ids.*' => ['required', 'string', 'uuid', 'distinct'],
            // Confirm mode: the server picks every entry field from the series (RULE-02)
            'use_series_assignment' => ['sometimes', 'boolean'],
            // A project is required (D-02); whether the user may book on it is core's check
            'project_id' => [Rule::requiredIf($explicit), Rule::prohibitedIf($series), 'string', 'uuid'],
            'task_id' => ['nullable', 'string', 'uuid', Rule::prohibitedIf($series)],
            'tags' => ['sometimes', 'nullable', 'array', Rule::prohibitedIf($series)],
            'tags.*' => ['string', 'uuid'],
            'billable' => [Rule::requiredIf($explicit), Rule::prohibitedIf($series), 'boolean'],
            // Single mode only: several meetings each take their own subject
            'description' => ['nullable', 'string', 'max:5000', Rule::prohibitedIf($several), Rule::prohibitedIf($series)],
            // Single mode only, both or neither; an end is always sent so no running timer is ever started
            'start' => ['nullable', 'string', 'date_format:'.self::FORMAT, 'required_with:end', Rule::prohibitedIf($several), Rule::prohibitedIf($series)],
            'end' => ['nullable', 'string', 'date_format:'.self::FORMAT, 'required_with:start', 'after:start', Rule::prohibitedIf($several), Rule::prohibitedIf($series)],
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

    /**
     * Confirm mode: each meeting takes its series' current assignment, resolved on the server.
     */
    public function usesSeriesAssignment(): bool
    {
        return $this->boolean('use_series_assignment');
    }

    /**
     * The project of the explicit mode (never read in confirm mode).
     */
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
