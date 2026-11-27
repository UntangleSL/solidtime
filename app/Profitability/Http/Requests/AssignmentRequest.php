<?php

declare(strict_types=1);

namespace App\Profitability\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Adds one member as project manager of the route project or account manager of the route client
 * (D-10, D-12). The body names the member only: the organization, the project and the client always
 * come from the route, never from the body.
 *
 * Shape only: whether the member is a non-placeholder member of the route organization is checked by
 * AssignmentController after the caller's scope (a 404 for anyone but Owner and Admin comes first).
 */
class AssignmentRequest extends FormRequest
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
            'member_id' => ['required', 'string', 'uuid'],
        ];
    }

    public function memberId(): string
    {
        return (string) $this->validated('member_id');
    }
}
