/**
 * TASK-112 — creates-only batch undo, end to end (`specs/api.md` §6.25,
 * `specs/data-model.md` §8.3, SD-03, REQ-067, US-032).
 *
 * ⚠ WHY THIS MUST BE AN INTEGRATION TEST. SD-03 is the ONLY sanctioned hard
 * delete of a list record in nextup. There is no soft-deleted copy to fall
 * back on, so "did undo restore the list exactly?" is a question about rows,
 * not about a return value — a stubbed repository would agree with whatever
 * the service asked it to delete. The batches here are closed through the REAL
 * close route so the provenance undo reads is the provenance close writes; a
 * hand-seeded `batch_change` set would let the two drift and every case would
 * still pass.
 *
 * ⚠ THE PRE/POST SNAPSHOT IS THE POINT. `T-UNDO-002` is "the list equals its
 * pre-batch state EXACTLY". Asserting a count would pass for an undo that
 * deleted the right number of wrong rows, so the assertions compare whole
 * sorted row shapes.
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
const SUBJECT = 'oid-owner-undo';
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
const ANDOR = 'tmdb:tv:83867';

let server: Server;
let app: Express;
let origin: string;
let ownerId: string;

const authed = {
  'content-type': 'application/json',
  [CLIENT_PRINCIPAL_HEADER]: principalHeader,
};

const close = (batchId: string, body: unknown = {}): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/close`, {
    method: 'POST',
    headers: authed,
    body: JSON.stringify(body),
  });

const undo = (batchId: string): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/undo`, {
    method: 'POST',
    headers: authed,
  });

interface UndoBody {
  batchId: string;
  status: string;
  undoneAt: string;
  reversed: { titlesDeleted: number; listingsRemoved: number };
  serviceState: { service: string; lastCompletedBatchAt: string | null };
}

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/* ── fixtures ─────────────────────────────────────────────────────────── */

let batchSeq = 0;

async function makeBatch(service = 'netflix', mode = 'append-only'): Promise<string> {
  const id = `batch-undo-${++batchSeq}`;
  await testPrisma().uploadBatch.create({
    data: {
      id,
      ownerId,
      service,
      mode,
      status: 'in-review',
      lowYield: false,
      degradedExtraction: false,
      crossCheck: 'ok',
    },
  });
  return id;
}

let candidateSeq = 0;

async function makeConfirmedCandidate(
  batchId: string,
  workIdentity: string,
  rawText: string,
): Promise<string> {
  const id = `undocand-${++candidateSeq}`;
  await testPrisma().extractionCandidate.create({
    data: {
      id,
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
      classification: 'new',
      reviewDisposition: 'confirmed',
      collapsedIntoCandidateId: null,
    },
  });
  return id;
}

let titleSeq = 0;

/** A title that existed BEFORE the batch under test — undo must not touch it. */
async function makePreExistingTitle(
  workIdentity: string,
  service: string,
  name: string,
  dateAdded = '2026-01-04',
): Promise<{ titleId: string; listingId: string }> {
  const titleId = `undotitle-${++titleSeq}`;
  const listingId = `undolisting-${titleSeq}`;
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
      sortDateAdded: new Date(dateAdded),
    },
  });
  await testPrisma().uploadBatch.upsert({
    where: { id: `batch-undo-seed-${service}` },
    update: {},
    create: {
      id: `batch-undo-seed-${service}`,
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
      dateAdded: new Date(dateAdded),
      createdByBatchId: `batch-undo-seed-${service}`,
    },
  });
  return { titleId, listingId };
}

/** The title row for a work identity. Throws rather than returning null so a
 * mis-seeded fixture fails loudly instead of asserting against `undefined`. */
async function titleFor(workIdentity: string): Promise<{
  id: string;
  state: string;
  sortDateAdded: Date | null;
}> {
  const row = await testPrisma().title.findFirst({ where: { ownerId, workIdentity } });
  if (row === null) throw new Error(`no title for ${workIdentity}`);
  return row;
}

