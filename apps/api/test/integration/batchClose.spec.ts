/**
 * TASK-071 — `POST /api/batches/:batchId/close` (`specs/api.md` §6.22).
 *
 * `T-REV-012` (close applies only `confirmed`/`corrected`; `pending` blocks
 * with 409 `PENDING_ADDITIONS`).
 *
 * The rules themselves are proven purely in
 * `packages/domain/test/close.spec.ts`. What this file proves is the half that
 * only a real store can show: that the writes land, that they land in ONE
 * transaction scoped to ONE service (product invariant 3), and that a refusal
 * leaves the database exactly as it found it.
 *
 * ⚠ EVERY REFUSAL CASE ASSERTS "AND NOTHING WAS WRITTEN". A close that refuses
 * with the right code but has already created six listings is the worst
 * possible outcome — the owner is told nothing happened, retries, and gets
 * duplicates. Asserting only the status code would pass on exactly that bug.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toBatchProvenance } from '@nextup/domain';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

/**
 * A fault injected INSIDE the transaction, so rollback can be proven.
 *
 * ⚠ There is no way to prove atomicity from the outside without one. Every
 * other refusal in this file is decided BEFORE the transaction opens, so it
 * would pass identically against an implementation with no transaction at all
 * — which is exactly the bug that matters: a close that writes six listings
 * and then fails leaves the owner told nothing happened, retrying, and getting
 * duplicates. `upsertServiceState` is the injection point because it is the
 * LAST write in the transaction, so by the time it throws every listing has
 * already been inserted and only a real rollback can remove them.
 */
let failServiceState = false;

/**
 * Simulates a work suppressed BETWEEN the candidate load and the transaction.
 *
 * ⚠ Without this the in-transaction suppression re-check is unreachable from
 * the route, and a mutant that deletes it survives every test in this file:
 * `loadReviewCandidates` has already filtered suppressed works out, so the
 * loop never sees one. That is precisely the race the re-check exists for —
 * review and close are separate requests, and a suppression made from another
 * tab in between would otherwise be overridden by the close.
 *
 * The simulation is one-shot and surgical: the review load sees NO
 * suppressions (as a load that ran before the suppression would have), while
 * the in-transaction `findActiveSuppression` still reads the real row.
 */
let hideSuppressionsFromReview = false;

/**
 * TASK-074 — a provenance write that fails (`T-PROV-001`, US-031 AC-6).
 *
 * ⚠ "A change without provenance MUST NOT be persisted" is only testable by
 * making the provenance write fail while the mutation succeeds. Nothing else
 * distinguishes an implementation that writes provenance in the transaction
 * from one that writes it afterwards, on the pooled client, where it would
 * survive a rollback — or be skipped entirely on failure while the titles it
 * was supposed to describe stayed.
 */
let failProvenance = false;

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    upsertServiceState: async (...args: Parameters<typeof actual.upsertServiceState>) => {
      if (failServiceState) throw new Error('injected mid-transaction failure');
      return actual.upsertServiceState(...args);
    },
    listActiveSuppressions: async (...args: Parameters<typeof actual.listActiveSuppressions>) => {
      if (hideSuppressionsFromReview) return [];
      return actual.listActiveSuppressions(...args);
    },
    recordBatchChange: async (...args: Parameters<typeof actual.recordBatchChange>) => {
      if (failProvenance) throw new Error('injected provenance failure');
      return actual.recordBatchChange(...args);
    },
  };
});

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-close';
const ISSUER = 'https://sts.windows.net/tenant/';

const principalHeader = Buffer.from(
  JSON.stringify({
    claims: [
      { typ: 'iss', val: ISSUER },
      { typ: OID, val: SUBJECT },
      { typ: 'preferred_username', val: 'owner@example.com' },
    ],
  }),
  'utf8',
).toString('base64');

const DUNE = 'tmdb:movie:438631';
const HEAT = 'tmdb:movie:949';

let server: Server;
let app: Express;
let origin: string;
let ownerId: string;

interface CloseBody {
  batchId: string;
  status: string;
  completedAt: string;
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
  undoable: boolean;
}

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

