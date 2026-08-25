/**
 * `T-TMDB-010` — the TMDB client. TASK-045, US-007.
 *
 * Every case runs against committed recordings (`tests/fixtures/msw/tmdb/`).
 * No test calls TMDB (`specs/testing.md` §3.2).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  TMDB_MAX_CONCURRENCY,
  TMDB_RETRY_BACKOFF_MS,
  TmdbClient,
  TmdbUnavailableError,
  TmdbWorkNotFoundError,
  resetTmdbRateLimiterForTests,
} from '../../../src/clients/tmdbClient.js';
import {
  RATE_LIMITED,
  tmdbMswServer,
  TMDB_UNAVAILABLE_TOKEN,
  type ReplayOptions,
} from '../../../../../tests/fixtures/msw/tmdb/index.js';

/**
 * The client runs against `msw`, on the REAL `fetch`, at the REAL TMDB origin.
 *
 * That matters: handing the client a fake `fetch` proves what the client does
 * with a response, but proves nothing about the request it builds. Every
 * assertion below about the URL, the query string or where the API key sits is
 * only meaningful because the request actually travelled through the HTTP
 * layer to get here.
 *
 * Backoff is asserted by the sleep LOG, never by actually waiting 5 seconds.
 */
let server: ReturnType<typeof tmdbMswServer> | undefined;

// The rate-limit gate is module scoped by design (it guards a per-process
// resource), so it outlives an individual test. Reset it between tests or a
// suite that leaves it saturated silently stalls the next one.
beforeEach(() => {
  resetTmdbRateLimiterForTests();
});

afterEach(() => {
  server?.close();
  server = undefined;
  resetTmdbRateLimiterForTests();
});

function makeClient(options: ReplayOptions = {}): {
  client: TmdbClient;
  slept: number[];
  calls: string[];
} {
  const slept: number[] = [];
  const calls: string[] = [];

  server?.close();
  server = tmdbMswServer({ ...options, calls });
  server.listen({ onUnhandledRequest: 'error' });

  const client = new TmdbClient({
    apiKey: 'fixture-key-not-a-real-secret',
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
  });
  return { client, slept, calls };
}

/**
 * Another client against the ALREADY-RUNNING msw server, sharing one `slept`
 * log. `makeClient` closes and replaces the server, so it cannot be used to
 * model concurrent callers.
 */
function makeSiblingClient(slept: number[]): TmdbClient {
  return new TmdbClient({
    apiKey: 'fixture-key-not-a-real-secret',
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
  });
}

