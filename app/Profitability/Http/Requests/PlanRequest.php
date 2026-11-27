<?php

declare(strict_types=1);

namespace App\Profitability\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * The monthly plan of one contract period (BUDG-04, D-02): the planned hours (seconds) of each month.
 * The body never names an organization, a project or a period: they come from the route, and who may
 * write is the controller's scope check (canEditPlan), which runs before this request is resolved.
 *
 * Whether the months are exactly the period's months, and whether they add up to the period's hours,
 * is checked by the controller against the stored period.
 */
class PlanRequest extends FormRequest
{
    public const int MAX_SECONDS = ContractTermsRequest::MAX_SECONDS;

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, string|ValidationRule>>
     */
    public function rules(): array
    {
        return [
            'months' => ['required', 'array', 'min:1', 'max:12'],
            'months.*' => ['required', 'array:month,planned_seconds'],
            'months.*.month' => ['required', 'string', 'date_format:Y-m-d', 'distinct'],
            'months.*.planned_seconds' => ['required', 'integer', 'min:0', 'max:'.self::MAX_SECONDS],
        ];
    }

    /**
     * The planned seconds keyed by month (Y-m-d), in the order sent.
     *
     * @return array<string, int>
     */
    public function plannedByMonth(): array
    {
        $months = $this->validated('months');
        $planned = [];
        if (! is_array($months)) {
            return $planned;
        }
        foreach ($months as $row) {
            if (! is_array($row) || ! is_string($row['month'] ?? null)) {
                continue;
            }
            $seconds = $row['planned_seconds'] ?? null;
            $planned[$row['month']] = is_numeric($seconds) ? (int) $seconds : 0;
        }

        return $planned;
    }
}
