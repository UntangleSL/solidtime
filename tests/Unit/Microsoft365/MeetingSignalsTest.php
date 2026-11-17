<?php

declare(strict_types=1);

namespace Tests\Unit\Microsoft365;

use App\Microsoft365\Suggestions\MeetingSignals;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

#[CoversClass(MeetingSignals::class)]
class MeetingSignalsTest extends TestCase
{
    private const string SECRET = 'test-secret';

    /** @var list<string> */
    private const array OWN = ['Me@Untangle.es', 'juan.m365@untanglegrowth.com'];

    /** @var list<string> */
    private const array INTERNAL = ['untangle.es', 'untanglegrowth.com'];

    /**
     * @param  list<array{address: string, name: ?string, type: string}>  $attendees
     * @return array{organizer_address: ?string, organizer_name: ?string, is_organizer: bool, attendees: list<array{address: string, name: ?string, type: string}>, attendee_count: ?int, subject: ?string}
     */
    private function meeting(array $attendees, ?string $organizer = 'me@untangle.es', bool $isOrganizer = true, ?string $organizerName = 'Me', ?int $count = null, ?string $subject = 'Kickoff ACME'): array
    {
        return [
            'organizer_address' => $organizer,
            'organizer_name' => $organizerName,
            'is_organizer' => $isOrganizer,
            'attendees' => $attendees,
            'attendee_count' => $count,
            'subject' => $subject,
        ];
    }

    /**
     * @return array{address: string, name: ?string, type: string}
     */
    private function attendee(string $address, ?string $name = null, string $type = 'required'): array
    {
        return ['address' => $address, 'name' => $name, 'type' => $type];
    }

    public function test_own_addresses_never_appear_in_any_case(): void
    {
        $features = MeetingSignals::features($this->meeting([
            $this->attendee('ME@untangle.es', 'Me'),
            $this->attendee('Juan.M365@UntangleGrowth.com', 'Me again'),
            $this->attendee('eva@client.test', 'Eva'),
        ], organizer: 'JUAN.M365@untanglegrowth.com', isOrganizer: false), self::OWN, self::INTERNAL);

        $this->assertNull($features['organizer']);
        $this->assertSame(['eva@client.test' => 'Eva'], $features['external']);
        $this->assertSame([], $features['internal']);
        $encoded = (string) json_encode($features);
        $this->assertStringNotContainsStringIgnoringCase('me@untangle.es', $encoded);
        $this->assertStringNotContainsStringIgnoringCase('juan.m365', $encoded);
    }

    public function test_the_organizer_appears_only_when_the_user_does_not_organize(): void
    {
        $byUser = MeetingSignals::features($this->meeting([$this->attendee('eva@client.test', 'Eva')]), self::OWN, self::INTERNAL);
        $this->assertNull($byUser['organizer']);
        $this->assertNull($byUser['organizer_name']);
        $this->assertFalse($byUser['organizer_internal']);

        $byClient = MeetingSignals::features($this->meeting([
            $this->attendee('Ana@Client.test', 'Ana'),
            $this->attendee('eva@client.test', 'Eva'),
            $this->attendee('me@untangle.es', 'Me'),
        ], organizer: 'ana@client.test', isOrganizer: false, organizerName: 'Ana'), self::OWN, self::INTERNAL);

        $this->assertSame('ana@client.test', $byClient['organizer']);
        $this->assertSame('Ana', $byClient['organizer_name']);
        $this->assertFalse($byClient['organizer_internal']);
        // never repeated among the attendees
        $this->assertSame(['eva@client.test' => 'Eva'], $byClient['external']);
        $this->assertSame(['client.test'], $byClient['domains']);
    }

    public function test_an_internal_organizer_is_flagged_and_its_domain_is_not_a_feature(): void
    {
        $features = MeetingSignals::features($this->meeting([
            $this->attendee('marta@untangle.es', 'Marta'),
        ], organizer: 'boss@untanglegrowth.com', isOrganizer: false, organizerName: 'Boss'), self::OWN, self::INTERNAL);

        $this->assertSame('boss@untanglegrowth.com', $features['organizer']);
        $this->assertTrue($features['organizer_internal']);
        $this->assertSame([], $features['domains']);
        $this->assertSame(['marta@untangle.es' => 'Marta'], $features['internal']);
    }

    public function test_colleagues_are_internal_clients_external_and_domains_distinct(): void
    {
        $features = MeetingSignals::features($this->meeting([
            $this->attendee('marta@untangle.es', 'Marta'),
            $this->attendee('eva@client.test', 'Eva'),
            $this->attendee('luis@client.test', null),
            $this->attendee('kim@partner.test', 'Kim', 'optional'),
        ]), self::OWN, self::INTERNAL);

        $this->assertSame(['marta@untangle.es' => 'Marta'], $features['internal']);
        $this->assertSame(['eva@client.test' => 'Eva', 'luis@client.test' => null, 'kim@partner.test' => 'Kim'], $features['external']);
        $this->assertSame(['client.test', 'partner.test'], $features['domains']);
        $this->assertSame(['kickoff', 'acme'], $features['tokens']);
    }

    public function test_resource_attendees_are_ignored(): void
    {
        $features = MeetingSignals::features($this->meeting([
            $this->attendee('room-madrid@untangle.es', 'Sala Madrid', 'resource'),
            $this->attendee('projector@client.test', 'Projector', 'Resource'),
            $this->attendee('eva@client.test', 'Eva'),
        ]), self::OWN, self::INTERNAL);

        $this->assertSame(['eva@client.test' => 'Eva'], $features['external']);
        $this->assertSame([], $features['internal']);
        $this->assertSame(['client.test'], $features['domains']);
    }

