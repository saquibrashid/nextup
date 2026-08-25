/**
 * The OMDb client — ADR-0011, REQ-089/REQ-091/REQ-093.
 *
 * Every case here defends a property whose failure is SILENT. A rating that
 * comes back `0` instead of "unknown" renders as a terrible film; a title-text
 * fallback attaches a plausible rating to the wrong work; a budget that resets
 * per-instance blows the daily cap while every individual request looks
 * well-behaved. None of these throw, and none show up in a log.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  OMDB_DAILY_BUDGET,
  OmdbClient,
  OmdbUnavailableError,
  isImdbId,
  omdbBudgetRemaining,
  resetOmdbBudgetForTests,
} from '../../../src/clients/omdbClient.js';

const INCEPTION = 'tt1375666';

/** A 200 carrying `body`. */
const ok = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const status = (code: number): Response => new Response('', { status: code });

interface Harness {
  client: OmdbClient;
  urls: URL[];
}

function harness(
  responses: Array<Response | Error>,
  now = new Date('2026-08-21T12:00:00Z'),
): Harness {
  const urls: URL[] = [];
  let i = 0;
  const client = new OmdbClient({
    apiKey: 'omdb-test-key',
    sleep: async () => undefined,
    now: () => now,
    fetch: (async (input: URL | RequestInfo) => {
      urls.push(new URL(String(input)));
      const next = responses[Math.min(i, responses.length - 1)];
      i += 1;
      if (next instanceof Error) throw next;
      // ⚠ `.clone()`, because a Response body is single-use. The exhaustion
      // case replays one response a thousand times, and without this it fails
      // on the second read with an unrelated parse error.
      return (next as Response).clone();
    }) as typeof globalThis.fetch,
  });
  return { client, urls };
}

beforeEach(() => {
  resetOmdbBudgetForTests();
});

describe('T-OMDB-001 — a rating is read, and only from `imdb_id`', () => {
  it('T-OMDB-001a: reads imdbRating and imdbVotes', async () => {
    const { client } = harness([
      ok({ Response: 'True', imdbRating: '8.8', imdbVotes: '2,600,000' }),
    ]);
    expect(await client.getRating(INCEPTION)).toEqual({
      imdbId: INCEPTION,
      rating: 8.8,
      voteCount: 2_600_000,
    });
  });

  it('T-OMDB-001b: sends the id as `i`, and sends no `t` parameter at all', async () => {
    const { client, urls } = harness([ok({ Response: 'True', imdbRating: '8.8' })]);
    await client.getRating(INCEPTION);

    expect(urls[0]?.searchParams.get('i')).toBe(INCEPTION);
    // ⚠ The whole of D-2 in one assertion.
    expect(urls[0]?.searchParams.has('t')).toBe(false);
  });

  it('T-OMDB-001c: carries the key as `apikey`, and the key never reaches an error message', async () => {
    const { client, urls } = harness([status(500), status(500)]);
    expect(urls).toHaveLength(0);

    await expect(client.getRating(INCEPTION)).rejects.toThrow(OmdbUnavailableError);
    expect(urls[0]?.searchParams.get('apikey')).toBe('omdb-test-key');

    // The message names the id, never the URL — which contains the key.
    await expect(client.getRating(INCEPTION)).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('omdb-test-key') as unknown }),
    );
  });
});

describe('T-OMDB-002 — "no rating" is a value, never a zero (REQ-091, D-4)', () => {
  it.each([
    ['N/A', 'the title exists but is unrated'],
    ['', 'an empty string'],
    ['not-a-number', 'a non-numeric body'],
    ['0', 'a literal zero, which OMDb cannot legitimately return'],
    ['11.5', 'a value above the 1.0-10.0 scale'],
  ])('T-OMDB-002a: imdbRating %j resolves to null (%s)', async (raw) => {
    const { client } = harness([ok({ Response: 'True', imdbRating: raw })]);
    const result = await client.getRating(INCEPTION);
    expect(result.rating).toBeNull();
    // The assertion that matters: not merely falsy, but specifically not zero.
    expect(result.rating).not.toBe(0);
  });

  it('T-OMDB-002b: an unknown id (Response: "False") is absent, not an error', async () => {
    const { client } = harness([ok({ Response: 'False', Error: 'Incorrect IMDb ID.' })]);
    await expect(client.getRating(INCEPTION)).resolves.toEqual({
      imdbId: INCEPTION,
      rating: null,
      voteCount: null,
    });
  });

  it('T-OMDB-002c: a missing imdbVotes does not invalidate a present rating', async () => {
    const { client } = harness([ok({ Response: 'True', imdbRating: '7.1', imdbVotes: 'N/A' })]);
    expect(await client.getRating(INCEPTION)).toEqual({
      imdbId: INCEPTION,
      rating: 7.1,
      voteCount: null,
    });
  });
});