describe('T-TMDB-010 the TMDB client reads only what nextup is allowed to keep', () => {
  it('T-TMDB-010 · US-007 AC-1 · a recorded search returns the allow-listed fields', async () => {
    const { client } = makeClient();
    const items = await client.searchMulti('Dune');

    expect(items[0]).toEqual({
      tmdbId: 438631,
      mediaType: 'movie',
      name: 'Dune',
      releaseYear: 2021,
      posterPath: '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg',
    });

    // US-007 AC-6: nextup does not mirror the TMDB catalogue. `overview`,
    // `popularity` and `vote_average` are in the recording and must not survive
    // the read — popularity especially, since it is time-varying and would make
    // matching untestable (specs/ai.md §4.2).
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual([
        'mediaType',
        'name',
        'posterPath',
        'releaseYear',
        'tmdbId',
      ]);
    }
  });

  it('T-TMDB-010a · US-007 AC-4 · every close match is returned, none silently dropped', async () => {
    const { client } = makeClient();
    const items = await client.searchMulti('Dune');

    // Two films called Dune and one series. Returning only the best would hide
    // the alternatives US-007 AC-4 requires to stay visible.
    expect(items.map((i) => i.tmdbId)).toEqual([438631, 41733, 66732]);
    expect(items.find((i) => i.tmdbId === 41733)?.releaseYear).toBe(1984);
  });

  it('T-TMDB-010b · a person result is discarded; a person is not a work', async () => {
    const { client } = makeClient();
    const items = await client.searchMulti('Dune');

    expect(items.some((i) => i.name === 'Denis Villeneuve')).toBe(false);
    expect(items.every((i) => i.mediaType === 'movie' || i.mediaType === 'tv')).toBe(true);
  });

  it('T-TMDB-010c · `type` and `limit` narrow the result set', async () => {
    const { client } = makeClient();

    expect((await client.searchMulti('Dune', { type: 'tv' })).map((i) => i.tmdbId)).toEqual([
      66732,
    ]);
    expect(await client.searchMulti('Dune', { limit: 1 })).toHaveLength(1);
  });

  it('T-TMDB-010d · an unrecorded query is the UNMATCHED path, not a failure', async () => {
    // US-008: a title TMDB has never heard of is a first-class state.
    const { client } = makeClient();
    expect(await client.searchMulti('a title nobody recorded')).toEqual([]);
  });

  it('T-TMDB-010e · include_adult=false is always sent, and is not configurable', async () => {
    const { client, calls } = makeClient();
    await client.searchMulti('Dune');
    expect(calls[0]).toContain('include_adult=false');
  });

  it('T-TMDB-010f · repeated queries in one batch cost one call', async () => {
    // specs/ai.md §4.1 — the in-process cache lives for the batch, no longer.
    const { client, calls } = makeClient();
    await client.searchMulti('Dune');
    await client.searchMulti('Dune');
    expect(calls).toHaveLength(1);

    // A second client is a second batch: nothing is shared, nothing persisted.
    const fresh = makeClient();
    await fresh.client.searchMulti('Dune');
    expect(fresh.calls).toHaveLength(1);
  });

  it('T-TMDB-010g · 429 is retried twice with 1s/4s backoff, then reported unavailable', async () => {
    const { client, slept, calls } = makeClient({
      script: [RATE_LIMITED, RATE_LIMITED, RATE_LIMITED],
    });

    const error = await client.searchMulti('Dune').then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(TmdbUnavailableError);
    expect((error as TmdbUnavailableError).httpStatus).toBe(429);
    expect(calls).toHaveLength(1 + TMDB_RETRY_BACKOFF_MS.length);
    // The spacing sleeps are interleaved; the backoff values must be present
    // in order, and must not have been "tidied" into a single fixed delay.
    expect(slept.filter((ms) => ms >= 1_000)).toEqual([...TMDB_RETRY_BACKOFF_MS]);
  });

  it('T-TMDB-010h · a retry that then succeeds returns the result', async () => {
    const { client } = makeClient({ script: [RATE_LIMITED] });
    expect((await client.searchMulti('Dune')).map((i) => i.tmdbId)).toEqual([438631, 41733, 66732]);
  });

  it('T-TMDB-010i · a transport failure is unavailability, NEVER an empty result', async () => {
    // The defect this guards: swallowing a network error into `[]` makes an
    // unreachable TMDB indistinguishable from "no such title", and metadata is
    // then lost silently rather than visibly (US-007 AC-5).
    const { client } = makeClient({
      script: ['network-error', 'network-error', 'network-error'],
    });

    const error = await client.searchMulti('Dune').then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(TmdbUnavailableError);
    expect((error as TmdbUnavailableError).retryable).toBe(true);
  });

  it('T-TMDB-010j · a 401 is not retried — retrying cannot fix a bad key', async () => {
    const { client, calls } = makeClient({
      script: [{ status: 401, body: { status_message: 'Invalid API key.' } }],
    });

    const error = await client.searchMulti('Dune').then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(TmdbUnavailableError);
    expect((error as TmdbUnavailableError).retryable).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('T-TMDB-010k · no error message can carry the API key', async () => {
    // The v3 key is a QUERY PARAMETER, so it lives inside the request URL. A
    // message built from a fetch error, or from `url.href`, leaks it into logs.
    const { client } = makeClient({
      script: ['network-error', 'network-error', 'network-error'],
    });

    const error = await client.searchMulti('Dune').then(
      () => null,
      (e: unknown) => e,
    );

    expect((error as Error).message).not.toContain('fixture-key-not-a-real-secret');
    expect((error as Error).message).not.toContain('api_key');
  });

  it('T-TMDB-010l · the request is spaced and bounded ACROSS clients, per specs/ai.md §4.1', async () => {
    // Six SEPARATE clients, as `registerTmdbRoutes` builds one per request.
    // This is the discriminating shape: were the gate per-instance, each fresh
    // client would see `lastStartedAt === 0`, conclude that far more than 30 ms
    // had elapsed, and never sleep — so `slept` would be empty and the process
    // would exceed the §4.1 cap while every client looked well-behaved.
    const { client, slept } = makeClient();
    const clients = [client, ...Array.from({ length: 5 }, () => makeSiblingClient(slept))];

    await Promise.all(clients.map((c, i) => c.searchMulti(`query-${String(i)}`)));

    expect(TMDB_MAX_CONCURRENCY).toBe(4);
    // Five of the six are spaced out behind the first.
    const spacingWaits = slept.filter((ms) => ms > 0 && ms <= 30);
    expect(spacingWaits.length).toBeGreaterThanOrEqual(clients.length - 1);
  });

  it('T-TMDB-010m · US-007 AC-2 · a detail read returns type, year, runtime, genres, poster', async () => {
    const { client } = makeClient();
    expect(await client.getWork('movie', 438631)).toEqual({
      tmdbId: 438631,
      mediaType: 'movie',
      name: 'Dune',
      releaseYear: 2021,
      posterPath: '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg',
      runtimeMinutes: 155,
      genres: ['Science Fiction', 'Adventure'],
      // The recording predates Epic M and carries no `imdb_id`; a work TMDB
      // has no IMDb mapping for is `null`, never `undefined` or `''`.
      imdbId: null,
    });
  });

  it('T-TMDB-010n · a 404 detail read is not-found, not unavailable', async () => {
    // They map to different closed error codes (TMDB_WORK_NOT_FOUND vs
    // TMDB_UNAVAILABLE) and to different remedies, so they must not merge.
    const { client } = makeClient();
    const error = await client.getWork('movie', 1).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TmdbWorkNotFoundError);
  });

  it('T-TMDB-010o · the unavailable token drives the failure path end to end', async () => {
    const { client } = makeClient();
    const error = await client.searchMulti(`Dune ${TMDB_UNAVAILABLE_TOKEN}`).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TmdbUnavailableError);
    expect((error as TmdbUnavailableError).httpStatus).toBe(503);
  });
});

