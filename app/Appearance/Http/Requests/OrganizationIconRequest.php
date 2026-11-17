<?php

declare(strict_types=1);

namespace App\Appearance\Http\Requests;

use App\Models\Organization;
use App\Rules\Base64ImageRule;
use App\Support\Base64File;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * A new organization icon as a base64 string or data URL. The core profile-photo rule is reused
 * unchanged: PNG or JPEG detected from the content (never from the data URL prefix), at most 1 MiB
 * decoded, so SVG and GIF can never get through. On top of that the image must parse and measure
 * between 32 and 1024 pixels on each side. Authorization happens in the controller.
 *
 * @property Organization $organization
 */
class OrganizationIconRequest extends FormRequest
{
    public const int MIN_SIDE = 32;

    public const int MAX_SIDE = 1024;

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, string|Base64ImageRule>>
     */
    public function rules(): array
    {
        return [
            'icon' => [
                'required',
                'string',
                new Base64ImageRule,
            ],
        ];
    }

    /**
     * Runs only when the rules above passed, so the value is a decodable PNG or JPEG of at most 1 MiB.
     *
     * @return array<int, callable(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                if ($validator->errors()->has('icon')) {
                    return;
                }

                $icon = $this->input('icon');
                $decoded = is_string($icon) ? Base64File::decode($icon) : null;
                $size = $decoded !== null ? @getimagesizefromstring($decoded['data']) : false;
                if ($size === false
                    || $size[0] < self::MIN_SIDE || $size[0] > self::MAX_SIDE
                    || $size[1] < self::MIN_SIDE || $size[1] > self::MAX_SIDE) {
                    $validator->errors()->add('icon', __('branding.validation.icon_dimensions'));
                }
            },
        ];
    }

    /**
     * The decoded icon (only valid after validation passed).
     *
     * @return array{data: string, mime_type: string}
     */
    public function getIcon(): array
    {
        $icon = $this->input('icon');
        $decoded = is_string($icon) ? Base64File::decode($icon) : null;
        assert($decoded !== null);

        return $decoded;
    }
}
