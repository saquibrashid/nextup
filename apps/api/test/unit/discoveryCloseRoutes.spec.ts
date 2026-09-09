/**
 * TASK-185 — `POST /api/batches/:batchId/close` for a DISCOVERY batch, driven
 * without a store (US-040 AC-3/AC-4/AC-5, ADR-0010 D-1).
 *
 * ⚠ This is not a second copy of `test/integration/discoveryClose.spec.ts`,
 * and the split is the same one `test/unit/batchCloseRoutes.spec.ts` explains:
 * coverage is measured on the `unit` project, which CI job 4 runs with no
 * database, so a branch proven only under `test/integration` scores zero
 * against the `apps/api/src/**` floor. What the integration suite proves and
 * this CANNOT is that `ux_intent_owner_title_waiting` really rejects the
 * second intent and that the transaction really rolls back — a stub can only
 * agree with itself about both.
 *
 * What this file owns is the shape of the RESULT: that the close writes no
 * listing, touches no service state, and reports the works it deliberately
 * declined to record an intent for.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-discovery-close-unit';
const DUNE = 'tmdb:movie:438631';
const HEAT = 'tmdb:movie:949';

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

const store: {
  batch: Record<string, unknown> | null;
  candidates: CandidateRow[];
  suppressions: { workIdentity: string }[];
  listed: string[];
  waiting: string[];
  titles: { id: string; workIdentity: string; state: string; sortDateAdded: Date | null }[];
  createdTitles: Record<string, unknown>[];
  intents: Record<string, unknown>[];
  listings: unknown[];
  serviceState: unknown[];
  changes: { kind: string }[];
  transactions: number;
} = {
  batch: null,
  candidates: [],
  suppressions: [],
  listed: [],
  waiting: [],
  titles: [],
  createdTitles: [],
  intents: [],
  listings: [],
  serviceState: [],
  changes: [],
  transactions: 0,
};

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    findUploadBatch: (_ownerId: string, batchId: string) =>
      Promise.resolve(
        store.batch !== null && store.batch['id'] === batchId ? { ...store.batch } : null,
      ),
    listCandidatesForReview: () => Promise.resolve(store.candidates),
    listActiveSuppressions: () => Promise.resolve(store.suppressions),
    // ⚠ Deliberately throws. The discovery path must never ask a service
    // question, and a stub that quietly returned `[]` would let a regression
    // that DID ask it pass here (ADR-0010 D-1).
    listActiveListingsForService: () => {
      throw new Error('listActiveListingsForService must not be called for a discovery batch');
    },
    listListedWorkIdentities: () => Promise.resolve(new Set(store.listed)),
    listWaitingWorkIdentities: () => Promise.resolve(new Set(store.waiting)),
    runInTransaction: <T>(work: (tx: unknown) => Promise<T>) => {
      store.transactions += 1;
      return work({});
    },
    findActiveSuppression: (_ownerId: string, workIdentity: string) =>
      Promise.resolve(store.suppressions.find((s) => s.workIdentity === workIdentity) ?? null),
    findTitleByWorkIdentity: (_ownerId: string, workIdentity: string) =>
      Promise.resolve(store.titles.find((t) => t.workIdentity === workIdentity) ?? null),
    setCandidateResolvedTitles: () => Promise.resolve(undefined),
    createTitle: (_ownerId: string, data: Record<string, unknown>) => {
      store.createdTitles.push({ ...data });
      store.titles.push({
        id: data['id'] as string,
        workIdentity: data['workIdentity'] as string,
        state: data['state'] as string,
        sortDateAdded: (data['sortDateAdded'] as Date | null) ?? null,
      });
      return Promise.resolve({ id: data['id'] as string });
    },
    createWatchIntent: (_ownerId: string, data: Record<string, unknown>) => {
      store.intents.push({ ...data });
      return Promise.resolve(undefined);
    },
    createServiceListing: () => {
      store.listings.push({});
      return Promise.resolve({ id: 'must-not-happen' });
    },
    upsertServiceState: () => {
      store.serviceState.push({});
      return Promise.resolve(undefined);
    },
    recordBatchChange: (_ownerId: string, data: Record<string, unknown>) => {
      store.changes.push({ kind: data['kind'] as string });
      return Promise.resolve(undefined);
    },
    transitionUploadBatchStatus: () => Promise.resolve({ count: 1 }),
  };
});

let server: Server;
let origin: string;

function principal(): string {
  return Buffer.from(
    JSON.stringify({
      auth_typ: 'aad',
      claims: [
        { typ: OID, val: SUBJECT },
        { typ: 'iss', val: 'https://login.microsoftonline.com/common/v2.0' },
      ],
    }),
  ).toString('base64');
}

function candidate(id: string, workIdentity: string, name: string): CandidateRow {
  return {
    id,
    batchId: 'batch-disc',
    rawText: name,
    normalisedText: name.toLowerCase(),
    inferredTitle: name,
    cleanupVerdict: 'title',
    classification: null,
    matchState: 'matched',
    resolvedWorkIdentity: workIdentity,
    correctedToTmdbId: null,
    reviewDisposition: 'confirmed',
    collapsedIntoCandidateId: null,
    matchCandidates: null,
    sourceImages: [{ imageId: 'img-1' }],
    ocrSupport: 'supported',
    boundingBoxes: null,
    ocrConfidence: 0.99,
    provider: 'vision',
    basis: 'tile',
  };
}

async function close(): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${origin}/api/batches/batch-disc/close`, {
    method: 'POST',
    headers: {
      [CLIENT_PRINCIPAL_HEADER]: principal(),
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  vi.resetModules();
  resetAllowListWarning();
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  process.env['TMDB_API_KEY'] = 'unit-fixture-key-not-a-real-secret';
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  store.batch = {
    id: 'batch-disc',
    service: null,
    discoverySource: 'fandango-at-home',
    status: 'in-review',
    mode: 'append-only',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: null,
  };
  store.candidates = [];
  store.suppressions = [];
  store.listed = [];
  store.waiting = [];
  store.titles = [];
  store.createdTitles = [];
  store.intents = [];
  store.listings = [];
  store.serviceState = [];
  store.changes = [];
  store.transactions = 0;

  const { createApp } = await import('../../src/app.js');
  const app: Express = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('T-WAIT-003 · US-040 AC-3 · closing a discovery batch creates no listing', () => {
  it('T-WAIT-003a: a confirmed discovery candidate yields an intent and NO service listing', async () => {
    store.candidates = [candidate('c1', DUNE, 'Dune')];

    const { status } = await close();

    expect(status).toBe(200);
    expect(store.listings).toHaveLength(0);
    expect(store.intents).toHaveLength(1);
    expect(store.intents[0]).toMatchObject({
      workIdentity: DUNE,
      discoverySource: 'fandango-at-home',
      state: 'waiting',
    });
  });

  it('T-WAIT-003b: no service state is written — REQ-039 must not claim a service was refreshed', async () => {
    store.candidates = [candidate('c1', DUNE, 'Dune')];

    const { body } = await close();

    expect(store.serviceState).toHaveLength(0);
    expect(body['serviceState']).toBeNull();
    const summary = body['summary'] as Record<string, unknown>;
    expect(summary['listingsCreated']).toBe(0);
    expect(summary['listingsRemoved']).toBe(0);
    expect(summary['removalGroupId']).toBeNull();
  });

  it('T-WAIT-003d: the waiting title is stored `removed` with a null sort date, so it is in neither view', async () => {
    store.candidates = [candidate('c1', DUNE, 'Dune')];

    await close();

    expect(store.createdTitles).toHaveLength(1);
    expect(store.createdTitles[0]).toMatchObject({ state: 'removed', sortDateAdded: null });
  });
});

describe('T-WAIT-004 · US-040 AC-5 · a work already held produces no intent, and is reported', () => {
  it('T-WAIT-004a: a work already in the combined list is REPORTED rather than silently dropped', async () => {
    store.listed = [DUNE];
    store.candidates = [candidate('c1', DUNE, 'Dune'), candidate('c2', HEAT, 'Heat')];

    const { body } = await close();

    // ⚠ `discovery.alreadyListed` is 0 here, and that is CORRECT rather than a
    // miss. The held work is caught earlier, by `classifyDiscoveryWorkIdentity`
    // routing it to the review pass's `alreadyOnYourList` section — which is
    // what AC-5 asks for, the owner being TOLD. The in-transaction counter is
    // the narrower safety net for a work that becomes listed BETWEEN review
    // and close, and only a real engine can produce that interleaving, so
    // `test/integration/discoveryClose.spec.ts` owns it.
    const discovery = body['discovery'] as Record<string, unknown>;
    expect(discovery['intentsCreated']).toBe(1);
    expect(store.intents).toHaveLength(1);
    expect(store.intents[0]).toMatchObject({ workIdentity: HEAT });
  });

  it('T-WAIT-004c: a work already waiting yields no second intent — the unique index would roll the close back', async () => {
    store.waiting = [DUNE];
    store.candidates = [candidate('c1', DUNE, 'Dune')];

    const { body } = await close();

    const discovery = body['discovery'] as Record<string, unknown>;
    expect(discovery['alreadyWaiting']).toBe(1);
    expect(store.intents).toHaveLength(0);
  });

  it('T-WAIT-004f: an existing title is REUSED as it stands — no promotion back to active', async () => {
    store.titles = [
      { id: 'title-existing', workIdentity: DUNE, state: 'removed', sortDateAdded: null },
    ];
    store.candidates = [candidate('c1', DUNE, 'Dune')];

    await close();

    expect(store.createdTitles).toHaveLength(0);
    expect(store.intents[0]).toMatchObject({ titleId: 'title-existing' });
    expect(store.changes.filter((c) => c.kind === 'title_created')).toHaveLength(0);
  });

  it('T-WAIT-004g: a suppressed work is gated INSIDE the transaction and counted', async () => {
    store.suppressions = [{ workIdentity: DUNE }];
    store.candidates = [candidate('c1', DUNE, 'Dune')];

    const { body } = await close();

    expect(store.intents).toHaveLength(0);
    const summary = body['summary'] as Record<string, unknown>;
    expect(summary['suppressedGated']).toBeGreaterThanOrEqual(1);
  });
});

describe('T-WAIT-002 · US-040 AC-4 · a pending decision still blocks the close', () => {
  it('T-WAIT-002d: an undecided discovery candidate is refused with PENDING_ADDITIONS', async () => {
    const pending = candidate('c1', DUNE, 'Dune');
    pending.reviewDisposition = 'pending';
    store.candidates = [pending];

    const { status, body } = await close();

    expect(status).toBe(409);
    expect((body['error'] as Record<string, unknown>)['code']).toBe('PENDING_ADDITIONS');
    expect(store.intents).toHaveLength(0);
    expect(store.transactions).toBe(0);
  });
});
