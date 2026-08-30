/**
 * TASK-065 — `GET /api/batches/:batchId/review` (`specs/api.md` §6.17).
 *
 * `T-REV-010` (new candidates appear in `additions`), `T-UX-063` (unmatched
 * candidates render in their own section with raw text), `T-AI-004` (every
 * candidate is reachable; nothing dropped), `T-REV-006` (full-update shows ALL
 * extracted titles — the safety property), `T-SUP-002`/`T-SUP-004` (suppressed
 * works are gated BEFORE classification and never appear, including in the
 * removal section), `T-CLS-013` (a matching failure lands in unmatched, never
 * a wrong classification).
 *
 * Integration, not unit: the properties under test are the interaction of
 * candidate rows, real active listings and real suppression rows. The pure
 * assembly is already covered by `packages/domain/test/review.spec.ts`; what
 * this file proves is that the ROUTE feeds it the right sets — which is where
 * a suppression gate or a service scope actually gets lost.
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
const SUBJECT = 'oid-owner-review';
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

interface ReviewSection {
  label: string;
  count: number;
  omitted?: boolean;
  withheld?: boolean;
  withheldReason?: string | null;
  collapsedByDefault?: boolean;
  items: {
    candidateId?: string;
    rawText?: string;
    name?: string;
    ticked?: boolean;
    tileCrop?: { imageId: string; x: number; y: number; w: number; h: number } | null;
  }[];
}

interface ReviewBody {
  batchId: string;
  service: string;
  mode: string;
  lowYield: boolean;
  banner: string | null;
  sections: {
    additions: ReviewSection;
    alreadyOnYourList: ReviewSection;
    probablyNotTitles: ReviewSection;
    unmatched: ReviewSection;
    unreadableTiles: ReviewSection;
    removals: ReviewSection;
  };
  imagesWithNoText: { imageId: string; fileName: string; href: string }[];
}

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

const getReview = (batchId: string): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/review`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader },
  });

/* ── fixtures ─────────────────────────────────────────────────────────── */

let batchSeq = 0;

async function makeBatch(
  over: { mode?: string; service?: string; status?: string; lowYield?: boolean } = {},
): Promise<string> {
  const id = `batch-review-${++batchSeq}`;
  await testPrisma().uploadBatch.create({
    data: {
      id,
      ownerId,
      service: over.service ?? 'netflix',
      mode: over.mode ?? 'full-update',
      status: over.status ?? 'in-review',
      lowYield: over.lowYield ?? false,
      degradedExtraction: false,
      crossCheck: 'ok',
    },
  });
  return id;
}

let candidateSeq = 0;

async function makeCandidate(
  batchId: string,
  over: {
    workIdentity?: string | null;
    rawText?: string;
    verdict?: string;
    collapsedInto?: string | null;
    disposition?: string;
    boxSource?: string;
    boundingBoxes?: string | null;
  } = {},
): Promise<string> {
  const id = `cand-${++candidateSeq}`;
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
      boxSource: over.boxSource ?? 'llm',
      boundingBoxes: over.boundingBoxes ?? null,
      cleanupVerdict: over.verdict ?? 'title-candidate',
      resolvedWorkIdentity: over.workIdentity === undefined ? DUNE : over.workIdentity,
      reviewDisposition: over.disposition ?? (over.collapsedInto == null ? 'pending' : 'discarded'),
      collapsedIntoCandidateId: over.collapsedInto ?? null,
    },
  });
  return id;
}

let titleSeq = 0;

