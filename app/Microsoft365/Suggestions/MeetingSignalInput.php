<?php

declare(strict_types=1);

namespace App\Microsoft365\Suggestions;

use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Models\User;

/**
 * The only place that knows how a cached Outlook meeting and its owner map to the input of the pure signal
 * extractor (MeetingSignals::features()). Stateless (Octane safe): every call reads the model and the config.
 *
 * The attendee data it hands on is personal data of the meeting owner (D-09): callers keep it on the server
 * and never log or serialize it.
 */
final class MeetingSignalInput
{
    public function __construct(
        private readonly MicrosoftConfig $config,
    ) {}

    /**
     * Defensive about the stored list: entries without a string address are skipped, a missing name is null
     * and a missing type counts as "required".
     *
     * @return array{organizer_address: ?string, organizer_name: ?string, is_organizer: bool, attendees: list<array{address: string, name: ?string, type: string}>, attendee_count: ?int, subject: ?string}
     */
    public function fromMeeting(OutlookMeeting $meeting): array
    {
        $attendees = [];
        foreach ($meeting->attendees ?? [] as $entry) {
            if (! is_array($entry)) {
                continue;
            }
            $address = $entry['address'] ?? null;
            if (! is_string($address) || trim($address) === '') {
                continue;
            }
            $name = $entry['name'] ?? null;
            $type = $entry['type'] ?? null;
            $attendees[] = [
                'address' => strtolower(trim($address)),
                'name' => is_string($name) ? $name : null,
                'type' => is_string($type) && $type !== '' ? $type : 'required',
            ];
        }

        return [
            'organizer_address' => $meeting->organizer_address,
            'organizer_name' => $meeting->organizer_name,
            'is_organizer' => $meeting->is_organizer,
            'attendees' => $attendees,
            'attendee_count' => $meeting->attendee_count,
            'subject' => $meeting->subject,
        ];
    }

    /**
     * The user's own addresses (users.email and the linked Microsoft address, lower-cased, deduplicated) and
     * the internal domains (the allowed sign-in domains plus the domain of each own address).
     *
     * @return array{own: list<string>, internal: list<string>}
     */
    public function identity(User $user): array
    {
        $microsoftEmail = MicrosoftAccount::query()
            ->where('user_id', '=', $user->getKey())
            ->value('microsoft_email');

        $own = [];
        foreach ([$user->email, $microsoftEmail] as $address) {
            if (! is_string($address)) {
                continue;
            }
            $address = strtolower(trim($address));
            if ($address !== '' && ! in_array($address, $own, true)) {
                $own[] = $address;
            }
        }

        $internal = $this->config->allowedDomains();
        foreach ($own as $address) {
            $at = strrpos($address, '@');
            if ($at === false) {
                continue;
            }
            $domain = substr($address, $at + 1);
            if ($domain !== '' && ! in_array($domain, $internal, true)) {
                $internal[] = $domain;
            }
        }

        return ['own' => $own, 'internal' => $internal];
    }
}