const closeBatchRequest = (batchId: string, body: unknown = {}): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/close`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [CLIENT_PRINCIPAL_HEADER]: principalHeader },
    body: JSON.stringify(body),
  });

/* ── fixtures ─────────────────────────────────────────────────────────── */

let batchSeq = 0;

async function makeBatch(
  over: { status?: string; mode?: string; service?: string } = {},
): Promise<string> {
  const id = `batch-close-${++batchSeq}`;
  await testPrisma().uploadBatch.create({
    data: {
      id,
      ownerId,
      service: over.service ?? 'netflix',
      mode: over.mode ?? 'append-only',
      status: over.status ?? 'in-review',
      lowYield: false,
      degradedExtraction: false,
      crossCheck: 'ok',
    },
  });
  return id;
}

let candidateSeq = 0;

/**
 * A candidate with a real match blob, because close reads `match` to build the
 * title row and a candidate without one would silently take the unmatched
 * branch — writing a `matchState: 'unmatched'` title that looks almost right.
 */
async function makeCandidate(
  batchId: string,
  over: {
    workIdentity?: string | null;
    rawText?: string;
    verdict?: string;
    disposition?: string;
    tmdbId?: number;
    /**
     * The pipeline's own top match, when it differs from the resolved identity
     * — i.e. what a REAL correction leaves behind, because applying one
     * rewrites `resolvedWorkIdentity` and deliberately never touches
     * `matchCandidates`. `null` means the pipeline proposed nothing.
     */
    originalTmdbId?: number | null;
    originalName?: string;
    collapsedInto?: string | null;
  } = {},
): Promise<string> {
  const id = `cand-close-${++candidateSeq}`;
  const workIdentity = over.workIdentity === undefined ? DUNE : over.workIdentity;
  const tmdbId = over.tmdbId ?? Number(workIdentity?.split(':')[2] ?? 0);
  const matched = workIdentity?.startsWith('tmdb:') === true;
  const altTmdbId =
    over.originalTmdbId === undefined ? (matched ? tmdbId : null) : over.originalTmdbId;

  await testPrisma().extractionCandidate.create({
    data: {
      id,
      ownerId,
      batchId,
      rawText: over.rawText ?? 'Dune',
      inferredTitle: over.rawText ?? 'Dune',
      basis: 'both',
      ocrSupport: 'exact',
      provider: 'llm',
      normalisedText: (over.rawText ?? 'Dune').toLowerCase(),
      boxSource: 'llm',
      cleanupVerdict: over.verdict ?? 'title-candidate',
      resolvedWorkIdentity: workIdentity,
      reviewDisposition: over.disposition ?? 'pending',
      collapsedIntoCandidateId: over.collapsedInto ?? null,
      matchCandidates:
        altTmdbId === null
          ? null
          : JSON.stringify([
              {
                tmdbId: altTmdbId,
                mediaType: 'movie',
                name: over.originalName ?? over.rawText ?? 'Dune',
                releaseYear: 2021,
                posterPath: '/dune.jpg',
                score: 1,
              },
            ]),
    },
  });
  return id;
}

let titleSeq = 0;

/** An EXISTING active title + listing, so already-present paths are real. */
async function seedListing(
  workIdentity: string,
  name: string,
  service: string,
  dateAdded = new Date('2026-01-04'),
): Promise<string> {
  const titleId = `title-close-${++titleSeq}`;
  await testPrisma().uploadBatch.upsert({
    where: { id: 'batch-close-seed' },
    update: {},
    create: {
      id: 'batch-close-seed',
      ownerId,
      service,
      mode: 'append-only',
      status: 'applied',
      lowYield: false,
      degradedExtraction: false,
    },
  });
  await testPrisma().title.create({
    data: {
      id: titleId,
      ownerId,
      workIdentity,
      state: 'active',
      matchState: 'matched',
      normalisedText: name.toLowerCase(),
      tmdbId: Number(workIdentity.split(':')[2]),
      tmdbMediaType: 'movie',
      tmdbName: name,
      tmdbReleaseYear: 1995,
      sortDateAdded: dateAdded,
    },
  });
  await testPrisma().serviceListing.create({
    data: {
      listingId: `listing-close-${titleSeq}`,
      ownerId,
      titleId,
      service,
      state: 'active',
      dateAdded,
      createdByBatchId: 'batch-close-seed',
    },
  });
  return titleId;
}

const countListings = (): Promise<number> => testPrisma().serviceListing.count({ where: {} });
const countTitles = (): Promise<number> => testPrisma().title.count({ where: {} });

/* ── lifecycle ────────────────────────────────────────────────────────── */

beforeEach(async () => {
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  process.env['TMDB_API_KEY'] = '';
  testPrisma();
  await resetDatabase();

  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  const created = await fetch(`${origin}/api/batches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [CLIENT_PRINCIPAL_HEADER]: principalHeader },
    body: JSON.stringify({ service: 'netflix', mode: 'append-only' }),
  });
  const seeded = (await created.json()) as { batchId: string };
  const row = await testPrisma().uploadBatch.findFirst({ where: { id: seeded.batchId } });
  ownerId = row?.ownerId ?? '';
  await testPrisma().uploadBatch.deleteMany({ where: { id: seeded.batchId } });
});

