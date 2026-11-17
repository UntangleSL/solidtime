<?php

declare(strict_types=1);

namespace App\Microsoft365\Suggestions;

use Illuminate\Support\Str;

/**
 * Reduces a meeting subject to a few meaningful words for the learned suggestions (RULE-03, D-06).
 * Pure: lower-case, accent-fold, split on anything that is not a letter or digit, then drop short,
 * digit-only and stop words, dedupe and cap. The words never leave the server in readable form: the
 * stored signals hold keyed hashes of them (MeetingSignals).
 */
final class SubjectTokenizer
{
    public const int MAX_TOKENS = 12;

    private const int MIN_LENGTH = 3;

    /**
     * Spanish and English function words plus meeting noise, keyed by the ascii-folded word.
     *
     * @var array<string, true>
     */
    private const array STOP_WORDS = [
        'the' => true, 'and' => true, 'for' => true, 'with' => true, 'from' => true,
        'reunion' => true, 'semanal' => true, 'meeting' => true, 'weekly' => true, 'sync' => true,
        'seguimiento' => true, 'llamada' => true, 'daily' => true, 'about' => true,
    ];

    /**
     * @return list<string>
     */
    public static function tokens(?string $subject): array
    {
        if ($subject === null || trim($subject) === '') {
            return [];
        }

        $normalized = preg_replace('/[^a-z0-9]+/', ' ', Str::ascii(Str::lower($subject))) ?? '';

        $tokens = [];
        foreach (explode(' ', $normalized) as $word) {
            if (strlen($word) < self::MIN_LENGTH || ctype_digit($word) || isset(self::STOP_WORDS[$word])) {
                continue;
            }
            if (in_array($word, $tokens, true)) {
                continue;
            }
            $tokens[] = $word;
            if (count($tokens) === self::MAX_TOKENS) {
                break;
            }
        }

        return $tokens;
    }
}
