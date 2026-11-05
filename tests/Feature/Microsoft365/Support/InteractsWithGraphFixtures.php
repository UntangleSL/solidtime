<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365\Support;

use App\Microsoft365\Models\MicrosoftAccount;
use App\Models\User;
use GuzzleHttp\Promise\PromiseInterface;
use Illuminate\Http\Client\Response;
use Illuminate\Http\Client\ResponseSequence;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;

/**
 * Replays the sanitized Microsoft Graph calendarView fixtures of phase 1 (tests/Fixtures/M365).
 * File names come from manifest.json, never from a directory listing: page-10 sorts before page-2.
 */
trait InteractsWithGraphFixtures
{
    /**
     * @return array<mixed>
     */
    protected function graphFixture(string $path): array
    {
        $json = file_get_contents(base_path('tests/Fixtures/M365/'.$path));
        $this->assertNotFalse($json, 'Fixture file not readable: '.$path);

        $data = json_decode($json, true, flags: JSON_THROW_ON_ERROR);
        $this->assertIsArray($data, 'Fixture is not a JSON object or list: '.$path);

        return $data;
    }

    /**
     * The pages of one recorded round in manifest order.
     *
     * @return list<array<string, mixed>>
     */
    protected function graphPages(string $round, string $pass = 'prod-select'): array
    {
        $manifest = $this->graphFixture('manifest.json');
        $files = $manifest['files']['calendarview'][$round][$pass]['pages'];
        $this->assertNotEmpty($files);

        return array_map(fn (string $file): array => $this->graphFixture($file), $files);
    }

    /**
     * @return array{start: string, end: string}
     */
    protected function fixtureWindow(): array
    {
        $manifest = $this->graphFixture('manifest.json');

        return [
            'start' => (string) $manifest['window']['start'],
            'end' => (string) $manifest['window']['end'],
        ];
    }

    /**
     * Fakes the Graph calendarView endpoint with the pages of a round, answered in order.
     *
     * @return list<array<string, mixed>> the pages that are replayed
     */
    protected function fakeGraphCalendar(string $round = 'A'): array
    {
        Config::set('microsoft365.graph.max_pages', 30);
        $pages = $this->graphPages($round);
        $sequence = Http::sequence();
        foreach ($pages as $page) {
            $sequence->push($page);
        }
        Http::fake([
            'https://graph.microsoft.com/v1.0/me/calendarView*' => $sequence,
        ]);

        return $pages;
    }

    /**
     * Fakes the Entra token endpoint of any tenant, together with the Graph calendarView pages when
     * given. Http::fake replaces earlier fakes, so tests that need both set the map once through this.
     *
     * @param  array<string, mixed>|int  $response  JSON body, or an HTTP status for an empty body
     * @param  ResponseSequence|null  $graph  answers for calendarView, see graphSequence(); default is a 500
     */
    protected function fakeTokenEndpoint(array|int $response, int $status = 200, ?ResponseSequence $graph = null): void
    {
        $tokenAnswer = is_int($response)
            ? Http::response([], $response)
            : Http::response($response, $status);

        // Without Graph answers a stray calendarView request must be visible, not reach the network
        Http::fake([
            'https://login.microsoftonline.com/*/oauth2/v2.0/token' => $tokenAnswer,
            'https://graph.microsoft.com/v1.0/me/calendarView*' => $graph
                ?? Http::response(['error' => ['code' => 'unexpected_graph_request']], 500),
        ]);
    }

    /**
     * Graph answers for the calendarView endpoint: the given first answers, then the pages of a round.
     * Use with fakeTokenEndpoint() so that one Http::fake call holds both endpoints.
     *
     * @param  list<PromiseInterface|Response>  $first
     */
    protected function graphSequence(array $first, string $round = 'A'): ResponseSequence
    {
        Config::set('microsoft365.graph.max_pages', 30);
        $sequence = Http::sequence();
        foreach ($first as $answer) {
            $sequence->push($answer);
        }
        foreach ($this->graphPages($round) as $page) {
            $sequence->push($page);
        }

        return $sequence;
    }

    protected function connectedAccount(User $user, bool $expired = false): MicrosoftAccount
    {
        $account = new MicrosoftAccount;
        $account->user()->associate($user);
        $account->tenant_id = '00000000-0000-4000-8000-0000000000a1';
        $account->microsoft_oid = '00000000-0000-4000-8000-0000000000b1';
        $account->microsoft_email = 'ada@example.test';
        $account->access_token = 'at-marker-7f3c';
        $account->refresh_token = 'rt-marker-9d1e';
        $account->access_token_expires_at = $expired ? Carbon::now()->subMinute() : Carbon::now()->addHour();
        $account->scopes = ['openid', 'profile', 'email', 'offline_access', 'User.Read', 'Calendars.Read'];
        $account->save();

        return $account;
    }
}
