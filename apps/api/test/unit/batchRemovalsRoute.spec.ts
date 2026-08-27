/**
 * TASK-085 — `PATCH /api/batches/:batchId/removals` driven WITHOUT a store
 * (`specs/api.md` §6.21, US-015, REQ-021, REQ-055).
 *
 * ⚠ Not a second copy of `test/integration/batchRemovals.spec.ts`. Coverage is
 * measured on the `unit` project, which CI job 4 runs with no database at all,
 * so a route proven only at integration level scores near zero against the
 * `apps/api/src/**` floor — the same reasoning `batchReviewRoutes.spec.ts`
 * carries. What integration proves and this cannot is the part a stub could
 * only agree with: owner scoping enforced by the query, the composite key, and
 * the transaction.
 *
 * The repository is stubbed at its MODULE boundary, because that boundary is
 * where owner scoping is expressed; stubbing Prisma underneath it would let a
 * route that forgot `ownerId` still pass here.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-removals-unit';

interface BatchRow {
  id: string;
  service: string;
  status: string;
  mode: string;
  lowYield?: boolean;
  degradedExtraction?: boolean;
  crossCheck?: string | null;
}

interface ListingRow {
  listingId: string;
  titleId: string;
  service: string;
  state: string;
  dateAdded: Date;
  title: {
    workIdentity: string;
    tmdbName: string | null;
    tmdbReleaseYear: number | null;
    tmdbPosterPath: string | null;
    rawExtractedText: string | null;
  };
}

const makeListing = (listingId: string, workIdentity: string, name: string): ListingRow => ({
  listingId,
  titleId: `t-${listingId}`,
  service: 'netflix',
  state: 'active',
  dateAdded: new Date('2026-01-05T00:00:00Z'),
  title: {
    workIdentity,
    tmdbName: name,
    tmdbReleaseYear: 2021,
    tmdbPosterPath: null,
    rawExtractedText: null,
  },
});

/**
 * The stub store. `decisions` is the `removal_decision` table: absence of an
 * entry means TICKED (REQ-055), exactly as in the real schema, so a route that
 * inverted the default cannot pass by agreeing with a stub that pre-seeded
 * every proposal.
 */
const store: {
  batch: BatchRow | null;
  listings: ListingRow[];
  decisions: Map<string, boolean>;
  writes: { listingIds: readonly string[]; ticked: boolean }[];
  transactions: number;
} = {
  batch: null,
  listings: [],
  decisions: new Map(),
  writes: [],
  transactions: 0,
};

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    findUploadBatch: (_ownerId: string, batchId: string) =>
      Promise.resolve(store.batch !== null && store.batch.id === batchId ? store.batch : null),
    listCandidatesForReview: () => Promise.resolve([]),
    listActiveSuppressions: () => Promise.resolve([]),
    listActiveListingsForService: () => Promise.resolve(store.listings),
    listImagesForBatch: () => Promise.resolve([]),
    listRemovalDecisions: () =>
      Promise.resolve([...store.decisions].map(([listingId, ticked]) => ({ listingId, ticked }))),
    setRemovalDecisions: (
      _ownerId: string,
      _batchId: string,
      listingIds: readonly string[],
      ticked: boolean,
    ) => {
      store.writes.push({ listingIds, ticked });
      for (const id of listingIds) store.decisions.set(id, ticked);
      return Promise.resolve();
    },
    runInTransaction: <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
      store.transactions += 1;
      return work(undefined);
    },
  };
});

