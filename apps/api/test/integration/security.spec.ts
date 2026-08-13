/**
 * TASK-029 — the database-backed security suite:
 * `T-SEC-002`, `T-SEC-017`, `T-SEC-028`, `T-SEC-030`.
 *
 * These run against a REAL `mcr.microsoft.com/mssql/server:2022-latest`
 * (`specs/testing.md` §3.3a) with two owners seeded from
 * `tests/fixtures/seed.ts`, and they drive a REAL listening server over HTTP.
 * Both halves matter and neither is decoration:
 *
 *   - A mocked store cannot have the property under test. Owner scoping on
 *     Azure SQL is a `WHERE` clause, not a partition key (`specs/security.md`
 *     §3, R3) — a handler that forgets it returns another owner's rows at full
 *     speed with no error. Only a real query can miss.
 *   - `T-SEC-030` already has a UNIT-level implementation in
 *     `apps/api/test/unit/authChain.spec.ts`, which asserts the wire shape of
 *     the refusal with no database at all. The version here asserts the
 *     complementary thing that unit test structurally cannot: that seeded rows
 *     EXIST and are still not disclosed. A 401 over an empty database is a
 *     weaker claim than a 401 over a full one.
 *
 * ⚠ THE 404-NOT-403 RULE. A foreign id must be indistinguishable from an id
 * that does not exist (NFR-008, `specs/security.md` §3). 403 confirms the row
 * exists and belongs to someone else, which is the information leak. Several
 * assertions below check for the ABSENCE of 403 explicitly rather than only
 * the presence of 404, because the natural implementation mistake — an
 * ownership check that throws `FORBIDDEN` — produces a perfectly reasonable
 * looking 403.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express, { type Express, Router } from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  extractionCandidateSchema,
  ownerDocumentSchema,
  serviceStateSchema,
  suppressionSchema,
  titleSchema,
  uploadBatchSchema,
  uploadedImageSchema,
} from '@nextup/domain';

import { createApp } from '../../src/app.js';
import { deriveOwnerId } from '../../src/auth/ownerId.js';
import { readPrincipal } from '../../src/auth/principal.js';
import { AppError } from '../../src/errors/AppError.js';
import { requireAllowList } from '../../src/middleware/allowList.js';
import { errorEnvelope } from '../../src/middleware/errorEnvelope.js';
import { attachOwnerScope, makeRequirePrincipal } from '../../src/middleware/ownerScope.js';
import { createApiRouter } from '../../src/routes/index.js';
import {
  findRemovalGroup,
  findServiceListing,
  findTitle,
  findUploadBatch,
  type OwnerId,
} from '../../src/repository/ownerData.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';
import {
  allSeededIds,
  asOwner,
  createClock,
  planSeed,
  principalHeaderValue,
  seedOwner,
  type OwnerAgent,
  type SeededOwner,
} from '../../../../tests/fixtures/seed.js';

/* ------------------------------------------------------------------ *
 * Two owners, both allow-listed, both holding data
 * ------------------------------------------------------------------ */

const SUBJECT_A = 'oid-owner-a';
const SUBJECT_B = 'oid-owner-b';
const SUBJECT_STRANGER = 'oid-not-allow-listed';

/**
 * The issuer `principalHeaderValue` mints. The owner id is derived from
 * `issuer|subject`, so the seed must be written under the SAME derived value
 * the middleware will compute — otherwise every request would legitimately see
 * nothing and the whole suite would pass while asserting nothing.
 */
const ISSUER = 'https://sts.windows.net/tenant/';

const ownerIdFor = (subject: string): OwnerId =>
  deriveOwnerId({ subject, issuer: ISSUER, email: null });

const OWNER_A = ownerIdFor(SUBJECT_A);
const OWNER_B = ownerIdFor(SUBJECT_B);

let server: Server;
let app: Express;
let origin: string;
let ownerA: OwnerAgent;
let ownerB: OwnerAgent;
let stranger: OwnerAgent;
let seedA: SeededOwner;
let seedB: SeededOwner;

const listen = (instance: Express): Promise<Server> =>
  new Promise((resolve) => {
    const started = instance.listen(0, () => resolve(started));
  });

/**
 * Every route the app can answer, read back out of Express.
 *
 * Enumerated, never listed. The route that leaks is by definition the one
 * whoever added it also forgot to add to a hand-written list, so a literal
 * list keeps passing at exactly the moment it stops being true. `T-SEC-002f`
 * is the negative control proving this helper really finds routes.
 */