/** Every list row the owner can see, in a stable, comparable shape. */ async function snapshotList(): Promise<{
  titles: { workIdentity: string; state: string; sortDateAdded: string | null }[];
  listings: { titleId: string; service: string; state: string }[];
}> {
  const titles = await testPrisma().title.findMany({ where: { ownerId } });
  const listings = await testPrisma().serviceListing.findMany({ where: { ownerId } });
  const byId = new Map(titles.map((t) => [t.id, t.workIdentity]));
  return {
    titles: titles
      .map((t) => ({
        workIdentity: t.workIdentity,
        state: t.state,
        sortDateAdded: t.sortDateAdded?.toISOString().slice(0, 10) ?? null,
      }))
      .sort((a, b) => a.workIdentity.localeCompare(b.workIdentity)),
    listings: listings
      .map((l) => ({
        titleId: byId.get(l.titleId) ?? l.titleId,
        service: l.service,
        state: l.state,
      }))
      .sort((a, b) => `${a.titleId}${a.service}`.localeCompare(`${b.titleId}${b.service}`)),
  };
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
    headers: authed,
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
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
});

afterAll(async () => {
  await closeTestPrisma();
});

/* ── T-UNDO-002 ───────────────────────────────────────────────────────── */

describe('T-UNDO-002 · US-032 AC-2 · after undo the list equals its pre-batch state exactly', () => {
  it('T-UNDO-002a · titles the batch created are DISCARDED, with their listings', async () => {
    const before = await snapshotList();

    const batchId = await makeBatch();
    await makeConfirmedCandidate(batchId, DUNE, 'Dune');
    await makeConfirmedCandidate(batchId, HEAT, 'Heat');
    expect((await close(batchId)).status).toBe(200);

    expect((await snapshotList()).titles).toHaveLength(2);

    const res = await undo(batchId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as UndoBody;
    expect(body.reversed).toEqual({ titlesDeleted: 2, listingsRemoved: 2 });

    // The whole point: not "two fewer rows", but the SAME rows as before.
    expect(await snapshotList()).toEqual(before);
  });

  it('T-UNDO-002b · a listing added to a PRE-EXISTING title is spliced; the title survives', async () => {
    // Heat is already on Max. A Netflix batch gives it a second badge; undo
    // must take the badge back and leave the work exactly as it was.
    await makePreExistingTitle(HEAT, 'max', 'Heat');
    const before = await snapshotList();

    const batchId = await makeBatch('netflix');
    await makeConfirmedCandidate(batchId, HEAT, 'Heat');
    expect((await close(batchId)).status).toBe(200);
    expect((await snapshotList()).listings).toHaveLength(2);

    const res = await undo(batchId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as UndoBody;
    // No title was created, so none is deleted — one listing leaves.
    expect(body.reversed).toEqual({ titlesDeleted: 0, listingsRemoved: 1 });

    expect(await snapshotList()).toEqual(before);
  });

  it('T-UNDO-002c · a survivor is RE-DERIVED from what it has left (invariant I-4)', async () => {
    // ⚠ NON-VACUITY IS THE WHOLE DIFFICULTY HERE, and two earlier versions of
    // this case were vacuous:
    //
    //  1. A pre-existing title dated in the PAST. Adding a listing dated today
    //     never moves an earlier `sortDateAdded`, so there is nothing to put
    //     back and a mutant deleting `rederiveSurvivors` outright survived.
    //  2. A pre-existing title whose only listing was `removed`. That is the
    //     REAPPEARANCE path (invariant L1/A33) — close writes a BRAND-NEW
    //     title row rather than reviving the old one, so the undo discards the
    //     new row and the old one was never touched. Both assertions passed
    //     against an arbitrary one of the two rows.
    //
    // So the survivor is ACTIVE, and its own listing is dated in the FUTURE —
    // which a real listing can be, because the owner may edit a date
    // (`date_added_edited`). Close pulls `sortDateAdded` back to today; undo
    // must push it forward again to the only date a surviving listing
    // justifies.
    const FUTURE = '2099-03-09';
    await makePreExistingTitle(ANDOR, 'max', 'Andor', FUTURE);
    const before = await snapshotList();

    const batchId = await makeBatch('netflix');
    await makeConfirmedCandidate(batchId, ANDOR, 'Andor');
    expect((await close(batchId)).status).toBe(200);

    // Exactly one title — this is the survivor path, not the reappearance one.
    expect(await testPrisma().title.count({ where: { ownerId, workIdentity: ANDOR } })).toBe(1);
    // And the close really did move the derived date, or the undo has nothing
    // to undo and every assertion below would hold vacuously.
    expect((await titleFor(ANDOR)).sortDateAdded?.toISOString().slice(0, 10)).not.toBe(FUTURE);

    expect((await undo(batchId)).status).toBe(200);

    const title = await titleFor(ANDOR);
    expect(title.sortDateAdded?.toISOString().slice(0, 10)).toBe(FUTURE);
    expect(title.state).toBe('active');
    expect(await snapshotList()).toEqual(before);
  });

  it('T-UNDO-002d · serviceState reverts to the PREVIOUS applied batch for that service', async () => {
    const first = await makeBatch('netflix');
    await makeConfirmedCandidate(first, DUNE, 'Dune');
    expect((await close(first)).status).toBe(200);
    const firstRow = await testPrisma().uploadBatch.findFirst({ where: { id: first } });

    const second = await makeBatch('netflix');
    await makeConfirmedCandidate(second, HEAT, 'Heat');
    expect((await close(second)).status).toBe(200);

    const res = await undo(second);
    const body = (await res.json()) as UndoBody;
    expect(body.serviceState.service).toBe('netflix');
    expect(body.serviceState.lastCompletedBatchAt).toBe(firstRow?.completedAt?.toISOString());

    const state = await testPrisma().serviceState.findFirst({
      where: { ownerId, service: 'netflix' },
    });
    expect(state?.lastCompletedBatchId).toBe(first);
  });

  it('T-UNDO-002e · undoing the FIRST batch reverts serviceState to never-updated', async () => {
    // REQ-039's honest "Netflix has never been updated", not a stale date.
    const batchId = await makeBatch('netflix');
    await makeConfirmedCandidate(batchId, DUNE, 'Dune');
    expect((await close(batchId)).status).toBe(200);

    const body = (await undo(batchId).then((r) => r.json())) as UndoBody;
    expect(body.serviceState.lastCompletedBatchAt).toBeNull();

    const state = await testPrisma().serviceState.findFirst({
      where: { ownerId, service: 'netflix' },
    });
    expect(state?.lastCompletedBatchAt).toBeNull();
    expect(state?.lastCompletedBatchId).toBeNull();
  });

  it('T-UNDO-002f · another service is untouched by the revert', async () => {
    const maxBatch = await makeBatch('max');
    await makeConfirmedCandidate(maxBatch, ANDOR, 'Andor');
    expect((await close(maxBatch)).status).toBe(200);
    const maxRow = await testPrisma().uploadBatch.findFirst({ where: { id: maxBatch } });

    const netflixBatch = await makeBatch('netflix');
    await makeConfirmedCandidate(netflixBatch, DUNE, 'Dune');
    expect((await close(netflixBatch)).status).toBe(200);
    expect((await undo(netflixBatch)).status).toBe(200);

    const maxState = await testPrisma().serviceState.findFirst({
      where: { ownerId, service: 'max' },
    });
    expect(maxState?.lastCompletedBatchAt?.toISOString()).toBe(maxRow?.completedAt?.toISOString());
    // And Andor is still on the list.
    const andor = await testPrisma().title.findFirst({ where: { ownerId, workIdentity: ANDOR } });
    expect(andor).not.toBeNull();
  });

  it('T-UNDO-002g · candidates and images are RETAINED (US-032 AC-3)', async () => {
    // Undo reverses the LIST, not the evidence. The batch still happened.
    const batchId = await makeBatch();
    await makeConfirmedCandidate(batchId, DUNE, 'Dune');
    await testPrisma().uploadedImage.create({
      data: {
        id: 'undo-img-1',
        ownerId,
        batchId,
        blobPath: `${ownerId}/undo-img-1.png`,
        fileName: 'undo-img-1.png',
        uploadedFormat: 'png',
        format: 'png',
        uploadedByteSize: BigInt(1024),
        byteSize: 1024,
        retainUntil: new Date('2099-01-01'),
      },
    });
    expect((await close(batchId)).status).toBe(200);
    expect((await undo(batchId)).status).toBe(200);

    expect(await testPrisma().extractionCandidate.count({ where: { ownerId, batchId } })).toBe(1);
    expect(await testPrisma().uploadedImage.count({ where: { ownerId, batchId } })).toBe(1);
  });

  it('T-UNDO-008a · a batch that created NOTHING undoes as a no-op (US-032 AC-5)', async () => {
    await makePreExistingTitle(HEAT, 'max', 'Heat');
    const before = await snapshotList();

    const batchId = await makeBatch();
    expect((await close(batchId)).status).toBe(200);

    const res = await undo(batchId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as UndoBody;
    expect(body.reversed).toEqual({ titlesDeleted: 0, listingsRemoved: 0 });
    expect(await snapshotList()).toEqual(before);
  });

  it('T-UNDO-002i · provenance rows are RETAINED — undo is recorded, not erased', async () => {
    // REQ-028 forbids purging history. The batch's record of what it did stays
    // so the undone batch remains explicable in the history view.
    const batchId = await makeBatch();
    await makeConfirmedCandidate(batchId, DUNE, 'Dune');
    expect((await close(batchId)).status).toBe(200);
    const changesBefore = await testPrisma().batchChange.count({ where: { ownerId, batchId } });
    expect(changesBefore).toBeGreaterThan(0);

    expect((await undo(batchId)).status).toBe(200);
    expect(await testPrisma().batchChange.count({ where: { ownerId, batchId } })).toBe(
      changesBefore,
    );
  });
});

/* ── T-UNDO-003 ───────────────────────────────────────────────────────── */

describe('T-UNDO-003 · US-032 AC-3 · status becomes undone; a second undo is refused', () => {
  it('T-UNDO-003a · the batch moves to `undone` and records `undoneAt`', async () => {
    const batchId = await makeBatch();
    await makeConfirmedCandidate(batchId, DUNE, 'Dune');
    expect((await close(batchId)).status).toBe(200);

    const body = (await undo(batchId).then((r) => r.json())) as UndoBody;
    expect(body.status).toBe('undone');
    expect(Number.isNaN(Date.parse(body.undoneAt))).toBe(false);

    const row = await testPrisma().uploadBatch.findFirst({ where: { id: batchId } });
    expect(row?.status).toBe('undone');
    expect(row?.undoneAt).not.toBeNull();
  });

  it('T-UNDO-003b · a second undo is 409 BATCH_ALREADY_UNDONE', async () => {
    const batchId = await makeBatch();
    await makeConfirmedCandidate(batchId, DUNE, 'Dune');
    expect((await close(batchId)).status).toBe(200);
    expect((await undo(batchId)).status).toBe(200);

    const res = await undo(batchId);
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('BATCH_ALREADY_UNDONE');
  });

  it('T-UNDO-003c · the second undo writes NOTHING — the list is unchanged', async () => {
    // The dangerous shape: a second undo that re-runs the discard would delete
    // rows a later batch has since recreated. Nothing is left to delete here,
    // so the assertion is that the refusal comes BEFORE any write.
    await makePreExistingTitle(HEAT, 'max', 'Heat');
    const batchId = await makeBatch();
    await makeConfirmedCandidate(batchId, DUNE, 'Dune');
    expect((await close(batchId)).status).toBe(200);
    expect((await undo(batchId)).status).toBe(200);

    const after = await snapshotList();
    expect((await undo(batchId)).status).toBe(409);
    expect(await snapshotList()).toEqual(after);
  });

  it('T-UNDO-003d · an un-applied batch is 409 BATCH_NOT_APPLIED, not ALREADY_UNDONE', async () => {
    const batchId = await makeBatch();
    const res = await undo(batchId);
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('BATCH_NOT_APPLIED');
    expect(body.error.details?.['status']).toBe('in-review');
  });

  it('T-UNDO-003e · an unknown batch is 404, never 403 (NFR-008)', async () => {
    const res = await undo('batch-that-does-not-exist');
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
  });

  it('T-UNDO-003f · a batch that REMOVED something is refused as not-creates-only', async () => {
    // The safety property: a full-update close that removed a listing must
    // never be reversed by the creates-only path, which cannot bring it back.
    const { titleId, listingId } = await makePreExistingTitle(HEAT, 'netflix', 'Heat');
    expect(titleId).not.toBe('');

    const batchId = await makeBatch('netflix', 'full-update');
    await makeConfirmedCandidate(batchId, DUNE, 'Dune');
    expect((await close(batchId, { confirmRemovals: true })).status).toBe(200);

    const removed = await testPrisma().serviceListing.findFirst({ where: { listingId } });
    expect(removed?.state).toBe('removed');

    const before = await snapshotList();
    const res = await undo(batchId);
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('BATCH_NOT_CREATES_ONLY');
    expect(body.error.details?.['reason']).toBe('modified-or-removed');

    // §8.4: nothing is written on a refusal, and the batch stays applied.
    expect(await snapshotList()).toEqual(before);
    const row = await testPrisma().uploadBatch.findFirst({ where: { id: batchId } });
    expect(row?.status).toBe('applied');
  });
});
