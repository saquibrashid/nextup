/**
 * TASK-062 — the recording transport for `T-AI-013` (Rule A, RSK-022).
 *
 * ⚠ WHY THIS IS A FIXTURE MODULE AND NOT A HELPER INSIDE THE SPEC. It calls
 * `registerMockedHost`, and `T-CI-007r` allows that from exactly three places:
 * `tools/egress-guard.mjs`, the egress guard's own spec, and
 * `tests/fixtures/msw/**`. That restriction is not bureaucracy — registering a
 * host tells the guard to WAVE THROUGH traffic to it, so a registration made
 * from an ordinary spec and never cleaned up would allow live egress to a real
 * provider for the rest of the run. Keeping every registration in this
 * directory keeps it next to the `close()` that reverses it.
 *
 * ⚠ WHY NOT REUSE THE `aoai` AND `vision` FIXTURES. Two reasons. `msw`'s
 * `setupServer` is process-global, so two listening servers fight over the
 * same interceptors; and the vision fixture deliberately does NOT capture the
 * request body ("The bytes are deliberately NOT captured"), which is the right
 * default for a contract suite and the wrong one for a test whose entire
 * assertion is about the body. This server records the FULL request — URL,
 * every header, raw body — for both hosts at once. Nothing recorded is logged.
 */

import { HttpResponse, http, passthrough } from 'msw';
import { setupServer, type SetupServerApi } from 'msw/node';

import { registerMockedHost, unregisterMockedHost } from '../../../../tools/egress-guard.mjs';
import { AOAI_ENDPOINT, VALID as AOAI_VALID } from '../aoai/index.js';
import { VISION_ENDPOINT, VALID as VISION_VALID } from '../vision/index.js';

/** Which inference host a request went to. */
export type InferenceHost = 'aoai' | 'vision';

export interface Wire {
  host: InferenceHost;
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * An `msw` server that serves the ordinary success recording for both
 * inference hosts and pushes every request it saw, in full, onto `wires`.
 *
 * `onUnhandledRequest: 'error'` is applied here rather than left to the
 * caller: an unhandled request is one that would have gone to the internet
 * carrying the owner's screenshot.
 */
export function recordingInferenceServer(wires: Wire[]): SetupServerApi {
  const capture =
    (host: InferenceHost) =>
    async (request: Request): Promise<void> => {
      const headers: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        headers[key] = value;
      });
      wires.push({ host, url: request.url, headers, body: await request.clone().text() });
    };

  const captureAoai = capture('aoai');
  const captureVision = capture('vision');

  const server = setupServer(
    http.all(`${AOAI_ENDPOINT}/*`, async ({ request }) => {
      await captureAoai(request);
      return HttpResponse.json(AOAI_VALID.body, { status: AOAI_VALID.status });
    }),
    http.all(`${VISION_ENDPOINT}/*`, async ({ request }) => {
      await captureVision(request);
      return HttpResponse.json(VISION_VALID.body, { status: VISION_VALID.status });
    }),
    // Loopback is not Azure and is never recorded; let it through untouched.
    http.all('http://127.0.0.1/*', () => passthrough()),
    http.all('http://localhost/*', () => passthrough()),
  );

  const hosts = [AOAI_ENDPOINT, VISION_ENDPOINT].map((e) => new URL(e).hostname);
  for (const host of hosts) registerMockedHost(host);

  const close = server.close.bind(server);
  server.close = (): void => {
    for (const host of hosts) unregisterMockedHost(host);
    close();
  };

  server.listen({ onUnhandledRequest: 'error' });
  return server;
}