/** An ACTIVE listing on a service, with a title behind it. */
async function makeActiveListing(
  workIdentity: string,
  service: string,
  name: string,
): Promise<{ titleId: string; listingId: string }> {
  const titleId = `title-${++titleSeq}`;
  const listingId = `listing-${titleSeq}`;
  const matched = workIdentity.startsWith('tmdb:');
  // ⚠ `title_match_coherent` is a CHECK constraint, not a convention: a
  // MATCHED title must carry a tmdbId and a NULL rawExtractedText, and an
  // UNMATCHED one the exact opposite. Setting both is rejected by the store.
  await testPrisma().title.create({
    data: {
      id: titleId,
      ownerId,
      workIdentity,
      state: 'active',
      matchState: matched ? 'matched' : 'unmatched',
      rawExtractedText: matched ? null : name,
      normalisedText: name.toLowerCase(),
      tmdbId: matched ? Number(workIdentity.split(':')[2]) : null,
      tmdbMediaType: matched ? (workIdentity.split(':')[1] ?? null) : null,
      tmdbName: matched ? name : null,
      tmdbReleaseYear: matched ? 1995 : null,
      sortDateAdded: new Date('2026-01-04'),
    },
  });
  await testPrisma().uploadBatch.upsert({
    where: { id: 'batch-seed' },
    update: {},
    create: {
      id: 'batch-seed',
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
      createdByBatchId: 'batch-seed',
    },
  });
  return { titleId, listingId };
}

async function suppress(workIdentity: string): Promise<void> {
  await testPrisma().suppression.create({
    data: {
      id: `sup-${workIdentity}`,
      ownerId,
      workIdentity,
      active: true,
      displayName: 'Suppressed',
    },
  });
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

  // Derived from a real request so the owner-id hash is never hard-coded.
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
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
});

afterAll(async () => {
  await closeTestPrisma();
});

/* ── tests ────────────────────────────────────────────────────────────── */

describe('T-REV-010 the review pass sorts candidates into sections', () => {
  it('T-REV-010h: 409 BATCH_NOT_IN_REVIEW while the batch is still extracting', async () => {
    const batchId = await makeBatch({ status: 'extracting' });
    const res = await getReview(batchId);
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('BATCH_NOT_IN_REVIEW');
  });

  it('T-REV-010i: 404 for a batch that does not exist', async () => {
    expect((await getReview('no-such-batch')).status).toBe(404);
  });

  it('T-REV-010j: a new candidate appears in additions', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId);

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.sections.additions.count).toBe(1);
    expect(body.sections.alreadyOnYourList.count).toBe(0);
  });

  it('T-REV-010k: a candidate already active on THIS service is already-present', async () => {
    const batchId = await makeBatch();
    await makeActiveListing(DUNE, 'netflix', 'Dune');
    await makeCandidate(batchId);

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.sections.additions.count).toBe(0);
    expect(body.sections.alreadyOnYourList.count).toBe(1);
  });

  it('T-REV-010l: a candidate active only on the OTHER service is NEW here', async () => {
    const batchId = await makeBatch({ service: 'netflix' });
    await makeActiveListing(DUNE, 'max', 'Dune');
    await makeCandidate(batchId);

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.sections.additions.count).toBe(1);
    expect(body.sections.alreadyOnYourList.count).toBe(0);
  });

  it('T-REV-010m: an SD-02 collapse loser is not rendered twice', async () => {
    const batchId = await makeBatch();
    const winner = await makeCandidate(batchId);
    await makeCandidate(batchId, { collapsedInto: winner });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.sections.additions.count).toBe(1);
    expect(body.sections.additions.items[0]?.candidateId).toBe(winner);
  });
});

describe('T-UX-063 unmatched candidates keep their own section and their raw text', () => {
  it('T-UX-063d: an unmatched: identity renders in unmatched with the raw text', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, {
      workIdentity: 'unmatched:9f2b1c4d5e6f7a80',
      rawText: 'Somethign Unreadble',
    });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.sections.unmatched.count).toBe(1);
    expect(body.sections.unmatched.items[0]?.rawText).toBe('Somethign Unreadble');
    expect(body.sections.additions.count).toBe(0);
  });

  it('T-CLS-013a: a matching FAILURE lands in unmatched, never as a wrong classification', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { workIdentity: null, rawText: 'Unidentifiable' });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.sections.unmatched.count).toBe(1);
    expect(body.sections.additions.count).toBe(0);
    expect(body.sections.alreadyOnYourList.count).toBe(0);
  });
});