/**
 * The wire is not a contract nextup controls. Every case below feeds the
 * client a body TMDB is entitled to return and asserts the field is DROPPED
 * rather than stored as `undefined`, `NaN` or `'[object Object]'` — the three
 * shapes that survive a permissive parser and only fail much later, at the
 * point of display, with no way back to the response that caused them.
 */
describe('T-TMDB-010 the client refuses to invent data from a malformed body', () => {
  function clientServing(body: unknown, status = 200): TmdbClient {
    return new TmdbClient({
      apiKey: 'fixture-key-not-a-real-secret',
      fetch: (() =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
        )) as typeof globalThis.fetch,
      sleep: () => Promise.resolve(),
    });
  }

  it('T-TMDB-010v · a non-array `results`, and rows that are not works, are dropped', async () => {
    expect(await clientServing({ results: 'nope' }).searchMulti('Dune')).toEqual([]);
    expect(await clientServing({}).searchMulti('Dune')).toEqual([]);

    const items = await clientServing({
      results: [
        null,
        'a string',
        { media_type: 'person', id: 1, name: 'Denis Villeneuve' },
        { media_type: 'movie', id: 1.5, title: 'Fractional id' },
        { media_type: 'movie', id: '7', title: 'String id' },
        { media_type: 'movie', id: 8 },
        { media_type: 'movie', id: 9, title: '' },
        { media_type: 'tv', id: 10, name: 'Kept' },
      ],
    }).searchMulti('anything');

    expect(items).toEqual([
      { tmdbId: 10, mediaType: 'tv', name: 'Kept', releaseYear: null, posterPath: null },
    ]);
  });

  it('T-TMDB-010w · an unusable date or poster becomes null, never NaN or a stray type', async () => {
    const items = await clientServing({
      results: [
        { media_type: 'movie', id: 1, title: 'Empty date', release_date: '' },
        { media_type: 'movie', id: 2, title: 'Short date', release_date: '20' },
        { media_type: 'movie', id: 3, title: 'Unparseable', release_date: 'soon-ish' },
        { media_type: 'tv', id: 4, name: 'Aired', first_air_date: '1999-01-01' },
        { media_type: 'movie', id: 5, title: 'Odd poster', poster_path: 42 },
      ],
    }).searchMulti('anything');

    expect(items.map((i) => i.releaseYear)).toEqual([null, null, null, 1999, null]);
    expect(items.every((i) => i.posterPath === null)).toBe(true);
  });

  it('T-TMDB-010x · a detail read survives absent, empty and junk optional fields', async () => {
    expect(await clientServing({}).getWork('tv', 77)).toEqual({
      tmdbId: 77,
      mediaType: 'tv',
      name: '',
      releaseYear: null,
      posterPath: null,
      runtimeMinutes: null,
      genres: [],
      imdbId: null,
    });

    // A series carries per-episode runtimes; the first is the usual one.
    expect(
      await clientServing({
        name: 'Severance',
        first_air_date: '2022-02-18',
        episode_run_time: [47, 51],
        genres: [{ name: 'Drama' }, { name: 42 }, {}, null],
      }).getWork('tv', 95396),
    ).toMatchObject({ runtimeMinutes: 47, releaseYear: 2022, genres: ['Drama'] });

    // An empty list is a list, not a reason to look elsewhere.
    expect(await clientServing({ episode_run_time: [] }).getWork('tv', 1)).toMatchObject({
      runtimeMinutes: null,
    });
    // `genres` present but not an array must not throw on `.map`.
    expect(await clientServing({ genres: 'Drama' }).getWork('tv', 1)).toMatchObject({ genres: [] });
  });

  it('T-TMDB-010y · an unreadable 200 and an unhandled 404 are failures, NOT empty results', async () => {
    // The whole point: neither may be indistinguishable from "TMDB has never
    // heard of this title", which is how metadata is lost silently.
    const unreadable = new TmdbClient({
      apiKey: 'fixture-key-not-a-real-secret',
      fetch: (() =>
        Promise.resolve(new Response('<html>maintenance</html>', { status: 200 }))) as never,
      sleep: () => Promise.resolve(),
    });

    for (const client of [unreadable, clientServing({ status_message: 'Not found.' }, 404)]) {
      const error = await client.searchMulti('Dune').then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(TmdbUnavailableError);
      // Retrying cannot change either answer.
      expect((error as TmdbUnavailableError).retryable).toBe(false);
      expect((error as Error).message).not.toContain('api_key');
    }
  });

  it('T-TMDB-010z · a 500 is retried the bounded number of times, then reported', async () => {
    const slept: number[] = [];
    let calls = 0;
    const client = new TmdbClient({
      apiKey: 'fixture-key-not-a-real-secret',
      fetch: (() => {
        calls += 1;
        return Promise.resolve(new Response('{}', { status: 500 }));
      }) as never,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
    });

    const error = await client.searchMulti('Dune').then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TmdbUnavailableError);
    expect(calls).toBe(TMDB_RETRY_BACKOFF_MS.length + 1);
    expect(slept.filter((ms) => TMDB_RETRY_BACKOFF_MS.includes(ms))).toEqual([
      ...TMDB_RETRY_BACKOFF_MS,
    ]);
  });
});