    public function test_addresses_are_lower_cased_and_trimmed_and_names_blank_to_null(): void
    {
        $features = MeetingSignals::features($this->meeting([
            $this->attendee('  Eva@Client.TEST ', '  '),
            $this->attendee('eva@client.test', 'Eva'),
            $this->attendee('not-an-address', 'Nobody'),
        ]), self::OWN, self::INTERNAL);

        $this->assertSame(['eva@client.test' => 'Eva'], $features['external']);
        $this->assertSame(['client.test'], $features['domains']);
    }

    /**
     * @return array<string, array{0: ?int, 1: int, 2: int}>
     */
    public static function countProvider(): array
    {
        return [
            'attendee_count wins over the list' => [40, 2, 40],
            'falls back to the list length' => [null, 2, 2],
            'zero attendee_count is kept' => [0, 2, 0],
        ];
    }

    #[DataProvider('countProvider')]
    public function test_count_prefers_attendee_count(?int $attendeeCount, int $listed, int $expected): void
    {
        $attendees = [];
        for ($index = 0; $index < $listed; $index++) {
            $attendees[] = $this->attendee('p'.$index.'@client.test');
        }

        $features = MeetingSignals::features($this->meeting($attendees, count: $attendeeCount), self::OWN, self::INTERNAL);

        $this->assertSame($expected, $features['count']);
    }

    public function test_hash_is_sixteen_lower_hex_keyed_and_kind_prefixed(): void
    {
        $hash = MeetingSignals::hash('person', 'eva@client.test', self::SECRET);

        $this->assertMatchesRegularExpression('/^[0-9a-f]{16}$/', $hash);
        $this->assertSame($hash, MeetingSignals::hash('person', 'eva@client.test', self::SECRET));
        $this->assertNotSame($hash, MeetingSignals::hash('person', 'eva@client.test', 'other-secret'));
        $this->assertNotSame(
            MeetingSignals::hash('domain', 'acme', self::SECRET),
            MeetingSignals::hash('token', 'acme', self::SECRET),
        );
        $this->assertSame(substr(hash_hmac('sha256', 'person|eva@client.test', self::SECRET), 0, 16), $hash);
    }

    public function test_hashed_payload_holds_no_readable_address_domain_or_word(): void
    {
        $features = MeetingSignals::features($this->meeting([
            $this->attendee('eva@client.test', 'Eva'),
            $this->attendee('marta@untangle.es', 'Marta'),
        ], organizer: 'ana@client.test', isOrganizer: false, organizerName: 'Ana', subject: 'Phoenix pricing ACME'), self::OWN, self::INTERNAL);

        $hashed = MeetingSignals::hashed($features, self::SECRET);
        $json = (string) json_encode($hashed);

        $this->assertSame(['v', 'o', 'oi', 'a', 'i', 'd', 't', 'n'], array_keys($hashed));
        $this->assertSame(1, $hashed['v']);
        $this->assertSame(MeetingSignals::hash('person', 'ana@client.test', self::SECRET), $hashed['o']);
        $this->assertFalse($hashed['oi']);
        $this->assertSame([MeetingSignals::hash('person', 'eva@client.test', self::SECRET)], $hashed['a']);
        $this->assertSame([MeetingSignals::hash('person', 'marta@untangle.es', self::SECRET)], $hashed['i']);
        $this->assertSame([MeetingSignals::hash('domain', 'client.test', self::SECRET)], $hashed['d']);
        $this->assertCount(3, $hashed['t']);
        $this->assertSame(2, $hashed['n']);

        $this->assertStringNotContainsString('@', $json);
        foreach (['client.test', 'untangle', 'eva', 'ana', 'marta', 'phoenix', 'pricing', 'acme', 'Eva', 'Ana'] as $readable) {
            $this->assertStringNotContainsStringIgnoringCase($readable, $json);
        }
    }

    public function test_hashed_payload_of_a_meeting_the_user_organizes_has_no_organizer(): void
    {
        $hashed = MeetingSignals::hashed(
            MeetingSignals::features($this->meeting([$this->attendee('eva@client.test', 'Eva')]), self::OWN, self::INTERNAL),
            self::SECRET,
        );

        $this->assertNull($hashed['o']);
        $this->assertFalse($hashed['oi']);
    }

    public function test_labels_map_hashes_to_names_and_bare_domains_never_addresses(): void
    {
        $features = MeetingSignals::features($this->meeting([
            $this->attendee('eva@client.test', 'Eva'),
            $this->attendee('luis@client.test', null),
        ], organizer: 'ana@client.test', isOrganizer: false, organizerName: 'Ana'), self::OWN, self::INTERNAL);

        $labels = MeetingSignals::labels($features, self::SECRET);

        $this->assertSame('Ana', $labels[MeetingSignals::hash('person', 'ana@client.test', self::SECRET)]);
        $this->assertSame('Eva', $labels[MeetingSignals::hash('person', 'eva@client.test', self::SECRET)]);
        $this->assertNull($labels[MeetingSignals::hash('person', 'luis@client.test', self::SECRET)]);
        $this->assertSame('client.test', $labels[MeetingSignals::hash('domain', 'client.test', self::SECRET)]);
        $this->assertStringNotContainsString('@', (string) json_encode($labels));
    }
}