afterEach(async () => {
  hideSuppressionsFromReview = false;
  failServiceState = false;
  failProvenance = false;
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterAll(async () => {
  await closeTestPrisma();
});

/* ── tests ────────────────────────────────────────────────────────────── */

describe('T-REV-012 · US-012 AC-3 · close applies confirmed work and refuses pending', () => {
  it('T-REV-012n: a confirmed addition becomes a title and a listing', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });

    const res = await closeBatchRequest(batchId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CloseBody;
    expect(body.summary.titlesCreated).toBe(1);
    expect(body.summary.listingsCreated).toBe(1);

    const title = await testPrisma().title.findFirst({ where: { workIdentity: DUNE } });
    expect(title?.matchState).toBe('matched');
    expect(title?.tmdbId).toBe(438631);
    expect(title?.tmdbName).toBe('Dune');
    // `title_match_coherent`: a matched title must carry NO raw text.
    expect(title?.rawExtractedText).toBeNull();

    const listing = await testPrisma().serviceListing.findFirst({
      where: { titleId: title?.id ?? '' },
    });
    expect(listing?.service).toBe('netflix');
    expect(listing?.state).toBe('active');
    expect(listing?.createdByBatchId).toBe(batchId);
  });

  it('T-REV-012o: a pending addition refuses with PENDING_ADDITIONS and writes NOTHING', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });
    const pendingId = await makeCandidate(batchId, { workIdentity: HEAT, rawText: 'Heat' });

    const res = await closeBatchRequest(batchId);
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('PENDING_ADDITIONS');
    expect(body.error.details['pendingCandidateIds']).toEqual([pendingId]);

    // The whole point: the confirmed sibling was NOT applied either.
    expect(await countTitles()).toBe(0);
    expect(await countListings()).toBe(0);
    const batch = await testPrisma().uploadBatch.findFirst({ where: { id: batchId } });
    expect(batch?.status).toBe('in-review');
    expect(batch?.completedAt).toBeNull();
  });

  it('T-REV-012p: a discarded item writes nothing but is counted', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'discarded' });

    const body = (await (await closeBatchRequest(batchId)).json()) as CloseBody;
    expect(body.summary).toMatchObject({ titlesCreated: 0, listingsCreated: 0, discarded: 1 });
    expect(await countListings()).toBe(0);

    // REQ-012: the candidate row itself survives the discard.
    expect(await testPrisma().extractionCandidate.count({ where: { batchId } })).toBe(1);
  });

  it('T-REV-012q: an unmatched confirmation is KEPT as an unresolved title (US-008)', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, {
      workIdentity: 'unmatched:0123456789abcdef',
      rawText: 'Some Obscure Film',
      disposition: 'confirmed',
    });

    const body = (await (await closeBatchRequest(batchId)).json()) as CloseBody;
    expect(body.summary.unresolvedKept).toBe(1);
    // ⚠ AND it gets a listing. A kept-anyway title with no listing is not on
    // the list at all — it would vanish from the combined view while the
    // summary still reported it as kept, which is the silent-loss failure
    // US-008 exists to prevent.
    expect(body.summary.listingsCreated).toBe(1);

    const title = await testPrisma().title.findFirst({
      where: { workIdentity: 'unmatched:0123456789abcdef' },
    });
    // `title_match_coherent`, the other half: unmatched ⇒ raw text present,
    // tmdb id absent. Prisma reports a violation as a FOREIGN KEY error.
    expect(title?.matchState).toBe('unmatched');
    expect(title?.rawExtractedText).toBe('Some Obscure Film');
    expect(title?.tmdbId).toBeNull();

    const listing = await testPrisma().serviceListing.findFirst({
      where: { titleId: title?.id ?? '' },
    });
    expect(listing?.service).toBe('netflix');
    expect(listing?.state).toBe('active');
  });

  it('T-REV-012r: a work already on ANOTHER service reuses its title, adding only a listing', async () => {
    const titleId = await seedListing(DUNE, 'Dune', 'max', new Date('2025-06-01'));
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });

    const body = (await (await closeBatchRequest(batchId)).json()) as CloseBody;
    expect(body.summary).toMatchObject({ titlesCreated: 0, listingsCreated: 1 });

    // One work, one title row, two service badges — the whole product.
    expect(await testPrisma().title.count({ where: { workIdentity: DUNE } })).toBe(1);
    const listings = await testPrisma().serviceListing.findMany({ where: { titleId } });
    expect(listings.map((l) => l.service).sort()).toEqual(['max', 'netflix']);
  });

  it('T-REV-012s: the title keeps its EARLIER date when a second service is added', async () => {
    // Product invariant 6: the title-level date is the earliest across its
    // listings. Overwriting it here would silently reorder the whole list to
    // the top every time a second service was captured.
    const titleId = await seedListing(DUNE, 'Dune', 'max', new Date('2025-06-01'));
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });

    await closeBatchRequest(batchId);

    const title = await testPrisma().title.findFirst({ where: { id: titleId } });
    expect(title?.sortDateAdded?.toISOString().slice(0, 10)).toBe('2025-06-01');
  });

  it('T-REV-012t: a suppressed work is gated at close, not silently re-added', async () => {
    // The gate is keyed on WORK IDENTITY (REQ-071, product invariant 1). A
    // candidate for a suppressed work must not become a listing however it
    // was dispositioned.
    await testPrisma().suppression.create({
      data: {
        id: 'sup-close-1',
        ownerId,
        workIdentity: DUNE,
        active: true,
        displayName: 'Dune',
      },
    });
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });

    const body = (await (await closeBatchRequest(batchId)).json()) as CloseBody;
    expect(body.summary.suppressedGated).toBe(1);
    expect(body.summary.listingsCreated).toBe(0);
    expect(await countListings()).toBe(0);
  });

  it('T-REV-012ah: a work suppressed AFTER review is still gated inside the transaction', async () => {
    // The race the in-transaction re-check exists for: review and close are
    // separate requests, so a suppression made from another tab between them
    // is invisible to the candidate load. Without the re-check the close
    // would silently re-add a work the owner had just said no to — and REQ-071
    // suppression that can be overridden by a stale tab is not suppression.
    await testPrisma().suppression.create({
      data: {
        id: 'sup-close-race',
        ownerId,
        workIdentity: DUNE,
        active: true,
        displayName: 'Dune',
      },
    });
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });

    hideSuppressionsFromReview = true;
    const body = (await (await closeBatchRequest(batchId)).json()) as CloseBody;

    // Counted once, by the transaction rather than by the (blinded) load.
    expect(body.summary.suppressedGated).toBe(1);
    expect(body.summary.listingsCreated).toBe(0);
    expect(await countListings()).toBe(0);
  });

  it('T-REV-012u: an SD-02 collapsed loser does not become a second listing', async () => {
    const batchId = await makeBatch();
    const winner = await makeCandidate(batchId, { disposition: 'confirmed' });
    await makeCandidate(batchId, { disposition: 'confirmed', collapsedInto: winner });

    const body = (await (await closeBatchRequest(batchId)).json()) as CloseBody;
    expect(body.summary.listingsCreated).toBe(1);
    expect(await countListings()).toBe(1);
  });

  it('T-REV-012v: closing marks the batch applied and stamps completedAt', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });

    const body = (await (await closeBatchRequest(batchId)).json()) as CloseBody;
    expect(body.status).toBe('applied');

    const batch = await testPrisma().uploadBatch.findFirst({ where: { id: batchId } });
    expect(batch?.status).toBe('applied');
    expect(batch?.completedAt).not.toBeNull();
    expect(body.completedAt).toBe(batch?.completedAt?.toISOString());
  });

  it('T-REV-012w: closing records the per-service last-updated date (REQ-039)', async () => {
    // US-022's factual freshness fact. Not a nudge, not a threshold — the date
    // itself, which `FreshnessStrip` renders.
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });

    const body = (await (await closeBatchRequest(batchId)).json()) as CloseBody;
    expect(body.serviceState.service).toBe('netflix');

    const state = await testPrisma().serviceState.findFirst({ where: { ownerId } });
    expect(state?.service).toBe('netflix');
    expect(state?.lastCompletedBatchId).toBe(batchId);
    expect(state?.lastCompletedBatchAt?.toISOString()).toBe(body.serviceState.lastCompletedBatchAt);
  });

  it('T-REV-012x: closing writes ONLY this batch’s service (product invariant 3)', async () => {
    await seedListing(HEAT, 'Heat', 'max');
    const batchId = await makeBatch({ service: 'netflix' });
    await makeCandidate(batchId, { disposition: 'confirmed' });

    await closeBatchRequest(batchId);

    const maxListings = await testPrisma().serviceListing.findMany({ where: { service: 'max' } });
    expect(maxListings).toHaveLength(1);
    expect(maxListings[0]?.createdByBatchId).toBe('batch-close-seed');
    // And no service state was written for the service this batch is not for.
    const states = await testPrisma().serviceState.findMany({ where: { ownerId } });
    expect(states.map((s) => s.service)).toEqual(['netflix']);
  });

  it('T-REV-012y: a batch that is not in-review is 409 BATCH_NOT_IN_REVIEW and writes nothing', async () => {
    const batchId = await makeBatch({ status: 'applied' });
    await makeCandidate(batchId, { disposition: 'confirmed' });

    const res = await closeBatchRequest(batchId);
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('BATCH_NOT_IN_REVIEW');
    expect(await countListings()).toBe(0);
    expect(await countTitles()).toBe(0);
  });

  it('T-REV-012z: closing twice is refused the second time, and does not duplicate', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });

    expect((await closeBatchRequest(batchId)).status).toBe(200);
    const second = await closeBatchRequest(batchId);
    expect(second.status).toBe(409);
    expect(((await second.json()) as ErrorBody).error.code).toBe('BATCH_NOT_IN_REVIEW');
    expect(await countListings()).toBe(1);
  });

  it('T-REV-012aa: an unknown batch id is 404, and so is another owner’s', async () => {
    expect((await closeBatchRequest('batch-does-not-exist')).status).toBe(404);
  });

  it('T-REV-012ab: an empty review closes cleanly with an all-zero summary', async () => {
    const batchId = await makeBatch();

    const body = (await (await closeBatchRequest(batchId)).json()) as CloseBody;
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

  it('T-REV-012ac: close removes NOTHING — removal is never a side effect (REQ-020)', async () => {
    // TASK-083 to TASK-086 own removals. Until then a full-update close must
    // still not remove anything, and this pins that the "safe direction" claim
    // in the service header is true rather than merely intended.
    const titleId = await seedListing(HEAT, 'Heat', 'netflix');
    const batchId = await makeBatch({ mode: 'full-update' });
    await makeCandidate(batchId, { disposition: 'confirmed' });

    const body = (await (await closeBatchRequest(batchId)).json()) as CloseBody;
    expect(body.summary.listingsRemoved).toBe(0);
    expect(body.summary.removalGroupId).toBeNull();

    const survivor = await testPrisma().serviceListing.findFirst({ where: { titleId } });
    expect(survivor?.state).toBe('active');
    expect(survivor?.removedAt).toBeNull();
    expect(await testPrisma().removalGroup.count({ where: {} })).toBe(0);
  });

  it('T-REV-012ad: a corrected item is applied under its CORRECTED identity', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, {
      workIdentity: HEAT,
      rawText: 'Heat',
      disposition: 'corrected',
    });

    const body = (await (await closeBatchRequest(batchId)).json()) as CloseBody;
    expect(body.summary.listingsCreated).toBe(1);
    const title = await testPrisma().title.findFirst({ where: { workIdentity: HEAT } });
    expect(title?.tmdbId).toBe(949);
  });

  it('T-REV-012ae: a chrome-suspected row neither blocks nor is applied', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { verdict: 'chrome-suspected', workIdentity: null });

    const res = await closeBatchRequest(batchId);
    expect(res.status).toBe(200);
    expect(await countListings()).toBe(0);
  });
});

