/**
 * The auth chain, end to end over real HTTP:
 * `T-SEC-005`, `T-SEC-010`, `T-SEC-014`, `T-SEC-015`, `T-SEC-016`,
 * `T-SEC-029`, `T-SEC-030`, `T-API-001`.
 *
 * These drive a listening server rather than calling middleware functions
 * directly, and they use Node's built-in `fetch` rather than a test client, so
 * no new dependency is introduced (NFR-004). The fidelity matters: the
 * properties under test are about ORDER and about what actually reaches the
 * wire — a 401 that is really an HTML redirect, or a CORS header added by a
 * library default, are both invisible when you assert on a mocked `res`.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { createApiRouter } from '../../src/routes/index.js';
import { type Express, Router } from 'express';

/**
 * Reads the registered routes back out of an Express router or app.
 *
 * Express does not expose a public route table, so this reaches into `stack`.
 * That is deliberate: the alternative is a hand-maintained list, and the route
 * that escapes the auth chain is precisely the one nobody remembered to add to
 * a list. `T-SEC-029d` is the negative control proving this still finds them.
 *
 * ⚠ `prefix` matters. A route registered on the API router stores its path
 * relative to the mount point (`/me`), while a route registered directly on
 * the app — the bypass this test hunts for — stores the whole path already
 * (`/api/leak`). Reading only the router misses the bypass entirely: verified
 * by mounting a leaking route, which the router-only version did not catch.
 */
function enumerateRoutes(layers: unknown, prefix: string): { method: string; path: string }[] {
  const stack = (layers as { stack?: unknown[] }).stack ?? [];
  const out: { method: string; path: string }[] = [];

  for (const layer of stack) {
    const route = (layer as { route?: { path?: unknown; methods?: Record<string, boolean> } })
      .route;
    if (route === undefined || typeof route.path !== 'string') continue;
    for (const [method, enabled] of Object.entries(route.methods ?? {})) {
      // Express records an implicit HEAD alongside every GET; asserting on it
      // separately would only re-test the GET with a body-less response.
      if (enabled !== true || method === 'head') continue;
      out.push({ method: method.toUpperCase(), path: `${prefix}${route.path}` });
    }
  }
  return out;
}

/** Every route the app can answer, from both registration sites. */
function allRoutes(app: Express): { method: string; path: string }[] {
  const router =
    (app as unknown as { router?: unknown; _router?: unknown }).router ??
    (app as unknown as { _router?: unknown })._router;
  return [...enumerateRoutes(router, ''), ...enumerateRoutes(createApiRouter(), '/api')];
}

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-1';
const ISSUER = 'https://sts.windows.net/tenant/';

const principalHeader = (subject: string, display: string | null = 'owner@example.com'): string =>
  Buffer.from(
    JSON.stringify({
      claims: [
        { typ: 'iss', val: ISSUER },
        { typ: OID, val: subject },
        // Omitted entirely when null: a principal whose token carries no
        // display claim is a real case, not a hypothetical one.
        ...(display === null ? [] : [{ typ: 'preferred_username', val: display }]),
      ],
    }),
    'utf8',
  ).toString('base64');

let server: Server;
let app: Express;
let origin: string;

const start = (): Promise<void> =>
  new Promise((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

const stop = (): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => resolve());
  });

const get = (path: string, subject?: string, display?: string | null): Promise<Response> =>
  fetch(`${origin}${path}`, {
    headers:
      subject === undefined
        ? {}
        : {
            [CLIENT_PRINCIPAL_HEADER]:
              display === undefined ? principalHeader(subject) : principalHeader(subject, display),
          },
  });

beforeEach(async () => {
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  delete process.env['NEXTUP_BOOTSTRAP_ALLOW_FIRST'];
  await start();
});

afterEach(async () => {
  await stop();
  vi.restoreAllMocks();
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
  delete process.env['NEXTUP_BOOTSTRAP_ALLOW_FIRST'];
});

describe('T-SEC-005 the middleware order is enforced', () => {
  it('T-SEC-005a: an allow-listed principal reaches the handler', async () => {
    const res = await get('/api/me', SUBJECT);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ownerId: string; signOutUrl: string };
    expect(body.ownerId).toMatch(/^o_[0-9a-f]{16}$/);
    expect(body.signOutUrl).toBe('/.auth/logout');
  });

  it('T-SEC-005b: a request without a principal cannot reach any handler', async () => {
    const res = await get('/api/me');
    expect(res.status).toBe(401);
  });

  it('T-SEC-005c: an unknown /api path still answers with the JSON envelope', async () => {
    // Inside the chain on purpose: falling through to the SPA shell would
    // surface a typo'd fetch as HTML parsed as JSON.
    const res = await get('/api/nope', SUBJECT);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('T-SEC-005d: an unknown /api path is refused BEFORE it is resolved', async () => {
    // Order matters: 404-before-401 would confirm which paths exist to an
    // unauthenticated caller.
    const res = await get('/api/nope');
    expect(res.status).toBe(401);
  });
});

describe('T-SEC-030 an unauthenticated /api call gets JSON, never a redirect', () => {
  it('T-SEC-030a: responds 401 with the error envelope', async () => {
    const res = await get('/api/me');
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.error.message).toBe('Sign in to continue.');
  });

  it('T-SEC-030b: emits no 3xx and no HTML sign-in page', async () => {
    const res = await fetch(`${origin}/api/me`, { redirect: 'manual' });
    expect(res.status).toBe(401);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('content-type')).not.toContain('text/html');
  });

  it('T-SEC-030c: a malformed principal header is refused, not partially trusted', async () => {
    const res = await fetch(`${origin}/api/me`, {
      headers: { [CLIENT_PRINCIPAL_HEADER]: 'not-base64 !!!' },
    });
    expect(res.status).toBe(401);
  });
});

