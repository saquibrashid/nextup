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

test('T-SMOKE-001 · an unauthenticated API request is intercepted by Easy Auth', async ({
  request,
}) => {
  // ⚠ 302 to the Microsoft sign-in page, NOT 401 JSON. security.md §2.1
  // fixes `unauthenticatedClientAction: RedirectToLoginPage`, which is
  // global and has no per-path variant, so this is what a CORRECTLY
  // configured deployment does. See specs/testing.md §18.2 — asserting 401
  // here would only pass if someone had added `/api/*` to `excludedPaths`,
  // i.e. published the owner's list to the internet.
  const res = await request.get(`${baseUrl()}/api/titles`, { maxRedirects: 0 });

  expect(res.status(), 'expected a redirect to the IdP').toBe(302);
  expect(res.headers()['location'] ?? '').toMatch(IDP);
});

test('T-SMOKE-002 · the SPA itself is behind the same boundary', async ({ request }) => {
  // The app root must not be anonymously reachable either. A deployment that
  // protected /api but served the SPA shell openly would leak nothing on its
  // own, but it is the shape a misconfiguration takes on the way to leaking.
  const res = await request.get(`${baseUrl()}/`, { maxRedirects: 0 });

  expect(res.status()).toBe(302);
  expect(res.headers()['location'] ?? '').toMatch(IDP);
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

  expect(res.status(), 'a forged principal header must not authenticate').not.toBe(200);
  expect(res.status()).toBe(302);
  expect(res.headers()['location'] ?? '').toMatch(IDP);
});
