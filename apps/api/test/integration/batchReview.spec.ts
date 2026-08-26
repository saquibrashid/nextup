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
  items: { candidateId?: string; rawText?: string; name?: string; ticked?: boolean }[];
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
  imagesWithNoText: { imageId: string; fileName: string }[];
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
      boxSource: 'llm',
      cleanupVerdict: over.verdict ?? 'title-candidate',
      resolvedWorkIdentity: over.workIdentity === undefined ? DUNE : over.workIdentity,
      reviewDisposition: over.collapsedInto == null ? 'pending' : 'discarded',
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
    expect(body.imagesWithNoText).toEqual([{ imageId: 'img-empty', fileName: 'IMG_0428.PNG' }]);
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
