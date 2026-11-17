<?php

declare(strict_types=1);

namespace App\Microsoft365\Suggestions;

/**
 * Reduces a meeting to the features the learned suggestions match on (RULE-03, D-06): the organizer,
 * external and internal attendees, external domains and subject words.
 *
 * features() returns the readable features of a meeting that is still cached (the target of a read).
 * hashed() turns them into the payload stored on each Outlook meeting link: keyed hashes only
 * (HMAC-SHA256 with the app secret, truncated to 16 lower-hex characters). Why keyed hashes:
 *  - D-09 / D-17: attendee data must not outlive the meeting cache in readable form, while links
 *    survive Disconnect; the Phase 4 link invariant keeps links free of subjects and addresses.
 *  - A plain sha256 of an address is dictionary-reversible; the HMAC key (APP_KEY) prevents that.
 *  - Equality matching is all the scorer needs, so nothing readable is required.
 * The kind prefix ("person|", "domain|", "token|") keeps a subject word from colliding with a domain.
 * Rotating APP_KEY silently resets learning (old hashes stop matching); "v" allows a future re-hash.
 *
 * Pure and static, no state (Octane safe).
 */
final class MeetingSignals
{
    public const int VERSION = 1;

    public const int HASH_LENGTH = 16;

    public const string KIND_PERSON = 'person';

    public const string KIND_DOMAIN = 'domain';

    public const string KIND_TOKEN = 'token';

    /**
     * @param  array{organizer_address: ?string, organizer_name: ?string, is_organizer: bool, attendees: list<array{address: string, name: ?string, type: string}>, attendee_count: ?int, subject: ?string}  $meeting
     * @param  list<string>  $ownAddresses  the user's addresses (users.email and the Microsoft address)
     * @param  list<string>  $internalDomains  the organization's own domains
     * @return array{organizer: ?string, organizer_name: ?string, organizer_internal: bool, external: array<string, ?string>, internal: array<string, ?string>, domains: list<string>, tokens: list<string>, count: int}
     */
    public static function features(array $meeting, array $ownAddresses, array $internalDomains): array
    {
        $own = [];
        foreach ($ownAddresses as $address) {
            $normalized = self::normalizeAddress($address);
            if ($normalized !== null) {
                $own[$normalized] = true;
            }
        }
        $internal = [];
        foreach ($internalDomains as $domain) {
            $internal[strtolower(trim($domain))] = true;
        }

        $organizerAddress = self::normalizeAddress($meeting['organizer_address']);

        $organizer = null;
        $organizerName = null;
        $organizerInternal = false;
        $domains = [];
        // When the user organizes, the organizer is the user and carries no information.
        if (! $meeting['is_organizer'] && $organizerAddress !== null && ! isset($own[$organizerAddress])) {
            $organizer = $organizerAddress;
            $organizerName = self::normalizeName($meeting['organizer_name']);
            $organizerDomain = self::domainOf($organizerAddress);
            $organizerInternal = isset($internal[$organizerDomain]);
            if (! $organizerInternal) {
                $domains[$organizerDomain] = true;
            }
        }

        $externalPeople = [];
        $internalPeople = [];
        foreach ($meeting['attendees'] as $attendee) {
            if (strtolower(trim($attendee['type'])) === 'resource') {
                continue;
            }
            $address = self::normalizeAddress($attendee['address']);
            if ($address === null || isset($own[$address]) || $address === $organizerAddress) {
                continue;
            }
            $name = self::normalizeName($attendee['name']);
            $domain = self::domainOf($address);
            if (isset($internal[$domain])) {
                $internalPeople[$address] = $internalPeople[$address] ?? $name;
            } else {
                $externalPeople[$address] = $externalPeople[$address] ?? $name;
                $domains[$domain] = true;
            }
        }

        return [
            'organizer' => $organizer,
            'organizer_name' => $organizerName,
            'organizer_internal' => $organizerInternal,
            'external' => $externalPeople,
            'internal' => $internalPeople,
            'domains' => array_map(strval(...), array_keys($domains)),
            'tokens' => SubjectTokenizer::tokens($meeting['subject']),
            'count' => $meeting['attendee_count'] ?? count($meeting['attendees']),
        ];
    }

    /**
     * The payload stored on outlook_meeting_links.signals: no address, domain or word is readable.
     *
     * @param  array{organizer: ?string, organizer_name: ?string, organizer_internal: bool, external: array<string, ?string>, internal: array<string, ?string>, domains: list<string>, tokens: list<string>, count: int}  $features
     * @return array{v: int, o: ?string, oi: bool, a: list<string>, i: list<string>, d: list<string>, t: list<string>, n: int}
     */
    public static function hashed(array $features, string $secret): array
    {
        $person = static fn (string|int $address): string => self::hash(self::KIND_PERSON, (string) $address, $secret);

        return [
            'v' => self::VERSION,
            'o' => $features['organizer'] === null ? null : $person($features['organizer']),
            'oi' => $features['organizer_internal'],
            'a' => array_map($person, array_keys($features['external'])),
            'i' => array_map($person, array_keys($features['internal'])),
            'd' => array_map(static fn (string $domain): string => self::hash(self::KIND_DOMAIN, $domain, $secret), $features['domains']),
            't' => array_map(static fn (string $token): string => self::hash(self::KIND_TOKEN, $token, $secret), $features['tokens']),
            'n' => $features['count'],
        ];
    }

    /**
     * Readable labels of a target meeting, keyed by the same hashes, for the suggestion reason: a person
     * hash maps to the display name (or null, never the address), a domain hash to the bare domain.
     *
     * @param  array{organizer: ?string, organizer_name: ?string, organizer_internal: bool, external: array<string, ?string>, internal: array<string, ?string>, domains: list<string>, tokens: list<string>, count: int}  $features
     * @return array<string, ?string>
     */
    public static function labels(array $features, string $secret): array
    {
        $labels = [];
        if ($features['organizer'] !== null) {
            $labels[self::hash(self::KIND_PERSON, $features['organizer'], $secret)] = $features['organizer_name'];
        }
        foreach ($features['external'] + $features['internal'] as $address => $name) {
            $labels[self::hash(self::KIND_PERSON, (string) $address, $secret)] = $name;
        }
        foreach ($features['domains'] as $domain) {
            $labels[self::hash(self::KIND_DOMAIN, $domain, $secret)] = $domain;
        }

        return $labels;
    }

    /**
     * Keyed hash of one feature: 16 lower-hex characters of HMAC-SHA256("kind|value").
     */
    public static function hash(string $kind, string $value, string $secret): string
    {
        return substr(hash_hmac('sha256', $kind.'|'.$value, $secret), 0, self::HASH_LENGTH);
    }

    private static function normalizeAddress(?string $address): ?string
    {
        if ($address === null) {
            return null;
        }
        $address = strtolower(trim($address));
        $at = strrpos($address, '@');
        if ($at === false || $at === 0 || $at === strlen($address) - 1) {
            return null;
        }

        return $address;
    }

    private static function normalizeName(?string $name): ?string
    {
        if ($name === null) {
            return null;
        }
        $name = trim($name);

        return $name === '' ? null : $name;
    }

    private static function domainOf(string $address): string
    {
        return substr($address, (int) strrpos($address, '@') + 1);
    }
}