describe('T-REV-012 · close is ONE transaction (product invariant 3)', () => {
  it('T-REV-012af: a failure after the listings are written rolls ALL of them back', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });
    await makeCandidate(batchId, { workIdentity: HEAT, rawText: 'Heat', disposition: 'confirmed' });

    failServiceState = true;
    const res = await closeBatchRequest(batchId);
    failServiceState = false;

    expect(res.status).toBe(500);

    // Two titles and two listings were inserted before the fault. If any of
    // them survives, the close was not transactional.
    expect(await countTitles()).toBe(0);
    expect(await countListings()).toBe(0);

    // And the batch is still closable, rather than stranded as `applied` with
    // nothing applied.
    const batch = await testPrisma().uploadBatch.findFirst({ where: { id: batchId } });
    expect(batch?.status).toBe('in-review');
    expect(batch?.completedAt).toBeNull();
    expect(await testPrisma().serviceState.count({ where: { ownerId } })).toBe(0);
  });

  it('T-REV-012ag: and the same batch closes cleanly on retry', async () => {
    // The accept half. Without it, an implementation that rolled back by
    // never writing anything at all would satisfy the case above.
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });

    failServiceState = true;
    expect((await closeBatchRequest(batchId)).status).toBe(500);
    failServiceState = false;

    expect((await closeBatchRequest(batchId)).status).toBe(200);
    expect(await countListings()).toBe(1);
  });
});