/**
 * `T-IMDB-009` — the IMDb id (REQ-094, ADR-0011 D-2a). Epic M.
 *
 * ⚠ RENAMED FROM `T-TMDB-011`, which was ALREADY TAKEN. `specs/testing.md`
 * L851 defines `T-TMDB-011` as an INTEGRATION test — "confirmed match stores
 * exactly type, year, runtime, genres, poster path, tmdbId, fetchedAt". Had
 * these unit cases kept that id, `check-status` would have seen it in the
 * suite and reported an unbuilt integration assertion as delivered. That is
 * the exact failure `tools/check-test-ids.mjs` exists to stop, and it is why
 * `tmdbSearchRoute.spec.ts` refused `T-AI-017` for the same reason.
 *
 * ⚠ THE ASYMMETRY IS THE WHOLE POINT, AND IT FAILS SILENTLY.
 * Measured against the live TMDB API: `/3/movie/{id}` carries `imdb_id` at the
 * top level, but `/3/tv/{id}` does NOT carry it at all — only
 * `external_ids.imdb_id` has it for a series. An implementation that reads
 * `body.imdb_id` alone therefore works for every film and returns `null` for
 * every series, which renders as REQ-091's legitimate "no rating yet" state
 * and looks entirely correct. Nothing but a test that feeds it a TV-shaped
 * body catches it.
 */