describe('T-AI-004 every candidate is reachable; nothing is dropped', () => {
  it('T-AI-004ad: chrome and unreadable tiles are collapsed but present, with counts', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { verdict: 'chrome-suspected', rawText: 'My List' });
    await makeCandidate(batchId, {
      verdict: 'unreadable-tile',
      rawText: '',
      workIdentity: null,
    });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.sections.probablyNotTitles.count).toBe(1);
    expect(body.sections.probablyNotTitles.omitted).toBe(false);
    expect(body.sections.unreadableTiles.count).toBe(1);
  });

  it('T-AI-004ae: an image that yielded no candidate is NAMED, never silently skipped', async () => {
    const batchId = await makeBatch();
    await testPrisma().uploadedImage.create({
      data: {
        id: 'img-empty',
        ownerId,
        batchId,
        fileName: 'IMG_0428.PNG',
        blobPath: 'o/img-empty',
        uploadedFormat: 'png',
        format: 'png',
        byteSize: BigInt(1024),
        uploadedByteSize: BigInt(1024),
        width: 100,
        height: 100,
        retainUntil: new Date('2026-09-25'),
        // 0, NOT null: this image WAS extracted and yielded nothing (US-006 AC-3).
        candidateCount: 0,
      },
    });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    // ⚠ NAMED AND THUMBNAILED (US-006 AC-3, `T-AI-020`). The `href` is the
    // thumbnail half; it is an API path, never a blob or SAS URL out of the
    // private container (NFR-020).
    expect(body.imagesWithNoText).toEqual([
      { imageId: 'img-empty', fileName: 'IMG_0428.PNG', href: '/api/images/img-empty' },
    ]);
  });

  it('T-AI-004af: an image not yet extracted (candidateCount null) is NOT reported as empty', async () => {
    const batchId = await makeBatch();
    await testPrisma().uploadedImage.create({
      data: {
        id: 'img-pending',
        ownerId,
        batchId,
        fileName: 'IMG_0429.PNG',
        blobPath: 'o/img-pending',
        uploadedFormat: 'png',
        format: 'png',
        byteSize: BigInt(1024),
        uploadedByteSize: BigInt(1024),
        retainUntil: new Date('2026-09-25'),
        candidateCount: null,
      },
    });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.imagesWithNoText).toEqual([]);
  });
});

describe('T-REV-006 full-update shows ALL extracted titles — the safety property', () => {
  it('T-REV-006f: an already-present title that WAS extracted is visible, not hidden', async () => {
    const batchId = await makeBatch({ mode: 'full-update' });
    await makeActiveListing(DUNE, 'netflix', 'Dune');
    await makeActiveListing(HEAT, 'netflix', 'Heat');
    await makeCandidate(batchId, { workIdentity: DUNE, rawText: 'Dune' });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;

    // The extracted known title is SHOWN...
    expect(body.sections.alreadyOnYourList.omitted).toBe(false);
    expect(body.sections.alreadyOnYourList.count).toBe(1);
    // ...and only the genuinely absent one is proposed for removal. If review
    // hid known titles, the owner could not tell these two cases apart.
    expect(body.sections.removals.count).toBe(1);
    expect(body.sections.removals.items[0]?.name).toBe('Heat');
    expect(body.sections.removals.items[0]?.ticked).toBe(true);
  });

  it('T-REV-006g: append-only omits BOTH alreadyOnYourList and removals', async () => {
    const batchId = await makeBatch({ mode: 'append-only' });
    await makeActiveListing(HEAT, 'netflix', 'Heat');
    await makeCandidate(batchId, { workIdentity: DUNE });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.sections.alreadyOnYourList.omitted).toBe(true);
    expect(body.sections.removals.omitted).toBe(true);
    expect(body.sections.removals.count).toBe(0);
  });

  it('T-AI-021l: a lowYield full-update withholds removals entirely', async () => {
    const batchId = await makeBatch({ mode: 'full-update', lowYield: true });
    await makeActiveListing(HEAT, 'netflix', 'Heat');
    await makeCandidate(batchId, { workIdentity: DUNE });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.sections.removals.withheld).toBe(true);
    expect(body.sections.removals.withheldReason).toBe('low-yield');
    expect(body.sections.removals.items).toEqual([]);
    expect(body.banner).toContain('nothing will be removed by this batch');
  });

  it('T-REV-006h: a removal proposal never crosses services', async () => {
    const batchId = await makeBatch({ service: 'netflix', mode: 'full-update' });
    await makeActiveListing(HEAT, 'max', 'Heat');
    await makeCandidate(batchId, { workIdentity: DUNE });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    // Heat is on MAX. A Netflix batch must not propose removing it.
    expect(body.sections.removals.count).toBe(0);
  });

  it('T-REV-006i: an already-REMOVED listing is not proposed for removal again', async () => {
    const batchId = await makeBatch({ mode: 'full-update' });
    const { listingId } = await makeActiveListing(HEAT, 'netflix', 'Heat');
    await testPrisma().serviceListing.update({
      where: { listingId },
      data: { state: 'removed', removedAt: new Date() },
    });
    await makeCandidate(batchId, { workIdentity: DUNE });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.sections.removals.count).toBe(0);
  });
});

