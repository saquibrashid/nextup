/**
 * TASK-085 — `PATCH /api/batches/:batchId/removals` (`specs/api.md` §6.21,
 * US-015, REQ-021, REQ-055).
 *
 * `T-UI-007` (every proposed removal arrives `ticked: true`) and `T-REM-014`
 * (unticking one rescues exactly that listing; the others are unaffected).
 *
 * Integration, not unit: the property under test is that a tick written by the
 * PATCH is the same tick the GET reads back, across a real store, for a
 * removal set that is RECOMPUTED from the screenshots on every read. A unit
 * test of either half would pass with the two sides disagreeing about which
 * listings are on the table, which is the failure that actually removes a
 * title the owner rescued.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-removals';
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
const ANDOR = 'tmdb:tv:83867';
const HEAT = 'tmdb:movie:949';

let server: Server;
let app: Express;
let origin: string;
let ownerId: string;

interface RemovalItem {
  listingId: string;
  name?: string;
  ticked?: boolean;
}

interface ReviewBody {
  sections: {
    removals: { label: string; count: number; omitted?: boolean; items: RemovalItem[] };
  };
}

interface PatchBody {
  tickedCount: number;
  untickedCount: number;
  totalCount: number;
}

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

const getReview = async (batchId: string): Promise<ReviewBody> => {
  const res = await fetch(`${origin}/api/batches/${batchId}/review`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as ReviewBody;
};

const patchRemovals = (batchId: string, body: unknown): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/removals`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      [CLIENT_PRINCIPAL_HEADER]: principalHeader,
    },
    body: JSON.stringify(body),
  });

/* ── fixtures ─────────────────────────────────────────────────────────── */

let batchSeq = 0;

async function makeBatch(
  over: { mode?: string; service?: string; status?: string } = {},
): Promise<string> {
  const id = `batch-removals-${++batchSeq}`;
  await testPrisma().uploadBatch.create({
    data: {
      id,
      ownerId,
      service: over.service ?? 'netflix',
      mode: over.mode ?? 'full-update',
      status: over.status ?? 'in-review',
      lowYield: false,
      degradedExtraction: false,
      crossCheck: 'ok',
    },
  });
  return id;
}

let candidateSeq = 0;

/** A candidate that resolves to a work — i.e. evidence the title IS still listed. */
async function makeCandidate(
  batchId: string,
  workIdentity: string,
  rawText: string,
): Promise<void> {
  await testPrisma().extractionCandidate.create({
    data: {
      id: `rmcand-${++candidateSeq}`,
      ownerId,
      batchId,
      rawText,
      inferredTitle: rawText,
      basis: 'both',
      ocrSupport: 'exact',
      provider: 'llm',
      normalisedText: rawText.toLowerCase(),
      boxSource: 'llm',
      cleanupVerdict: 'title-candidate',
      resolvedWorkIdentity: workIdentity,
      reviewDisposition: 'pending',
      collapsedIntoCandidateId: null,
    },
  });
}

let titleSeq = 0;

async function makeActiveListing(
  workIdentity: string,
  service: string,
  name: string,
): Promise<string> {
  const titleId = `rmtitle-${++titleSeq}`;
  const listingId = `rmlisting-${titleSeq}`;
  await testPrisma().title.create({
    data: {
      id: titleId,
      ownerId,
      workIdentity,
      state: 'active',
      matchState: 'matched',
      rawExtractedText: null,
      normalisedText: name.toLowerCase(),
      tmdbId: Number(workIdentity.split(':')[2]),
      tmdbMediaType: workIdentity.split(':')[1] ?? null,
      tmdbName: name,
      tmdbReleaseYear: 1995,
      sortDateAdded: new Date('2026-01-04'),
    },
  });
  await testPrisma().uploadBatch.upsert({
    where: { id: 'batch-rm-seed' },
    update: {},
    create: {
      id: 'batch-rm-seed',
      ownerId,
      service,
      mode: 'append-only',
      status: 'applied',
      lowYield: false,
      degradedExtraction: false,
    },
  });
  await testPrisma().serviceListing.create({
    data: {
      listingId,
      ownerId,
      titleId,
      service,
      state: 'active',
      dateAdded: new Date('2026-01-04'),
      createdByBatchId: 'batch-rm-seed',
    },
  });
  return listingId;
}

/**
 * Three active Netflix listings, a full-update batch whose screenshots show
 * only one of them — so two removals are proposed.
 */
