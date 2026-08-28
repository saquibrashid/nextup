/**
 * TASK-068 — US-008 AC-4: closing with unresolved unmatched candidates KEEPS
 * them. `T-UNM-012`.
 *
 * ⚠ **THIS IS THE ASSERTION US-008 EXISTS FOR.** The whole user story is
 * "unmatched candidates are surfaced, never silently discarded", and the only
 * place that promise can be broken is here, at close: the review pass can show
 * a title perfectly and the close can still write nothing for it, and the
 * owner would have no way to tell — the summary would simply be one smaller
 * than they expected, on a screen they have already left.
 *
 * ⚠ **KEPT MEANS A TITLE *AND* A LISTING.** A title with no listing is not on
 * the combined list at all: it would vanish from the only view the owner has
 * while `unresolvedKept` still counted it. Every case here asserts both.
 *
 * ⚠ **`unresolvedKept` MUST NOT DOUBLE-COUNT WITH `titlesCreated`, AND MUST
 * NOT REPLACE IT.** They answer different questions — how many rows were
 * written, and how many of those the product could not name — so a summary
 * that reported an unresolved keep under only one of them would either hide
 * the row or hide the fact that it is unidentified.
 *
 * The routing rule itself (what makes a candidate "unmatched") is proven
 * purely in `packages/domain/test/review.spec.ts` under `T-UX-063`; the close
 * grammar is proven purely in `packages/domain/test/close.spec.ts`. What only
 * a real store shows is that the rows land.
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
const SUBJECT = 'oid-owner-unmatched';
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

let server: Server;
let app: Express;
let origin: string;
let ownerId: string;

interface CloseBody {
  summary: {
    titlesCreated: number;
    listingsCreated: number;
    listingsRemoved: number;
    unresolvedKept: number;
    discarded: number;
    suppressedGated: number;
    removalGroupId: string | null;
  };
}

const closeBatch = (batchId: string): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/close`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [CLIENT_PRINCIPAL_HEADER]: principalHeader },
    body: JSON.stringify({}),
  });

let batchSeq = 0;

async function makeBatch(): Promise<string> {
  const id = `batch-unm-${++batchSeq}`;
  await testPrisma().uploadBatch.create({
    data: {
      id,
      ownerId,
      service: 'netflix',
      mode: 'append-only',
      status: 'in-review',
      lowYield: false,
      degradedExtraction: false,
      crossCheck: 'ok',
    },
  });
  return id;
}

let candidateSeq = 0;

/**
 * ⚠ `matchCandidates` is left NULL. An unmatched candidate is by definition
 * one the pipeline proposed nothing for; seeding a match blob would make the
 * fixture describe a *corrected* row instead, and the unmatched branch of
 * close would never be exercised by a file whose only job is to exercise it.
 */