/* ── exhaustiveness (T-REV-015) ───────────────────────────────────────── */

describe('T-REV-015 · US-013 AC-1 · full-update review contains EVERY extracted title', () => {
  it('T-REV-015a: every non-collapsed candidate in the batch is reachable in some section', async () => {
    // ⚠ THE EXPECTED SET IS READ BACK FROM THE STORE, NOT WRITTEN OUT HERE.
    // A test that lists the ids it expects is only ever as exhaustive as the
    // person who wrote it: add a seventh classification later and the test
    // still passes while the seventh kind of candidate silently vanishes from
    // the owner's review. Asking the database "what candidates does this batch
    // have?" and demanding the review account for all of them is the only form
    // of this assertion that keeps working after the code changes.
    //
    // This is the machinery behind product invariant 2 — a full-update review
    // shows ALL extracted titles, not just the new ones — which is why a
    // failed extraction of a known title can never be misread as a removal.
    const batchId = await makeBatch({ mode: 'full-update' });
    await makeActiveListing(HEAT, 'netflix', 'Heat');

    // One of every kind the classifier can produce.
    await makeCandidate(batchId, { workIdentity: DUNE, rawText: 'Dune' });
    await makeCandidate(batchId, { workIdentity: HEAT, rawText: 'Heat' });
    await makeCandidate(batchId, {
      workIdentity: 'unmatched:9f2b1c4d5e6f7a80',
      rawText: 'Somethign Unreadble',
    });
    await makeCandidate(batchId, { workIdentity: null, rawText: 'Unidentifiable' });
    await makeCandidate(batchId, { verdict: 'chrome-suspected', rawText: 'My List' });
    await makeCandidate(batchId, {
      verdict: 'unreadable-tile',
      rawText: '',
      workIdentity: null,
    });

    const stored = await testPrisma().extractionCandidate.findMany({
      where: { ownerId, batchId, collapsedIntoCandidateId: null },
      select: { id: true },
    });
    expect(stored.length).toBe(6);

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    const rendered = new Set(
      Object.values(body.sections)
        .flatMap((section) => section.items)
        .map((item) => item.candidateId)
        .filter((id): id is string => typeof id === 'string'),
    );

    for (const { id } of stored) {
      expect(rendered.has(id), `candidate ${id} is missing from every review section`).toBe(true);
    }
  });

  it('T-REV-015b: the KNOWN half is present in its own right, with a truthful count', async () => {
    // `015a` proves nothing is dropped. It does not prove the known titles are
    // shown AS known — a build that dumped every candidate into `additions`
    // would satisfy it while asking the owner to re-add titles they already
    // have. AC-1 says "new and known", so both halves are asserted.
    const batchId = await makeBatch({ mode: 'full-update' });
    await makeActiveListing(HEAT, 'netflix', 'Heat');
    const known = await makeCandidate(batchId, { workIdentity: HEAT, rawText: 'Heat' });
    const fresh = await makeCandidate(batchId, { workIdentity: DUNE, rawText: 'Dune' });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.sections.alreadyOnYourList.count).toBe(1);
    expect(body.sections.alreadyOnYourList.items[0]?.candidateId).toBe(known);
    expect(body.sections.additions.count).toBe(1);
    expect(body.sections.additions.items[0]?.candidateId).toBe(fresh);
  });
});

