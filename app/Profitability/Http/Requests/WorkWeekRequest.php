<?php

declare(strict_types=1);

namespace App\Profitability\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * A new dated working week with its chargeability target for one member (D-13, CHRG-01). The member
 * comes from the route and is looked up inside the route organization; who may write it (Owner and
 * Admin) is the controller's scope check.
 */
class WorkWeekRequest extends FormRequest
{
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
            'effective_from' => ['required', 'string', 'date_format:Y-m-d'],
            // 0 to 168 hours a week, in seconds
            'weekly_seconds' => ['required', 'integer', 'min:0', 'max:604800'],
            'target_percent' => ['required', 'integer', 'min:0', 'max:100'],
        ];
    }

    public function effectiveFrom(): string
    {
        return (string) $this->validated('effective_from');
    }

    public function weeklySeconds(): int
    {
        return (int) $this->validated('weekly_seconds');
    }

    public function targetPercent(): int
    {
        return (int) $this->validated('target_percent');
    }
}