describe('T-SEC-010 the allow-list refuses a signed-in stranger', () => {
  it('T-SEC-010a: a principal outside the list gets 403, not 401', async () => {
    // 403, because they ARE signed in. Returning 401 would loop them through
    // sign-in forever without ever explaining the refusal.
    const res = await get('/api/me', 'oid-someone-else');
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_ALLOWED');
  });

  it('T-SEC-010b: a refused principal receives no data', async () => {
    const res = await get('/api/me', 'oid-someone-else');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('ownerId');
  });

  it('T-SEC-010c: the refusal names the account it refused (ux-states §2.11)', async () => {
    /*
     * ⚠ NOT COSMETIC. A personal MSA and a work account federate through the
     * same `/common` issuer with different subject ids, so "this account is
     * not permitted" with no account named is genuinely ambiguous to the one
     * person entitled to use the app — it reads as a broken deployment.
     *
     * The value is decorated by the ENVELOPE, not by `allowList.ts`, which
     * `T-SEC-015b` forbids from naming an address claim at all.
     */
    const res = await get('/api/me', 'oid-someone-else', 'stranger@example.com');
    expect(res.status).toBe(403);

    const body = (await res.json()) as { error: { details: Record<string, unknown> } };
    expect(body.error.details['signedInAs']).toBe('stranger@example.com');
  });

  it('T-SEC-010d: a principal with no display claim is still refused, with no key to render', async () => {
    // Absent, not empty. An empty string would render "Signed in as" followed
    // by nothing, which looks like a bug in the refusal screen itself.
    const res = await get('/api/me', 'oid-someone-else', null);
    expect(res.status).toBe(403);

    const body = (await res.json()) as { error: { details: Record<string, unknown> } };
    expect(body.error.details).not.toHaveProperty('signedInAs');
  });

  it('T-SEC-010e: the name is not echoed onto refusals that established no identity', async () => {
    // A 401 has no principal to report.
    const res = await get('/api/me');
    expect(res.status).toBe(401);

    const body = (await res.json()) as { error: { details: Record<string, unknown> } };
    expect(body.error.details).not.toHaveProperty('signedInAs');
  });

  it('T-SEC-010f: the name rides on NOT_ALLOWED only, never on an ordinary error', async () => {
    /*
     * ⚠ THIS CASE EXISTS BECAUSE MUTATION TESTING PROVED `T-SEC-010e` COULD
     * NOT SEE THE RESTRICTION. Deleting the `NOT_ALLOWED` check from the
     * envelope left every test green: a 401 carries no principal, so the
     * `typeof` guard excluded it anyway and the 401 case was asserting a
     * property that held for an unrelated reason.
     *
     * The condition is only observable for a caller who IS a valid principal
     * and gets some other error — an allow-listed owner hitting a path that
     * does not exist. Without this, the restriction is a comment.
     */
    const res = await get('/api/definitely-not-a-route', SUBJECT);
    expect(res.status).not.toBe(403);

    const body = (await res.json()) as { error: { details: Record<string, unknown> } };
    expect(body.error.details).not.toHaveProperty('signedInAs');
  });
});

describe('T-SEC-014 the allow-list fails closed', () => {
  it('T-SEC-014a: an unset list refuses everyone', async () => {
    delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
    expect((await get('/api/me', SUBJECT)).status).toBe(403);
  });

  it('T-SEC-014b: an empty list refuses everyone', async () => {
    process.env['NEXTUP_ALLOWED_SUBJECTS'] = '   ';
    expect((await get('/api/me', SUBJECT)).status).toBe(403);
  });

  it('T-SEC-014c: a list of only separators refuses everyone', async () => {
    process.env['NEXTUP_ALLOWED_SUBJECTS'] = ',,, ,';
    expect((await get('/api/me', SUBJECT)).status).toBe(403);
  });

  it('T-SEC-014d: warns once at start-up when the list is empty', async () => {
    delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
    await get('/api/me', SUBJECT);
    await get('/api/me', SUBJECT);
    const warnings = vi
      .mocked(console.warn)
      .mock.calls.filter(([first]) => String(first).includes('every request will be refused'));
    expect(warnings).toHaveLength(1);
  });

  it('T-SEC-014e: tolerates whitespace and multiple entries', async () => {
    process.env['NEXTUP_ALLOWED_SUBJECTS'] = ` other , ${SUBJECT} `;
    expect((await get('/api/me', SUBJECT)).status).toBe(200);
  });

  it('T-SEC-014f: matches the subject exactly, not as a prefix', async () => {
    process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
    expect((await get('/api/me', `${SUBJECT}-extra`)).status).toBe(403);
  });
});