/* ── discrepancy visibility (T-REV-017) ───────────────────────────────── */

describe('T-REV-017 · US-005 AC-4 — the discrepancy is SHOWN, never reconciled silently', () => {
  // ⚠ THE POINT OF THIS SUITE IS THE ABSENCE OF A MERGE. A reconciliation that
  // quietly took the union of "what the screenshots said" and "what is on the
  // list" would produce a correct-looking list and destroy the owner's only
  // means of telling a genuine removal from a failed OCR read. Every case here
  // asserts that the two directions of disagreement land in DIFFERENT, VISIBLE
  // sections with honest counts — product invariant 2.

  it('T-REV-017a: a known title missed by extraction is proposed for removal AND the rest still show', async () => {
    // The canonical AC-4 scenario: two titles on the list, extraction reads
    // only one of them.
    const batchId = await makeBatch({ mode: 'full-update' });
    await makeActiveListing(DUNE, 'netflix', 'Dune');
    await makeActiveListing(HEAT, 'netflix', 'Heat');
    await makeCandidate(batchId, { workIdentity: DUNE, rawText: 'Dune' });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;

    // The half that WAS read is visible and named...
    expect(body.sections.alreadyOnYourList.count).toBe(1);
    expect(body.sections.alreadyOnYourList.items[0]?.rawText).toBe('Dune');
    // ...and the half that was NOT read is on the table as a removal, named.
    expect(body.sections.removals.count).toBe(1);
    expect(body.sections.removals.items[0]?.name).toBe('Heat');
    // ⚠ Both must be non-empty in the SAME response. A review that showed only
    // the removal would present a failed extraction as a decided fact.
    expect(body.sections.alreadyOnYourList.omitted).toBe(false);
    expect(body.sections.removals.omitted).toBe(false);
  });

  it('T-REV-017b: an extracted title that is NOT on the list is an addition, never folded into the known section', async () => {
    // The other direction of the same discrepancy.
    const batchId = await makeBatch({ mode: 'full-update' });
    await makeActiveListing(HEAT, 'netflix', 'Heat');
    await makeCandidate(batchId, { workIdentity: DUNE, rawText: 'Dune' });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;

    expect(body.sections.additions.count).toBe(1);
    expect(body.sections.additions.items[0]?.rawText).toBe('Dune');
    // Silently treating a new title as already-known is the failure that makes
    // an addition vanish without ever being offered.
    expect(body.sections.alreadyOnYourList.count).toBe(0);
  });

  it('T-REV-017c: both directions at once are reported separately, each with its own count', async () => {
    const batchId = await makeBatch({ mode: 'full-update' });
    await makeActiveListing(HEAT, 'netflix', 'Heat'); // on the list, not read
    await makeActiveListing(ANDOR, 'netflix', 'Andor'); // on the list, read
    await makeCandidate(batchId, { workIdentity: ANDOR, rawText: 'Andor' });
    await makeCandidate(batchId, { workIdentity: DUNE, rawText: 'Dune' }); // read, not on the list

    const body = (await (await getReview(batchId)).json()) as ReviewBody;

    expect(body.sections.additions.count).toBe(1);
    expect(body.sections.additions.items[0]?.rawText).toBe('Dune');
    expect(body.sections.alreadyOnYourList.count).toBe(1);
    expect(body.sections.alreadyOnYourList.items[0]?.rawText).toBe('Andor');
    expect(body.sections.removals.count).toBe(1);
    expect(body.sections.removals.items[0]?.name).toBe('Heat');
  });

  it('T-REV-017d: no candidate appears in two sections — the sections partition, they do not overlap', async () => {
    // ⚠ A "reconciliation" that emitted a row into both `additions` and
    // `alreadyOnYourList` would let one confirmation both add and skip the same
    // title, and the counts would still look plausible.
    const batchId = await makeBatch({ mode: 'full-update' });
    await makeActiveListing(ANDOR, 'netflix', 'Andor');
    await makeCandidate(batchId, { workIdentity: ANDOR, rawText: 'Andor' });
    await makeCandidate(batchId, { workIdentity: DUNE, rawText: 'Dune' });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;

    const ids = [
      ...body.sections.additions.items,
      ...body.sections.alreadyOnYourList.items,
      ...body.sections.probablyNotTitles.items,
      ...body.sections.unmatched.items,
      ...body.sections.unreadableTiles.items,
    ].map((candidate) => candidate.candidateId);

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('T-REV-017e: when there is NO discrepancy the sections are shown and empty, not omitted', async () => {
    // ⚠ `count: 0` with `omitted: false` says "we looked, and there is nothing".
    // `omitted: true` says "this question does not apply". Collapsing the two
    // is how a full-update comes to look like an append-only one.
    const batchId = await makeBatch({ mode: 'full-update' });
    await makeActiveListing(ANDOR, 'netflix', 'Andor');
    await makeCandidate(batchId, { workIdentity: ANDOR, rawText: 'Andor' });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;

    expect(body.sections.additions.count).toBe(0);
    expect(body.sections.removals.count).toBe(0);
    expect(body.sections.removals.omitted).toBe(false);
    expect(body.sections.alreadyOnYourList.omitted).toBe(false);
    expect(body.sections.alreadyOnYourList.count).toBe(1);
  });
});

describe('T-SUP-002 suppression is gated BEFORE classification and never appears', () => {
  it('T-SUP-002a: a suppressed work is absent from every candidate section', async () => {
    const batchId = await makeBatch();
    await suppress(DUNE);
    await makeCandidate(batchId, { workIdentity: DUNE });
    await makeCandidate(batchId, { workIdentity: ANDOR, rawText: 'Andor' });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.sections.additions.count).toBe(1);
    expect(body.sections.additions.items[0]?.rawText).toBe('Andor');
    expect(body.sections.alreadyOnYourList.count).toBe(0);
    expect(body.sections.unmatched.count).toBe(0);
  });

  it('T-SUP-006a: an unmatched: identity is suppressible and gated identically — no branch on prefix', async () => {
    const batchId = await makeBatch();
    const raw = 'unmatched:9f2b1c4d5e6f7a80';
    await suppress(raw);
    await makeCandidate(batchId, { workIdentity: raw, rawText: 'Whatever' });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.sections.unmatched.count).toBe(0);
    expect(body.sections.additions.count).toBe(0);
  });

  it('T-SUP-004a: a work suppressed WHILE holding an active listing is not proposed for removal', async () => {
    // Without the explicit filter the owner would be asked, on every
    // full-update batch, about the very work they said they were not
    // interested in.
    const batchId = await makeBatch({ mode: 'full-update' });
    await makeActiveListing(HEAT, 'netflix', 'Heat');
    await suppress(HEAT);
    await makeCandidate(batchId, { workIdentity: DUNE });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.sections.removals.count).toBe(0);
  });
});

