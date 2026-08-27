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
const HEAT = 'tmdb:movie:949';

interface BatchRow {
  id: string;
  service: string;
  status: string;
  mode: string;
  lowYield: boolean;
  degradedExtraction: boolean;
  crossCheck: string | null;
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
  changes: {
    kind: string;
    titleId: string | null;
    listingId: string | null;
    nextValue: string | null;
  }[];
  transactions: number;
  activeListings: {
    listingId: string;
    titleId: string;
    service: string;
    state: string;
    dateAdded: Date;
    title: {
      workIdentity: string;
      tmdbName: string | null;
      rawExtractedText: string | null;
      tmdbReleaseYear: number | null;
      tmdbPosterPath: string | null;
    };
  }[];
  decisions: { listingId: string; ticked: boolean }[];
  removalGroups: string[];
  softDeleted: { listingId: string; removedByGroupId?: string | null }[];
  /** Listing ids whose soft delete reports zero rows — the injected race. */
  softDeleteFails: string[];
} = {
  batch: null,
  candidates: [],
  suppressions: [],
  titles: [],
  listings: [],
  titleUpdates: [],
  transitions: [],
  serviceState: [],
  changes: [],
  transactions: 0,
  activeListings: [],
  decisions: [],
  removalGroups: [],
  softDeleted: [],
  softDeleteFails: [],
};

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    findUploadBatch: (_ownerId: string, batchId: string) =>
      Promise.resolve(store.batch !== null && store.batch.id === batchId ? store.batch : null),
    listCandidatesForReview: () => Promise.resolve(store.candidates),
    listActiveSuppressions: () => Promise.resolve(store.suppressions),
    listActiveListingsForService: () => Promise.resolve(store.activeListings),
    listRemovalDecisions: () => Promise.resolve(store.decisions),
    createRemovalGroup: (_ownerId: string, data: Record<string, unknown>) => {
      store.removalGroups.push(data['id'] as string);
      return Promise.resolve({ id: data['id'] as string }) as Promise<never>;
    },
    softDeleteServiceListing: (
      _ownerId: string,
      listingId: string,
      removal: Record<string, unknown>,
    ) => {
      if (store.softDeleteFails.includes(listingId)) return Promise.resolve({ count: 0 });
      store.softDeleted.push({
        listingId,
        removedByGroupId: removal['removedByGroupId'] as string | null,
      });
      return Promise.resolve({ count: 1 });
    },
    listListingsForTitle: (_ownerId: string, titleId: string) =>
      Promise.resolve(
        store.activeListings
          .filter((l) => l.titleId === titleId)
          .map((l) => ({
            listingId: l.listingId,
            service: l.service,
            state: store.softDeleted.some((d) => d.listingId === l.listingId) ? 'removed' : l.state,
            dateAdded: l.dateAdded,
          })),
      ) as Promise<never>,
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
        tmdbId: (data['tmdbId'] as number | undefined) ?? null,
        tmdbName: (data['tmdbName'] as string | null | undefined) ?? null,
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
    recordBatchChange: (_ownerId: string, data: Record<string, unknown>) => {
      store.changes.push({
        kind: data['kind'] as string,
        titleId: (data['titleId'] as string | undefined) ?? null,
        listingId: (data['listingId'] as string | undefined) ?? null,
        attr: (data['attr'] as string | null | undefined) ?? null,
        prevValue: (data['prevValue'] as string | null | undefined) ?? null,
        nextValue: (data['nextValue'] as string | null | undefined) ?? null,
      });
      return Promise.resolve({ id: BigInt(store.changes.length) }) as Promise<never>;
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

  store.batch = {
    id: 'batch-1',
    service: 'netflix',
    status: 'in-review',
    mode: 'append-only',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'ok',
  };
  store.candidates = [];
  store.suppressions = [];
  store.titles = [];
  store.listings = [];
  store.titleUpdates = [];
  store.transitions = [];
  store.serviceState = [];
  store.changes = [];
  store.transactions = 0;
  store.activeListings = [];
  store.decisions = [];
  store.removalGroups = [];
  store.softDeleted = [];
  store.softDeleteFails = [];

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
    // TASK-074: the provenance rows are written in the SAME call as the
    // mutation (REQ-068, US-031 AC-6) — one for the title, one for the
    // listing. `T-PROV-001a` proves the atomicity; this pins that they are
    // written at all, on the path a client actually takes.
    expect(store.changes.map((c) => c.kind)).toEqual(['title_created', 'listing_added']);
    // Every write went through exactly one transaction call.
    expect(store.transactions).toBe(1);
  });

  it('T-REV-012as: a corrected candidate stores the CORRECTED title and a modified record', async () => {
    // The row a real correction leaves: `resolvedWorkIdentity` is the owner's
    // choice, `matchCandidates` still holds the pipeline's rejected match.
    makeCandidate({
      resolvedWorkIdentity: HEAT,
      correctedToTmdbId: 949,
      reviewDisposition: 'corrected',
    });

    const res = await closeBatch('batch-1');
    expect(res.status).toBe(200);

    expect(store.titles[0]?.workIdentity).toBe(HEAT);
    // Not 438631 — the identity and the metadata must name the same work, or
    // the owner sees the title they corrected away from.
    expect(store.titles[0]?.tmdbId).toBe(949);
    expect(store.titles[0]?.tmdbName).toBeNull();

    expect(store.changes.map((c) => c.kind)).toEqual([
      'title_created',
      'attr_modified',
      'listing_added',
    ]);
    expect(store.changes[1]).toMatchObject({
      attr: 'workIdentity',
      prevValue: JSON.stringify(DUNE),
      nextValue: JSON.stringify(HEAT),
    });
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

  it('T-REV-012ar: confirmRemovals is read strictly — only a literal true confirms', async () => {
    // ⚠ This was the TASK-086 boundary pin ("accepted but not acted on yet");
    // it is now the strictness pin. A truthy coercion would let `"false"`, a
    // stray `1`, or a half-built client stand in for the owner pressing the
    // button, and REQ-020's whole point is that removal is never a side
    // effect.
    //
    // These fixtures propose no removals, so the flag changes nothing here.
    // The behavioural half is the `T-REV-012ba`-`bh` block below and, against a real
    // store, `test/integration/batchCloseRemovals.spec.ts`.
    makeCandidate();
    const body = (await (
      await closeBatch('batch-1', { confirmRemovals: true })
    ).json()) as CloseBody;
    expect(body.summary.listingsRemoved).toBe(0);
    expect(body.summary.removalGroupId).toBeNull();
  });
});

