/**
 * TASK-066 — `PATCH /api/batches/:batchId/candidates/:candidateId` and
 * `POST /api/batches/:batchId/candidates/confirm-all` (`specs/api.md` §6.18,
 * §6.19).
 *
 * `T-REV-011` (confirm / correct / discard, all supported per item),
 * `T-REV-014` (correcting onto a work with an existing active listing → 409
 * `DUPLICATE_WORK_IDENTITY` unless confirmed), `T-REV-010` (the corrected
 * match is visible in the review pass BEFORE close).
 *
 * Integration, not unit: the body grammar is already covered by
 * `packages/domain/test/candidatePatch.spec.ts`. What this file proves is that
 * the route WRITES what it says it wrote, that the 409 gates fire against real
 * rows, and that `confirm-all` agrees with `GET /review` about which section
 * an item is in — which is precisely where a second, simpler section rule
 * would drift undetectably.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';
import { confirmPendingCandidates } from '../../src/repository/ownerData.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-candidates';
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

interface PatchedCandidate {
  candidateId: string;
  rawText: string;
  verdict: string;
  resolvedWorkIdentity: string | null;
  correctedToTmdbId: number | null;
  disposition: string;
}

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

interface ConfirmAllBody {
  section: string;
  confirmed: number;
  skipped: number;
}

const patchCandidate = (batchId: string, candidateId: string, body: unknown): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/candidates/${candidateId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', [CLIENT_PRINCIPAL_HEADER]: principalHeader },
    body: JSON.stringify(body),
  });

const confirmAll = (batchId: string, body: unknown): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/candidates/confirm-all`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [CLIENT_PRINCIPAL_HEADER]: principalHeader },
    body: JSON.stringify(body),
  });

const getReview = (batchId: string): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/review`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader },
  });

/* ── fixtures ─────────────────────────────────────────────────────────── */

let batchSeq = 0;

async function makeBatch(over: { status?: string; mode?: string } = {}): Promise<string> {
  const id = `batch-cand-${++batchSeq}`;
  await testPrisma().uploadBatch.create({
    data: {
      id,
      ownerId,
      service: 'netflix',
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

async function makeCandidate(
  batchId: string,
  over: {
    workIdentity?: string | null;
    rawText?: string;
    verdict?: string;
    disposition?: string;
  } = {},
): Promise<string> {
  const id = `cand-p-${++candidateSeq}`;
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
      reviewDisposition: over.disposition ?? 'pending',
    },
  });
  return id;
}

let titleSeq = 0;

async function makeActiveListing(workIdentity: string, name: string): Promise<string> {
  const titleId = `title-c-${++titleSeq}`;
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
    where: { id: 'batch-c-seed' },
    update: {},
    create: {
      id: 'batch-c-seed',
      ownerId,
      service: 'netflix',
      mode: 'append-only',
      status: 'applied',
      lowYield: false,
      degradedExtraction: false,
    },
  });
  await testPrisma().serviceListing.create({
    data: {
      listingId: `listing-c-${titleSeq}`,
      ownerId,
      titleId,
      service: 'netflix',
      state: 'active',
      dateAdded: new Date('2026-01-04'),
      createdByBatchId: 'batch-c-seed',
    },
  });
  return titleId;
}

/* ── lifecycle ────────────────────────────────────────────────────────── */