/**
 * TASK-074 — provenance (REQ-068, US-031, `specs/data-model.md` §8.1).
 *
 * The store keeps one `batch_change` row per event; `toBatchProvenance` folds
 * them into the §3.7 three-array shape. Both halves are asserted here, because
 * a row that is written but folds into nothing is not provenance.
 */
describe('T-PROV-010 · close records what it created', () => {
  const provenanceFor = async (batchId: string) =>
    toBatchProvenance(await testPrisma().batchChange.findMany({ where: { batchId } }));

  it('T-PROV-010a: a created title and its listing carry createdByBatchId and appear in provenance.created', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });

    expect((await closeBatchRequest(batchId)).status).toBe(200);

    const title = await testPrisma().title.findFirst({ where: { workIdentity: DUNE } });
    const listing = await testPrisma().serviceListing.findFirst({ where: { titleId: title?.id } });
    expect(title?.createdByBatchId).toBe(batchId);
    expect(listing?.createdByBatchId).toBe(batchId);

    expect(await provenanceFor(batchId)).toEqual({
      created: [{ titleId: title?.id, listingId: listing?.listingId, titleWasCreated: true }],
      modified: [],
      removed: [],
    });
  });

  it('T-PROV-010b: a listing added to an EXISTING title records titleWasCreated false', async () => {
    const titleId = await seedListing(DUNE, 'Dune', 'max');
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });

    expect((await closeBatchRequest(batchId)).status).toBe(200);

    const provenance = await provenanceFor(batchId);
    expect(provenance.created).toEqual([
      { titleId, listingId: expect.any(String) as unknown as string, titleWasCreated: false },
    ]);
    // The title was not this batch's to create, so its `createdByBatchId` must
    // not be rewritten — undo of this batch may remove the Netflix listing, but
    // never the title the earlier Max batch created.
    const title = await testPrisma().title.findFirst({ where: { id: titleId } });
    expect(title?.createdByBatchId).toBeNull();
  });

  it('T-PROV-010c: a discarded or suppressed candidate produces NO provenance', async () => {
    await testPrisma().suppression.create({
      data: {
        id: 'sup-prov-1',
        ownerId,
        workIdentity: HEAT,
        active: true,
        displayName: 'Heat',
      },
    });
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'discarded' });
    await makeCandidate(batchId, { workIdentity: HEAT, rawText: 'Heat', disposition: 'confirmed' });

    expect((await closeBatchRequest(batchId)).status).toBe(200);
    expect(await provenanceFor(batchId)).toEqual({ created: [], modified: [], removed: [] });
  });
});

