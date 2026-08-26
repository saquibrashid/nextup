/**
 * TASK-071 — `POST /api/batches/:batchId/close` driven WITHOUT a store
 * (`specs/api.md` §6.22).
 *
 * ⚠ This is not a second copy of `test/integration/batchClose.spec.ts`.
 * Coverage is measured on the `unit` project, which CI job 4 runs with no
 * database at all, so a route proven only in `test/integration` scores near
 * zero against the `apps/api/src/**` floor and fails the gate. The rationale
 * is written down in the header of `test/unit/suppressions.spec.ts` and is the
 * same one `test/unit/batchReviewRoutes.spec.ts` follows.
 *
 * What the integration suite proves and this CANNOT is everything a stub could
 * only agree with: owner scoping enforced by the query, the SQL CHECK
 * constraints, and — above all — that the transaction is real. `T-REV-012af`
 * is the only test in the project that can prove rollback, and it needs an
 * engine. Nothing here should be read as covering that.
 *
 * The repository module is stubbed at its module boundary, partially, so that
 * unrelated helpers (`asOwnerId`, used by the auth chain) still exist.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-close-unit';
const DUNE = 'tmdb:movie:438631';

interface BatchRow {
  id: string;
  service: string;
  status: string;
  mode: string;
}

interface CandidateRow {
  id: string;
  batchId: string;
  rawText: string;
  normalisedText: string;
  inferredTitle: string | null;
  cleanupVerdict: string;
  classification: string | null;
  matchState: string | null;
  resolvedWorkIdentity: string | null;
  correctedToTmdbId: number | null;
  reviewDisposition: string;
  collapsedIntoCandidateId: string | null;
  matchCandidates: string | null;
  sourceImages: { imageId: string }[];
  ocrSupport: string;
  boundingBoxes: string | null;
  ocrConfidence: number | null;
  provider: string;
  basis: string;
}

interface TitleRow {
  id: string;
  workIdentity: string;
  state: string;
  sortDateAdded: Date | null;
}

const store: {
  batch: BatchRow | null;
  candidates: CandidateRow[];
  suppressions: { workIdentity: string }[];
  titles: TitleRow[];
  listings: { titleId: string; service: string; dateAdded: Date }[];
  titleUpdates: { id: string; data: Record<string, unknown> }[];
  transitions: { to: string; extra: Record<string, unknown> | undefined }[];
  serviceState: { service: string; data: Record<string, unknown> }[];
  transactions: number;
} = {
  batch: null,
  candidates: [],
  suppressions: [],
  titles: [],
  listings: [],
  titleUpdates: [],
  transitions: [],
  serviceState: [],
  transactions: 0,
};

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    findUploadBatch: (_ownerId: string, batchId: string) =>
      Promise.resolve(store.batch !== null && store.batch.id === batchId ? store.batch : null),
    listCandidatesForReview: () => Promise.resolve(store.candidates),
    listActiveSuppressions: () => Promise.resolve(store.suppressions),
    listActiveListingsForService: () => Promise.resolve([]),
    // The stub runs the callback inline. It therefore proves ORDERING and the
    // fact that every write happens under one call — it proves NOTHING about
    // atomicity. `T-REV-012af` owns that, against a real engine.
    runInTransaction: <T>(work: (tx: unknown) => Promise<T>) => {
      store.transactions += 1;
      return work({});
    },
    findActiveSuppression: (_ownerId: string, workIdentity: string) =>
      Promise.resolve(
        store.suppressions.find((s) => s.workIdentity === workIdentity) ?? null,
      ) as Promise<unknown>,
    findTitleByWorkIdentity: (_ownerId: string, workIdentity: string) =>
      Promise.resolve(store.titles.find((t) => t.workIdentity === workIdentity) ?? null),
    createTitle: (_ownerId: string, data: Record<string, unknown>) => {
      store.titles.push({
        id: data['titleId'] as string,
        workIdentity: data['workIdentity'] as string,
        state: 'active',
        sortDateAdded: data['sortDateAdded'] as Date,
      });
      return Promise.resolve({ id: data['titleId'] as string });
    },
    updateTitle: (_ownerId: string, id: string, data: Record<string, unknown>) => {
      store.titleUpdates.push({ id, data });
      return Promise.resolve({ count: 1 });
    },
    createServiceListing: (_ownerId: string, data: Record<string, unknown>) => {
      store.listings.push({
        titleId: data['titleId'] as string,
        service: data['service'] as string,
        dateAdded: data['dateAdded'] as Date,
      });
      return Promise.resolve({ id: data['listingId'] as string });
    },
    upsertServiceState: (_ownerId: string, service: string, data: Record<string, unknown>) => {
      store.serviceState.push({ service, data });
      return Promise.resolve(undefined) as Promise<never>;
    },
    transitionUploadBatchStatus: (
      _ownerId: string,
      _batchId: string,
      _from: string,
      data: Record<string, unknown>,
    ) => {
      store.transitions.push({ to: data['status'] as string, extra: data });
      if (store.batch !== null) store.batch.status = data['status'] as string;
      return Promise.resolve(1);
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

const closeBatch = (batchId: string, body?: unknown): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/close`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CLIENT_PRINCIPAL_HEADER]: principalHeader(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

interface CloseBody {
  batchId: string;
  status: string;
  completedAt: string;
  undoable: boolean;
  summary: {
    titlesCreated: number;
    listingsCreated: number;
    listingsRemoved: number;
    unresolvedKept: number;
    discarded: number;
    suppressedGated: number;
    removalGroupId: string | null;
  };
  serviceState: { service: string; lastCompletedBatchAt: string };
}

function makeCandidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
  const row: CandidateRow = {
    id: `cand-${store.candidates.length + 1}`,
    batchId: 'batch-1',
    rawText: 'Dune',
    normalisedText: 'dune',
    inferredTitle: 'Dune',
    cleanupVerdict: 'title-candidate',
    classification: 'new',
    matchState: 'matched',
    resolvedWorkIdentity: DUNE,
    correctedToTmdbId: null,
    reviewDisposition: 'confirmed',
    collapsedIntoCandidateId: null,
    matchCandidates: JSON.stringify([
      { tmdbId: 438631, mediaType: 'movie', name: 'Dune', releaseYear: 2021, score: 1 },
    ]),
    sourceImages: [{ imageId: 'img-1' }],
    ocrSupport: 'corroborated',
    boundingBoxes: null,
    ocrConfidence: 0.9,
    provider: 'azure-openai',
    basis: 'vision',
    ...overrides,
  };
  store.candidates.push(row);
  return row;
}

beforeEach(async () => {
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  process.env['TMDB_API_KEY'] = 'unit-fixture-key-not-a-real-secret';

  store.batch = { id: 'batch-1', service: 'netflix', status: 'in-review', mode: 'append-only' };
  store.candidates = [];
  store.suppressions = [];
  store.titles = [];
  store.listings = [];
  store.titleUpdates = [];
  store.transitions = [];
  store.serviceState = [];
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

describe('T-REV-012 · POST /close without a store', () => {
  it('T-REV-012ai: a confirmed addition is applied and the batch is marked applied', async () => {
    makeCandidate();

    const res = await closeBatch('batch-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as CloseBody;

    expect(body.status).toBe('applied');
    expect(body.summary.titlesCreated).toBe(1);
    expect(body.summary.listingsCreated).toBe(1);
    expect(body.summary.listingsRemoved).toBe(0);
    expect(store.listings[0]?.service).toBe('netflix');
    expect(store.transitions.map((t) => t.to)).toEqual(['applied']);
    expect(store.serviceState[0]?.service).toBe('netflix');
    // Every write went through exactly one transaction call.
    expect(store.transactions).toBe(1);
  });

  it('T-REV-012aj: a pending addition refuses with 409 PENDING_ADDITIONS and writes nothing', async () => {
    makeCandidate({ reviewDisposition: 'pending' });

    const res = await closeBatch('batch-1');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'PENDING_ADDITIONS',
    );
    // ⚠ Refused BEFORE the transaction opens — not rolled back afterwards.
    // A close that opened a transaction and then refused would still be
    // correct, but it would mean the guard ran too late to be the reason.
    expect(store.transactions).toBe(0);
    expect(store.listings).toEqual([]);
    expect(store.transitions).toEqual([]);
  });

  it('T-REV-012ak: an unknown batch id is 404', async () => {
    const res = await closeBatch('batch-nope');
    expect(res.status).toBe(404);
    expect(store.transactions).toBe(0);
  });

  it('T-REV-012al: a batch that is not in review is 409 BATCH_NOT_IN_REVIEW', async () => {
    store.batch = { id: 'batch-1', service: 'netflix', status: 'open', mode: 'append-only' };
    const res = await closeBatch('batch-1');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'BATCH_NOT_IN_REVIEW',
    );
  });

  it('T-REV-012am: an existing title gains a listing without a second title', async () => {
    store.titles.push({
      id: 'title-1',
      workIdentity: DUNE,
      state: 'active',
      sortDateAdded: new Date('2025-01-01T00:00:00Z'),
    });
    makeCandidate();

    const body = (await (await closeBatch('batch-1')).json()) as CloseBody;
    expect(body.summary.titlesCreated).toBe(0);
    expect(body.summary.listingsCreated).toBe(1);
    expect(store.listings[0]?.titleId).toBe('title-1');
    // Product invariant 6: the EARLIER date is kept, so no update is issued.
    expect(store.titleUpdates).toEqual([]);
  });

  it('T-REV-012an: a suppressed work is gated and never becomes a listing', async () => {
    store.suppressions = [{ workIdentity: DUNE }];
    makeCandidate();

    const body = (await (await closeBatch('batch-1')).json()) as CloseBody;
    expect(body.summary.suppressedGated).toBe(1);
    expect(body.summary.listingsCreated).toBe(0);
    expect(store.listings).toEqual([]);
  });

  it('T-REV-012ao: a discarded item is counted and writes nothing', async () => {
    makeCandidate({ reviewDisposition: 'discarded' });

    const body = (await (await closeBatch('batch-1')).json()) as CloseBody;
    expect(body.summary.discarded).toBe(1);
    expect(body.summary.listingsCreated).toBe(0);
  });

  it('T-REV-012ap: the response reports undoable and the service last-updated date', async () => {
    makeCandidate();
    const body = (await (await closeBatch('batch-1')).json()) as CloseBody;

    // Derived from the state machine (`applied` → `undone`), never hard-coded.
    expect(body.undoable).toBe(true);
    expect(body.serviceState.service).toBe('netflix');
    expect(Date.parse(body.serviceState.lastCompletedBatchAt)).not.toBeNaN();
    expect(body.serviceState.lastCompletedBatchAt).toBe(body.completedAt);
  });

  it('T-REV-012aq: an empty review closes cleanly with an all-zero summary', async () => {
    const body = (await (await closeBatch('batch-1')).json()) as CloseBody;
    expect(body.summary).toEqual({
      titlesCreated: 0,
      listingsCreated: 0,
      listingsRemoved: 0,
      unresolvedKept: 0,
      discarded: 0,
      suppressedGated: 0,
      removalGroupId: null,
    });
  });

  it('T-REV-012ar: a body is accepted but confirmRemovals is NOT acted on yet', async () => {
    // ⚠ Pinning the TASK-086 boundary. Removals are unimplemented, so a close
    // must never report having removed anything however the flag is set —
    // telling a client its removals were confirmed while nothing was removed
    // is the silent-loss failure REQ-020 exists to prevent.
    makeCandidate();
    const body = (await (
      await closeBatch('batch-1', { confirmRemovals: true })
    ).json()) as CloseBody;
    expect(body.summary.listingsRemoved).toBe(0);
    expect(body.summary.removalGroupId).toBeNull();
  });
});