describe('T-OMDB-003 — a malformed id never becomes a request', () => {
  it.each([
    ['', 'empty'],
    ['1375666', 'no tt prefix'],
    ['tt12', 'too few digits'],
    ['tt1375666; DROP TABLE', 'trailing junk'],
    ['../../etc/passwd', 'a traversal attempt'],
  ])('T-OMDB-003a: %j is rejected before any fetch (%s)', async (bad) => {
    const { client, urls } = harness([ok({ Response: 'True', imdbRating: '9.9' })]);
    const result = await client.getRating(bad);

    expect(result.rating).toBeNull();
    // The point: no request was built at all, so nothing was interpolated.
    expect(urls).toHaveLength(0);
  });

  it('T-OMDB-003b: isImdbId accepts real ids and rejects everything else', () => {
    expect(isImdbId('tt1375666')).toBe(true);
    expect(isImdbId('tt0903747')).toBe(true);
    expect(isImdbId('tt12345678')).toBe(true);
    expect(isImdbId(null)).toBe(false);
    expect(isImdbId(1_375_666)).toBe(false);
    expect(isImdbId('nm0000138')).toBe(false);
  });
});

describe('T-OMDB-004 — the daily budget is process-wide and degrades (REQ-093, D-6)', () => {
  const NOW = new Date('2026-08-21T12:00:00Z');

  it('T-OMDB-004a: the budget is spent per request and reported', async () => {
    const { client } = harness([ok({ Response: 'True', imdbRating: '8.8' })], NOW);
    expect(omdbBudgetRemaining(NOW)).toBe(OMDB_DAILY_BUDGET);

    await client.getRating(INCEPTION);
    expect(omdbBudgetRemaining(NOW)).toBe(OMDB_DAILY_BUDGET - 1);
  });

  it('T-OMDB-004b: exhaustion degrades to absent and makes no request', async () => {
    const { client, urls } = harness([ok({ Response: 'True', imdbRating: '8.8' })], NOW);

    for (let i = 0; i < OMDB_DAILY_BUDGET; i += 1) await client.getRating(INCEPTION);
    expect(urls).toHaveLength(OMDB_DAILY_BUDGET);
    expect(omdbBudgetRemaining(NOW)).toBe(0);

    // REQ-093: it degrades. It does not throw, and it does not retry.
    const result = await client.getRating(INCEPTION);
    expect(result.rating).toBeNull();
    expect(urls).toHaveLength(OMDB_DAILY_BUDGET);
  });

  it('T-OMDB-004c: the budget is shared across client instances, not per-instance', async () => {
    // ⚠ The silent failure this defends: a per-instance counter lets every
    // request believe it is the only caller. Each looks well-behaved; the
    // process as a whole blows the cap.
    const a = harness([ok({ Response: 'True', imdbRating: '8.8' })], NOW);
    const b = harness([ok({ Response: 'True', imdbRating: '8.8' })], NOW);

    await a.client.getRating(INCEPTION);
    await b.client.getRating(INCEPTION);

    expect(omdbBudgetRemaining(NOW)).toBe(OMDB_DAILY_BUDGET - 2);
  });

  it('T-OMDB-004d: the counter rolls over on a new UTC day, with no scheduler', async () => {
    // Invariant 5: there is no job that resets this. The day is derived from
    // the clock at the moment of use, which is why no process is added.
    const day1 = new Date('2026-08-21T23:59:00Z');
    const first = harness([ok({ Response: 'True', imdbRating: '8.8' })], day1);
    await first.client.getRating(INCEPTION);
    expect(omdbBudgetRemaining(day1)).toBe(OMDB_DAILY_BUDGET - 1);

    const day2 = new Date('2026-08-22T00:01:00Z');
    expect(omdbBudgetRemaining(day2)).toBe(OMDB_DAILY_BUDGET);

    const second = harness([ok({ Response: 'True', imdbRating: '8.8' })], day2);
    await second.client.getRating(INCEPTION);
    expect(omdbBudgetRemaining(day2)).toBe(OMDB_DAILY_BUDGET - 1);
  });

  it('T-OMDB-004e: no source line builds a `t=` title query', () => {
    // A static assertion, because the property is a property of the SOURCE:
    // a `?t=` call added later would pass every runtime test above.
    const source = readFileSync(
      fileURLToPath(new URL('../../../src/clients/omdbClient.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/searchParams\.set\(\s*['"]t['"]/);
  });
});

describe('T-OMDB-005 — transport failure is distinguishable from "unrated"', () => {
  it('T-OMDB-005a: a 5xx retries once, then throws OmdbUnavailableError', async () => {
    const { client, urls } = harness([status(503), status(503)]);
    await expect(client.getRating(INCEPTION)).rejects.toMatchObject({
      name: 'OmdbUnavailableError',
      retryable: true,
    });
    expect(urls).toHaveLength(2);
  });

  it('T-OMDB-005b: a 5xx followed by a 200 succeeds', async () => {
    const { client } = harness([status(503), ok({ Response: 'True', imdbRating: '6.4' })]);
    expect((await client.getRating(INCEPTION)).rating).toBe(6.4);
  });

  it('T-OMDB-005c: a 401 does NOT retry — a bad key cannot be waited out', async () => {
    const { client, urls } = harness([status(401)]);
    await expect(client.getRating(INCEPTION)).rejects.toMatchObject({ retryable: false });
    expect(urls).toHaveLength(1);
  });

  it('T-OMDB-005d: an unparseable 200 throws rather than reading as unrated', async () => {
    // ⚠ Returning "absent" here would be indistinguishable from a genuinely
    // unrated title, which is how a broken integration hides for months.
    const { client } = harness([new Response('<html>oops</html>', { status: 200 })]);
    await expect(client.getRating(INCEPTION)).rejects.toThrow(OmdbUnavailableError);
  });

  it('T-OMDB-005e: a network error is retryable and leaks no URL', async () => {
    const { client } = harness([
      new Error('connect ECONNREFUSED https://www.omdbapi.com/?apikey=omdb-test-key'),
    ]);
    await expect(client.getRating(INCEPTION)).rejects.toMatchObject({
      retryable: true,
      message: expect.not.stringContaining('omdb-test-key') as unknown,
    });
  });

  it('T-OMDB-005f: the request is abortable on timeout', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const client = new OmdbClient({
      apiKey: 'k',
      sleep: async () => undefined,
      fetch: (async (_input: URL | RequestInfo, init?: RequestInit) => {
        signals.push(init?.signal ?? undefined);
        return ok({ Response: 'True', imdbRating: '5.0' });
      }) as typeof globalThis.fetch,
    });

    await client.getRating(INCEPTION);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]?.aborted).toBe(false);
  });
});