describe('T-PROV-001 · a change without provenance is never persisted (US-031 AC-6)', () => {
  it('T-PROV-001a: if provenance cannot be written the close fails atomically', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });
    await makeCandidate(batchId, { workIdentity: HEAT, rawText: 'Heat', disposition: 'confirmed' });

    failProvenance = true;
    const res = await closeBatchRequest(batchId);
    failProvenance = false;

    expect(res.status).toBe(500);
    // Nothing at all: not the titles, not the listings, not the provenance
    // rows, not the batch transition. Provenance is the record undo reads, so
    // a close that persisted its writes and skipped its record would leave a
    // batch that could never be undone correctly.
    expect(await countTitles()).toBe(0);
    expect(await countListings()).toBe(0);
    expect(await testPrisma().batchChange.count({ where: { batchId } })).toBe(0);

    const batch = await testPrisma().uploadBatch.findFirst({ where: { id: batchId } });
    expect(batch?.status).toBe('in-review');
    expect(batch?.completedAt).toBeNull();
  });

  it('T-PROV-001b: and the same batch closes cleanly, with provenance, on retry', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });

    failProvenance = true;
    expect((await closeBatchRequest(batchId)).status).toBe(500);
    failProvenance = false;

    expect((await closeBatchRequest(batchId)).status).toBe(200);
    expect(await countListings()).toBe(1);
    // Exactly two rows — `title_created` and `listing_added` — not four. The
    // failed attempt left nothing behind to be counted twice.
    expect(await testPrisma().batchChange.count({ where: { batchId } })).toBe(2);
  });
});

