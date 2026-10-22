<?php

declare(strict_types=1);

namespace Tests\Unit\Microsoft365;

use Illuminate\Support\Arr;
use Tests\TestCase;

/**
 * The Spanish copy is prepared while the app locale stays 'en' (D-18): the two files must never drift.
 */
class MicrosoftLangTest extends TestCase
{
    public function test_english_and_spanish_files_have_exactly_the_same_nested_keys(): void
    {
        // Arrange
        $english = $this->flatten('en');
        $spanish = $this->flatten('es');

        // Act
        $missingInSpanish = array_values(array_diff(array_keys($english), array_keys($spanish)));
        $missingInEnglish = array_values(array_diff(array_keys($spanish), array_keys($english)));

        // Assert
        $this->assertSame([], $missingInSpanish);
        $this->assertSame([], $missingInEnglish);
        $this->assertNotEmpty($english);
    }

    public function test_no_value_is_empty_in_either_language(): void
    {
        foreach (['en', 'es'] as $locale) {
            foreach ($this->flatten($locale) as $key => $value) {
                $this->assertIsString($value, sprintf('%s.%s must be a string', $locale, $key));
                $this->assertNotSame('', trim($value), sprintf('%s.%s must not be empty', $locale, $key));
            }
        }
    }

    public function test_english_is_the_default_copy_and_spanish_is_prepared(): void
    {
        // Arrange
        $english = $this->flatten('en');
        $spanish = $this->flatten('es');

        // Assert
        $this->assertSame('Sign in with Microsoft', $english['ui.sign_in']);
        $this->assertSame('Iniciar sesión con Microsoft', $spanish['ui.sign_in']);
        $this->assertSame('en', config('app.locale'));
    }

    public function test_placeholders_match_between_languages(): void
    {
        // Arrange
        $english = $this->flatten('en');
        $spanish = $this->flatten('es');

        foreach ($english as $key => $value) {
            // Act
            preg_match_all('/:[a-z_]+/', (string) $value, $englishPlaceholders);
            preg_match_all('/:[a-z_]+/', (string) $spanish[$key], $spanishPlaceholders);

            // Assert
            $this->assertEqualsCanonicalizing($englishPlaceholders[0], $spanishPlaceholders[0], $key);
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function flatten(string $locale): array
    {
        $translations = require lang_path($locale.'/microsoft365.php');
        $this->assertIsArray($translations);

        return Arr::dot($translations);
    }
}