describe('T-IMDB-009 the IMDb id survives both media types', () => {
  function clientServing(body: unknown): TmdbClient {
    return new TmdbClient({
      apiKey: 'fixture-key-not-a-real-secret',
      fetch: (() =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )) as typeof globalThis.fetch,
      sleep: () => Promise.resolve(),
    });
  }

  it('T-IMDB-009a · the detail request asks for `external_ids`, at no extra call', async () => {
    // If this drops out of the query string the series path goes quietly dark,
    // so the request itself is asserted rather than only its parsed result.
    const { client, calls } = makeClient();
    await client.getWork('movie', 438631);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('append_to_response=external_ids');
    // Appended, NOT a second round trip to `/external_ids`.
    expect(calls[0]).toContain('/3/movie/438631');
  });

  it('T-IMDB-009b · the top-level `imdb_id` a film carries is read', async () => {
    expect(
      await clientServing({ title: 'Dune', imdb_id: 'tt1160419' }).getWork('movie', 438631),
    ).toMatchObject({ imdbId: 'tt1160419' });
  });

  it('T-IMDB-009c · a series has it ONLY under `external_ids`, and it is still read', async () => {
    // The exact body `/3/tv/{id}?append_to_response=external_ids` returns:
    // no top-level `imdb_id` key at all.
    const detail = await clientServing({
      name: 'The Office',
      external_ids: { imdb_id: 'tt0386676', tvdb_id: 73244 },
    }).getWork('tv', 2316);

    expect(detail.imdbId).toBe('tt0386676');
  });

  it('T-IMDB-009d · `external_ids` wins over the top level when both are present', async () => {
    // A film carries both. They agree in practice, but the order must be fixed
    // so the series-safe branch is the one that always runs.
    expect(
      await clientServing({
        imdb_id: 'tt1111111',
        external_ids: { imdb_id: 'tt2222222' },
      }).getWork('movie', 1),
    ).toMatchObject({ imdbId: 'tt2222222' });
  });

  it('T-IMDB-009e · absent, empty, null and junk ids all become null, never a lookup key', async () => {
    // TMDB returns `''` or `null` for a work with no IMDb mapping. Passing any
    // of these to OMDb would spend budget on a request that cannot succeed.
    for (const body of [
      {},
      { imdb_id: '' },
      { imdb_id: null },
      { imdb_id: 42 },
      { imdb_id: 'nm0000138' },
      { imdb_id: 'tt' },
      { imdb_id: 'not-an-id' },
      { external_ids: { imdb_id: '' } },
      { external_ids: null },
      { external_ids: 'nope' },
    ]) {
      expect((await clientServing(body).getWork('tv', 1)).imdbId).toBeNull();
    }
  });

  it('T-IMDB-009f · an empty `external_ids` falls back to the top level rather than to null', async () => {
    // A film whose appended block is present but blank must not lose an id it
    // did return.
    expect(
      await clientServing({ imdb_id: 'tt1375666', external_ids: {} }).getWork('movie', 1),
    ).toMatchObject({ imdbId: 'tt1375666' });
  });
});