beforeEach(async () => {
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  // ⚠ Deliberately UNCONFIGURED. The `reclassifyAsTitle` path calls TMDB, and
  // an integration test must never depend on a live third party: it would be
  // flaky offline and would make real outbound calls from CI. With no key the
  // client refuses locally (`TmdbUnavailableError`, not retryable), which is
  // exactly the outage path `T-REV-011af` asserts the rescue survives.
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
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterAll(async () => {
  await closeTestPrisma();
});

/* ── tests ────────────────────────────────────────────────────────────── */

describe('T-REV-011 · per-item confirm, discard and re-pend', () => {
  it('T-REV-011u: confirming writes confirmed and echoes it back', async () => {
    const batchId = await makeBatch();
    const candidateId = await makeCandidate(batchId);

    const res = await patchCandidate(batchId, candidateId, { disposition: 'confirmed' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as PatchedCandidate).disposition).toBe('confirmed');

    const row = await testPrisma().extractionCandidate.findFirst({ where: { id: candidateId } });
    expect(row?.reviewDisposition).toBe('confirmed');
  });

  it('T-REV-011v: discarding writes discarded and DELETES NOTHING (REQ-012)', async () => {
    const batchId = await makeBatch();
    const candidateId = await makeCandidate(batchId);

    await patchCandidate(batchId, candidateId, { disposition: 'discarded' });

    const row = await testPrisma().extractionCandidate.findFirst({ where: { id: candidateId } });
    expect(row).not.toBeNull();
    expect(row?.reviewDisposition).toBe('discarded');
    expect(row?.rawText).toBe('Dune');
  });

  it('T-REV-011w: a decision is reversible — confirmed → pending', async () => {
    const batchId = await makeBatch();
    const candidateId = await makeCandidate(batchId);

    await patchCandidate(batchId, candidateId, { disposition: 'confirmed' });
    const res = await patchCandidate(batchId, candidateId, { disposition: 'pending' });

    expect(res.status).toBe(200);
    expect(((await res.json()) as PatchedCandidate).disposition).toBe('pending');
  });

  it('T-REV-011x: a malformed body is 400 VALIDATION_FAILED and writes nothing', async () => {
    const batchId = await makeBatch();
    const candidateId = await makeCandidate(batchId);

    const res = await patchCandidate(batchId, candidateId, { disposition: 'applied' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_FAILED');

    const row = await testPrisma().extractionCandidate.findFirst({ where: { id: candidateId } });
    expect(row?.reviewDisposition).toBe('pending');
  });

  it('T-REV-011y: the body is validated BEFORE the batch state, so a bad body is always 400', async () => {
    // Reversed, the same bad request answers 400 or 409 depending on unrelated
    // state — untestable and unhelpful.
    const batchId = await makeBatch({ status: 'applied' });
    const candidateId = await makeCandidate(batchId);

    const res = await patchCandidate(batchId, candidateId, { disposition: 'applied' });
    expect(res.status).toBe(400);
  });

  it('T-REV-011z: a batch that is not in-review is 409 BATCH_NOT_IN_REVIEW', async () => {
    const batchId = await makeBatch({ status: 'applied' });
    const candidateId = await makeCandidate(batchId);

    const res = await patchCandidate(batchId, candidateId, { disposition: 'confirmed' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('BATCH_NOT_IN_REVIEW');

    const row = await testPrisma().extractionCandidate.findFirst({ where: { id: candidateId } });
    expect(row?.reviewDisposition).toBe('pending');
  });

  it('T-REV-011aa: a candidate belonging to ANOTHER batch is 404, not silently patched', async () => {
    const batchId = await makeBatch();
    const otherBatchId = await makeBatch();
    const candidateId = await makeCandidate(otherBatchId);

    const res = await patchCandidate(batchId, candidateId, { disposition: 'confirmed' });
    expect(res.status).toBe(404);

    const row = await testPrisma().extractionCandidate.findFirst({ where: { id: candidateId } });
    expect(row?.reviewDisposition).toBe('pending');
  });

  it('T-REV-011ab: an unknown candidate id is 404', async () => {
    const batchId = await makeBatch();
    expect((await patchCandidate(batchId, 'nope', { disposition: 'confirmed' })).status).toBe(404);
  });
});

describe('T-REV-011 · correction re-resolves identity immediately (US-007 AC-3)', () => {
  it('T-REV-011ac: a correction writes the NEW work identity and the corrected tmdbId', async () => {
    const batchId = await makeBatch();
    const candidateId = await makeCandidate(batchId, { rawText: 'Heat' });

    const res = await patchCandidate(batchId, candidateId, {
      disposition: 'corrected',
      tmdbId: 949,
      mediaType: 'movie',
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as PatchedCandidate;
    expect(body.resolvedWorkIdentity).toBe(HEAT);
    expect(body.correctedToTmdbId).toBe(949);
    expect(body.disposition).toBe('corrected');
  });

  it('T-REV-010n: the corrected match is visible in the review pass BEFORE close', async () => {
    const batchId = await makeBatch();
    const candidateId = await makeCandidate(batchId, { rawText: 'Heat' });

    await patchCandidate(batchId, candidateId, {
      disposition: 'corrected',
      tmdbId: 949,
      mediaType: 'movie',
    });

    const review = (await (await getReview(batchId)).json()) as {
      sections: { additions: { items: { candidateId: string; resolvedWorkIdentity: string }[] } };
    };
    const item = review.sections.additions.items.find((i) => i.candidateId === candidateId);
    expect(item?.resolvedWorkIdentity).toBe(HEAT);
  });

  it('T-REV-011ad: correcting a chrome-suspected item ALSO clears the verdict, or it stays collapsed', async () => {
    const batchId = await makeBatch();
    const candidateId = await makeCandidate(batchId, {
      rawText: 'Continue watching',
      verdict: 'chrome-suspected',
      workIdentity: null,
    });

    await patchCandidate(batchId, candidateId, {
      disposition: 'corrected',
      tmdbId: 949,
      mediaType: 'movie',
    });

    const review = (await (await getReview(batchId)).json()) as {
      sections: {
        additions: { items: { candidateId: string }[] };
        probablyNotTitles: { items: { candidateId: string }[] };
      };
    };
    expect(review.sections.probablyNotTitles.items).toHaveLength(0);
    expect(review.sections.additions.items.map((i) => i.candidateId)).toContain(candidateId);
  });
});

describe('T-REV-014 · correcting onto a work already on this list', () => {
  it('T-REV-014a: 409 DUPLICATE_WORK_IDENTITY when an active listing already holds that work', async () => {
    const batchId = await makeBatch();
    const candidateId = await makeCandidate(batchId, { rawText: 'Heat' });
    const titleId = await makeActiveListing(HEAT, 'Heat');

    const res = await patchCandidate(batchId, candidateId, {
      disposition: 'corrected',
      tmdbId: 949,
      mediaType: 'movie',
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('DUPLICATE_WORK_IDENTITY');
    expect(body.error.details['titleId']).toBe(titleId);

    const row = await testPrisma().extractionCandidate.findFirst({ where: { id: candidateId } });
    expect(row?.reviewDisposition).toBe('pending');
    expect(row?.resolvedWorkIdentity).toBe(DUNE);
  });

  it('T-REV-014b: confirmDuplicate: true lets the owner through', async () => {
    const batchId = await makeBatch();
    const candidateId = await makeCandidate(batchId, { rawText: 'Heat' });
    await makeActiveListing(HEAT, 'Heat');

    const res = await patchCandidate(batchId, candidateId, {
      disposition: 'corrected',
      tmdbId: 949,
      mediaType: 'movie',
      confirmDuplicate: true,
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as PatchedCandidate).resolvedWorkIdentity).toBe(HEAT);
  });

  it('T-REV-014c: a REMOVED listing is not a duplicate — a reappearance is a new row (invariant 7)', async () => {
    const batchId = await makeBatch();
    const candidateId = await makeCandidate(batchId, { rawText: 'Heat' });
    await makeActiveListing(HEAT, 'Heat');
    await testPrisma().serviceListing.updateMany({
      where: { ownerId, service: 'netflix' },
      data: { state: 'removed', removedAt: new Date('2026-02-01') },
    });

    const res = await patchCandidate(batchId, candidateId, {
      disposition: 'corrected',
      tmdbId: 949,
      mediaType: 'movie',
    });

    expect(res.status).toBe(200);
  });
});

describe('T-SUP-002 · correcting ONTO a suppressed work is refused', () => {
  it('T-SUP-002b: 409 TARGET_WORK_SUPPRESSED — correction is not a back door into the list', async () => {
    const batchId = await makeBatch();
    const candidateId = await makeCandidate(batchId, { rawText: 'Heat' });
    await testPrisma().suppression.create({
      data: {
        id: `sup-${HEAT}`,
        ownerId,
        workIdentity: HEAT,
        active: true,
        displayName: 'Heat',
      },
    });

    const res = await patchCandidate(batchId, candidateId, {
      disposition: 'corrected',
      tmdbId: 949,
      mediaType: 'movie',
    });

    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('TARGET_WORK_SUPPRESSED');
  });

  it('T-SUP-002c: the suppression gate fires BEFORE the duplicate gate', async () => {
    // Both apply. The owner needs to be told the reason they can act on.
    const batchId = await makeBatch();
    const candidateId = await makeCandidate(batchId, { rawText: 'Heat' });
    await makeActiveListing(HEAT, 'Heat');
    await testPrisma().suppression.create({
      data: {
        id: `sup-${HEAT}`,
        ownerId,
        workIdentity: HEAT,
        active: true,
        displayName: 'Heat',
      },
    });

    const res = await patchCandidate(batchId, candidateId, {
      disposition: 'corrected',
      tmdbId: 949,
      mediaType: 'movie',
    });

    expect(((await res.json()) as ErrorBody).error.code).toBe('TARGET_WORK_SUPPRESSED');
  });
});

describe('T-REV-011 · reclassifyAsTitle rescues a chrome-suspected item', () => {
  it('T-REV-011ae: the item leaves probablyNotTitles and stays PENDING', async () => {
    const batchId = await makeBatch();
    const candidateId = await makeCandidate(batchId, {
      rawText: 'Continue watching',
      verdict: 'chrome-suspected',
      workIdentity: null,
    });

    const res = await patchCandidate(batchId, candidateId, { reclassifyAsTitle: true });
    expect(res.status).toBe(200);

    const body = (await res.json()) as PatchedCandidate;
    expect(body.verdict).toBe('title-candidate');
    // A rescue says "this IS a title", never "add it" — REQ-014.
    expect(body.disposition).toBe('pending');
  });

  it('T-REV-011af: a TMDB outage does NOT lose the rescue', async () => {
    // Without an API key the client cannot reach TMDB; the verdict flip is
    // still what the owner asked for and must survive.
    const previous = process.env['TMDB_API_KEY'];
    delete process.env['TMDB_API_KEY'];
    try {
      const batchId = await makeBatch();
      const candidateId = await makeCandidate(batchId, {
        rawText: 'Continue watching',
        verdict: 'chrome-suspected',
        workIdentity: null,
      });

      const res = await patchCandidate(batchId, candidateId, { reclassifyAsTitle: true });
      expect(res.status).toBe(200);

      const row = await testPrisma().extractionCandidate.findFirst({ where: { id: candidateId } });
      expect(row?.cleanupVerdict).toBe('title-candidate');
    } finally {
      if (previous !== undefined) process.env['TMDB_API_KEY'] = previous;
    }
  });
});

describe('T-REV-011 · confirm-all (§6.19)', () => {
  it('T-REV-011ag: confirms every pending item in the section and reports the count', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { rawText: 'Dune', workIdentity: DUNE });
    await makeCandidate(batchId, { rawText: 'Heat', workIdentity: HEAT });

    const res = await confirmAll(batchId, { section: 'additions' });
    expect(res.status).toBe(200);
    expect((await res.json()) as ConfirmAllBody).toEqual({
      section: 'additions',
      confirmed: 2,
      skipped: 0,
    });
  });

  it('T-REV-011ah: an explicitly DISCARDED item is skipped, never resurrected', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { rawText: 'Dune', workIdentity: DUNE });
    const discardedId = await makeCandidate(batchId, {
      rawText: 'Heat',
      workIdentity: HEAT,
      disposition: 'discarded',
    });

    const body = (await (
      await confirmAll(batchId, { section: 'additions' })
    ).json()) as ConfirmAllBody;
    expect(body).toEqual({ section: 'additions', confirmed: 1, skipped: 1 });

    const row = await testPrisma().extractionCandidate.findFirst({ where: { id: discardedId } });
    expect(row?.reviewDisposition).toBe('discarded');
  });

  /**
   * ⚠ This drives the REPOSITORY directly, on purpose. Through the route the
   * `pending` predicate is unreachable — the handler has already filtered to
   * confirmable rows — so a route-level test passes whether or not the WHERE
   * carries it, and the guard could be deleted with a green suite. The hazard
   * it exists for is a discard landing between the handler's read and its
   * write, which is exactly what seeding a discarded id and calling the bulk
   * update with it reproduces.
   */
  it('T-REV-011an: the bulk update refuses to reverse a concurrent discard', async () => {
    const batchId = await makeBatch();
    const pendingId = await makeCandidate(batchId, { rawText: 'Dune', workIdentity: DUNE });
    const discardedId = await makeCandidate(batchId, {
      rawText: 'Heat',
      workIdentity: HEAT,
      disposition: 'discarded',
    });

    const { count } = await confirmPendingCandidates(ownerId, [pendingId, discardedId]);

    expect(count).toBe(1);
    const discarded = await testPrisma().extractionCandidate.findFirst({
      where: { id: discardedId },
    });
    expect(discarded?.reviewDisposition).toBe('discarded');
  });

  it('T-REV-011ai: it does NOT touch another section', async () => {
    const batchId = await makeBatch();
    const unmatchedId = await makeCandidate(batchId, {
      rawText: 'Something odd',
      workIdentity: null,
    });

    await confirmAll(batchId, { section: 'additions' });

    const row = await testPrisma().extractionCandidate.findFirst({ where: { id: unmatchedId } });
    expect(row?.reviewDisposition).toBe('pending');
  });

  it('T-REV-011aj: the unmatched section is confirmable on its own', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { rawText: 'Something odd', workIdentity: null });

    const body = (await (
      await confirmAll(batchId, { section: 'unmatched' })
    ).json()) as ConfirmAllBody;
    expect(body.confirmed).toBe(1);
  });

  it('T-REV-011ak: a collapsed-by-default section is refused, not silently bulk-confirmed', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { verdict: 'chrome-suspected', workIdentity: null });

    const res = await confirmAll(batchId, { section: 'probablyNotTitles' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_FAILED');
  });

  it('T-REV-011al: a batch that is not in-review is 409', async () => {
    const batchId = await makeBatch({ status: 'applied' });
    await makeCandidate(batchId);

    const res = await confirmAll(batchId, { section: 'additions' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('BATCH_NOT_IN_REVIEW');
  });

  it('T-REV-011am: an empty section reports confirmed 0 / skipped 0, not an error', async () => {
    const batchId = await makeBatch();

    const body = (await (
      await confirmAll(batchId, { section: 'additions' })
    ).json()) as ConfirmAllBody;
    expect(body).toEqual({ section: 'additions', confirmed: 0, skipped: 0 });
  });

  it('T-SUP-002d: a suppressed work is not bulk-confirmed — the gate holds here too', async () => {
    const batchId = await makeBatch();
    const suppressedId = await makeCandidate(batchId, { rawText: 'Dune', workIdentity: DUNE });
    await testPrisma().suppression.create({
      data: {
        id: `sup-${DUNE}`,
        ownerId,
        workIdentity: DUNE,
        active: true,
        displayName: 'Dune',
      },
    });

    const body = (await (
      await confirmAll(batchId, { section: 'additions' })
    ).json()) as ConfirmAllBody;
    expect(body.confirmed).toBe(0);

    const row = await testPrisma().extractionCandidate.findFirst({ where: { id: suppressedId } });
    expect(row?.reviewDisposition).toBe('pending');
  });
});
