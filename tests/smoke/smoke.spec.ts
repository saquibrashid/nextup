import { expect, test } from '@playwright/test';

// Post-deploy smoke suite. Runs against a REAL deployed revision — staging
// before production is allowed to deploy, then production at 0 % traffic
// before any traffic is shifted to it.
//
// These assert the PLATFORM boundary, not application logic: that Easy Auth is
// actually in front of the app, and that it cannot be talked out of the way.
// Everything behind the boundary is covered by the unit, integration and e2e
// tiers, which do not need a deployment.
//
// ⚠ Deliberately NO authenticated happy-path case. Signing in needs an
// interactive Entra login as the owner, which cannot run unattended in CI
// without storing owner credentials — exactly what ADR-0002 exists to avoid.
// A smoke suite that required them would trade the product's central security
// property for a green tick. What the suite proves instead is that nothing is
// reachable WITHOUT signing in, which is the property a deployment can break.

// Fail loudly rather than silently smoke-testing nothing. An unset base URL
// would otherwise make every request below fail in a way that looks like a
// broken deployment rather than a misconfigured pipeline.
function baseUrl(): string {
  const url = process.env['SMOKE_BASE_URL'];
  if (!url) throw new Error('SMOKE_BASE_URL is not set — refusing to run a vacuous smoke suite.');
  return url;
}

const IDP = /login\.microsoftonline\.com/;

/**
 * Assert that a response was produced by the Easy Auth middleware and NOT by
 * the application.
 *
 * ⚠ This is the whole point of the suite, and a bare status-code check does
 * not do it. `401` is also exactly what the app itself returns when it sees no
 * principal — so if someone put `/api/*` into `excludedPaths`, publishing the
 * owner's list at the platform edge, a status-only assertion would still pass
 * while the request now reaches application code. The three markers below can
 * only come from the platform:
 *
 *   - `x-ms-middleware-request-id` is stamped by the Easy Auth middleware.
 *   - `www-authenticate` names the Microsoft sign-in host and the Entra app.
 *   - The body is EMPTY. The app never answers with a zero-length body; every
 *     application refusal carries the JSON error envelope.
 */
async function expectPlatformChallenge(
  res: { status: () => number; headers: () => Record<string, string>; body: () => Promise<Buffer> },
  what: string,
): Promise<void> {
  expect(res.status(), `${what}: must not be served`).not.toBe(200);
  expect(res.status(), `${what}: expected the Easy Auth challenge`).toBe(401);

  const headers = res.headers();
  expect(
    headers['x-ms-middleware-request-id'],
    `${what}: not handled by Easy Auth middleware`,
  ).toBeTruthy();
  expect(headers['www-authenticate'] ?? '', `${what}: no IdP challenge`).toMatch(IDP);

  const body = await res.body();
  expect(body.length, `${what}: a body means application code ran — check excludedPaths`).toBe(0);
}

test('T-SMOKE-001 · an unauthenticated API request is intercepted by Easy Auth', async ({
  request,
}) => {
  const res = await request.get(`${baseUrl()}/api/titles`, { maxRedirects: 0 });
  await expectPlatformChallenge(res, 'GET /api/titles');
});

test('T-SMOKE-002 · the SPA itself is behind the same boundary', async ({ request }) => {
  // The app root must not be anonymously reachable either. A deployment that
  // protected /api but served the SPA shell openly would leak nothing on its
  // own, but it is the shape a misconfiguration takes on the way to leaking.
  const res = await request.get(`${baseUrl()}/`, { maxRedirects: 0 });
  await expectPlatformChallenge(res, 'GET /');
});

test('T-SMOKE-003 · a forged principal header does not get past Easy Auth', async ({ request }) => {
  // US-002 AC-4. The app trusts `x-ms-client-principal` because the platform
  // guarantees it is injected by the platform and cannot be supplied by a
  // caller. That guarantee is untestable in-process — the integration tier
  // has no Easy Auth in front of it — so it can only be proven here, against
  // a real revision.
  //
  // If this ever returns 200, the app's entire identity model is forgeable
  // by anyone on the internet who can spell a header name.
  const forged = Buffer.from(
    JSON.stringify({
      userId: 'attacker',
      userDetails: 'attacker@example.com',
      identityProvider: 'aad',
      claims: [{ typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: 'x' }],
    }),
  ).toString('base64');

  const res = await request.get(`${baseUrl()}/api/titles`, {
    maxRedirects: 0,
    headers: { 'x-ms-client-principal': forged },
  });

  await expectPlatformChallenge(res, 'forged x-ms-client-principal');
});

test('T-SMOKE-004 · the sign-in route exists and points at the tenant IdP', async ({ request }) => {
  // The three tests above prove nothing is reachable. On their own they would
  // ALSO pass against a deployment where sign-in is impossible — a wrong
  // client id, a broken provider block, or an app registration that has been
  // deleted all present as "everything is refused", which is indistinguishable
  // from "correctly secured" if you only ever assert refusal.
  const res = await request.get(`${baseUrl()}/.auth/login/aad`, { maxRedirects: 0 });

  expect(res.status(), 'the Easy Auth login route must exist').toBe(302);
  const location = res.headers()['location'] ?? '';
  expect(location, 'sign-in must go to the Microsoft IdP').toMatch(IDP);
  expect(location, 'the redirect must come back to THIS deployment').toContain(
    encodeURIComponent(`${baseUrl()}/.auth/login/aad/callback`),
  );
});