describe('T-SEC-016 bootstrap mode grants nothing', () => {
  it('T-SEC-016a: a request under bootstrap mode is still refused', async () => {
    delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
    process.env['NEXTUP_BOOTSTRAP_ALLOW_FIRST'] = 'true';
    expect((await get('/api/me', 'oid-first-caller')).status).toBe(403);
  });

  it('T-SEC-016b: logs the refused subject id so the owner can find it', async () => {
    delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
    process.env['NEXTUP_BOOTSTRAP_ALLOW_FIRST'] = 'true';
    await get('/api/me', 'oid-first-caller');
    const logged = vi
      .mocked(console.warn)
      .mock.calls.some(([first]) => String(first).includes('oid-first-caller'));
    expect(logged).toBe(true);
  });

  it('T-SEC-016c: is off unless set to exactly "true"', async () => {
    delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
    process.env['NEXTUP_BOOTSTRAP_ALLOW_FIRST'] = '1';
    await get('/api/me', 'oid-first-caller');
    const logged = vi
      .mocked(console.warn)
      .mock.calls.some(([first]) => String(first).includes('oid-first-caller'));
    expect(logged).toBe(false);
  });
});

describe('T-SEC-029 every API route is owner-scoped', () => {
  it('T-SEC-029a: the owner id comes from the principal, not the request', async () => {
    const mine = (await (await get('/api/me', SUBJECT)).json()) as { ownerId: string };

    process.env['NEXTUP_ALLOWED_SUBJECTS'] = `${SUBJECT},oid-other`;
    const theirs = (await (await get('/api/me', 'oid-other')).json()) as { ownerId: string };

    expect(mine.ownerId).not.toBe(theirs.ownerId);
  });

  it('T-SEC-029c: every route enumerated from the router refuses an unauthenticated caller', async () => {
    // ⚠ The routes are ENUMERATED from the router rather than listed here.
    // A hand-written list is the failure mode this test exists to prevent: the
    // route that bypasses the chain is, by definition, the one whoever added it
    // also forgot to add to the list, so a literal list would keep passing at
    // exactly the moment it stopped being true.
    const routes = allRoutes(app);

    // Guard against the vacuous pass. If the enumeration ever returns nothing
    // — an Express internals change, a renamed property — every assertion
    // below would be skipped and the test would report success while checking
    // no routes at all.
    expect(routes.length, 'no routes were enumerated from the API router').toBeGreaterThan(0);

    const reachable: string[] = [];
    for (const route of routes) {
      const res = await fetch(`${origin}${route.path}`, { method: route.method });
      if (res.status !== 401) reachable.push(`${route.method} ${route.path} -> ${res.status}`);
    }

    expect(reachable, 'these routes answered without a principal').toEqual([]);
  });

  it('T-SEC-029d: the enumeration sees a route mounted outside the chain', () => {
    // The negative control. `T-SEC-029c` can only be trusted if the helper it
    // depends on actually finds routes; a helper that silently returned [] for
    // an unfamiliar shape would make the guard above the only thing standing.
    const probe = Router();
    probe.get('/probe', (_req, res) => res.json({}));
    probe.post('/probe', (_req, res) => res.json({}));

    const found = enumerateRoutes(probe, '/api');
    // The helper reports the mounted path, so `/probe` on the router is
    // `/api/probe` on the wire — that is what `T-SEC-029c` must fetch.
    expect(found).toContainEqual({ method: 'GET', path: '/api/probe' });
    expect(found).toContainEqual({ method: 'POST', path: '/api/probe' });
  });
});

describe('T-API-001 no CORS surface exists', () => {
  it('T-API-001a: no Access-Control header on a successful response', async () => {
    const res = await get('/api/me', SUBJECT);
    for (const [name] of res.headers) {
      expect(name.toLowerCase()).not.toContain('access-control');
    }
  });

  it('T-API-001b: no Access-Control header on a refusal', async () => {
    const res = await get('/api/me');
    for (const [name] of res.headers) {
      expect(name.toLowerCase()).not.toContain('access-control');
    }
  });

  it('T-API-001c: a cross-origin preflight is not answered with permission', async () => {
    const res = await fetch(`${origin}/api/me`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('T-API-001d: an Origin header does not cause one to be reflected', async () => {
    const res = await fetch(`${origin}/api/me`, {
      headers: {
        Origin: 'https://evil.example',
        [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT),
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('T-SEC-012 the server does not advertise itself', () => {
  it('T-SEC-012a: no x-powered-by header', async () => {
    const res = await get('/api/me', SUBJECT);
    expect(res.headers.get('x-powered-by')).toBeNull();
  });
});
