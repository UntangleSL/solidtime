<?php

declare(strict_types=1);

namespace App\Profitability\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * A new dated hourly cost of one member (D-08, BUDG-05). The body carries the date and the cost only:
 * the member comes from the route and is looked up inside the route organization, the organization is
 * never read from input. Who may write it (Owner and Admin) is the controller's scope check.
 */
class CostRateRequest extends FormRequest
{
    /** Upper bound of an hourly cost in cents (one million per hour): rejects typos, never a real value. */
    public const int MAX_HOURLY_COST_CENTS = 100000000;

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
            'hourly_cost_cents' => ['required', 'integer', 'min:0', 'max:'.self::MAX_HOURLY_COST_CENTS],
        ];
    }

    public function effectiveFrom(): string
    {
        return (string) $this->validated('effective_from');
    }

    public function hourlyCostCents(): int
    {
        return (int) $this->validated('hourly_cost_cents');
    }
}
