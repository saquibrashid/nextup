/**
 * Recorded Azure OpenAI `chat.completions` responses, replayed offline
 * (`specs/testing.md` §3.1a, `specs/ai.md` §9.3). TASK-056b, `T-AI-033`.
 *
 * ⚠ **NO TEST EVER CALLS AZURE OPENAI.** The whole suite runs with no
 * subscription, no managed identity and no network. This matters more here
 * than anywhere else in the repository: a vision call at `detail: 'high'`
 * with `max_tokens: 4096` is the single most expensive request this product
 * makes, and a contract suite that silently went live would bill per run, per
 * CI job, per pull request.
 *
 * WHY `msw` AND NOT AN INJECTED CLIENT
 * ------------------------------------
 * Half of what `T-AI-009`/`T-AI-011b` protect are properties of the REQUEST:
 * `temperature: 0`, the fixed seed, `detail: 'high'`, `strict: true`, and the
 * absence of any service name anywhere in the body. A fake client would prove
 * what the extractor does with a RESPONSE and prove nothing about what it
 * asks for. `msw` intercepts at the HTTP layer, so every assertion below
 * about the request body is only meaningful because the body really travelled
 * through the SDK's serialiser to get here.
 *
 * ⚠ NOTE THE DIFFERENCE FROM THE VISION FIXTURES. The `openai` SDK speaks
 * `fetch`, which `msw` mocks by REPLACING — so nothing ever reaches
 * `tools/egress-guard.mjs` and no mocked-host registration is needed. The
 * Azure Vision SDK speaks `https.request`, which `msw` can only mock by
 * calling the real one with a swapped socket, which is why THAT fixture
 * registers a host and this one does not. Do not "make them consistent":
 * registering a host that does not need it widens the seam for nothing.
 *
 * PATH NOTE. `specs/testing.md` §3.1a names `tests/fixtures/vision/`. The
 * established layout for replayed HTTP here is
 * `tests/fixtures/msw/<provider>/` (TASK-045 landed TMDB there against the
 * same kind of spec text), so these sit alongside it rather than starting a
 * second convention.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { http, HttpResponse, passthrough } from 'msw';
import { setupServer, type SetupServerApi } from 'msw/node';

const HERE = fileURLToPath(new URL('.', import.meta.url));

const read = (name: string): unknown => JSON.parse(readFileSync(`${HERE}${name}`, 'utf8'));

/** Where the recordings were captured from. Nothing ever reaches it. */
export const AOAI_ENDPOINT = 'https://nextup-aoai.openai.azure.com';
export const AOAI_DEPLOYMENT = 'nextup-extract';

export interface RecordedResponse {
  status: number;
  body: unknown;
}

/**
 * A normal result: four tiles.
 *
 * Every one of them is a trap that a naive mapper gets wrong:
 *  - tile 1 is the ordinary case (`basis: 'both'`);
 *  - tile 2 was read from text alone;
 *  - tile 3 has `visibleText: null` AND `identifiedTitle: null` — an
 *    unreadable tile the model correctly declined to guess at. It must
 *    survive as an item, because "never omit a tile" is what stops a
 *    full-update batch reading an unreadable tile as a removal;
 *  - tile 4 carries a TRUNCATED caption with a real `…`, a box that runs off
 *    both edges of the frame, and a `confidence` of `1.31` — providers do
 *    return out-of-range confidences, and every §7 threshold assumes `0..1`.
 */
export const VALID: RecordedResponse = { status: 200, body: read('chat.tiles.json') };

/**
 * A screenshot with no tiles at all. `tiles: []` is a VALID empty result and
 * must not be confused with any of the unusable responses below.
 */
export const EMPTY: RecordedResponse = { status: 200, body: read('chat.empty.json') };

/**
 * ⚠ `finish_reason: 'length'` — and note the content is still VALID JSON
 * carrying one complete tile.
 *
 * That is the whole point of this fixture: an implementation that parses
 * first and checks `finish_reason` afterwards returns one tile and looks
 * entirely successful. In full-update mode a short tile list is a wave of
 * removals. `T-AI-040`.
 */
export const TRUNCATED: RecordedResponse = { status: 200, body: read('chat.truncated.json') };

/** A content-filter refusal on a 200, via the `refusal` field. */
export const REFUSAL: RecordedResponse = { status: 200, body: read('chat.refusal.json') };

/**
 * `T-AI-044`. A prompt-injection payload sitting inside `visibleText`,
 * including an instruction to emit a service name and one to delete titles.
 *
 * The correct behaviour is boring and that is the assertion: it parses to the
 * schema, the payload survives verbatim as DATA in `rawText`, nothing is
 * interpreted, and no field escapes.
 */