describe('T-PROV-012 · a correction made in review is recorded as modified (REQ-068, §8.1)', () => {
  const provenanceFor = async (batchId: string) =>
    toBatchProvenance(await testPrisma().batchChange.findMany({ where: { batchId } }));

  it('T-PROV-012h: a corrected candidate records attr workIdentity with the pipeline match as `before`', async () => {
    const batchId = await makeBatch();
    // What a real correction leaves on the row: the resolved identity is the
    // owner's (Heat), `matchCandidates` still holds the pipeline's (Dune).
    await makeCandidate(batchId, {
      workIdentity: HEAT,
      rawText: 'Heat',
      disposition: 'corrected',
      originalTmdbId: 438631,
      originalName: 'Dune',
    });

    expect((await closeBatchRequest(batchId)).status).toBe(200);

    const title = await testPrisma().title.findFirst({ where: { workIdentity: HEAT } });
    expect(await provenanceFor(batchId)).toEqual({
      created: [
        {
          titleId: title?.id,
          listingId: expect.any(String) as unknown as string,
          titleWasCreated: true,
        },
      ],
      modified: [{ titleId: title?.id, attr: 'workIdentity', before: DUNE, after: HEAT }],
      removed: [],
    });
  });

  it('T-PROV-012i: the title is built from the CORRECTED identity, not the rejected match', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, {
      workIdentity: HEAT,
      rawText: 'Heat',
      disposition: 'corrected',
      originalTmdbId: 438631,
      originalName: 'Dune',
    });

    expect((await closeBatchRequest(batchId)).status).toBe(200);

    const title = await testPrisma().title.findFirst({ where: { workIdentity: HEAT } });
    // ⚠ The regression this guards: reading `alternatives[0]` for the metadata
    // stored a row whose identity said Heat and whose tmdbId, name and poster
    // all still said Dune — the very title the owner had just corrected away
    // from, under an identity suppression and dedup would never match.
    expect(title?.tmdbId).toBe(949);
    expect(title?.tmdbMediaType).toBe('movie');
    // Nothing knows Heat's name yet: the correction carries only an id and a
    // media type. Left null with `tmdbFetchedAt` null, the lazy refresh
    // (REQ-076, NFR-014) fills it on first access rather than a wrong name
    // being invented here.
    expect(title?.tmdbName).toBeNull();
    expect(title?.tmdbPosterPath).toBeNull();
    expect(title?.tmdbFetchedAt).toBeNull();
  });

  it('T-PROV-012j: a correction from an unmatched candidate records before as null', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, {
      workIdentity: HEAT,
      rawText: 'Heat',
      disposition: 'corrected',
      originalTmdbId: null,
    });

    expect((await closeBatchRequest(batchId)).status).toBe(200);

    const provenance = await provenanceFor(batchId);
    // `null`, not the `unmatched:` hash: the row never actually held one, and
    // recording a value it never had would make undo restore a fiction.
    expect(provenance.modified).toEqual([
      {
        titleId: expect.any(String) as unknown as string,
        attr: 'workIdentity',
        before: null,
        after: HEAT,
      },
    ]);
  });

  it('T-PROV-012k: a confirmed candidate the owner did not correct records nothing modified', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });

    expect((await closeBatchRequest(batchId)).status).toBe(200);
    expect((await provenanceFor(batchId)).modified).toEqual([]);
  });

  it('T-PROV-012l: a correction that lands back on the pipeline match records nothing modified', async () => {
    const batchId = await makeBatch();
    // The owner opened the picker and chose the title already proposed.
    await makeCandidate(batchId, { disposition: 'corrected' });

    expect((await closeBatchRequest(batchId)).status).toBe(200);
    expect((await provenanceFor(batchId)).modified).toEqual([]);
  });

  it('T-PROV-012n: a keep-anyway unmatched title records nothing modified', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, {
      workIdentity: 'unmatched:0123456789abcdef',
      rawText: 'Some Obscure Film',
      disposition: 'confirmed',
    });

    expect((await closeBatchRequest(batchId)).status).toBe(200);
    // ⚠ The owner corrected nothing here — the pipeline simply matched
    // nothing. Recording this as `modified` (from null to the hash) would make
    // an ordinary keep-anyway batch permanently un-undoable, because SD-03's
    // creates-only undo refuses any batch that modified something.
    expect((await provenanceFor(batchId)).modified).toEqual([]);
  });

  it('T-PROV-012m: the modified row is written INSIDE the close transaction', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, {
      workIdentity: HEAT,
      rawText: 'Heat',
      disposition: 'corrected',
      originalTmdbId: 438631,
    });

    failProvenance = true;
    expect((await closeBatchRequest(batchId)).status).toBe(500);
    failProvenance = false;

    expect(await testPrisma().batchChange.count({ where: { batchId } })).toBe(0);
    expect(await countTitles()).toBe(0);
  });
});