/* ── the removal path, without a store (TASK-086/087/088) ─────────────── */

/**
 * `test/integration/batchCloseRemovals.spec.ts` is the twin, and it owns every
 * claim about what is actually IN the store afterwards. What these add is the
 * branch coverage the `unit` project measures — CI job 4 runs it with no
 * database, so a path proven only in `test/integration` scores zero against
 * the `apps/api/src/**` floor — plus the ordering claims a stub can honestly
 * make: what was called, in what order, and how many times.
 */
describe('T-REV-012ba-bh: removals at close, stubbed', () => {
  /** One Netflix listing the batch's screenshots do not show. */
  function listedButNotSeen(): void {
    store.batch = {
      id: 'batch-1',
      service: 'netflix',
      status: 'in-review',
      mode: 'full-update',
      lowYield: false,
      degradedExtraction: false,
      crossCheck: 'ok',
    };
    store.activeListings.push({
      listingId: 'listing-heat',
      titleId: 'title-heat',
      service: 'netflix',
      state: 'active',
      dateAdded: new Date('2026-01-04T00:00:00.000Z'),
      title: {
        workIdentity: HEAT,
        tmdbName: 'Heat',
        rawExtractedText: null,
        tmdbReleaseYear: 1995,
        tmdbPosterPath: null,
      },
    });
  }

  it('T-REV-012ba: refuses an unconfirmed close and opens no transaction at all', async () => {
    listedButNotSeen();

    const res = await closeBatch('batch-1');

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'REMOVALS_NOT_CONFIRMED',
    );
    // The refusal happens BEFORE the transaction is opened, which is why
    // "nothing was written" needs no rollback to be true.
    expect(store.transactions).toBe(0);
  });

  it('T-REV-012bb: a literal true confirms; anything merely truthy does not', async () => {
    for (const value of ['true', 1, {}, [], 'yes']) {
      store.activeListings = [];
      store.removalGroups = [];
      store.softDeleted = [];
      listedButNotSeen();
      expect((await closeBatch('batch-1', { confirmRemovals: value })).status).toBe(409);
    }
  });

  it('T-REV-012bc: a confirmed close soft-deletes with the group id and reports it', async () => {
    listedButNotSeen();

    const body = (await (
      await closeBatch('batch-1', { confirmRemovals: true })
    ).json()) as CloseBody;

    expect(body.summary.listingsRemoved).toBe(1);
    expect(store.removalGroups).toHaveLength(1);
    expect(body.summary.removalGroupId).toBe(store.removalGroups[0]);
    expect(store.softDeleted).toHaveLength(1);
    // US-017 undoes a GROUP, so the listing must carry the group id.
    expect(store.softDeleted[0]?.removedByGroupId).toBe(store.removalGroups[0]);
  });

  it('T-REV-012bd: unticking the only proposal still records a zero-member group', async () => {
    listedButNotSeen();
    store.decisions.push({ listingId: 'listing-heat', ticked: false });

    const body = (await (
      await closeBatch('batch-1', { confirmRemovals: true })
    ).json()) as CloseBody;

    expect(body.summary.listingsRemoved).toBe(0);
    expect(store.softDeleted).toHaveLength(0);
    // ⚠ A group EXISTS. "I rescued all of them" must be distinguishable in
    // history from "there was nothing to remove" (US-015 AC-5).
    expect(store.removalGroups).toHaveLength(1);
    expect(body.summary.removalGroupId).toBe(store.removalGroups[0]);
  });

  it('T-REV-012be: a withheld removal section creates NO group and needs no confirmation', async () => {
    listedButNotSeen();
    (store.batch as BatchRow).lowYield = true;

    const body = (await (await closeBatch('batch-1')).json()) as CloseBody;

    expect(body.summary.listingsRemoved).toBe(0);
    // Withheld is NOT a zero-member group: the owner was never shown a
    // section, so recording one would log a decision nobody made — and
    // requiring confirmation would make the batch unclosable.
    expect(store.removalGroups).toHaveLength(0);
    expect(body.summary.removalGroupId).toBeNull();
  });

  it('T-REV-012bf: an append-only batch never proposes a removal, however it is confirmed', async () => {
    listedButNotSeen();
    (store.batch as BatchRow).mode = 'append-only';

    const body = (await (
      await closeBatch('batch-1', { confirmRemovals: true })
    ).json()) as CloseBody;

    expect(body.summary.listingsRemoved).toBe(0);
    expect(store.removalGroups).toHaveLength(0);
    expect(store.softDeleted).toHaveLength(0);
  });

  it('T-REV-012bg: a soft delete affecting zero rows raises PARTIAL_FAILURE_PREVENTED', async () => {
    listedButNotSeen();
    store.softDeleteFails.push('listing-heat');

    const res = await closeBatch('batch-1', { confirmRemovals: true });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('PARTIAL_FAILURE_PREVENTED');
    expect(body.error.message).toMatch(/nothing was changed/i);
    // The stub runs the callback inline, so it cannot prove the rollback —
    // `test/integration/batchCloseRemovals.spec.ts` T-REM-015b owns that. What
    // it can prove is that the batch was never transitioned.
    expect(store.transitions).toHaveLength(0);
  });

  it('T-REV-012bh: the removed title is re-derived from its whole listing set', async () => {
    listedButNotSeen();

    await closeBatch('batch-1', { confirmRemovals: true });

    // Its only listing has gone, so the title is `removed` with no date to
    // sort by — computed by `derive.ts`, never inline (invariant I-4).
    const update = store.titleUpdates.find((u) => u.id === 'title-heat');
    expect(update?.data['state']).toBe('removed');
    expect(update?.data['sortDateAdded']).toBeNull();
  });
});
