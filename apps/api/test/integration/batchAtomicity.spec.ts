/**
 * TASK-072 — atomic close by VISIBILITY, and crash resumability.
 *
 * `T-BATCH-003` (nothing is visible before close), `T-BATCH-005` (a close
 * killed mid-flight leaves the list byte-identical and retries to exactly one
 * copy), `T-FRESH-013` (abandoned and failed batches never update
 * `serviceState`), `T-BATCH-011`/`T-BATCH-012` (reconciliation touches only the
 * batch's own service) and `T-BATCH-014` (additions and corrections are applied
 * together, in one step).
 *
 * ⚠ WHY THIS FILE ASSERTS THE LIST RESPONSE AND NOT ROW COUNTS. US-005's
 * promise is made to the OWNER, not to the schema: "nothing changes until you
 * close it" is a statement about what they see. A row count can stay flat while
 * the rendered list reorders, regains a service badge, or changes a date — and
 * every one of those is the batch leaking out early. So the assertions capture
 * the `GET /api/titles` response body verbatim and compare the strings.
 *
 * ⚠ AND WHY IT IS A SEPARATE FILE FROM `batchClose.spec.ts`. That file proves
 * the close applies the right things. This one proves that until it does,
 * nothing else has moved — the failure mode it guards is the opposite one, and
 * mixing them would let a fixture written for one hide the other.
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
 * A fault injected at the LAST write inside the close transaction, which is as
 * close to "the process died mid-close" as a test can get without killing the
 * runner: every title and listing has already been inserted when it throws, so
 * only a real rollback can put the list back.
 */
let failServiceState = false;

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    upsertServiceState: async (...args: Parameters<typeof actual.upsertServiceState>) => {
      if (failServiceState) throw new Error('injected mid-close failure');
      return actual.upsertServiceState(...args);
    },
  };
});

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-atomic';
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

const authed = (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${origin}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      [CLIENT_PRINCIPAL_HEADER]: principalHeader,
      ...(init.headers ?? {}),
    },
  });

const closeBatchRequest = (batchId: string): Promise<Response> =>
  authed(`/api/batches/${batchId}/close`, { method: 'POST', body: '{}' });

/**
 * The combined list EXACTLY as the owner would see it.
 *
 * ⚠ Returned as raw text, not parsed. Re-serialising through `JSON.parse`
 * would normalise key order and hide a response whose *shape* changed, and the
 * property under test is "byte-identical", not "deeply equal".
 */
const listText = async (): Promise<string> => {
  const res = await authed('/api/titles');
  expect(res.status).toBe(200);
  return res.text();
};

const serviceStateFor = async (service: string): Promise<string | null> => {
  const res = await authed('/api/service-state');
  const body = (await res.json()) as {
    services: { service: string; lastCompletedBatchAt: string | null }[];
  };
  return body.services.find((s) => s.service === service)?.lastCompletedBatchAt ?? null;
};

/* ── fixtures ─────────────────────────────────────────────────────────── */

let batchSeq = 0;

async function makeBatch(
  over: { status?: string; mode?: string; service?: string } = {},
): Promise<string> {
  const id = `batch-atomic-${++batchSeq}`;
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

async function makeCandidate(
  batchId: string,
  over: {
    workIdentity?: string;
    rawText?: string;
    disposition?: string;
    originalTmdbId?: number;
  } = {},
): Promise<string> {
  const id = `cand-atomic-${++candidateSeq}`;
  const workIdentity = over.workIdentity ?? DUNE;
  const altId = over.originalTmdbId ?? Number(workIdentity.split(':')[2]);

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
      cleanupVerdict: 'title-candidate',
      resolvedWorkIdentity: workIdentity,
      reviewDisposition: over.disposition ?? 'confirmed',
      matchCandidates: JSON.stringify([
        {
          tmdbId: altId,
          mediaType: 'movie',
          name: over.rawText ?? 'Dune',
          releaseYear: 2021,
          posterPath: '/p.jpg',
          score: 1,
        },
      ]),
    },
  });
  return id;
}

let titleSeq = 0;

/** An existing active title + listing, so "before" is not an empty list. */
async function seedListing(workIdentity: string, name: string, service: string): Promise<string> {
  const titleId = `title-atomic-${++titleSeq}`;
  await testPrisma().uploadBatch.upsert({
    where: { id: `batch-atomic-seed-${service}` },
    update: {},
    create: {
      id: `batch-atomic-seed-${service}`,
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
      tmdbReleaseYear: 2021,
      sortDateAdded: new Date('2026-01-04'),
    },
  });
  await testPrisma().serviceListing.create({
    data: {
      listingId: `listing-atomic-${titleSeq}`,
      ownerId,
      titleId,
      service,
      state: 'active',
      dateAdded: new Date('2026-01-04'),
      createdByBatchId: `batch-atomic-seed-${service}`,
    },
  });
  return titleId;
}

