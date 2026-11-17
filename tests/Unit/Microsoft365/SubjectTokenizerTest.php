<?php

declare(strict_types=1);

namespace Tests\Unit\Microsoft365;

use App\Microsoft365\Suggestions\SubjectTokenizer;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

#[CoversClass(SubjectTokenizer::class)]
class SubjectTokenizerTest extends TestCase
{
    /**
     * @return array<string, array{0: ?string, 1: list<string>}>
     */
    public static function subjectProvider(): array
    {
        return [
            'spanish weekly with client and quarter' => ['Reunión semanal ACME – Q3', ['acme', 'q3']],
            'english sync with client' => ['Weekly sync with Contoso about the roadmap', ['contoso', 'roadmap']],
            'reply and forward prefixes' => ['RE: FW: Seguimiento proyecto Phoenix', ['proyecto', 'phoenix']],
            'weekday, year and accents' => ['Llamada lunes 2026 diseño', ['diseno']],
            'daily standup' => ['Daily standup', ['standup']],
            'empty subject' => ['', []],
            'blank subject' => ['   ', []],
            'null subject' => [null, []],
            'repeated words appear once' => ['Phoenix phoenix PHOENIX budget Phoenix', ['phoenix', 'budget']],
            'months and calendar words' => ['Planning enero January next week', ['planning']],
            'punctuation splits words' => ['acme/contoso:pricing-model', ['acme', 'contoso', 'pricing', 'model']],
            'short words and digit-only tokens dropped' => ['AI ok 42 2026 a b3x ab3', ['b3x', 'ab3']],
            'two-character letter and digit codes kept' => ['Pricing V2 vs 3D q4', ['pricing', 'v2', '3d', 'q4']],
        ];
    }

    /**
     * @param  list<string>  $expected
     */
    #[DataProvider('subjectProvider')]
    public function test_tokens(?string $subject, array $expected): void
    {
        $this->assertSame($expected, SubjectTokenizer::tokens($subject));
    }

    public function test_a_long_subject_is_capped_at_twelve_tokens(): void
    {
        $words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliett',
            'kilo', 'lima', 'mike', 'november2', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango'];

        $tokens = SubjectTokenizer::tokens(implode(' ', $words));

        $this->assertCount(SubjectTokenizer::MAX_TOKENS, $tokens);
        $this->assertSame(12, SubjectTokenizer::MAX_TOKENS);
        $this->assertSame(array_slice($words, 0, 12), $tokens);
    }
}