function enumerateRoutes(layers: unknown, prefix: string): { method: string; path: string }[] {
  const stack = (layers as { stack?: unknown[] }).stack ?? [];
  const out: { method: string; path: string }[] = [];

  for (const layer of stack) {
    const route = (layer as { route?: { path?: unknown; methods?: Record<string, boolean> } })
      .route;
    if (route === undefined || typeof route.path !== 'string') continue;
    for (const [method, enabled] of Object.entries(route.methods ?? {})) {
      if (enabled !== true || method === 'head') continue;
      out.push({ method: method.toUpperCase(), path: `${prefix}${route.path}` });
    }
  }
  return out;
}

/** A route is id-bearing when it names a resource by a path parameter. */
const isIdBearing = (path: string): boolean => path.includes(':');

beforeAll(async () => {
  testPrisma();
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = `${SUBJECT_A},${SUBJECT_B}`;
  app = createApp({ webRoot: '/nonexistent-web-root' });
  server = await listen(app);
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ownerA = asOwner(origin, SUBJECT_A);
  ownerB = asOwner(origin, SUBJECT_B);
  stranger = asOwner(origin, SUBJECT_STRANGER);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeTestPrisma();
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
});

beforeEach(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await resetDatabase();
  seedA = await seedOwner(OWNER_A, { prefix: 'owner-a', clock: createClock() });
  seedB = await seedOwner(OWNER_B, { prefix: 'owner-b', clock: createClock() });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * A probe app: the same chain, plus routes that DO take an id
 * ------------------------------------------------------------------ */

/**
 * ⚠ WHY THIS EXISTS, AND WHY IT IS NOT CHEATING.
 *
 * `specs/api.md` §4 specifies 30 routes, 20 of which are id-bearing. Exactly
 * ONE of them is implemented today (`GET /api/me`, which takes no id), so the
 * walk over the real router in `T-SEC-002e` currently iterates over an empty
 * set — a vacuous pass, and the exact failure class this lane exists to
 * prevent. Two things stop it being vacuous:
 *
 *   - `T-SEC-002e` still runs, and grows teeth automatically: the moment lane
 *     A registers `GET /api/titles/:titleId`, it is walked with no edit here.
 *   - The probe app below mounts the SAME middleware chain around a route
 *     backed by the SAME repository, so the 404-not-403 behaviour is asserted
 *     against a real owner-scoped miss TODAY, and `T-SEC-002f` proves the walk
 *     detects a route that leaks.
 *
 * The probe registers a correct route and a deliberately leaking one. It is a
 * test fixture and must never be imitated in `apps/api/src/**`.
 */
type Finder = (ownerId: OwnerId, id: string) => Promise<unknown>;

const FINDERS: Readonly<Record<string, Finder>> = {
  batch: findUploadBatch,
  title: findTitle,
  listing: findServiceListing,
  group: findRemovalGroup,
};

function createProbeApp(): Express {
  const probe = express();
  probe.disable('x-powered-by');

  const router = Router();

  // The CORRECT shape: owner-scoped read, and a miss is 404 — never 403.
  router.get('/probe/:kind/:id', (req, _res, next) => {
    const kind = req.params['kind'] ?? '';
    const finder = FINDERS[kind];
    if (finder === undefined) {
      next(new AppError('NOT_FOUND', 404, 'No such resource.'));
      return;
    }
    finder(req.ownerId as OwnerId, req.params['id'] ?? '')
      .then((row) => {
        if (row === null || row === undefined) {
          next(new AppError('NOT_FOUND', 404, 'No such resource.'));
          return;
        }
        _res.json({ found: true });
      })
      .catch(next);
  });

  // The LEAK, mounted on purpose: an unscoped read that answers 403 when the
  // row belongs to someone else. `T-SEC-002f` requires the walk to catch it.
  router.get('/leak/:id', (req, _res, next) => {
    testPrisma()
      .title.findFirst({ where: { id: req.params['id'] ?? '' } })
      .then((row) => {
        if (row === null) {
          next(new AppError('NOT_FOUND', 404, 'No such resource.'));
          return;
        }
        if (row.ownerId !== req.ownerId) {
          next(new AppError('NOT_ALLOWED', 403, 'Not yours.'));
          return;
        }
        _res.json({ found: true });
      })
      .catch(next);
  });

  probe.use('/api', makeRequirePrincipal(readPrincipal));
  probe.use('/api', requireAllowList);
  probe.use('/api', attachOwnerScope);
  probe.use('/api', router);
  probe.use('/api', errorEnvelope);
  return probe;
}

let probeServer: Server;
let probeOrigin: string;

beforeAll(async () => {
  probeServer = await listen(createProbeApp());
  probeOrigin = `http://127.0.0.1:${(probeServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => probeServer.close(() => resolve()));
});

/**
 * Walk a set of id-bearing routes as `agent`, substituting each foreign id.
 *
 * The agent already carries its own origin, so paths are passed relative — an
 * earlier version prefixed the origin a second time and every request failed
 * with ERR_INVALID_URL, which would have looked like a passing walk had the
 * assertions been written to tolerate errors.
 */
async function statusesForForeignIds(
  agent: OwnerAgent,
  paths: { method: string; path: string }[],
  ids: readonly string[],
): Promise<string[]> {
  const results: string[] = [];
  for (const route of paths) {
    for (const id of ids) {
      const path = route.path.replace(/:[A-Za-z]+/g, id);
      const res = await agent.request(route.method, path);
      results.push(`${route.method} ${path} -> ${res.status}`);
    }
  }
  return results;
}

/* ================================================================== *
 * T-SEC-002 — cross-owner access returns 404, never 403
 * ================================================================== */

describe('T-SEC-002 · US-002 AC-3 · another owner’s id is indistinguishable from a missing one', () => {
  it('T-SEC-002a · the two seeded owners hold identical data under disjoint ids', async () => {
    // The vacuous-pass guard for everything below. If owner B held nothing,
    // "owner A cannot see owner B's rows" would be true for the wrong reason,
    // and if the ids overlapped a leak would be unprovable.
    const overlap = allSeededIds(seedA).filter((id) => allSeededIds(seedB).includes(id));
    expect(overlap).toEqual([]);
    expect(allSeededIds(seedA).length).toBeGreaterThan(5);
    expect(allSeededIds(seedA)).toHaveLength(allSeededIds(seedB).length);

    // Both owners really are in the store, under their own scope.
    expect(await findTitle(OWNER_A, seedA.titleIds[0] as string)).not.toBeNull();
    expect(await findTitle(OWNER_B, seedB.titleIds[0] as string)).not.toBeNull();
  });

  it('T-SEC-002b · the seed is deterministic, so a leak is reproducible', () => {
    // A fixture built from `new Date()` or a random id makes a failure
    // impossible to re-run. `planSeed` is pure over an injected clock.
    expect(planSeed('owner-a', createClock())).toEqual(planSeed('owner-a', createClock()));
  });

  it('T-SEC-002c · every repository finder returns nothing for the other owner’s id', async () => {
    // The data layer is where the `WHERE ownerId` either is or is not.
    const misses: string[] = [];
    for (const [kind, finder] of Object.entries(FINDERS)) {
      const foreign = allSeededIds(seedB).filter((id) => id.includes(`-${kind}-`));
      expect(foreign.length, `the seed has no ${kind} to probe with`).toBeGreaterThan(0);
      for (const id of foreign) {
        const row = await finder(OWNER_A, id);
        if (row !== null && row !== undefined) misses.push(`${kind} ${id} leaked to owner A`);
      }
    }
    expect(misses).toEqual([]);
  });

  it('T-SEC-002d · an id-bearing route answers 404 — not 403 — for a foreign id', async () => {
    const statuses = await statusesForForeignIds(
      asOwner(probeOrigin, SUBJECT_A),
      [{ method: 'GET', path: '/api/probe/title/:titleId' }],
      seedB.titleIds,
    );
    expect(statuses.every((s) => s.endsWith('-> 404'))).toBe(true);
    expect(statuses.some((s) => s.endsWith('-> 403'))).toBe(false);
  });

  it('T-SEC-002e · the same route answers 200 for the caller’s OWN id', async () => {
    // The accept half of the pair. Without it, a route that 404s on
    // everything — including a broken query — would satisfy T-SEC-002d.
    const own = asOwner(probeOrigin, SUBJECT_A);
    const res = await own.get(`/api/probe/title/${seedA.titleIds[0] as string}`);
    expect(res.status).toBe(200);
  });

  it('T-SEC-002f · the walk CATCHES a route that answers 403 for a foreign id', async () => {
    // The mutation. `/api/leak/:id` is a deliberately incorrect handler that
    // confirms the row exists and belongs to someone else. If the assertions
    // in T-SEC-002d could not see this, they would be asserting nothing.
    const statuses = await statusesForForeignIds(
      asOwner(probeOrigin, SUBJECT_A),
      [{ method: 'GET', path: '/api/leak/:titleId' }],
      seedB.titleIds,
    );
    expect(statuses.some((s) => s.endsWith('-> 403'))).toBe(true);
    expect(statuses.every((s) => s.endsWith('-> 404'))).toBe(false);
  });

  it('T-SEC-002g · every id-bearing route on the REAL router refuses a foreign id', async () => {
    // Enumerated from the shipped router, so a route added by any lane is
    // covered here the moment it is registered, with no edit to this file.
    const routes = enumerateRoutes(createApiRouter(), '/api').filter((r) => isIdBearing(r.path));
    const statuses = await statusesForForeignIds(ownerA, routes, allSeededIds(seedB));

    const leaked = statuses.filter((s) => !s.endsWith('-> 404'));
    expect(leaked, 'these routes disclosed something about another owner’s id').toEqual([]);

    // Symmetrically, in the other direction. Owner A happens to be seeded
    // first; a scoping bug that only leaks "downwards" would survive a
    // one-directional walk.
    const reverse = await statusesForForeignIds(ownerB, routes, allSeededIds(seedA));
    expect(reverse.filter((s) => !s.endsWith('-> 404'))).toEqual([]);
  });

  it('T-SEC-002h · the route enumeration is not silently empty', () => {
    // T-SEC-002g iterates over whatever the enumeration returns. If Express's
    // internals changed shape and it returned [], that test would pass having
    // checked nothing — so the enumeration itself is asserted.
    const all = enumerateRoutes(createApiRouter(), '/api');
    expect(all.length, 'no routes were enumerated from the API router').toBeGreaterThan(0);
    expect(all).toContainEqual({ method: 'GET', path: '/api/me' });

    const probe = Router();
    probe.get('/thing/:thingId', (_req, res) => res.json({}));
    expect(enumerateRoutes(probe, '/api').filter((r) => isIdBearing(r.path))).toHaveLength(1);
  });
});

/* ================================================================== *
 * T-SEC-017 — an allow-listed-out identity gets NO data
 * ================================================================== */

describe('T-SEC-017 · US-001 AC-4 · a signed-in stranger receives no data at all', () => {
  it('T-SEC-017a · every enumerated route refuses a principal outside the allow-list', async () => {
    const routes = enumerateRoutes(createApiRouter(), '/api');
    expect(routes.length).toBeGreaterThan(0);

    const answered: string[] = [];
    for (const route of routes) {
      const path = route.path.replace(/:[A-Za-z]+/g, seedA.titleIds[0] as string);
      const res = await stranger.request(route.method, path);
      if (res.status !== 403) answered.push(`${route.method} ${path} -> ${res.status}`);
    }
    expect(answered, 'these routes answered a non-allow-listed principal').toEqual([]);
  });

  it('T-SEC-017b · the refusal body carries none of the seeded data', async () => {
    // The highest-value test in the product: the refusal must be a refusal,
    // not a refusal with the list attached to it.
    const res = await stranger.get('/api/me');
    const body = await res.text();
    for (const id of allSeededIds(seedA)) {
      expect(body).not.toContain(id);
    }
    expect(body).not.toContain('A Matched Work');
    expect(body).not.toContain(OWNER_A);
  });

  it('T-SEC-017c · the same data IS readable by the allow-listed owner', async () => {
    // The accept half. A server that refuses everyone also passes T-SEC-017a.
    const res = await ownerA.get('/api/me');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ownerId: string };
    expect(body.ownerId).toBe(OWNER_A);
  });

  it('T-SEC-017d · an emptied allow-list refuses the owner too, and discloses nothing', async () => {
    const previous = process.env['NEXTUP_ALLOWED_SUBJECTS'];
    delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
    try {
      const res = await ownerA.get('/api/me');
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain(OWNER_A);
    } finally {
      process.env['NEXTUP_ALLOWED_SUBJECTS'] = previous;
    }
  });
});

/* ================================================================== *
 * T-SEC-028 — ownerId is required on every stored document
 * ================================================================== */

describe('T-SEC-028 · US-002 AC-1 · every stored document is owner-stamped', () => {
  const SCHEMAS = {
    title: titleSchema,
    suppression: suppressionSchema,
    uploadBatch: uploadBatchSchema,
    uploadedImage: uploadedImageSchema,
    extractionCandidate: extractionCandidateSchema,
    serviceState: serviceStateSchema,
  } as const;

  it('T-SEC-028a · every document schema in the union is covered here', () => {
    // The union is the closed set of stored documents. If a seventh document
    // type is added and not listed above, this fails rather than letting the
    // new type escape the ownerId assertion.
    const options = (ownerDocumentSchema as unknown as { options: unknown[] }).options;
    expect(options).toHaveLength(Object.keys(SCHEMAS).length);
  });

  it('T-SEC-028b · every document schema REJECTS a document without ownerId', () => {
    const accepted: string[] = [];
    for (const [name, schema] of Object.entries(SCHEMAS)) {
      // An empty object is missing ownerId among other things; the assertion
      // that matters is that `ownerId` is named in the failure, so the schema
      // is refusing it specifically rather than incidentally.
      const result = schema.safeParse({});
      if (result.success) {
        accepted.push(name);
        continue;
      }
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths, `${name} does not require ownerId`).toContain('ownerId');
    }
    expect(accepted, 'these schemas accepted a document with no ownerId').toEqual([]);
  });

  it('T-SEC-028c · every table in the live schema has a NOT NULL owner_id column', async () => {
    // The other half, and the one a Zod test cannot make: the STORE refuses an
    // owner-less row. Read from the running database, not from the schema file.
    const rows = await testPrisma().$queryRawUnsafe<{ table: string; nullable: string }[]>(`
      SELECT t.TABLE_NAME AS [table], ISNULL(c.IS_NULLABLE, 'MISSING') AS [nullable]
      FROM INFORMATION_SCHEMA.TABLES t
      LEFT JOIN INFORMATION_SCHEMA.COLUMNS c
        ON c.TABLE_NAME = t.TABLE_NAME AND c.COLUMN_NAME = 'owner_id'
      WHERE t.TABLE_TYPE = 'BASE TABLE' AND t.TABLE_NAME NOT LIKE '\\_%' ESCAPE '\\'
    `);

    expect(rows.length, 'no tables were found — the migration did not run').toBeGreaterThan(5);
    const bad = rows.filter((r) => r.nullable !== 'NO').map((r) => `${r.table}: ${r.nullable}`);
    expect(bad, 'these tables have no NOT NULL owner_id column').toEqual([]);
  });
});

/* ================================================================== *
 * T-SEC-030 — no principal → 401 JSON envelope, over a FULL database
 * ================================================================== */

describe('T-SEC-030 · US-002 AC-4 · a missing or malformed principal discloses nothing', () => {
  it('T-SEC-030d · a missing principal gets the 401 envelope while data exists', async () => {
    const res = await fetch(`${origin}/api/me`);
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('T-SEC-030e · a malformed principal header is refused, not partially trusted', async () => {
    for (const value of ['not-base64 !!!', '', Buffer.from('{}').toString('base64')]) {
      const res = await fetch(`${origin}/api/me`, {
        headers: { 'x-ms-client-principal': value },
      });
      expect(res.status, `header ${JSON.stringify(value)} was not refused`).toBe(401);
    }
  });

  it('T-SEC-030f · a forged principal for an unknown subject reaches no data', async () => {
    const forged = await fetch(`${origin}/api/me`, {
      headers: { 'x-ms-client-principal': principalHeaderValue('oid-forged') },
    });
    // Signed in as far as the header goes, but not allow-listed: 403, and the
    // seeded rows must not appear in the body.
    expect(forged.status).toBe(403);
    const body = await forged.text();
    for (const id of allSeededIds(seedA)) expect(body).not.toContain(id);
  });

  it('T-SEC-030g · the refusal is never an HTML redirect to a sign-in page', async () => {
    const res = await fetch(`${origin}/api/me`, { redirect: 'manual' });
    expect(res.status).toBe(401);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('content-type')).not.toContain('text/html');
  });
});