describe('T-UI-006 · US-013 AC-3 · the mode contract: omitted means "not applicable", never "nothing found"', () => {
  it('T-UI-006a: append-only marks alreadyOnYourList omitted with an empty item list', async () => {
    const batchId = await makeBatch({ mode: 'append-only' });
    // The data to fill the section EXISTS: this title is on the list and was
    // extracted. Append-only omits the section anyway, because the owner has
    // not told us the screenshots are a complete picture.
    await makeActiveListing(DUNE, 'netflix', 'Dune');
    await makeCandidate(batchId, { workIdentity: DUNE, rawText: 'Dune' });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.sections.alreadyOnYourList.omitted).toBe(true);
    expect(body.sections.alreadyOnYourList.items).toEqual([]);
    expect(body.sections.alreadyOnYourList.count).toBe(0);
  });

  it('T-UI-006b: the SAME data in full-update fills the section — the mode is what decides', async () => {
    const batchId = await makeBatch({ mode: 'full-update' });
    await makeActiveListing(DUNE, 'netflix', 'Dune');
    await makeCandidate(batchId, { workIdentity: DUNE, rawText: 'Dune' });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    // ⚠ The discriminating half. Without it, hard-coding `omitted: true` — or
    // omitting the section whenever it happens to be empty — passes every
    // append-only assertion in this file.
    expect(body.sections.alreadyOnYourList.omitted).toBe(false);
    expect(body.sections.alreadyOnYourList.count).toBe(1);
    expect(body.sections.alreadyOnYourList.items[0]?.rawText).toBe('Dune');
  });

  it('T-UI-006c: an EMPTY full-update section is present, not omitted — the two are different answers', async () => {
    const batchId = await makeBatch({ mode: 'full-update' });
    await makeCandidate(batchId, { workIdentity: DUNE, rawText: 'Dune' });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    // ⚠ THIS IS PRODUCT INVARIANT 2 IN ONE ASSERTION. `omitted: true` says
    // "this question does not apply to this batch"; `omitted: false, count: 0`
    // says "we looked and there is nothing already on your list". Collapsing
    // them lets a failed extraction of a known title read as a removal, which
    // is the one thing this product must never do.
    expect(body.sections.alreadyOnYourList.omitted).toBe(false);
    expect(body.sections.alreadyOnYourList.count).toBe(0);
    expect(body.sections.alreadyOnYourList.items).toEqual([]);
  });

  it('T-UI-006d: no omitted section anywhere in the response ever carries items', async () => {
    const batchId = await makeBatch({ mode: 'append-only' });
    await makeActiveListing(DUNE, 'netflix', 'Dune');
    await makeCandidate(batchId, { workIdentity: DUNE, rawText: 'Dune' });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    // Structural, over every section rather than the two we happen to know
    // about: a section the client is told not to render but which still ships
    // rows is a leak waiting for the first client that trusts `items` over
    // `omitted`.
    for (const [name, section] of Object.entries(body.sections)) {
      if (section.omitted === true) {
        expect(`${name}:${section.items.length}`).toBe(`${name}:0`);
        expect(`${name}:${section.count}`).toBe(`${name}:0`);
      }
    }
  });

  it('T-UI-006e: full-update never omits alreadyOnYourList, whatever else is true of the batch', async () => {
    // A withheld removals section is the case most likely to take the known
    // titles down with it: both are full-update-only, and both are computed
    // from the same read. They are independent — the owner must still see what
    // was recognised even when removals are withheld.
    const batchId = await makeBatch({ mode: 'full-update', lowYield: true });
    await makeActiveListing(DUNE, 'netflix', 'Dune');
    await makeCandidate(batchId, { workIdentity: DUNE, rawText: 'Dune' });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.sections.removals.withheld).toBe(true);
    expect(body.sections.alreadyOnYourList.omitted).toBe(false);
    expect(body.sections.alreadyOnYourList.count).toBe(1);
  });

  it('T-UI-006f: the review never filters candidates by disposition', async () => {
    // The review is re-read after every decision. Filtering out the ones
    // already decided would empty the page as the owner worked through it, and
    // in full-update it would make a confirmed known title look extracted-and-
    // then-lost on the next read.
    const batchId = await makeBatch({ mode: 'full-update' });
    await makeActiveListing(DUNE, 'netflix', 'Dune');
    await makeCandidate(batchId, { workIdentity: DUNE, rawText: 'Dune', disposition: 'confirmed' });
    await makeCandidate(batchId, { workIdentity: HEAT, rawText: 'Heat', disposition: 'discarded' });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.sections.alreadyOnYourList.count).toBe(1);
    expect(body.sections.additions.count).toBe(1);
  });
});