async function threeListedTwoProposed(): Promise<{
  batchId: string;
  dune: string;
  andor: string;
  heat: string;
}> {
  const dune = await makeActiveListing(DUNE, 'netflix', 'Dune');
  const andor = await makeActiveListing(ANDOR, 'netflix', 'Andor');
  const heat = await makeActiveListing(HEAT, 'netflix', 'Heat');
  const batchId = await makeBatch();
  await makeCandidate(batchId, DUNE, 'Dune');
  return { batchId, dune, andor, heat };
}

/* ── lifecycle ────────────────────────────────────────────────────────── */

beforeEach(async () => {
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
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
    headers: {
      'content-type': 'application/json',
      [CLIENT_PRINCIPAL_HEADER]: principalHeader,
    },
    body: JSON.stringify({ service: 'netflix', mode: 'append-only' }),
  });
  const body = (await created.json()) as { batchId: string };
  const row = await testPrisma().uploadBatch.findFirst({ where: { id: body.batchId } });
  ownerId = row?.ownerId ?? '';
  await resetDatabase();
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeTestPrisma();
});

/* ── T-UI-007 — ticked by default ─────────────────────────────────────── */

describe('PATCH /api/batches/:batchId/removals', () => {
  it('T-UI-007a proposes every removal ticked before the owner touches anything', async () => {
    const { batchId } = await threeListedTwoProposed();

    const review = await getReview(batchId);
    const removals = review.sections.removals;
    expect(removals.count).toBe(2);
    expect(removals.items).toHaveLength(2);
    // ⚠ REQ-055: the DEFAULT is ticked, and it is a default of the read, not a
    // row written when the batch was created. There is nothing in
    // `removal_decision` at this point.
    expect(removals.items.map((item) => item.ticked)).toEqual([true, true]);
    expect(await testPrisma().removalDecision.count()).toBe(0);
  });

  it('T-UI-007b keeps a re-ticked removal ticked, and stores it explicitly', async () => {
    const { batchId, andor } = await threeListedTwoProposed();

    const off = await patchRemovals(batchId, { untick: [andor] });
    expect(off.status).toBe(200);
    const on = await patchRemovals(batchId, { tick: [andor] });
    expect(on.status).toBe(200);
    expect((await on.json()) as PatchBody).toEqual({
      tickedCount: 2,
      untickedCount: 0,
      totalCount: 2,
    });

    const review = await getReview(batchId);
    expect(review.sections.removals.items.map((item) => item.ticked)).toEqual([true, true]);
  });

  it('T-UI-007c reports counts derived from storage, not from the instruction', async () => {
    const { batchId, andor, heat } = await threeListedTwoProposed();

    await patchRemovals(batchId, { untick: [andor] });
    // A second press mentioning only `heat` must still report `andor` as
    // unticked: the response describes the BATCH, not the request.
    const res = await patchRemovals(batchId, { untick: [heat] });
    expect(res.status).toBe(200);
    expect((await res.json()) as PatchBody).toEqual({
      tickedCount: 0,
      untickedCount: 2,
      totalCount: 2,
    });
  });

  /* ── T-REM-014 — unticking rescues exactly one ──────────────────────── */

  it('T-REM-014a unticks exactly the named listing and leaves the others ticked', async () => {
    const { batchId, andor, heat } = await threeListedTwoProposed();

    const res = await patchRemovals(batchId, { untick: [andor] });
    expect(res.status).toBe(200);
    expect((await res.json()) as PatchBody).toEqual({
      tickedCount: 1,
      untickedCount: 1,
      totalCount: 2,
    });

    const review = await getReview(batchId);
    const byId = new Map(review.sections.removals.items.map((i) => [i.listingId, i.ticked]));
    expect(byId.get(andor)).toBe(false);
    expect(byId.get(heat)).toBe(true);
    // The rescue does not shrink the section: an unticked removal is still on
    // the table and still shown, it is simply not going to happen.
    expect(review.sections.removals.count).toBe(2);
  });

  it('T-REM-014m stores only the deviation — one row, for the unticked listing', async () => {
    const { batchId, andor } = await threeListedTwoProposed();
    await patchRemovals(batchId, { untick: [andor] });

    const rows = await testPrisma().removalDecision.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.listingId).toBe(andor);
    expect(rows[0]?.ticked).toBe(false);
    expect(rows[0]?.batchId).toBe(batchId);
  });

  it('T-REM-014n allows unticking every removal — a zero-member group is valid', async () => {
    const { batchId, andor, heat } = await threeListedTwoProposed();

    const res = await patchRemovals(batchId, { untick: [andor, heat] });
    expect(res.status).toBe(200);
    expect((await res.json()) as PatchBody).toEqual({
      tickedCount: 0,
      untickedCount: 2,
      totalCount: 2,
    });

    const review = await getReview(batchId);
    expect(review.sections.removals.items.every((item) => item.ticked === false)).toBe(true);
  });

  /**
   * ⚠ A decision is scoped to the BATCH that raised it. If it were scoped to
   * the listing it would become a standing exemption, and the NEXT
   * full-update — with fresh evidence that the title really is gone — would
   * silently decline to propose it.
   */
  it('T-REM-014o does not carry a decision across into another batch', async () => {
    const { batchId, andor } = await threeListedTwoProposed();
    await patchRemovals(batchId, { untick: [andor] });

    const second = await makeBatch();
    await makeCandidate(second, DUNE, 'Dune');

    const review = await getReview(second);
    const byId = new Map(review.sections.removals.items.map((i) => [i.listingId, i.ticked]));
    expect(byId.get(andor)).toBe(true);
  });

  /**
   * ⚠ A stored decision is NOT evidence the listing is still proposed. The
   * removal set is recomputed from the screenshots on every read, so a
   * listing the owner unticked can stop being proposed entirely — here,
   * because a later screenshot shows it after all. That decision is history,
   * and counting it would report an untick against a removal that no longer
   * exists.
   */
  it('T-REM-014w intersects stored decisions with the live removal set', async () => {
    const { batchId, andor, heat } = await threeListedTwoProposed();
    await patchRemovals(batchId, { untick: [andor] });

    // Fresh evidence: Andor IS still on the service, so it is no longer proposed.
    await makeCandidate(batchId, ANDOR, 'Andor');

    const res = await patchRemovals(batchId, { tick: [heat] });
    expect(res.status).toBe(200);
    expect((await res.json()) as PatchBody).toEqual({
      tickedCount: 1,
      untickedCount: 0,
      totalCount: 1,
    });

    const review = await getReview(batchId);
    expect(review.sections.removals.items.map((i) => i.listingId)).toEqual([heat]);
  });

  /* ── refusals ───────────────────────────────────────────────────────── */

  it('T-REM-014p refuses a listing this batch does not propose removing', async () => {
    const { batchId } = await threeListedTwoProposed();
    const otherService = await makeActiveListing('tmdb:movie:603', 'max', 'The Matrix');

    const res = await patchRemovals(batchId, { tick: [otherService] });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.details['listingIds']).toEqual([otherService]);
    // Nothing is written: the whole press is refused, not the valid part.
    expect(await testPrisma().removalDecision.count()).toBe(0);
  });

  it('T-REM-014q refuses the whole press when only one id is unknown', async () => {
    const { batchId, andor } = await threeListedTwoProposed();

    const res = await patchRemovals(batchId, { untick: [andor, 'no-such-listing'] });
    expect(res.status).toBe(404);
    expect(await testPrisma().removalDecision.count()).toBe(0);
  });

  it('T-REM-014r refuses an append-only batch — it proposes no removals at all', async () => {
    await makeActiveListing(ANDOR, 'netflix', 'Andor');
    const batchId = await makeBatch({ mode: 'append-only' });

    const res = await patchRemovals(batchId, { untick: ['rmlisting-1'] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_FAILED');
  });

  it('T-REM-014s refuses a batch that is not in review', async () => {
    const { andor } = await threeListedTwoProposed();
    const applied = await makeBatch({ status: 'applied' });

    const res = await patchRemovals(applied, { untick: [andor] });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('BATCH_NOT_IN_REVIEW');
  });

  it('T-REM-014t answers 404 for an unknown batch', async () => {
    const res = await patchRemovals('batch-does-not-exist', { untick: ['x'] });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
  });

  /**
   * ⚠ Existence and ownership are checked BEFORE the body. `T-SEC-002g` walks
   * every id-bearing route with another owner's ids and requires a flat 404 —
   * parsing first answers 400 for a foreign id, which is a different answer
   * from the one a missing id gets and therefore a disclosure.
   */
  it('T-REM-014u answers 404, not 400, for a malformed body on an unknown batch', async () => {
    const { batchId } = await threeListedTwoProposed();

    const real = await patchRemovals(batchId, { tick: 'not-an-array' });
    const fake = await patchRemovals('batch-does-not-exist', { tick: 'not-an-array' });
    expect(real.status).toBe(400);
    expect(((await real.json()) as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    expect(fake.status).toBe(404);
    expect(((await fake.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
  });

  it('T-REM-014v refuses an empty instruction', async () => {
    const { batchId } = await threeListedTwoProposed();

    const res = await patchRemovals(batchId, {});
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.details['reason']).toBe('no-instruction');
  });
});