async function makeUnmatched(
  batchId: string,
  over: { rawText?: string; identity?: string | null; disposition?: string } = {},
): Promise<string> {
  const id = `cand-unm-${++candidateSeq}`;
  const rawText = over.rawText ?? 'THE HAUNTNG OF BLY MANR';
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
      resolvedWorkIdentity:
        over.identity === undefined ? 'unmatched:0123456789abcdef' : over.identity,
      reviewDisposition: over.disposition ?? 'confirmed',
      matchCandidates: null,
    },
  });
  return id;
}

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
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-UNM-012 · US-008 AC-4 · unresolved unmatched candidates are KEPT at close', () => {
  it('T-UNM-012a: a kept unmatched candidate becomes a real title AND a real listing', async () => {
    const batchId = await makeBatch();
    await makeUnmatched(batchId);

    const res = await closeBatch(batchId);
    expect(res.status).toBe(200);

    const title = await testPrisma().title.findFirst({
      where: { workIdentity: 'unmatched:0123456789abcdef' },
    });
    expect(title).not.toBeNull();
    expect(title?.state).toBe('active');
    // ⚠ `matchState` says unidentified — the row exists, and the product does
    // not pretend it knows what it is.
    expect(title?.matchState).toBe('unmatched');
    expect(title?.tmdbId).toBeNull();

    const listings = await testPrisma().serviceListing.findMany({
      where: { titleId: title?.id ?? '' },
    });
    expect(listings).toHaveLength(1);
    expect(listings[0]?.state).toBe('active');
    expect(listings[0]?.service).toBe('netflix');
  });

  it('T-UNM-012b: the title carries the RAW TEXT, never a blank name', async () => {
    // ⚠ The row's only name is what was read off the screenshot. A title kept
    // under an empty name is indistinguishable, on the list, from a rendering
    // failure — and the owner cannot act on it.
    const batchId = await makeBatch();
    await makeUnmatched(batchId, { rawText: 'MARE OF EASTOWNE' });

    await closeBatch(batchId);

    const title = await testPrisma().title.findFirst({ where: { matchState: 'unmatched' } });
    expect(title?.rawExtractedText).toBe('MARE OF EASTOWNE');
  });

  it('T-UNM-012c: `unresolvedKept` counts them, and `titlesCreated` still counts the row', async () => {
    const batchId = await makeBatch();
    await makeUnmatched(batchId, { rawText: 'ONE' });
    await makeUnmatched(batchId, { rawText: 'TWO', identity: 'unmatched:fedcba9876543210' });

    const body = (await (await closeBatch(batchId)).json()) as CloseBody;
    expect(body.summary.unresolvedKept).toBe(2);
    expect(body.summary.titlesCreated).toBe(2);
    expect(body.summary.listingsCreated).toBe(2);
  });

  it('T-UNM-012d: a candidate with a NULL identity is kept too, not dropped', async () => {
    // ⚠ `null` and `unmatched:…` are both "TMDB could not name this", and only
    // one of them has a prefix to test for. A close that handled the prefix
    // and dropped the null would lose exactly the rows the pipeline failed
    // hardest on.
    const batchId = await makeBatch();
    await makeUnmatched(batchId, { rawText: 'ARTWORK ONLY TILE', identity: null });

    const body = (await (await closeBatch(batchId)).json()) as CloseBody;
    expect(body.summary.unresolvedKept).toBe(1);
    expect(await testPrisma().serviceListing.count({ where: {} })).toBe(1);
  });

  it('T-UNM-012e: a DISCARDED unmatched candidate is not kept and is not counted', async () => {
    // The other half of "never silently discarded": discarding is a decision
    // the owner made explicitly, and it must be honoured exactly.
    const batchId = await makeBatch();
    await makeUnmatched(batchId, { disposition: 'discarded' });

    const body = (await (await closeBatch(batchId)).json()) as CloseBody;
    expect(body.summary.unresolvedKept).toBe(0);
    expect(body.summary.discarded).toBe(1);
    expect(await testPrisma().title.count({ where: {} })).toBe(0);
    expect(await testPrisma().serviceListing.count({ where: {} })).toBe(0);

    // ⚠ AND the candidate row survives (REQ-012): the record of the discard is
    // the only evidence the tile was ever read.
    expect(await testPrisma().extractionCandidate.count({ where: { batchId } })).toBe(1);
  });

  it('T-UNM-012f: an UNDECIDED unmatched candidate blocks the close instead of being dropped', async () => {
    // ⚠ REQ-014's no-accept-by-inaction rule cuts BOTH ways here. Closing over
    // an undecided unmatched row would be a silent decision; and the refusal
    // has to be a refusal, not a partial write.
    const batchId = await makeBatch();
    await makeUnmatched(batchId, { disposition: 'pending' });

    const res = await closeBatch(batchId);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PENDING_ADDITIONS');
    expect(await testPrisma().title.count({ where: {} })).toBe(0);
    expect(await testPrisma().serviceListing.count({ where: {} })).toBe(0);
  });
});