export const INJECTION: RecordedResponse = { status: 200, body: read('chat.injection.json') };

/**
 * A tile carrying `service` and `platform` properties.
 *
 * `strict: true` + `additionalProperties: false` means the real service
 * cannot send this — but the parser must drop them anyway rather than spread
 * the parsed object, because REQ-058 must not depend on a remote service
 * honouring a schema.
 */
export const EXTRA_FIELD: RecordedResponse = { status: 200, body: read('chat.extra-field.json') };

/** `basis: 'guessed'` — a value outside the closed enum. */
export const BAD_SHAPE: RecordedResponse = { status: 200, body: read('chat.bad-shape.json') };

/** Prose instead of JSON — what a model does when Structured Outputs is off. */
export const NOT_JSON: RecordedResponse = { status: 200, body: read('chat.not-json.json') };

export const RATE_LIMITED: RecordedResponse = { status: 429, body: read('error.429.json') };
export const SERVER_ERROR: RecordedResponse = {
  status: 503,
  body: { error: { code: 'ServiceUnavailable', message: 'Temporarily unavailable.' } },
};
/** Non-retryable: retrying cannot change the answer, and it costs a call. */
export const BAD_REQUEST: RecordedResponse = { status: 400, body: read('error.400.json') };
/** A 400 that is a REFUSAL, not a bug in our request. Different kind, same status. */
export const CONTENT_FILTER_400: RecordedResponse = {
  status: 400,
  body: read('error.400.content-filter.json'),
};

export interface RecordedRequest {
  /** Path plus query string. */
  target: string;
  apiVersion: string | null;
  correlationId: string | null;
  authorization: string | null;
  /**
   * The parsed request body.
   *
   * ⚠ This is the ONLY place in the test tree where a prompt and a data URI
   * are held in memory, and it exists so `T-AI-009` can assert what is in
   * them. Nothing here is ever logged.
   */
  body: Record<string, unknown>;
}

export interface ReplayOptions {
  /** Requests seen, in order — so a test can assert retry COUNT, not just outcome. */
  calls?: RecordedRequest[];
  /**
   * Responses to serve before the default, in order. `'network-error'` makes
   * the transport itself reject, which is a different code path from any
   * status code. `'hang'` never responds, driving the timeout path.
   */
  script?: Array<RecordedResponse | 'network-error' | 'hang'>;
  /** Served once the script is exhausted. Defaults to {@link VALID}. */
  fallback?: RecordedResponse;
}

/**
 * An `msw` server serving the recordings above at the recorded endpoint.
 *
 * ⚠ Start it with `onUnhandledRequest: 'error'`. An unhandled request is a
 * request that WOULD have gone to the internet — which for this provider also
 * means a request carrying the owner's screenshot, and a bill.
 */
export function aoaiMswServer(options: ReplayOptions = {}): SetupServerApi {
  const script = [...(options.script ?? [])];

  const handler = http.all(`${AOAI_ENDPOINT}/openai/*`, async ({ request }) => {
    const url = new URL(request.url);
    let body: Record<string, unknown>;
    try {
      body = (await request.clone().json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    options.calls?.push({
      target: `${url.pathname}${url.search}`,
      apiVersion: url.searchParams.get('api-version'),
      correlationId: request.headers.get('x-ms-client-request-id'),
      authorization: request.headers.get('authorization'),
      body,
    });

    const next = script.shift();
    if (next === 'network-error') return HttpResponse.error();
    if (next === 'hang') return new Promise<never>(() => undefined);

    const recorded = next ?? options.fallback ?? VALID;
    return HttpResponse.json(recorded.body, { status: recorded.status });
  });

  return setupServer(
    handler,
    // Loopback is not Azure and is never recorded; let it through untouched.
    http.all('http://127.0.0.1/*', () => passthrough()),
    http.all('http://localhost/*', () => passthrough()),
  );
}

/**
 * A `TokenCredential` that returns a constant, obviously-fake token.
 *
 * Without this every test would construct `DefaultAzureCredential`, which
 * reaches for IMDS, environment credentials and the Azure CLI in turn — three
 * more ways for an "offline" suite to touch the network, and on a developer
 * machine it would succeed and quietly start billing.
 */
export function fakeAoaiCredential(): {
  getToken: () => Promise<{ token: string; expiresOnTimestamp: number }>;
} {
  return {
    getToken: () =>
      Promise.resolve({
        token: 'fixture-token-not-a-real-credential',
        expiresOnTimestamp: Date.now() + 3_600_000,
      }),
  };
}