describe('T-OMDB-006 — Rule A: nothing here can reach an inference service', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../../../src/clients/omdbClient.ts', import.meta.url)),
    'utf8',
  );
  /** Comments stripped, so prose about Rule A cannot satisfy or break it. */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('T-OMDB-006a: the executable source reaches exactly one host, and it is OMDb', () => {
    // ⚠ Asserted against CODE, not the file text. An earlier form of this case
    // searched the whole file for 'openai' and failed on this module's own
    // header, which says the rating is "never sent to Azure OpenAI". A test
    // that a comment can break is a test a comment can also satisfy.
    const hosts = [...code.matchAll(/https?:\/\/([\w.-]+)/g)].map((m) => m[1]);
    expect([...new Set(hosts)]).toEqual(['www.omdbapi.com']);
  });

  it('T-OMDB-006b: the module imports nothing at all', () => {
    // No SDK can be reached if none is imported. This also keeps NFR-004's
    // dependency count at zero for the whole feature.
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/\brequire\s*\(/);
  });
});

describe('T-OMDB-007 — the module holds no key of its own', () => {
  it('T-OMDB-007a: the key arrives by construction, never from process.env here', () => {
    // `OMDB_API_KEY` is read once, at composition. A module-level env read
    // would make the key impossible to scope and impossible to rotate.
    const source = readFileSync(
      fileURLToPath(new URL('../../../src/clients/omdbClient.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/process\.env/);
  });
});