describe('T-REM-010 · US-014 · removals as the owner actually receives them', () => {
  it('T-REM-010a: a full-update proposes exactly the active listings nothing extracted', async () => {
    const batchId = await makeBatch({ service: 'netflix', mode: 'full-update' });
    await makeActiveListing(DUNE, 'netflix', 'Dune');
    await makeActiveListing(HEAT, 'netflix', 'Heat');
    // A third work, active on the OTHER service. (It must be a third work:
    // `title_one_active_per_work` allows only one title row per identity, so a
    // cross-service fixture cannot reuse one of the two above.)
    await makeActiveListing('tmdb:movie:603', 'max', 'The Matrix');
    await makeCandidate(batchId, { workIdentity: DUNE, rawText: 'Dune' });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    // Heat only. Dune was extracted; the Max listing is out of scope, because
    // a Netflix screenshot is evidence about Netflix and nothing else.
    expect(body.sections.removals.items.map((i) => i.name)).toEqual(['Heat']);
    expect(body.sections.removals.count).toBe(1);
    expect(body.sections.removals.items[0]?.ticked).toBe(true);
  });

  it('T-REM-013a: a listing already in the removed state is never proposed again', async () => {
    const batchId = await makeBatch({ mode: 'full-update' });
    const { listingId } = await makeActiveListing(HEAT, 'netflix', 'Heat');
    await testPrisma().serviceListing.update({
      where: { listingId },
      data: { state: 'removed', removedAt: new Date() },
    });
    // Nothing in this batch mentions Heat, so only the state stops it. A
    // second proposal would let this batch re-remove a listing the owner
    // restored between the two.
    await makeCandidate(batchId, { workIdentity: DUNE, rawText: 'Dune' });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.sections.removals.items).toEqual([]);
    expect(body.sections.removals.count).toBe(0);
  });
});

