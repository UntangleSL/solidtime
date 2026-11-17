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
     * Spanish and English function words, meeting noise and calendar words, keyed by the ascii-folded
     * word. The list is a judgement call and tunable (RESEARCH A6): add a word when owner UAT shows it
     * matching unrelated meetings. Words under three characters are dropped anyway; the short reply
     * prefixes are listed for clarity.
     *
     * @var array<string, bool>
     */
    private const array STOP_WORDS = [
        // English function words
        'the' => true, 'and' => true, 'for' => true, 'with' => true, 'from' => true, 'this' => true,
        'that' => true, 'these' => true, 'those' => true, 'about' => true, 'into' => true, 'over' => true,
        'our' => true, 'ours' => true, 'your' => true, 'yours' => true, 'are' => true, 'was' => true,
        'were' => true, 'will' => true, 'can' => true, 'has' => true, 'have' => true, 'had' => true,
        'not' => true, 'but' => true, 'all' => true, 'any' => true, 'its' => true, 'his' => true,
        'her' => true, 'she' => true, 'him' => true, 'they' => true, 'them' => true, 'their' => true,
        'you' => true, 'who' => true, 'what' => true, 'when' => true, 'where' => true, 'why' => true,
        'how' => true, 'which' => true, 'then' => true, 'than' => true, 'also' => true, 'just' => true,
        'only' => true, 'out' => true, 'off' => true, 'per' => true, 'via' => true, 'upon' => true,
        'onto' => true, 'under' => true, 'after' => true, 'before' => true, 'between' => true,
        'through' => true, 'during' => true, 'again' => true, 'more' => true, 'most' => true,
        'some' => true, 'such' => true, 'very' => true, 'there' => true, 'here' => true, 'been' => true,
        'being' => true, 'would' => true, 'should' => true, 'could' => true, 'must' => true,
        'shall' => true, 'does' => true, 'did' => true, 'done' => true, 'let' => true, 'lets' => true,
        'get' => true, 'new' => true, 'next' => true, 'other' => true, 'each' => true, 'both' => true,
        'few' => true, 'own' => true, 'same' => true, 'too' => true, 'now' => true, 'yet' => true,
        'one' => true, 'two' => true, 'three' => true, 'without' => true, 'within' => true,
        'around' => true, 'regarding' => true,
        // Spanish function words
        'los' => true, 'las' => true, 'del' => true, 'para' => true, 'con' => true, 'por' => true,
        'una' => true, 'uno' => true, 'unos' => true, 'unas' => true, 'que' => true, 'sobre' => true,
        'este' => true, 'esta' => true, 'estos' => true, 'estas' => true, 'ese' => true, 'esa' => true,
        'esos' => true, 'esas' => true, 'nuestro' => true, 'nuestra' => true, 'nuestros' => true,
        'nuestras' => true, 'vuestro' => true, 'vuestra' => true, 'entre' => true, 'tras' => true,
        'sin' => true, 'mas' => true, 'pero' => true, 'como' => true, 'cuando' => true, 'donde' => true,
        'desde' => true, 'hasta' => true, 'hacia' => true, 'contra' => true, 'segun' => true,
        'durante' => true, 'mediante' => true, 'ante' => true, 'bajo' => true, 'muy' => true,
        'tambien' => true, 'sus' => true, 'les' => true, 'nos' => true, 'ella' => true, 'ellos' => true,
        'ellas' => true, 'usted' => true, 'ustedes' => true, 'son' => true, 'ser' => true, 'estar' => true,
        'hay' => true, 'fue' => true, 'han' => true, 'hemos' => true, 'era' => true, 'sera' => true,
        'todo' => true, 'toda' => true, 'todos' => true, 'todas' => true, 'otro' => true, 'otra' => true,
        'otros' => true, 'otras' => true, 'cual' => true, 'cuales' => true, 'quien' => true,
        'porque' => true, 'pues' => true, 'aqui' => true, 'ahora' => true, 'antes' => true,
        'despues' => true, 'luego' => true, 'cada' => true, 'mismo' => true, 'misma' => true,
        'solo' => true, 'sino' => true, 'algo' => true, 'nada' => true,
        // Meeting noise and reply prefixes
        'meeting' => true, 'meetings' => true, 'meet' => true, 'call' => true, 'calls' => true,
        'sync' => true, 'catch' => true, 'catchup' => true, 'weekly' => true, 'daily' => true,
        'monthly' => true, 'biweekly' => true, 'quarterly' => true, 'review' => true, 'update' => true,
        'updates' => true, 'updated' => true, 'follow' => true, 'followup' => true, 'reunion' => true,
        'reuniones' => true, 'llamada' => true, 'llamadas' => true, 'videollamada' => true,
        'semanal' => true, 'diaria' => true, 'diario' => true, 'mensual' => true, 'quincenal' => true,
        'trimestral' => true, 'seguimiento' => true, 'revision' => true, 'punto' => true, 'puntos' => true,
        'teams' => true, 'zoom' => true, 'online' => true, 'invite' => true, 'invitation' => true,
        'invitacion' => true, 'accepted' => true, 'aceptado' => true, 'aceptada' => true,
        'canceled' => true, 'cancelled' => true, 'cancelado' => true, 'cancelada' => true,
        'tentative' => true, 'declined' => true, 'rechazado' => true, 'actualizado' => true,
        'actualizacion' => true, 'recurring' => true, 'session' => true, 'sesion' => true,
        're' => true, 'fw' => true, 'fwd' => true, 'rv' => true,
        // Calendar words (English and Spanish, ascii-folded)
        'monday' => true, 'tuesday' => true, 'wednesday' => true, 'thursday' => true, 'friday' => true,
        'saturday' => true, 'sunday' => true, 'mon' => true, 'tue' => true, 'wed' => true, 'thu' => true,
        'fri' => true, 'sat' => true, 'sun' => true, 'january' => true, 'february' => true,
        'march' => true, 'april' => true, 'may' => true, 'june' => true, 'july' => true, 'august' => true,
        'september' => true, 'october' => true, 'november' => true, 'december' => true, 'jan' => true,
        'feb' => true, 'mar' => true, 'apr' => true, 'jun' => true, 'jul' => true, 'aug' => true,
        'sep' => true, 'sept' => true, 'oct' => true, 'nov' => true, 'dec' => true, 'today' => true,
        'tomorrow' => true, 'week' => true, 'month' => true, 'year' => true, 'lunes' => true,
        'martes' => true, 'miercoles' => true, 'jueves' => true, 'viernes' => true, 'sabado' => true,
        'domingo' => true, 'enero' => true, 'febrero' => true, 'marzo' => true, 'abril' => true,
        'mayo' => true, 'junio' => true, 'julio' => true, 'agosto' => true, 'septiembre' => true,
        'setiembre' => true, 'octubre' => true, 'noviembre' => true, 'diciembre' => true, 'ene' => true,
        'abr' => true, 'ago' => true, 'dic' => true, 'hoy' => true, 'manana' => true, 'semana' => true,
        'mes' => true, 'ano' => true,
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
            if (! self::meaningful($word)) {
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

    /**
     * Words under three characters are dropped, except two-character codes mixing a letter and a digit
     * ("q3", "v2"), which name a quarter or a version and are worth matching. Digit-only tokens (years,
     * times, counts) and stop words are dropped.
     */
    private static function meaningful(string $word): bool
    {
        if ($word === '' || ctype_digit($word) || isset(self::STOP_WORDS[$word])) {
            return false;
        }
        if (strlen($word) >= self::MIN_LENGTH) {
            return true;
        }

        return strlen($word) === 2 && preg_match('/^(?:[a-z][0-9]|[0-9][a-z])$/', $word) === 1;
    }
}