const principalHeader = (): string =>
  Buffer.from(
    JSON.stringify({
      claims: [
        { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
        { typ: OID, val: SUBJECT },
      ],
    }),
    'utf8',
  ).toString('base64');

let server: Server;
let app: Express;
let origin: string;

const patchRemovals = (batchId: string, body: unknown): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/removals`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      [CLIENT_PRINCIPAL_HEADER]: principalHeader(),
    },
    body: JSON.stringify(body),
  });

interface PatchBody {
  tickedCount: number;
  untickedCount: number;
  totalCount: number;
}

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

beforeEach(async () => {
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  process.env['TMDB_API_KEY'] = 'unit-fixture-key-not-a-real-secret';

  store.batch = { id: 'batch-1', service: 'netflix', status: 'in-review', mode: 'full-update' };
  // No candidate names either listing, so both are proposed for removal.
  store.listings = [
    makeListing('listing-andor', 'tmdb:tv:83867', 'Andor'),
    makeListing('listing-heat', 'tmdb:movie:949', 'Heat'),
  ];
  store.decisions = new Map();
  store.writes = [];
  store.transactions = 0;

  const { createApp } = await import('../../src/app.js');
  app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('T-REM-014 · PATCH /removals without a store', () => {
  it('T-REM-014x: unticks the named listing and reports counts over the whole batch', async () => {
    const res = await patchRemovals('batch-1', { untick: ['listing-andor'] });
    expect(res.status).toBe(200);
    expect((await res.json()) as PatchBody).toEqual({
      tickedCount: 1,
      untickedCount: 1,
      totalCount: 2,
    });
    expect(store.decisions.get('listing-andor')).toBe(false);
    // ⚠ Only the deviation is written. A row per proposal would have to be
    // reconciled as the removal set is recomputed, and every gap in that
    // bookkeeping presents as a removal the owner never ticked.
    expect(store.decisions.size).toBe(1);
  });

  it('T-REM-014y: applies the whole press inside ONE transaction', async () => {
    const res = await patchRemovals('batch-1', {
      untick: ['listing-andor'],
      tick: ['listing-heat'],
    });
    expect(res.status).toBe(200);
    expect(store.transactions).toBe(1);
    expect(store.writes).toEqual([
      { listingIds: ['listing-andor'], ticked: false },
      { listingIds: ['listing-heat'], ticked: true },
    ]);
  });

  it('T-REM-014z: refuses a listing this batch does not propose, writing nothing', async () => {
    const res = await patchRemovals('batch-1', { tick: ['listing-elsewhere'] });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.details['listingIds']).toEqual(['listing-elsewhere']);
    expect(store.transactions).toBe(0);
    expect(store.decisions.size).toBe(0);
  });

  it('T-REM-014aa: 404 when the batch does not belong to the owner', async () => {
    const res = await patchRemovals('batch-elsewhere', { untick: ['listing-andor'] });
    expect(res.status).toBe(404);
    expect(store.transactions).toBe(0);
  });

  it('T-REM-014ab: 409 while the batch is still extracting', async () => {
    store.batch = { id: 'batch-1', service: 'netflix', status: 'extracting', mode: 'full-update' };
    const res = await patchRemovals('batch-1', { untick: ['listing-andor'] });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('BATCH_NOT_IN_REVIEW');
  });

  it('T-REM-014ac: 400 for an append-only batch — it proposes no removals at all', async () => {
    store.batch = { id: 'batch-1', service: 'netflix', status: 'in-review', mode: 'append-only' };
    const res = await patchRemovals('batch-1', { untick: ['listing-andor'] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details['mode']).toBe('append-only');
  });

  it('T-REM-014ad: 404 before 400 — a foreign id is refused before its body is read', async () => {
    const res = await patchRemovals('batch-elsewhere', { tick: 'listing-andor' });
    expect(res.status).toBe(404);
    const own = await patchRemovals('batch-1', { tick: 'listing-andor' });
    expect(own.status).toBe(400);
    expect(((await own.json()) as ErrorBody).error.details['reason']).toBe('not-an-array');
  });

  it('T-REM-014ae: counts a stored untick only while the listing is still proposed', async () => {
    store.decisions.set('listing-gone', false);
    const res = await patchRemovals('batch-1', { untick: ['listing-andor'] });
    expect(res.status).toBe(200);
    expect((await res.json()) as PatchBody).toEqual({
      tickedCount: 1,
      untickedCount: 1,
      totalCount: 2,
    });
  });
});
