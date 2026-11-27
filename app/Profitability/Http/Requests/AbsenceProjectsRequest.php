<?php

declare(strict_types=1);

namespace App\Profitability\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * The full set of absence projects of the organization (D-06, CHRG-02): the body replaces the markers.
 * An empty list unmarks everything. Whether every id is a project of the route organization is the
 * controller's check (422 on project_ids).
 */
class AbsenceProjectsRequest extends FormRequest
{
    /** Largest set: bounds the lookup of one request. */
    public const int MAX_PROJECTS = 50;

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
            'project_ids' => ['present', 'array', 'max:'.self::MAX_PROJECTS],
            'project_ids.*' => ['required', 'string', 'uuid', 'distinct'],
        ];
    }

    /**
     * @return list<string>
     */
    public function projectIds(): array
    {
        $value = $this->validated('project_ids');
        if (! is_array($value)) {
            return [];
        }

        return array_values(array_filter($value, 'is_string'));
    }
}