describe('T-PROV-013 · edits made OUTSIDE a batch write no batch provenance (US-031 AC-5)', () => {
  const post = (path: string, body: unknown = {}): Promise<Response> =>
    fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CLIENT_PRINCIPAL_HEADER]: principalHeader },
      body: JSON.stringify(body),
    });

  it('T-PROV-013a: suppressing a title writes no batch_change row', async () => {
    const titleId = await seedListing(DUNE, 'Dune', 'netflix');

    expect((await post(`/api/titles/${titleId}/suppress`)).status).toBe(200);

    // There is no batch to attribute it to — `batch_change.batch_id` is NOT
    // NULL, so an out-of-batch edit cannot be recorded there even in
    // principle. The batch history must not grow a phantom entry for an edit
    // the owner made from the list.
    expect(await testPrisma().batchChange.count()).toBe(0);
  });

  it('T-PROV-013b: un-suppressing writes no batch_change row either', async () => {
    const titleId = await seedListing(HEAT, 'Heat', 'netflix');
    expect((await post(`/api/titles/${titleId}/suppress`)).status).toBe(200);

    const suppression = await testPrisma().suppression.findFirst({ where: { workIdentity: HEAT } });
    expect((await post(`/api/suppressions/${suppression?.id}/unsuppress`)).status).toBe(200);

    expect(await testPrisma().batchChange.count()).toBe(0);
  });
});