// ── T-AI-041 · specs/ui.md §5.3a · the crop reaches the wire ───────────────
//
// ⚠ WHY THIS IS AN INTEGRATION TEST AND NOT A UNIT ONE. `tileCropFor` is
// covered exhaustively in `packages/domain/test/review.spec.ts`, and the
// rendering is covered in `apps/web/test/candidateThumbnail.spec.tsx` - and
// with BOTH of those green, replacing this route's call with a hard `null`
// changed nothing anywhere. A perfect domain function that no route invokes
// is a feature that does not exist, and this file is the only place that
// difference is visible. It is the same dead-wiring defect `thumbnailUrl`
// already shipped with once.
describe('T-AI-041 · the review response carries the tile crop for the client to render', () => {
  const boxes = (over: Record<string, unknown> = {}) =>
    JSON.stringify([{ imageId: 'img_tile', x: 0.25, y: 0.5, w: 0.25, h: 0.25, ...over }]);

  it('T-AI-041v: an inferred-unverified candidate is served WITH its crop', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, {
      verdict: 'inferred-unverified',
      boxSource: 'llm',
      boundingBoxes: boxes(),
    });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    const crop = body.sections.additions.items[0]?.tileCrop;

    expect(crop).toBeTruthy();
    expect(crop?.imageId).toBe('img_tile');
    // Padded by 8% of the tile's own size, so the artwork is not clipped.
    expect(crop?.w).toBeGreaterThan(0.25);
  });

  it('T-AI-041w: an unreadable tile is served with its crop - the tile is all it has', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, {
      verdict: 'unreadable-tile',
      rawText: '',
      workIdentity: null,
      boxSource: 'llm',
      boundingBoxes: boxes(),
    });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.sections.unreadableTiles.items[0]?.tileCrop).toBeTruthy();
  });

  it('T-AI-041x: an OCR box is served as NO crop - it is a caption strip, not artwork', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, {
      verdict: 'inferred-unverified',
      boxSource: 'ocr',
      boundingBoxes: boxes({ h: 0.02 }),
    });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.sections.additions.items[0]?.tileCrop).toBeNull();
  });

  // ⚠ `boundingBoxes` is NVarChar(Max) JSON written by the extraction
  // pipeline. A malformed value must degrade to "no crop" - a candidate the
  // owner can still SEE is recoverable; a 500 on the review pass is not.
  it('T-AI-041y: malformed stored boxes degrade to no crop, never a 500', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, {
      verdict: 'inferred-unverified',
      boxSource: 'llm',
      boundingBoxes: '{"not":"an array"}',
    });

    const res = await getReview(batchId);
    expect(res.status).toBe(200);
    expect(((await res.json()) as ReviewBody).sections.additions.items[0]?.tileCrop).toBeNull();
  });

  it('T-AI-041z: a plain title-candidate carries no crop', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { boxSource: 'llm', boundingBoxes: boxes() });

    const body = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(body.sections.additions.items[0]?.tileCrop).toBeNull();
  });
});
