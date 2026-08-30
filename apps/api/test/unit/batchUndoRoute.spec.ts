/**
 * TASK-112 — `POST /api/batches/:batchId/undo` driven WITHOUT a store
 * (`specs/api.md` §6.25, `specs/data-model.md` §8.3, SD-03, US-032).
 *
 * ⚠ This is not a second copy of `test/integration/batchUndo.spec.ts`.
 * Coverage is measured on the `unit` project, which CI job 4 runs with no
 * database at all, so a route proven only in `test/integration` scores zero
 * against the `apps/api/src/**` floor and fails the gate. Same rationale as
 * `test/unit/batchCloseRoutes.spec.ts`.
 *
 * What the integration suite proves and this CANNOT: that the discard really
 * cascades, that the provenance FKs really are detached before the delete
 * (`fk_change_listing` — the constraint that made this feature not work at
 * all), and that the whole undo is one atomic transaction. A stub can only
 * agree with the code that calls it. Nothing here should be read as covering
 * those.
 *
 * What it CAN prove, and what the integration suite does NOT assert as
 * sharply: the ORDER of the gates and the ORDER of the writes.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-undo-unit';

interface BatchRow {
  id: string;
  service: string;
  status: string;
  mode: string;
  completedAt: Date | null;
  undoneAt: Date | null;
}

interface ChangeRow {
  kind: string;
  titleId: string | null;
  listingId: string | null;
  attr: string | null;
  prevValue: string | null;
  nextValue: string | null;
}

const store: {
  batch: BatchRow | null;
  previous: { id: string; completedAt: Date | null } | null;
  changes: ChangeRow[];
  listingsByTitle: Record<string, { listingId: string; service: string; dateAdded: Date }[]>;
  /** Every mutating call, in the order the service made it. */
  calls: string[];
  detached: { titleIds: string[]; listingIds: string[] }[];
  discardedTitles: string[];
  discardedListings: string[];
  titleUpdates: { id: string; data: Record<string, unknown> }[];
  serviceState: { service: string; data: Record<string, unknown> }[];
  transactions: number;
  /** Makes the conditional status claim report zero rows — the injected race. */
  claimFails: boolean;
  /** Current title rows the §8.4 refusal enumeration reads (TASK-114). */
  titleDisplays: Record<
    string,
    {
      workIdentity: string;
      state: string;
      tmdbName: string | null;
      rawExtractedText: string | null;
      tmdbReleaseYear: number | null;
      tmdbPosterPath: string | null;
    }
  >;
  /** Current listing state by listingId, for `removed` entries' `currentState`. */
  listingStates: Record<string, string>;
  /** Active suppressions, keyed on WORK identity (REQ-071). */
  suppressions: { workIdentity: string }[];
  /** Titles + listings this batch created — the provenance-unavailable signal. */
  createdEffects: number;
} = {
  batch: null,
  previous: null,
  changes: [],
  listingsByTitle: {},
  calls: [],
  detached: [],
  discardedTitles: [],
  discardedListings: [],
  titleUpdates: [],
  serviceState: [],
  transactions: 0,
  claimFails: false,
  titleDisplays: {},
  listingStates: {},
  suppressions: [],
  createdEffects: 0,
};

