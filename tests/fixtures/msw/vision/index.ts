/**
 * Recorded Azure AI Vision `Read` responses, replayed offline
 * (`specs/testing.md` §3.1a, `specs/ai.md` §9.3). TASK-056, `T-AI-033`.
 *
 * ⚠ **NO TEST EVER CALLS AZURE AI VISION.** The whole suite runs with no
 * subscription, no managed identity and no network. Every body in this
 * directory was recorded once and committed, which is also what makes the
 * suite byte-deterministic.
 *
 * WHY `msw` AND NOT AN INJECTED CLIENT
 * ------------------------------------
 * The properties `T-AI-009` exists to protect are properties of the REQUEST:
 * that `features` is `Read` and nothing else, that no service name appears
 * anywhere in the call. Handing `AzureVisionExtractor` a fake client would
 * prove what it does with a response and prove nothing about what it asks
 * for. `msw` intercepts at the HTTP layer, so every assertion below about the
 * query string is only meaningful because the request really travelled
 * through the SDK's pipeline to get here.
 *
 * `msw` and the egress guard (`tools/egress-guard.mjs`) are complementary and
 * both stay on: `msw` supplies the recorded body, and the guard turns a
 * MISSING handler into a loud failure rather than a silent live request.
 *
 * PATH NOTE. `specs/testing.md` §3.1a names `tests/fixtures/vision/`. The
 * established layout for replayed HTTP in this repository is
 * `tests/fixtures/msw/<provider>/` (TASK-045 landed TMDB there against the
 * same kind of spec text), so these sit alongside it rather than starting a
 * second convention.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { http, HttpResponse, passthrough } from 'msw';
import { setupServer, type SetupServerApi } from 'msw/node';

import { registerMockedHost, unregisterMockedHost } from '../../../../tools/egress-guard.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));

const read = (name: string): unknown => JSON.parse(readFileSync(`${HERE}${name}`, 'utf8'));

/** Where the recordings were captured from. Nothing ever reaches it. */
export const VISION_ENDPOINT = 'https://nextup-vision.cognitiveservices.azure.com';

export interface RecordedResponse {
  status: number;
  body: unknown;
}

/**
 * A normal Read result: two blocks, three lines, one of them straddling the
 * frame edge by four pixels and one of them wordless.
 *
 * Both of those are real Read behaviours and both are traps — the out-of-frame
 * polygon must clamp rather than produce a coordinate outside `0..1`, and the
 * wordless line must report `confidence: null` rather than a flattering `0`
 * or a fabricated `1`.
 */
export const VALID: RecordedResponse = { status: 200, body: read('analyze.tiles.json') };

/** An image that genuinely contains no text: `blocks: []`. A valid EMPTY result. */
export const EMPTY: RecordedResponse = { status: 200, body: read('analyze.empty.json') };

/**
 * A 200 with no `readResult` at all. ⚠ ABSENT IS NOT EMPTY: `features=Read`
 * was requested, so this is a response we do not understand, and an unread
 * image reported as "no text" reads, in full-update mode, as removals.
 */
export const NO_READ_RESULT: RecordedResponse = {
  status: 200,
  body: read('analyze.no-read-result.json'),
};

/** A 200 with no image dimensions — boxes could only be normalised by guessing. */
export const NO_METADATA: RecordedResponse = {
  status: 200,
  body: read('analyze.no-metadata.json'),
};

export const RATE_LIMITED: RecordedResponse = { status: 429, body: read('error.429.json') };
export const SERVER_ERROR: RecordedResponse = {
  status: 503,
  body: { error: { code: 'ServiceUnavailable', message: 'Temporarily unavailable.' } },
};
/** Non-retryable: retrying cannot change the answer, and it costs a transaction. */
export const BAD_REQUEST: RecordedResponse = { status: 400, body: read('error.400.json') };

export interface RecordedRequest {
  /** Path plus query string. The bytes are deliberately NOT captured. */
  target: string;
  features: string | null;
  correlationId: string | null;
  contentType: string | null;
}

export interface ReplayOptions {
  /** Requests seen, in order — so a test can assert retry COUNT, not just outcome. */
  calls?: RecordedRequest[];
  /**
   * Responses to serve before the default, in order. An entry of
   * `'network-error'` makes the transport itself reject, which is a different
   * code path from any status code and the one a client most often gets
   * wrong. An entry of `'hang'` never responds, driving the timeout path.
   */
  script?: Array<RecordedResponse | 'network-error' | 'hang'>;
  /** Served once the script is exhausted. Defaults to {@link VALID}. */
  fallback?: RecordedResponse;
}

/**
 * An `msw` server serving the recordings above at the recorded endpoint.
 *
 * ⚠ `onUnhandledRequest: 'error'` is how the caller must start it. An
 * unhandled request is a request that WOULD have gone to the internet — which
 * for this provider also means a request carrying the owner's screenshot.
 *
 * ⚠ The endpoint host is registered with the egress guard for the server's
 * lifetime, and DEREGISTERED on `close()`. The Azure SDKs speak
 * `https.request`, which `msw` mocks by swapping the socket underneath a real
 * `ClientRequest` — so the guard sees a request to a public hostname even
 * though no packet leaves. See the long note on `registerMockedHost`. The
 * registration is scoped to a listening server precisely so it cannot outlive
 * the thing that guarantees nothing escapes.
 */
export function visionMswServer(options: ReplayOptions = {}): SetupServerApi {
  const script = [...(options.script ?? [])];

  const handler = http.all(`${VISION_ENDPOINT}/computervision/*`, ({ request }) => {
    const url = new URL(request.url);
    options.calls?.push({
      target: `${url.pathname}${url.search}`,
      features: url.searchParams.get('features'),
      correlationId: request.headers.get('x-ms-client-request-id'),
      contentType: request.headers.get('content-type'),
    });

    const next = script.shift();
    if (next === 'network-error') return HttpResponse.error();
    if (next === 'hang') return new Promise<never>(() => undefined);

    const recorded = next ?? options.fallback ?? VALID;
    return HttpResponse.json(recorded.body, { status: recorded.status });
  });

  const server = setupServer(
    handler,
    // Loopback is not Azure and is never recorded; let it through untouched.
    http.all('http://127.0.0.1/*', () => passthrough()),
    http.all('http://localhost/*', () => passthrough()),
  );

  const host = new URL(VISION_ENDPOINT).hostname;
  registerMockedHost(host);
  const close = server.close.bind(server);
  server.close = (): void => {
    unregisterMockedHost(host);
    close();
  };

  return server;
}

/**
 * A `TokenCredential` that returns a constant, obviously-fake token.
 *
 * Without this every test would construct `DefaultAzureCredential`, which
 * reaches for IMDS, environment credentials and the Azure CLI in turn — three
 * more ways for an "offline" suite to touch the network, and on a developer
 * machine it would succeed and quietly start billing.
 */
export function fakeVisionCredential(): {
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
