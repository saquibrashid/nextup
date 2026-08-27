/**
 * TASK-086 / TASK-087 / TASK-088 — applying removals at close (`specs/api.md`
 * §6.22, US-015, US-016, REQ-020, REQ-021, REQ-062).
 *
 * `T-REV-005` (no `confirmRemovals` → 409, nothing written), `T-REV-007`
 * (untick all → zero-member group, close succeeds, nothing removed),
 * `T-REM-015` (a mid-apply failure leaves the whole group unapplied),
 * `T-REM-012`/`T-REM-016` (a Netflix close never touches a Max listing),
 * `T-REM-017` (a two-badge title keeps its other badge), `T-REM-018` (the last
 * active listing going takes the title to `removed`) and `T-REM-019`
 * (append-only absence changes nothing).
 *
 * Integration, not unit: every one of these properties is a statement about
 * what is IN THE STORE after the close, and the failures they guard against —
 * a group half-applied, a title left `active` with no active listing, a
 * removal that crossed a service boundary — are all invisible to a test that
 * stubs the store, because the stub agrees with whatever the code asked it to
 * do.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

/**
 * The one seam in this file that is not the real thing.
 *
 * `softDeleteServiceListing` guards its UPDATE on `state: 'active'`, so it
 * affects zero rows when a listing stopped being active between the proposal
 * (read before the transaction) and the write. That window cannot be opened
 * from outside the process: pre-removing the row just takes it out of the
 * proposed set, which is a different scenario entirely. `T-REM-015` says
 * "injected mid-apply failure" for exactly this reason.
 *
 * `value` is the 1-based call number to fail on, or `0` for pass-through, and
 * it is reset in `beforeEach` so it cannot leak into another test.
 */
const failSoftDeleteOnCall = vi.hoisted(() => ({ value: 0, seen: 0 }));

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    softDeleteServiceListing: (
      ...args: Parameters<typeof actual.softDeleteServiceListing>
    ): ReturnType<typeof actual.softDeleteServiceListing> => {
      failSoftDeleteOnCall.seen += 1;
      if (failSoftDeleteOnCall.value === failSoftDeleteOnCall.seen) {
        return Promise.resolve({ count: 0 });
      }
      return actual.softDeleteServiceListing(...args);
    },
  };
});

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-close-removals';
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
const MATRIX = 'tmdb:movie:603';

let server: Server;
let app: Express;
let origin: string;
let ownerId: string;

interface CloseBody {
  summary: {
    titlesCreated: number;
    listingsCreated: number;
    listingsRemoved: number;
    discarded: number;
    removalGroupId: string | null;
  };
}

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