vi.mock('../../src/repository/undoDiscard.js', () => ({
  detachReferencesToDiscarded: (
    _ownerId: string,
    titleIds: readonly string[],
    listingIds: readonly string[],
  ) => {
    store.calls.push('detach');
    store.detached.push({ titleIds: [...titleIds], listingIds: [...listingIds] });
    return Promise.resolve(undefined);
  },
  discardCreatedTitles: (_ownerId: string, titleIds: readonly string[]) => {
    store.calls.push('discardTitles');
    store.discardedTitles.push(...titleIds);
    return Promise.resolve(titleIds.length);
  },
  discardCreatedListings: (_ownerId: string, listingIds: readonly string[]) => {
    store.calls.push('discardListings');
    store.discardedListings.push(...listingIds);
    return Promise.resolve(listingIds.length);
  },
}));

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    findUploadBatch: (_ownerId: string, batchId: string) =>
      Promise.resolve(store.batch !== null && store.batch.id === batchId ? store.batch : null),
    listBatchChanges: () => Promise.resolve(store.changes) as Promise<never>,
    findPreviousAppliedBatch: () => Promise.resolve(store.previous) as Promise<never>,
    listListingsForTitle: (_ownerId: string, titleId: string) =>
      Promise.resolve(
        (store.listingsByTitle[titleId] ?? []).map((row) => ({
          ...row,
          state: 'active',
        })),
      ) as Promise<never>,
    // Inline. Proves ORDERING and that every write happens under one call — it
    // proves NOTHING about atomicity. The integration suite owns that.
    runInTransaction: <T>(work: (tx: unknown) => Promise<T>) => {
      store.transactions += 1;
      return work({});
    },
    transitionUploadBatchStatus: (
      _ownerId: string,
      _batchId: string,
      _from: string,
      data: Record<string, unknown>,
    ) => {
      store.calls.push('claim');
      if (store.claimFails) return Promise.resolve(0);
      if (store.batch !== null) {
        store.batch.status = data['status'] as string;
        store.batch.undoneAt = (data['undoneAt'] as Date | undefined) ?? null;
      }
      return Promise.resolve(1);
    },
    updateTitle: (_ownerId: string, id: string, data: Record<string, unknown>) => {
      store.calls.push('rederive');
      store.titleUpdates.push({ id, data });
      return Promise.resolve({ count: 1 });
    },
    upsertServiceState: (_ownerId: string, service: string, data: Record<string, unknown>) => {
      store.calls.push('serviceState');
      store.serviceState.push({ service, data });
      return Promise.resolve(undefined) as Promise<never>;
    },
    // TASK-114 · the four reads the §8.4 refusal enumeration makes. With
    // `...actual` these would hit Prisma against no database and throw, which
    // is exactly the 500 the route was returning on every refusal path.
    listTitleDisplaysByIds: (_ownerId: string, titleIds: readonly string[]) =>
      Promise.resolve(
        [...titleIds].flatMap((id) => {
          const display = store.titleDisplays[id];
          return display === undefined ? [] : [{ id, ...display }];
        }),
      ) as Promise<never>,
    listServiceListingStatesByIds: (_ownerId: string, listingIds: readonly string[]) =>
      Promise.resolve(
        [...listingIds].flatMap((listingId) => {
          const state = store.listingStates[listingId];
          return state === undefined ? [] : [{ listingId, state }];
        }),
      ) as Promise<never>,
    listActiveSuppressions: () =>
      Promise.resolve(store.suppressions.map((row) => ({ ...row }))) as Promise<never>,
    countBatchCreatedEffects: () => Promise.resolve(store.createdEffects),
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