const countListings = (service?: string): Promise<number> =>
  testPrisma().serviceListing.count({
    where: service === undefined ? {} : { service },
  });

/* ── lifecycle ────────────────────────────────────────────────────────── */

beforeEach(async () => {
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  process.env['TMDB_API_KEY'] = '';
  testPrisma();
  await resetDatabase();

  app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const me = await authed('/api/me');
  ownerId = ((await me.json()) as { ownerId: string }).ownerId;

  failServiceState = false;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-BATCH-003 · US-005 AC-1 · nothing is visible until the batch is closed', () => {
  it('T-BATCH-003a: an extracted, reviewed, UNCLOSED batch leaves the list byte-identical', async () => {
    await seedListing(HEAT, 'Heat', 'netflix');
    const before = await listText();

    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });
    await makeCandidate(batchId, { workIdentity: HEAT, rawText: 'Heat', disposition: 'confirmed' });

    // Everything short of close has happened: images extracted, candidates
    // matched, the owner has confirmed them. The list must not have moved.
    expect(await listText()).toBe(before);
  });

  it('T-BATCH-003b: reviewing a batch creates no title rows at all', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });

    const review = await authed(`/api/batches/${batchId}/review`);
    expect(review.status).toBe(200);

    // The review READ must not be a write. Materialising titles here would make
    // the batch visible to a second tab that never opened the review.
    expect(await testPrisma().title.count()).toBe(0);
    expect(await countListings()).toBe(0);
  });

  it('T-BATCH-003c: and closing it is what changes the list', async () => {
    await seedListing(HEAT, 'Heat', 'netflix');
    const before = await listText();

    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });

    expect((await closeBatchRequest(batchId)).status).toBe(200);

    // The accept half: without it, an implementation that never applies
    // anything would pass every assertion above.
    expect(await listText()).not.toBe(before);
  });
});

describe('T-BATCH-005 · a close killed mid-flight leaves nothing behind', () => {
  it('T-BATCH-005a: the list is byte-identical to its pre-close state', async () => {
    await seedListing(HEAT, 'Heat', 'netflix');
    const before = await listText();

    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });
    await makeCandidate(batchId, {
      workIdentity: 'tmdb:movie:27205',
      rawText: 'Inception',
      disposition: 'confirmed',
    });

    failServiceState = true;
    expect((await closeBatchRequest(batchId)).status).toBe(500);
    failServiceState = false;

    // Not "roughly the same": identical. A half-applied close that added one of
    // the two titles would still return 200-shaped JSON with a plausible list.
    expect(await listText()).toBe(before);
  });

  it('T-BATCH-005b: and the retry produces exactly one copy, not two', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });

    failServiceState = true;
    expect((await closeBatchRequest(batchId)).status).toBe(500);
    failServiceState = false;

    expect((await closeBatchRequest(batchId)).status).toBe(200);

    // The resumability half. An implementation that rolled back by *deleting*
    // rather than by never committing would leave the batch stranded, and one
    // that committed the first attempt's listings would double them here.
    expect(await testPrisma().title.count()).toBe(1);
    expect(await countListings()).toBe(1);
    expect(await testPrisma().batchChange.count({ where: { batchId } })).toBe(2);
  });

  it('T-BATCH-005c: the failed attempt leaves the batch closable, not stranded', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });

    failServiceState = true;
    expect((await closeBatchRequest(batchId)).status).toBe(500);
    failServiceState = false;

    const batch = await testPrisma().uploadBatch.findFirst({ where: { id: batchId } });
    expect(batch?.status).toBe('in-review');
    expect(batch?.completedAt).toBeNull();
  });
});

describe('T-FRESH-013 · US-022 AC-4 · abandoned and failed batches never update serviceState', () => {
  it('T-FRESH-013a: a discarded batch leaves the service date untouched', async () => {
    const batchId = await makeBatch({ status: 'draft' });

    expect((await authed(`/api/batches/${batchId}/discard`, { method: 'POST' })).status).toBe(200);

    // "Netflix updated today" after a batch the owner threw away is a lie the
    // owner cannot detect — the whole point of REQ-039 is that the date is a
    // FACT about the list, and discarding one changed no list.
    expect(await serviceStateFor('netflix')).toBeNull();
    expect(await testPrisma().serviceState.count()).toBe(0);
  });

  it('T-FRESH-013b: a failed extraction leaves the service date untouched', async () => {
    const batchId = await makeBatch({ status: 'extracting' });
    await testPrisma().uploadBatch.update({
      where: { id: batchId },
      data: { status: 'extraction-failed' },
    });

    expect(await serviceStateFor('netflix')).toBeNull();
    expect(await testPrisma().serviceState.count()).toBe(0);
  });

  it('T-FRESH-013c: a close that rolls back leaves the service date untouched', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });

    failServiceState = true;
    expect((await closeBatchRequest(batchId)).status).toBe(500);
    failServiceState = false;

    expect(await serviceStateFor('netflix')).toBeNull();
  });

  it('T-FRESH-013d: only a completed close writes it', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });

    expect((await closeBatchRequest(batchId)).status).toBe(200);

    expect(await serviceStateFor('netflix')).not.toBeNull();
    // The OTHER service must stay never-updated: a write keyed on the owner
    // rather than on (owner, service) would mark both.
    expect(await serviceStateFor('max')).toBeNull();
  });
});