const close = (batchId: string, body?: unknown): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/close`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CLIENT_PRINCIPAL_HEADER]: principalHeader,
    },
    body: JSON.stringify(body ?? {}),
  });

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
  over: {
    mode?: string;
    service?: string;
    lowYield?: boolean;
    degradedExtraction?: boolean;
    crossCheck?: string;
  } = {},
): Promise<string> {
  const id = `batch-cr-${++batchSeq}`;
  await testPrisma().uploadBatch.create({
    data: {
      id,
      ownerId,
      service: over.service ?? 'netflix',
      mode: over.mode ?? 'full-update',
      status: 'in-review',
      lowYield: over.lowYield ?? false,
      degradedExtraction: over.degradedExtraction ?? false,
      crossCheck: over.crossCheck ?? 'ok',
    },
  });
  return id;
}

let candidateSeq = 0;

/** Evidence that a work IS still listed — so it is not proposed for removal. */
async function makeCandidate(
  batchId: string,
  workIdentity: string,
  rawText: string,
): Promise<void> {
  await testPrisma().extractionCandidate.create({
    data: {
      id: `crcand-${++candidateSeq}`,
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
      classification: 'already-present-for-this-service',
      reviewDisposition: 'confirmed',
      collapsedIntoCandidateId: null,
    },
  });
}

let titleSeq = 0;

/** A title with one active listing. Returns both ids. */
async function makeActiveTitle(
  workIdentity: string,
  service: string,
  name: string,
): Promise<{ titleId: string; listingId: string }> {
  const titleId = `crtitle-${++titleSeq}`;
  const listingId = `crlisting-${titleSeq}`;
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
  await seedBatch(service);
  await testPrisma().serviceListing.create({
    data: {
      listingId,
      ownerId,
      titleId,
      service,
      state: 'active',
      dateAdded: new Date('2026-01-04'),
      createdByBatchId: `batch-cr-seed-${service}`,
    },
  });
  return { titleId, listingId };
}

/** A second listing on an existing title — the two-badge case. */
async function addListing(titleId: string, service: string, date: string): Promise<string> {
  const listingId = `crlisting-x${++titleSeq}`;
  await seedBatch(service);
  await testPrisma().serviceListing.create({
    data: {
      listingId,
      ownerId,
      titleId,
      service,
      state: 'active',
      dateAdded: new Date(date),
      createdByBatchId: `batch-cr-seed-${service}`,
    },
  });
  return listingId;
}

async function seedBatch(service: string): Promise<void> {
  await testPrisma().uploadBatch.upsert({
    where: { id: `batch-cr-seed-${service}` },
    update: {},
    create: {
      id: `batch-cr-seed-${service}`,
      ownerId,
      service,
      mode: 'append-only',
      status: 'applied',
      lowYield: false,
      degradedExtraction: false,
    },
  });
}

const listing = (listingId: string) =>
  testPrisma().serviceListing.findFirstOrThrow({ where: { ownerId, listingId } });

const title = (titleId: string) =>
  testPrisma().title.findFirstOrThrow({ where: { ownerId, id: titleId } });

/**
 * Three active Netflix listings, a full-update batch whose screenshots show
 * only Dune — so Andor and Heat are proposed for removal.
 */
async function threeListedTwoProposed() {
  const dune = await makeActiveTitle(DUNE, 'netflix', 'Dune');
  const andor = await makeActiveTitle(ANDOR, 'netflix', 'Andor');
  const heat = await makeActiveTitle(HEAT, 'netflix', 'Heat');
  const batchId = await makeBatch();
  await makeCandidate(batchId, DUNE, 'Dune');
  return { batchId, dune, andor, heat };
}

/* ── lifecycle ────────────────────────────────────────────────────────── */

beforeEach(async () => {
  resetAllowListWarning();
  failSoftDeleteOnCall.value = 0;
  failSoftDeleteOnCall.seen = 0;
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
  vi.restoreAllMocks();
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterAll(async () => {
  await closeTestPrisma();
});

/* ── the confirmation gate (T-REV-005) ────────────────────────────────── */

describe('T-REV-005 — closing without confirmRemovals', () => {
  it('T-REV-005a refuses with 409 REMOVALS_NOT_CONFIRMED', async () => {
    const { batchId } = await threeListedTwoProposed();

    const res = await close(batchId);

    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('REMOVALS_NOT_CONFIRMED');
    expect(body.error.details['removalCount']).toBe(2);
  });

  it('T-REV-005b writes NOTHING — no listing removed, no group, batch still in review', async () => {
    const { batchId, andor, heat } = await threeListedTwoProposed();

    expect((await close(batchId)).status).toBe(409);

    expect((await listing(andor.listingId)).state).toBe('active');
    expect((await listing(heat.listingId)).state).toBe('active');
    expect(await testPrisma().removalGroup.count({ where: { ownerId } })).toBe(0);
    const batch = await testPrisma().uploadBatch.findFirstOrThrow({
      where: { ownerId, id: batchId },
    });
    expect(batch.status).toBe('in-review');
  });

  it('T-REV-005c refuses a merely truthy confirmation — only a literal true confirms', async () => {
    const { batchId } = await threeListedTwoProposed();

    for (const value of ['true', 1, {}, 'yes']) {
      const res = await close(batchId, { confirmRemovals: value });
      expect(res.status).toBe(409);
    }
  });

  it('T-REV-005d accepts the close once confirmRemovals is literally true', async () => {
    const { batchId, andor, heat } = await threeListedTwoProposed();

    const res = await close(batchId, { confirmRemovals: true });

    expect(res.status).toBe(200);
    const body = (await res.json()) as CloseBody;
    expect(body.summary.listingsRemoved).toBe(2);
    expect(body.summary.removalGroupId).not.toBeNull();
    expect((await listing(andor.listingId)).state).toBe('removed');
    expect((await listing(heat.listingId)).state).toBe('removed');
  });

  it('T-REV-005e does not require confirmation when the batch proposes no removals', async () => {
    const dune = await makeActiveTitle(DUNE, 'netflix', 'Dune');
    const batchId = await makeBatch();
    await makeCandidate(batchId, DUNE, 'Dune');

    const res = await close(batchId);

    expect(res.status).toBe(200);
    expect((await listing(dune.listingId)).state).toBe('active');
  });

  it('T-REV-005f does not require confirmation when the removal section was withheld', async () => {
    // Degraded extraction withholds the section, so the owner was never shown
    // anything to confirm. Requiring confirmation here would make the batch
    // unclosable; recording a group would log a decision nobody made.
    const { andor } = await threeListedTwoProposed();
    const batchId = await makeBatch({ degradedExtraction: true, crossCheck: 'llm-unavailable' });
    await makeCandidate(batchId, DUNE, 'Dune');

    const res = await close(batchId);

    expect(res.status).toBe(200);
    const body = (await res.json()) as CloseBody;
    expect(body.summary.listingsRemoved).toBe(0);
    expect(body.summary.removalGroupId).toBeNull();
    expect(await testPrisma().removalGroup.count({ where: { ownerId } })).toBe(0);
    expect((await listing(andor.listingId)).state).toBe('active');
  });
});

/* ── the zero-member group (T-REV-007) ────────────────────────────────── */

describe('T-REV-007 — unticking every proposed removal', () => {
  it('T-REV-007a still requires confirmation — the gate counts proposals, not ticks', async () => {
    const { batchId, andor, heat } = await threeListedTwoProposed();
    await patchRemovals(batchId, { untick: [andor.listingId, heat.listingId] });

    expect((await close(batchId)).status).toBe(409);
  });

  it('T-REV-007b closes with a zero-member group and removes nothing', async () => {
    const { batchId, andor, heat } = await threeListedTwoProposed();
    await patchRemovals(batchId, { untick: [andor.listingId, heat.listingId] });

    const res = await close(batchId, { confirmRemovals: true });

    expect(res.status).toBe(200);
    const body = (await res.json()) as CloseBody;
    expect(body.summary.listingsRemoved).toBe(0);
    // ⚠ A GROUP EXISTS. "I rescued all of them" must be distinguishable in
    // history from "there was nothing to remove" (US-015 AC-5).
    expect(body.summary.removalGroupId).not.toBeNull();
    expect(await testPrisma().removalGroup.count({ where: { ownerId } })).toBe(1);
    expect((await listing(andor.listingId)).state).toBe('active');
    expect((await listing(heat.listingId)).state).toBe('active');
  });

  it('T-REV-007c removes exactly the still-ticked subset', async () => {
    const { batchId, andor, heat } = await threeListedTwoProposed();
    await patchRemovals(batchId, { untick: [andor.listingId] });

    const res = await close(batchId, { confirmRemovals: true });

    expect(res.status).toBe(200);
    expect(((await res.json()) as CloseBody).summary.listingsRemoved).toBe(1);
    expect((await listing(andor.listingId)).state).toBe('active');
    expect((await listing(heat.listingId)).state).toBe('removed');
  });
});

/* ── one confirmation, one group (T-UI-008) ───────────────────────────── */

describe('T-UI-008 — a single confirmation applies every ticked removal', () => {
  // Level I/C in specs/testing.md L928. Only the integration half is claimed:
  // "no per-row remove control exists in the DOM" needs a rendered ReviewPage,
  // which is still a stub, and belongs with TASK-093 / T-REM-011.
  it('T-UI-008a one close removes BOTH ticked listings under ONE group', async () => {
    const { batchId, andor, heat } = await threeListedTwoProposed();

    const res = await close(batchId, { confirmRemovals: true });

    expect(res.status).toBe(200);
    const body = (await res.json()) as CloseBody;
    expect(body.summary.listingsRemoved).toBe(2);

    // ⚠ ONE group, not one per listing. The group IS the unit of confirmation
    // and the unit batch-undo will later reverse; a group per row would make
    // "undo the removals I just confirmed" ambiguous.
    expect(await testPrisma().removalGroup.count({ where: { ownerId } })).toBe(1);
    const removed = await testPrisma().serviceListing.findMany({
      where: { ownerId, state: 'removed' },
      select: { listingId: true, removedByGroupId: true },
      orderBy: { listingId: 'asc' },
    });
    expect(removed.map((r) => r.listingId).sort()).toEqual(
      [andor.listingId, heat.listingId].sort(),
    );
    expect(new Set(removed.map((r) => r.removedByGroupId))).toEqual(
      new Set([body.summary.removalGroupId]),
    );
  });

  it('T-UI-008b needs no per-listing confirmation — the group confirmation is the only one', async () => {
    const { batchId, dune } = await threeListedTwoProposed();

    // A single flag, sent once, for a two-listing removal. If the API ever
    // grew a per-row acknowledgement this close would start refusing.
    expect((await close(batchId, { confirmRemovals: true })).status).toBe(200);
    expect((await listing(dune.listingId)).state).toBe('active');
  });
});

/* ── what a removal writes (T-REM-016, T-REM-018) ─────────────────────── */

describe('T-REM-016 / T-REM-018 — the removal transition', () => {
  it('T-REM-016a stamps removedAt, removedByBatchId and removedByGroupId', async () => {
    const { batchId, heat } = await threeListedTwoProposed();
    await patchRemovals(batchId, { untick: [heat.listingId] });

    const res = await close(batchId, { confirmRemovals: true });
    const groupId = ((await res.json()) as CloseBody).summary.removalGroupId;

    const row = await listing((await pickRemoved()).listingId);
    expect(row.state).toBe('removed');
    expect(row.removedAt).not.toBeNull();
    expect(row.removedByBatchId).toBe(batchId);
    expect(row.removedByGroupId).toBe(groupId);
  });

  it('T-REM-018a takes the title to removed when its last active listing goes', async () => {
    const { batchId, andor } = await threeListedTwoProposed();
    await patchRemovals(batchId, { untick: [andor.listingId] });

    expect((await close(batchId, { confirmRemovals: true })).status).toBe(200);

    const row = await title((await pickRemoved()).titleId);
    expect(row.state).toBe('removed');
    // A fully removed title has no date to sort by (US-020 AC-7).
    expect(row.sortDateAdded).toBeNull();
  });

  it('T-REM-018b retains the record — soft delete, never a hard delete (REQ-028)', async () => {
    const { batchId, andor, heat } = await threeListedTwoProposed();

    expect((await close(batchId, { confirmRemovals: true })).status).toBe(200);

    // Both rows are still there to be read back.
    expect((await listing(andor.listingId)).listingId).toBe(andor.listingId);
    expect((await listing(heat.listingId)).listingId).toBe(heat.listingId);
    expect(await testPrisma().title.count({ where: { ownerId } })).toBe(3);
  });

  it('T-REM-016b records a listing_removed change carrying the group id', async () => {
    const { batchId, andor } = await threeListedTwoProposed();
    await patchRemovals(batchId, { untick: [andor.listingId] });

    const res = await close(batchId, { confirmRemovals: true });
    const groupId = ((await res.json()) as CloseBody).summary.removalGroupId;

    const changes = await testPrisma().batchChange.findMany({
      where: { ownerId, batchId, kind: 'listing_removed' },
    });
    expect(changes).toHaveLength(1);
    // US-017 undoes a GROUP, so the group id must be on the entry.
    expect(changes[0]?.nextValue).toContain(String(groupId));
  });
});

/** The single listing this batch removed. */
async function pickRemoved(): Promise<{ listingId: string; titleId: string }> {
  const rows = await testPrisma().serviceListing.findMany({
    where: { ownerId, state: 'removed' },
  });
  expect(rows).toHaveLength(1);
  return { listingId: rows[0]?.listingId ?? '', titleId: rows[0]?.titleId ?? '' };
}

/* ── blast radius (T-REM-012, T-REM-017, T-REM-019) ───────────────────── */

describe('T-REM-012 / T-REM-017 — a close never crosses a service boundary', () => {
  it('T-REM-012a a Netflix full-update leaves a Max-only listing untouched', async () => {
    const maxOnly = await makeActiveTitle(MATRIX, 'max', 'The Matrix');
    const { batchId } = await threeListedTwoProposed();

    expect((await close(batchId, { confirmRemovals: true })).status).toBe(200);

    const row = await listing(maxOnly.listingId);
    expect(row.state).toBe('active');
    expect(row.removedAt).toBeNull();
    expect((await title(maxOnly.titleId)).state).toBe('active');
  });

  it('T-REM-017a a two-badge title keeps its other badge and stays in the list', async () => {
    const andor = await makeActiveTitle(ANDOR, 'netflix', 'Andor');
    const maxListingId = await addListing(andor.titleId, 'max', '2026-02-09');
    await makeActiveTitle(DUNE, 'netflix', 'Dune');
    const batchId = await makeBatch();
    await makeCandidate(batchId, DUNE, 'Dune');

    expect((await close(batchId, { confirmRemovals: true })).status).toBe(200);

    expect((await listing(andor.listingId)).state).toBe('removed');
    expect((await listing(maxListingId)).state).toBe('active');
    const row = await title(andor.titleId);
    // Still in the list, and now dated by the surviving listing (US-020 AC-5).
    expect(row.state).toBe('active');
    expect(row.sortDateAdded?.toISOString().slice(0, 10)).toBe('2026-02-09');
  });

  it('T-REM-019a an append-only close proposes and applies no removals', async () => {
    const { andor, heat } = await threeListedTwoProposed();
    const batchId = await makeBatch({ mode: 'append-only' });
    await makeCandidate(batchId, DUNE, 'Dune');

    const res = await close(batchId, { confirmRemovals: true });

    expect(res.status).toBe(200);
    const body = (await res.json()) as CloseBody;
    expect(body.summary.listingsRemoved).toBe(0);
    expect(body.summary.removalGroupId).toBeNull();
    expect(await testPrisma().removalGroup.count({ where: { ownerId } })).toBe(0);
    expect((await listing(andor.listingId)).state).toBe('active');
    expect((await listing(heat.listingId)).state).toBe('active');
  });
});

/* ── partial-failure prevention (T-REM-015) ───────────────────────────── */

describe('T-REM-015 — a mid-apply failure leaves the group unapplied in full', () => {
  it('T-REM-015a an injected mid-apply failure aborts the whole close', async () => {
    const { batchId } = await threeListedTwoProposed();
    // The race the guard exists for: a listing stops being active between the
    // proposal (read outside the transaction) and the write. It cannot be
    // produced from outside — pre-removing the row simply removes it from the
    // proposed set — so the zero-row result is injected at the seam where the
    // real race would surface it.
    failSoftDeleteOnCall.value = 2;

    const res = await close(batchId, { confirmRemovals: true });

    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('PARTIAL_FAILURE_PREVENTED');
    expect(body.error.message).toMatch(/nothing was changed/i);
  });

  it('T-REM-015b rolls the whole transaction back — no listing, group or transition survives', async () => {
    const { batchId, andor, heat } = await threeListedTwoProposed();
    failSoftDeleteOnCall.value = 2;

    expect((await close(batchId, { confirmRemovals: true })).status).toBe(409);

    // The FIRST removal really was written inside the transaction before the
    // second failed, so these two assertions are the rollback itself: a group
    // applied in part cannot be undone as a group, and the owner would have no
    // way to see which half landed.
    expect((await listing(andor.listingId)).state).toBe('active');
    expect((await listing(heat.listingId)).state).toBe('active');
    expect(await testPrisma().removalGroup.count({ where: { ownerId } })).toBe(0);
    expect(await testPrisma().batchChange.count({ where: { ownerId, batchId } })).toBe(0);
    const batch = await testPrisma().uploadBatch.findFirstOrThrow({
      where: { ownerId, id: batchId },
    });
    expect(batch.status).toBe('in-review');
  });
});
