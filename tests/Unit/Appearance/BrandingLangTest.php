<?php

declare(strict_types=1);

namespace Tests\Unit\Appearance;

use App\Appearance\AccentPreset;
use Illuminate\Support\Arr;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCase;

/**
 * The Spanish copy is prepared while the app locale stays 'en': the two files must never drift, and
 * the preset names must follow the AccentPreset enum.
 */
#[UsesClass(AccentPreset::class)]
class BrandingLangTest extends TestCase
{
    private const array UI_KEYS = [
        'accent_label',
        'accent_description',
        'accent_default_name',
        'accent_reset',
        'accent_announcement',
        'accent_save_failed_title',
        'accent_save_failed_body',
        'theme_helper',
        'mode_light',
        'mode_dark',
        'icon_label',
        'icon_upload',
        'icon_replace',
        'icon_remove',
        'icon_helper',
        'icon_empty',
        'icon_pending',
        'icon_read_only',
        'icon_error_type',
        'icon_error_size',
        'icon_error_generic',
        'icon_removed',
        'icon_alt',
    ];

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

    public function test_preset_keys_equal_the_accent_preset_values(): void
    {
        foreach (['en', 'es'] as $locale) {
            // Arrange
            $translations = $this->load($locale);
            $presets = $translations['presets'] ?? null;

            // Assert
            $this->assertIsArray($presets);
            $this->assertSame(AccentPreset::values(), array_keys($presets), $locale);
        }
    }

    public function test_every_ui_key_of_the_contract_exists(): void
    {
        foreach (['en', 'es'] as $locale) {
            // Arrange
            $translations = $this->load($locale);
            $ui = $translations['ui'] ?? null;

            // Assert
            $this->assertIsArray($ui);
            $this->assertEqualsCanonicalizing(self::UI_KEYS, array_keys($ui), $locale);
        }
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

    public function test_english_is_the_default_copy(): void
    {
        // Assert
        $this->assertSame('en', config('app.locale'));
        $this->assertSame('Accent color', __('branding.ui.accent_label'));
        $this->assertSame('Color de acento', $this->flatten('es')['ui.accent_label']);
    }

    /**
     * @return array<mixed>
     */
    private function load(string $locale): array
    {
        $translations = require lang_path($locale.'/branding.php');
        $this->assertIsArray($translations);

        return $translations;
    }

    /**
     * @return array<string, mixed>
     */
    private function flatten(string $locale): array
    {
        return Arr::dot($this->load($locale));
    }
}
