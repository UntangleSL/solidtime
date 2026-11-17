<?php

declare(strict_types=1);

namespace App\Appearance\Http\Requests;

use App\Appearance\AccentPreset;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;
use Illuminate\Validation\Rules\In;
use Illuminate\Validation\Validator;

/**
 * Theme and accent of the signed-in user. Both are allow-listed (the values end up in every page and
 * in a pre-paint script), at least one of the two keys must be sent, and null resets a value. There
 * is no user id field: the controller always writes the session user's row.
 */
class AppearanceUpdateRequest extends FormRequest
{
    /**
     * @var list<string>
     */
    public const array THEMES = ['system', 'light', 'dark'];

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, string|In|Enum>>
     */
    public function rules(): array
    {
        return [
            'theme' => [
                'sometimes',
                'nullable',
                'string',
                Rule::in(self::THEMES),
            ],
            'accent' => [
                'sometimes',
                'nullable',
                'string',
                Rule::enum(AccentPreset::class),
            ],
        ];
    }

    /**
     * An empty body is rejected. `required_without` is not used on purpose: it would also reject an
     * explicit null, and null is how a single value is reset while the other one is kept.
     *
     * @return array<int, callable(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                if (! $this->has('theme') && ! $this->has('accent')) {
                    $validator->errors()->add('theme', __('validation.required_without', [
                        'attribute' => 'theme',
                        'values' => 'accent',
                    ]));
                }
            },
        ];
    }
}
