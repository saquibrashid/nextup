/**
 * Recorded TMDB responses, replayed offline (`specs/testing.md` §3.2).
 * TASK-045.
 *
 * ⚠ **NO TEST EVER CALLS TMDB.** The whole suite runs with no TMDB key and no
 * network. Every body in this directory was recorded once and committed.
 *
 * THIS IS AN `msw` HANDLER TABLE, AND THE `fetch` SEAM IS THE FALLBACK
 * --------------------------------------------------------------------
 * `msw` intercepts at the HTTP layer, so a test that uses it exercises the
 * client's REAL request construction — the URL, the query string and where
 * the API key sits — none of which is proven by handing the client a fake
 * `fetch`. `tmdbMswServer()` is therefore the default, and `tmdbReplayFetch()`
 * is retained for the cases that assert on the seam itself.
 *
 * `msw` and the egress guard (`tools/egress-guard.mjs`) are complementary and
 * both stay on: `msw` supplies the recorded body, and the guard is the
 * backstop that turns a MISSING handler into a loud failure rather than a
 * silent live request to `api.themoviedb.org`.
 *
 * ~~Superseded (R1): "WHY THIS IS A `fetch` REPLAY AND NOT AN `msw` HANDLER
 * TABLE — `msw` is NOT a dependency of this repository today, and adding one
 * is a hard stop for this lane." `msw` landed as a devDependency with the
 * egress guard (TASK-128), so the constraint that forced the seam is gone.~~
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { http, HttpResponse, passthrough } from 'msw';
import { setupServer, type SetupServerApi } from 'msw/node';

const HERE = fileURLToPath(new URL('.', import.meta.url));

const read = (name: string): unknown => JSON.parse(readFileSync(`${HERE}${name}`, 'utf8'));

/**
 * The token that drives US-007 AC-5 (`specs/testing.md` §3.2): a query
 * CONTAINING it gets a 503, so the `TMDB_UNAVAILABLE` path is reachable from
 * an e2e test with nothing but a search box.
 */
export const TMDB_UNAVAILABLE_TOKEN = '__tmdb_unavailable__';

export interface RecordedResponse {
  status: number;
  body: unknown;
}

/**
 * Search recordings, keyed on the NORMALISED query string (trimmed,
 * lower-cased) — `specs/testing.md` §3.2.
 *
 * A query with no recording returns `{ results: [] }`: the unmatched path.
 * That is deliberate and is NOT a hole in the fixtures — an unmatched
 * candidate is a first-class product state (US-008), so an unrecorded query
 * exercising it is a useful default rather than a failure.
 */
export const SEARCH_RECORDINGS: ReadonlyMap<string, RecordedResponse> = new Map([
  ['dune', { status: 200, body: read('search-multi.dune.json') }],
]);

/** Detail recordings, keyed `${mediaType}/${tmdbId}`. */
export const DETAIL_RECORDINGS: ReadonlyMap<string, RecordedResponse> = new Map([
  ['movie/438631', { status: 200, body: read('movie.438631.json') }],
]);

export const EMPTY_SEARCH: RecordedResponse = {
  status: 200,
  body: read('search-multi.empty.json'),
};

export const RATE_LIMITED: RecordedResponse = { status: 429, body: read('error.429.json') };

export const UNAVAILABLE: RecordedResponse = {
  status: 503,
  body: { status_code: 503, status_message: 'Service unavailable.', success: false },
};

export interface ReplayOptions {
  /** Requests seen, in order — so a test can assert retry COUNT, not just outcome. */
  calls?: string[];
  /**
   * Responses to serve before consulting the recordings, in order. Used to
   * drive retry and transport-failure paths. An entry of `'network-error'`
   * makes `fetch` itself reject, which is a different code path from any
   * status code and is the one a client most often gets wrong.
   */
  script?: Array<RecordedResponse | 'network-error'>;
}

/** Where the recordings were captured from. Nothing ever reaches it. */
export const TMDB_ORIGIN = 'https://api.themoviedb.org';

/**
 * Resolve one recorded response for a TMDB request — the single keying rule,
 * shared by the `msw` handler and the `fetch` seam so the two cannot drift.
 */
export function recordedResponseFor(url: URL): RecordedResponse {
  if (url.pathname.endsWith('/search/multi')) {
    const query = (url.searchParams.get('query') ?? '').trim().toLowerCase();
    if (query.includes(TMDB_UNAVAILABLE_TOKEN)) return UNAVAILABLE;
    return SEARCH_RECORDINGS.get(query) ?? EMPTY_SEARCH;
  }

  return (
    DETAIL_RECORDINGS.get(url.pathname.replace(/^\/3\//, '')) ?? {
      status: 404,
      body: { status_message: 'The resource you requested could not be found.' },
    }
  );
}

/**
 * An `msw` server serving the recordings above at the real TMDB origin
 * (`specs/testing.md` §3.2).
 *
 * ⚠ Every handler asserts the request carries an `api_key`, because the
 * failure it guards against is silent: a client that stopped sending the key
 * would get a 401 from the real TMDB and pass every offline test that did not
 * check.
 *
 * ⚠ `onUnhandledRequest: 'error'` is deliberate. An unhandled request is a
 * request that WOULD have gone to the internet, and the whole point of §3.2 is
 * that none does. Loopback is passed through untouched so a test that also
 * drives a real Express server on an ephemeral port still works.
 */
export function tmdbMswServer(options: ReplayOptions = {}): SetupServerApi {
  const script = [...(options.script ?? [])];

  const handler = http.all(`${TMDB_ORIGIN}/3/*`, ({ request }) => {
    const url = new URL(request.url);
    options.calls?.push(
      `${url.pathname}${url.search.replace(/api_key=[^&]*/, 'api_key=REDACTED')}`,
    );

    if (!url.searchParams.get('api_key')) {
      return HttpResponse.json({ status_message: 'Invalid API key.' }, { status: 401 });
    }

    const next = script.shift();
    if (next === 'network-error') return HttpResponse.error();
    const recorded = next ?? recordedResponseFor(url);
    return HttpResponse.json(recorded.body, { status: recorded.status });
  });

  const server = setupServer(
    handler,
    // Loopback is not TMDB and is never recorded; let it through untouched.
    http.all('http://127.0.0.1/*', () => passthrough()),
    http.all('http://localhost/*', () => passthrough()),
  );
  return server;
}

/**
 * A `FetchLike` serving the same recordings, for the cases that assert on the
 * injectable seam itself rather than on request construction.
 *
 * ⚠ It asserts the request carries an `api_key`, for the reason above.
 */
export function tmdbReplayFetch(options: ReplayOptions = {}): typeof globalThis.fetch {
  const script = [...(options.script ?? [])];

  return ((input: URL | RequestInfo): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input : input.url,
    );
    options.calls?.push(
      `${url.pathname}${url.search.replace(/api_key=[^&]*/, 'api_key=REDACTED')}`,
    );

    if (!url.searchParams.get('api_key')) {
      return Promise.resolve(
        respond({ status: 401, body: { status_message: 'Invalid API key.' } }),
      );
    }

    const next = script.shift();
    if (next === 'network-error') {
      return Promise.reject(new TypeError('fetch failed'));
    }
    return Promise.resolve(respond(next ?? recordedResponseFor(url)));
  }) as typeof globalThis.fetch;
}

function respond(recorded: RecordedResponse): Response {
  return new Response(JSON.stringify(recorded.body), {
    status: recorded.status,
    headers: { 'content-type': 'application/json' },
  });
}