describe('T-BATCH-011 · US-016 · reconciliation touches only the batch service', () => {
  it('T-BATCH-011a: closing a Netflix batch leaves an existing Max listing untouched', async () => {
    const titleId = await seedListing(DUNE, 'Dune', 'max');
    const maxBefore = await testPrisma().serviceListing.findFirst({ where: { service: 'max' } });

    const batchId = await makeBatch({ service: 'netflix' });
    await makeCandidate(batchId, { disposition: 'confirmed' });

    expect((await closeBatchRequest(batchId)).status).toBe(200);

    // One work, two services, one row each — and the Max row is the SAME row,
    // not a rewritten one. Product invariant 3: one batch close is scoped to
    // exactly one service.
    expect(await countListings('max')).toBe(1);
    expect(await countListings('netflix')).toBe(1);
    const maxAfter = await testPrisma().serviceListing.findFirst({ where: { service: 'max' } });
    expect(maxAfter).toEqual(maxBefore);
    expect(await testPrisma().title.count({ where: { id: titleId } })).toBe(1);
  });

  it('T-BATCH-011b: a full-update Netflix batch does not remove Max listings', async () => {
    // The dangerous case. Full-update reconciliation is the only path that
    // removes anything, and a scope bug here silently empties the other
    // service's list — the failure REQ-020 and product invariant 3 exist for.
    await seedListing(HEAT, 'Heat', 'max');

    const batchId = await makeBatch({ service: 'netflix', mode: 'full-update' });
    await makeCandidate(batchId, { disposition: 'confirmed' });

    expect((await closeBatchRequest(batchId)).status).toBe(200);

    expect(await countListings('max')).toBe(1);
    expect(
      await testPrisma().serviceListing.count({ where: { service: 'max', state: 'active' } }),
    ).toBe(1);
  });
});

describe('T-BATCH-012 · US-016 · mixed-service screenshots reconcile only the declared service', () => {
  it('T-BATCH-012a: every listing a close writes carries the batch service', async () => {
    // The batch declares Netflix. The candidates are a mix — one work that is
    // already on Max, one brand new — as a screenshot set taken across two apps
    // would produce. The DECLARED service decides, never the content.
    await seedListing(DUNE, 'Dune', 'max');

    const batchId = await makeBatch({ service: 'netflix' });
    await makeCandidate(batchId, { disposition: 'confirmed' });
    await makeCandidate(batchId, { workIdentity: HEAT, rawText: 'Heat', disposition: 'confirmed' });

    expect((await closeBatchRequest(batchId)).status).toBe(200);

    const written = await testPrisma().serviceListing.findMany({
      where: { createdByBatchId: batchId },
    });
    expect(written).toHaveLength(2);
    expect(new Set(written.map((l) => l.service))).toEqual(new Set(['netflix']));
    expect(await countListings('max')).toBe(1);
  });
});

describe('T-BATCH-014 · US-005 AC-3 · a close applies everything in one step', () => {
  it('T-BATCH-014a: additions and corrections are applied together', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });
    await makeCandidate(batchId, {
      workIdentity: HEAT,
      rawText: 'Heat',
      disposition: 'corrected',
      originalTmdbId: 27205,
    });

    expect((await closeBatchRequest(batchId)).status).toBe(200);

    const identities = (await testPrisma().title.findMany()).map((t) => t.workIdentity).sort();
    expect(identities).toEqual([DUNE, HEAT].sort());
    expect(await countListings('netflix')).toBe(2);
  });

  it('T-BATCH-014b: and either both land or neither does', async () => {
    const batchId = await makeBatch();
    await makeCandidate(batchId, { disposition: 'confirmed' });
    await makeCandidate(batchId, {
      workIdentity: HEAT,
      rawText: 'Heat',
      disposition: 'corrected',
      originalTmdbId: 27205,
    });

    failServiceState = true;
    expect((await closeBatchRequest(batchId)).status).toBe(500);
    failServiceState = false;

    // ⚠ The addition and the correction are separate loop iterations, so an
    // implementation that opened a transaction per candidate would leave the
    // first applied and the second not — and the owner would be told the whole
    // close failed.
    expect(await testPrisma().title.count()).toBe(0);
    expect(await countListings()).toBe(0);
  });
});