const undo = (batchId: string): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/undo`, {
    method: 'POST',
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader() },
  });

interface UndoBody {
  batchId: string;
  status: string;
  undoneAt: string;
  reversed: { titlesDeleted: number; listingsRemoved: number };
  serviceState: { service: string; lastCompletedBatchAt: string | null };
}

interface ErrorBody {
  error: { code: string; details?: Record<string, unknown> };
}

function created(titleId: string, listingId: string): void {
  store.changes.push({
    kind: 'title_created',
    titleId,
    listingId: null,
    attr: null,
    prevValue: null,
    nextValue: null,
  });
  store.changes.push({
    kind: 'listing_added',
    titleId,
    listingId,
    attr: null,
    prevValue: null,
    nextValue: null,
  });
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
    status: 'applied',
    mode: 'append-only',
    completedAt: new Date('2026-02-01T00:00:00.000Z'),
    undoneAt: null,
  };
  store.previous = null;
  store.changes = [];
  store.listingsByTitle = {};
  store.calls = [];
  store.detached = [];
  store.discardedTitles = [];
  store.discardedListings = [];
  store.titleUpdates = [];
  store.serviceState = [];
  store.transactions = 0;
  store.claimFails = false;
  store.titleDisplays = {};
  store.listingStates = {};
  store.suppressions = [];
  store.createdEffects = 0;

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

describe('T-UNDO-002/003/008 · POST /undo without a store', () => {
  it('T-UNDO-002j: a creates-only batch is undone and reports what it reversed', async () => {
    created('t-1', 'l-1');
    store.listingsByTitle['t-1'] = [
      { listingId: 'l-1', service: 'netflix', dateAdded: new Date('2026-02-01T00:00:00.000Z') },
    ];

    const res = await undo('batch-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as UndoBody;

    expect(body.status).toBe('undone');
    expect(body.batchId).toBe('batch-1');
    expect(body.reversed.titlesDeleted).toBe(1);
    // The cascade takes the created title's listing; the plan never names it
    // separately, or it would be counted twice.
    expect(body.reversed.listingsRemoved).toBe(1);
    expect(store.discardedTitles).toEqual(['t-1']);
    expect(store.discardedListings).toEqual([]);
    expect(store.transactions).toBe(1);
  });

  it('T-UNDO-002k: the detach runs BEFORE either discard — the fk_change_listing order', async () => {
    // ⚠ THIS IS THE ORDERING THAT MADE THE FEATURE WORK AT ALL. `batch_change`
    // and `extraction_candidate` hold plain FKs onto the rows the discard
    // destroys, and only `service_listing → title` cascades. Discard first and
    // every undo fails with `fk_change_listing`. A unit test can pin the order
    // even though only the integration suite can prove the constraint.
    created('t-1', 'l-1');
    store.listingsByTitle['t-1'] = [
      { listingId: 'l-1', service: 'netflix', dateAdded: new Date('2026-02-01T00:00:00.000Z') },
    ];

    expect((await undo('batch-1')).status).toBe(200);

    expect(store.calls.indexOf('detach')).toBeGreaterThan(-1);
    expect(store.calls.indexOf('detach')).toBeLessThan(store.calls.indexOf('discardTitles'));
    expect(store.calls.indexOf('detach')).toBeLessThan(store.calls.indexOf('discardListings'));
  });

  it('T-UNDO-002l: the detach covers listings the cascade takes, not just planned ones', async () => {
    // A title created by this batch that later gained a SECOND service. That
    // second listing goes with the cascade, so its provenance FK must be
    // detached too — scoping the detach to this batch's own rows would leave
    // it violated.
    created('t-1', 'l-1');
    store.listingsByTitle['t-1'] = [
      { listingId: 'l-1', service: 'netflix', dateAdded: new Date('2026-02-01T00:00:00.000Z') },
      { listingId: 'l-2', service: 'max', dateAdded: new Date('2026-03-01T00:00:00.000Z') },
    ];

    const body = (await undo('batch-1')).json() as Promise<UndoBody>;
    expect((await body).reversed.listingsRemoved).toBe(2);

    expect(store.detached[0]?.listingIds.sort()).toEqual(['l-1', 'l-2']);
    expect(store.detached[0]?.titleIds).toEqual(['t-1']);
  });

  it('T-UNDO-003g: the status claim is the FIRST write, before anything is destroyed', async () => {
    created('t-1', 'l-1');
    store.listingsByTitle['t-1'] = [
      { listingId: 'l-1', service: 'netflix', dateAdded: new Date('2026-02-01T00:00:00.000Z') },
    ];

    expect((await undo('batch-1')).status).toBe(200);
    expect(store.calls[0]).toBe('claim');
  });

  it('T-UNDO-003h: a lost status claim refuses instead of discarding', async () => {
    // Two concurrent undos both read `applied`. Exactly one may proceed; the
    // loser must not delete rows the winner already destroyed and then report
    // a successful undo of them.
    created('t-1', 'l-1');
    store.listingsByTitle['t-1'] = [
      { listingId: 'l-1', service: 'netflix', dateAdded: new Date('2026-02-01T00:00:00.000Z') },
    ];
    store.claimFails = true;

    const res = await undo('batch-1');
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('BATCH_ALREADY_UNDONE');
    expect(store.discardedTitles).toEqual([]);
    expect(store.discardedListings).toEqual([]);
    expect(store.detached).toEqual([]);
  });

  it('T-UNDO-002m: a listing added to a pre-existing title is discarded, not its title', async () => {
    store.changes.push({
      kind: 'listing_added',
      titleId: 't-old',
      listingId: 'l-9',
      attr: null,
      prevValue: null,
      nextValue: null,
    });
    store.listingsByTitle['t-old'] = [
      { listingId: 'l-8', service: 'max', dateAdded: new Date('2025-01-01T00:00:00.000Z') },
    ];

    const res = await undo('batch-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as UndoBody;

    expect(store.discardedTitles).toEqual([]);
    expect(store.discardedListings).toEqual(['l-9']);
    expect(body.reversed.titlesDeleted).toBe(0);
    expect(body.reversed.listingsRemoved).toBe(1);
    // And the survivor is re-derived from what it has LEFT (invariant I-4).
    expect(store.titleUpdates[0]?.id).toBe('t-old');
  });

  it('T-UNDO-002n: serviceState reverts to the previous applied batch', async () => {
    created('t-1', 'l-1');
    store.listingsByTitle['t-1'] = [
      { listingId: 'l-1', service: 'netflix', dateAdded: new Date('2026-02-01T00:00:00.000Z') },
    ];
    store.previous = { id: 'batch-0', completedAt: new Date('2026-01-01T00:00:00.000Z') };

    const body = (await (await undo('batch-1')).json()) as UndoBody;

    expect(body.serviceState.service).toBe('netflix');
    expect(body.serviceState.lastCompletedBatchAt).toBe('2026-01-01T00:00:00.000Z');
    expect(store.serviceState[0]?.data['lastCompletedBatchId']).toBe('batch-0');
  });

  it('T-UNDO-002o: undoing the only batch reverts serviceState to never-updated', async () => {
    // REQ-039 renders "Netflix has never been updated" from exactly this.
    // Leaving the old timestamp would tell the owner a batch they just undid
    // still counts as their last update.
    created('t-1', 'l-1');
    store.listingsByTitle['t-1'] = [
      { listingId: 'l-1', service: 'netflix', dateAdded: new Date('2026-02-01T00:00:00.000Z') },
    ];

    const body = (await (await undo('batch-1')).json()) as UndoBody;

    expect(body.serviceState.lastCompletedBatchAt).toBeNull();
    expect(store.serviceState[0]?.data['lastCompletedBatchId']).toBeNull();
  });

  it('T-UNDO-003i: an unknown batch is 404, never 403 (NFR-008)', async () => {
    const res = await undo('batch-nope');
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
  });

  it('T-UNDO-003j: an already-undone batch is ALREADY_UNDONE, not NOT_APPLIED', async () => {
    // ⚠ The gate ORDER is the contract. `undone` is not `applied`, so a
    // generic check placed first would swallow the specific one and report
    // "that batch was never applied" — false and unactionable.
    store.batch = {
      ...(store.batch as BatchRow),
      status: 'undone',
      undoneAt: new Date('2026-02-02T00:00:00.000Z'),
    };

    const res = await undo('batch-1');
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('BATCH_ALREADY_UNDONE');
    expect(body.error.details?.['undoneAt']).toBe('2026-02-02T00:00:00.000Z');
  });

  it('T-UNDO-003k: a batch that was never applied is BATCH_NOT_APPLIED', async () => {
    store.batch = { ...(store.batch as BatchRow), status: 'in-review' };

    const res = await undo('batch-1');
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('BATCH_NOT_APPLIED');
    expect(body.error.details?.['status']).toBe('in-review');
  });

  it('T-UNDO-003l: a batch that removed something is refused and destroys NOTHING', async () => {
    created('t-1', 'l-1');
    store.changes.push({
      kind: 'listing_removed',
      titleId: 't-2',
      listingId: 'l-2',
      attr: null,
      prevValue: null,
      nextValue: null,
    });

    const res = await undo('batch-1');
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('BATCH_NOT_CREATES_ONLY');
    expect(body.error.details?.['reason']).toBe('modified-or-removed');
    // TASK-114 replaces `details` with the full §8.4 enumeration; the marker
    // is here so that task has something to find.
    expect(body.error.details?.['truncated']).toBe(false);

    expect(store.transactions).toBe(0);
    expect(store.discardedTitles).toEqual([]);
    expect(store.discardedListings).toEqual([]);
  });

  it('T-UNDO-008b: a batch that created NOTHING undoes as a no-op (US-032 AC-5)', async () => {
    // Creates-only is "modified and removed are both empty", NOT "created is
    // non-empty". An import where the owner discarded every read is undoable,
    // and refusing it would be a refusal with nothing to explain.
    const res = await undo('batch-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as UndoBody;

    expect(body.reversed.titlesDeleted).toBe(0);
    expect(body.reversed.listingsRemoved).toBe(0);
    expect(store.transactions).toBe(1);
  });

  it('T-UNDO-003m: an attr_modified row blocks the undo', async () => {
    // The batch touched an existing row's attributes. SD-03 can restore a
    // creation by destroying it; it has no way to restore a previous value.
    created('t-1', 'l-1');
    store.changes.push({
      kind: 'attr_modified',
      titleId: 't-9',
      listingId: null,
      attr: 'tmdbName',
      prevValue: '"Heat"',
      nextValue: '"Dune"',
    });

    const res = await undo('batch-1');
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('BATCH_NOT_CREATES_ONLY');
  });

  it('T-UNDO-006a: the refusal enumerates created + modified + removed in ONE untruncated payload', async () => {
    // Unit-level counterpart to the integration T-UNDO-006, driving the §8.4
    // enumeration builder with no database. A mixed batch — a created title, a
    // modified title, a removed listing — must return all three groups, each
    // entry carrying its remedy + remedyHref, with truncated:false.
    created('t-1', 'l-1');
    store.changes.push({
      kind: 'attr_modified',
      titleId: 't-9',
      listingId: null,
      attr: 'tmdbName',
      prevValue: '"Heat"',
      nextValue: '"Dune"',
    });
    store.changes.push({
      kind: 'listing_removed',
      titleId: 't-2',
      listingId: 'l-2',
      attr: null,
      prevValue: null,
      nextValue: '"group-1"',
    });
    store.titleDisplays = {
      't-1': {
        workIdentity: 'w-1',
        state: 'active',
        tmdbName: 'The Matrix',
        rawExtractedText: 'matrix',
        tmdbReleaseYear: 1999,
        tmdbPosterPath: '/matrix.jpg',
      },
      't-9': {
        workIdentity: 'w-9',
        state: 'active',
        tmdbName: 'Dune',
        rawExtractedText: 'dune',
        tmdbReleaseYear: 2021,
        tmdbPosterPath: null,
      },
      't-2': {
        workIdentity: 'w-2',
        state: 'active',
        tmdbName: 'Heat',
        rawExtractedText: 'heat',
        tmdbReleaseYear: 1995,
        tmdbPosterPath: '/heat.jpg',
      },
    };
    store.listingStates = { 'l-2': 'removed' };

    const res = await undo('batch-1');
    expect(res.status).toBe(409);
    const details = ((await res.json()) as ErrorBody).error.details as {
      reason: string;
      truncated: boolean;
      created: Record<string, unknown>[];
      modified: Record<string, unknown>[];
      removed: Record<string, unknown>[];
    };

    expect(details.reason).toBe('modified-or-removed');
    expect(details.truncated).toBe(false);

    expect(details.created).toHaveLength(1);
    expect(details.created[0]).toMatchObject({
      titleId: 't-1',
      name: 'The Matrix',
      releaseYear: 1999,
      posterPath: '/matrix.jpg',
      currentState: 'active',
      remedy: 'not-interested',
      remedyHref: '/api/titles/t-1/suppress',
    });

    expect(details.modified).toHaveLength(1);
    expect(details.modified[0]).toMatchObject({
      titleId: 't-9',
      name: 'Dune',
      attr: 'tmdbName',
      before: 'Heat',
      currentState: 'active',
      remedy: 'fix-match',
      remedyHref: '/api/titles/t-9/fix-match',
    });

    expect(details.removed).toHaveLength(1);
    expect(details.removed[0]).toMatchObject({
      titleId: 't-2',
      listingId: 'l-2',
      name: 'Heat',
      currentState: 'removed',
      remedy: 'restore',
      remedyHref: '/api/listings/l-2/restore',
    });

    // Read-only refusal (REQ-075): nothing written.
    expect(store.transactions).toBe(0);
  });

  it('T-UNDO-012a: a since-removed title and a since-suppressed work are ANNOTATED, not dropped', async () => {
    // US-033 AC-6: a title the batch touched that has since been removed or
    // suppressed still appears, annotated via currentState. Filtering them out
    // is the tempting bug — it loses exactly the entries the owner most needs.
    created('t-1', 'l-1');
    store.changes.push({
      kind: 'listing_removed',
      titleId: 't-2',
      listingId: 'l-2',
      attr: null,
      prevValue: null,
      nextValue: '"group-1"',
    });
    store.titleDisplays = {
      't-1': {
        workIdentity: 'w-1',
        state: 'removed',
        tmdbName: 'Gone Title',
        rawExtractedText: 'gone',
        tmdbReleaseYear: null,
        tmdbPosterPath: null,
      },
      't-2': {
        workIdentity: 'w-2',
        state: 'active',
        tmdbName: 'Suppressed Title',
        rawExtractedText: null,
        tmdbReleaseYear: null,
        tmdbPosterPath: null,
      },
    };
    // The listing itself is still active; suppression of its WORK must win.
    store.listingStates = { 'l-2': 'active' };
    store.suppressions = [{ workIdentity: 'w-2' }];

    const res = await undo('batch-1');
    expect(res.status).toBe(409);
    const details = ((await res.json()) as ErrorBody).error.details as {
      created: Record<string, unknown>[];
      removed: Record<string, unknown>[];
    };

    expect(details.created[0]).toMatchObject({ titleId: 't-1', currentState: 'removed' });
    expect(details.removed[0]).toMatchObject({ titleId: 't-2', currentState: 'suppressed' });
  });

  it('T-UNDO-007a: created effects with NO provenance refuse as provenance-unavailable, writing nothing', async () => {
    // US-033 AC-7: no batch_change rows, but the batch demonstrably created
    // rows — provenance was lost. The refusal must be the structured §8.4 body,
    // not a silent no-op that destroys rows it has no record of.
    store.changes = [];
    store.createdEffects = 3;

    const res = await undo('batch-1');
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('BATCH_NOT_CREATES_ONLY');
    const details = body.error.details as {
      reason: string;
      created: unknown[];
      modified: unknown[];
      removed: unknown[];
      truncated: boolean;
    };
    expect(details.reason).toBe('provenance-unavailable');
    expect(details.created).toEqual([]);
    expect(details.modified).toEqual([]);
    expect(details.removed).toEqual([]);
    expect(details.truncated).toBe(false);

    // Read-only: no transaction, nothing discarded.
    expect(store.transactions).toBe(0);
    expect(store.discardedTitles).toEqual([]);
    expect(store.discardedListings).toEqual([]);
  });
});
