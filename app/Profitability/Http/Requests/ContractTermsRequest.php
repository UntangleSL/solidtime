<?php

declare(strict_types=1);

namespace App\Profitability\Http\Requests;

use App\Profitability\Enums\ContractSchedule;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;
use Illuminate\Validation\Rules\In;
use InvalidArgumentException;

/**
 * The contract terms of one project (BUDG-01, D-01, D-12): service, schedule, dates and what is sold per
 * period in hours (seconds) and money (cents). The body never names an organization, a project or a
 * user: both ids come from the route (T-08-15), and who may write is the controller's scope check.
 *
 * Dates are local calendar dates (Y-m-d) bounded to this century, and every number has an upper bound,
 * so a request cannot make the materializer create an unbounded number of rows (T-08-13).
 */
class ContractTermsRequest extends FormRequest
{
    public const int MAX_SECONDS = 3600000000;

    public const int MAX_CENTS = 100000000000;

    public const string APPLY_CURRENT_AND_FOLLOWING = 'current_and_following';

    public const string APPLY_NEXT_PERIOD = 'next_period';

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, string|ValidationRule|Enum|In>>
     */
    public function rules(): array
    {
        $date = ['date_format:Y-m-d', 'after_or_equal:2000-01-01', 'before_or_equal:2099-12-31'];

        return [
            'service' => ['nullable', 'string', 'max:255'],
            'schedule' => ['required', 'string', Rule::enum(ContractSchedule::class)],
            'starts_on' => ['required', ...$date],
            'ends_on' => ['nullable', 'required_if:schedule,'.ContractSchedule::OneOff->value, ...$date, 'after:starts_on'],
            'budget_seconds' => ['required', 'integer', 'min:0', 'max:'.self::MAX_SECONDS],
            'amount_cents' => ['required', 'integer', 'min:0', 'max:'.self::MAX_CENTS],
            // Overrides of the prorated stub first period (D-15)
            'first_period_budget_seconds' => ['nullable', 'integer', 'min:0', 'max:'.self::MAX_SECONDS],
            'first_period_amount_cents' => ['nullable', 'integer', 'min:0', 'max:'.self::MAX_CENTS],
            // Which periods an edit of a started contract changes (UI-D9, used by the edit flow)
            'apply_to' => ['nullable', 'string', Rule::in([self::APPLY_CURRENT_AND_FOLLOWING, self::APPLY_NEXT_PERIOD])],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'ends_on.required_if' => self::label('profitability.validation.one_off_needs_end'),
            'ends_on.after' => self::label('profitability.validation.end_before_start'),
        ];
    }

    public function service(): ?string
    {
        $value = $this->validated('service');

        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }

    public function schedule(): ContractSchedule
    {
        return ContractSchedule::from((string) $this->validated('schedule'));
    }

    public function startsOn(): CarbonImmutable
    {
        return self::localDate((string) $this->validated('starts_on'));
    }

    public function endsOn(): ?CarbonImmutable
    {
        $value = $this->validated('ends_on');

        return is_string($value) ? self::localDate($value) : null;
    }

    public function budgetSeconds(): int
    {
        return (int) $this->validated('budget_seconds');
    }

    public function amountCents(): int
    {
        return (int) $this->validated('amount_cents');
    }

    public function firstPeriodBudgetSeconds(): ?int
    {
        $value = $this->validated('first_period_budget_seconds');

        return $value === null ? null : (int) $value;
    }

    public function firstPeriodAmountCents(): ?int
    {
        $value = $this->validated('first_period_amount_cents');

        return $value === null ? null : (int) $value;
    }

    public function applyTo(): ?string
    {
        $value = $this->validated('apply_to');

        return is_string($value) ? $value : null;
    }

    private static function localDate(string $value): CarbonImmutable
    {
        return CarbonImmutable::createFromFormat('!Y-m-d', $value, 'UTC')
            ?: throw new InvalidArgumentException('Invalid date.');
    }

    private static function label(string $key): string
    {
        $value = __($key);

        return is_string($value) ? $value : $key;
    }
}
