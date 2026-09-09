/**
 * TASK-185 — closing a DISCOVERY batch (US-040, ADR-0010).
 *
 * `T-WAIT-002` (reconciliation never runs) and `T-WAIT-003` (no
 * `ServiceListing`, and the combined list is unchanged).
 *
 * Integration level because both claims are about what the DATABASE does and
 * does not contain afterwards. A unit test with a mocked store would prove
 * that `closeDiscoveryBatch` does not CALL the removal code, which is a
 * statement about this build's shape; these prove the owner's list did not
 * move, which is the statement US-040 actually makes.
 *
 * ⚠ `T-WAIT-002b` IS THE POINT OF THE FILE. Without it, `T-WAIT-002a` passes
 * just as happily against a build where reconciliation is simply broken
 * everywhere — including for the Netflix full-update captures the whole
 * product is built around.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const ISSUER = 'https://sts.windows.net/tenant/';

const principalHeader = Buffer.from(
  JSON.stringify({
    claims: [
      { typ: 'iss', val: ISSUER },
      { typ: OID, val: 'oid-owner-discovery' },
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
  summary: {
    titlesCreated: number;
    listingsCreated: number;
    listingsRemoved: number;
    removalGroupId: string | null;
  };
  serviceState: { service: string } | null;
  discovery?: { discoverySource: string; intentsCreated: number; alreadyListed: number };
}

const authed = { [CLIENT_PRINCIPAL_HEADER]: principalHeader };

const closeBatchRequest = (batchId: string, body: unknown = {}): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/close`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authed },
    body: JSON.stringify(body),
  });

/* ── fixtures ─────────────────────────────────────────────────────────── */

let batchSeq = 0;

/** A batch on a SERVICE. `service` and `discoverySource` are exclusive. */
async function makeServiceBatch(mode: string): Promise<string> {
  const id = `batch-disc-${++batchSeq}`;
  await testPrisma().uploadBatch.create({
    data: {
      id,
      ownerId,
      service: 'netflix',
      discoverySource: null,
      mode,
      status: 'in-review',
      lowYield: false,
      degradedExtraction: false,
      crossCheck: 'ok',
    },
  });
  return id;
}

/** A batch on a DISCOVERY SOURCE — no service, and append-only by rule. */
async function makeDiscoveryBatch(mode = 'append-only'): Promise<string> {
  const id = `batch-disc-${++batchSeq}`;
  await testPrisma().uploadBatch.create({
    data: {
      id,
      ownerId,
      service: null,
      discoverySource: 'fandango-at-home',
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

async function makeCandidate(
  batchId: string,
  workIdentity: string,
  name: string,
  disposition = 'confirmed',
): Promise<string> {
  const id = `cand-disc-${++candidateSeq}`;
  await testPrisma().extractionCandidate.create({
    data: {
      id,
      ownerId,
      batchId,
      rawText: name,
      inferredTitle: name,
      basis: 'both',
      ocrSupport: 'exact',
      provider: 'llm',
      normalisedText: name.toLowerCase(),
      boxSource: 'llm',
      cleanupVerdict: 'title-candidate',
      resolvedWorkIdentity: workIdentity,
      reviewDisposition: disposition,
      collapsedIntoCandidateId: null,
      matchCandidates: JSON.stringify([
        {
          tmdbId: Number(workIdentity.split(':')[2]),
          mediaType: 'movie',
          name,
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

/** An existing active title + listing — a work really in the combined list. */
async function seedListing(workIdentity: string, name: string, service = 'netflix') {
  const titleId = `title-disc-${++titleSeq}`;
  await testPrisma().uploadBatch.upsert({
    where: { id: 'batch-disc-seed' },
    update: {},
    create: {
      id: 'batch-disc-seed',
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
      sortDateAdded: new Date('2026-01-04'),
    },
  });
  await testPrisma().serviceListing.create({
    data: {
      listingId: `listing-disc-${titleSeq}`,
      ownerId,
      titleId,
      service,
      state: 'active',
      dateAdded: new Date('2026-01-04'),
      createdByBatchId: 'batch-disc-seed',
    },
  });
  return titleId;
}

/** The combined list exactly as the owner sees it, as a comparable string. */
async function combinedList(): Promise<string> {
  const res = await fetch(`${origin}/api/titles`, { headers: authed });
  expect(res.status).toBe(200);
  return JSON.stringify(await res.json());
}

/* ── lifecycle ────────────────────────────────────────────────────────── */

beforeEach(async () => {
  await resetDatabase();
  resetAllowListWarning();
  batchSeq = 0;
  candidateSeq = 0;
  titleSeq = 0;
  process.env['OWNER_ALLOW_LIST'] = 'owner@example.com';
  app = createApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const res = await fetch(`${origin}/api/me`, { headers: authed });
  ownerId = ((await res.json()) as { ownerId: string }).ownerId;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

afterAll(async () => {
  await closeTestPrisma();
});

/* ── tests ────────────────────────────────────────────────────────────── */

describe('T-WAIT-002 · US-040 AC-4 · reconciliation never runs for a discovery batch', () => {
  it('T-WAIT-002a · a second capture omitting a previously-seen title proposes no removal', async () => {
    const first = await makeDiscoveryBatch();
    await makeCandidate(first, DUNE, 'Dune');
    await makeCandidate(first, HEAT, 'Heat');
    expect((await closeBatchRequest(first)).status).toBe(200);
    expect(await testPrisma().watchIntent.count({ where: { state: 'waiting' } })).toBe(2);

    // The second capture of the same rotating page shows only Heat. On a saved
    // list that omission would mean "removed"; on a storefront it means the
    // editorial feed moved on, which is not a fact about the owner at all.
    const second = await makeDiscoveryBatch();
    await makeCandidate(second, HEAT, 'Heat');
    const res = await closeBatchRequest(second);
    expect(res.status).toBe(200);

    const body = (await res.json()) as CloseBody;
    expect(body.summary.listingsRemoved).toBe(0);
    // ⚠ `null`, not a zero-member group. A group is the record of a removal
    // section the owner was SHOWN, and they were shown none.
    expect(body.summary.removalGroupId).toBeNull();
    expect(await testPrisma().removalGroup.count({ where: {} })).toBe(0);

    // Dune is still waiting — untouched, not satisfied and not withdrawn.
    const dune = await testPrisma().watchIntent.findFirst({ where: { workIdentity: DUNE } });
    expect(dune?.state).toBe('waiting');
    // …and no second intent was created for Heat (`ux_intent_owner_title_waiting`).
    expect(await testPrisma().watchIntent.count({ where: { workIdentity: HEAT } })).toBe(1);
  });

  it('T-WAIT-002b · THE DISCRIMINATING CASE — the same omission in a Netflix full-update DOES propose a removal', async () => {
    // Identical shape to (a): a work is present, a later capture omits it. The
    // ONLY difference is that this batch is a saved list, where absence is a
    // real fact about the owner's account.
    await seedListing(DUNE, 'Dune');
    await seedListing(HEAT, 'Heat');

    const batch = await makeServiceBatch('full-update');
    await makeCandidate(batch, HEAT, 'Heat');

    const res = await closeBatchRequest(batch, { confirmRemovals: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CloseBody;

    expect(body.summary.listingsRemoved).toBe(1);
    expect(body.summary.removalGroupId).not.toBeNull();
    const removed = await testPrisma().serviceListing.findFirst({
      where: { state: 'removed' },
      select: { titleId: true },
    });
    const dune = await testPrisma().title.findFirst({ where: { workIdentity: DUNE } });
    expect(removed?.titleId).toBe(dune?.id);
  });

  it('T-WAIT-002c · the database itself refuses a full-update discovery batch', async () => {
    // Defence in depth beneath the API refusal (`T-WAIT-001b`).
    // `ck_batch_discovery_append_only` is what makes "reconciliation never
    // runs" true even for a caller that reached the store directly.
    await expect(makeDiscoveryBatch('full-update')).rejects.toThrow();
  });
});

describe('T-WAIT-003 · US-040 AC-3 · a closed discovery batch changes no list state', () => {
  it('T-WAIT-003a · no ServiceListing is created and the combined list is unchanged', async () => {
    await seedListing(HEAT, 'Heat');
    const before = await combinedList();
    const listingsBefore = await testPrisma().serviceListing.count({ where: {} });

    const batch = await makeDiscoveryBatch();
    await makeCandidate(batch, DUNE, 'Dune');
    const res = await closeBatchRequest(batch);
    expect(res.status).toBe(200);

    const body = (await res.json()) as CloseBody;
    expect(body.summary.listingsCreated).toBe(0);
    expect(body.discovery?.intentsCreated).toBe(1);
    // A discovery capture updated no service, so it reports no service state
    // — REQ-039's freshness strip must not claim Netflix was refreshed.
    expect(body.serviceState).toBeNull();
    expect(await testPrisma().serviceState.count({ where: {} })).toBe(0);

    expect(await testPrisma().serviceListing.count({ where: {} })).toBe(listingsBefore);
    // ⚠ The WHOLE rendered list, not a count. Membership, ordering and every
    // badge are compared at once, which is the only way to catch a waiting
    // work that leaked into the list in some position other than the end.
    expect(await combinedList()).toBe(before);
  });

  it('T-WAIT-003b · no service badge count changes', async () => {
    await seedListing(HEAT, 'Heat');
    const badgesBefore = await testPrisma().serviceListing.groupBy({
      by: ['service'],
      where: { state: 'active' },
      _count: { _all: true },
    });

    const batch = await makeDiscoveryBatch();
    await makeCandidate(batch, DUNE, 'Dune');
    expect((await closeBatchRequest(batch)).status).toBe(200);

    const badgesAfter = await testPrisma().serviceListing.groupBy({
      by: ['service'],
      where: { state: 'active' },
      _count: { _all: true },
    });
    expect(badgesAfter).toEqual(badgesBefore);
    // The waiting work exists — this is not passing because nothing happened.
    expect(await testPrisma().watchIntent.count({ where: { workIdentity: DUNE } })).toBe(1);
  });

  it('T-WAIT-003c · a work already in the combined list produces no intent (US-040 AC-5)', async () => {
    await seedListing(DUNE, 'Dune');

    const batch = await makeDiscoveryBatch();
    await makeCandidate(batch, DUNE, 'Dune');
    const res = await closeBatchRequest(batch);
    expect(res.status).toBe(200);

    const body = (await res.json()) as CloseBody;
    expect(body.discovery?.intentsCreated).toBe(0);
    // Reported, not silently dropped.
    expect(body.discovery?.alreadyListed).toBe(1);
    expect(await testPrisma().watchIntent.count({ where: {} })).toBe(0);
  });

  it('T-WAIT-003d · a waiting work is invisible to BOTH the combined list and the removed log', async () => {
    const batch = await makeDiscoveryBatch();
    await makeCandidate(batch, DUNE, 'Dune');
    expect((await closeBatchRequest(batch)).status).toBe(200);

    // Its title is stored `removed` with no listing, which is what keeps it
    // out of `listActiveTitles`. The removed view reads `service_listing`, so
    // having no listing keeps it out of that too — the work is waiting, and
    // "waiting" is neither "on my list" nor "I removed it".
    const list = JSON.parse(await combinedList()) as { titles?: unknown[] };
    expect(JSON.stringify(list)).not.toContain(DUNE);

    const removed = await fetch(`${origin}/api/removed`, { headers: authed });
    expect(removed.status).toBe(200);
    expect(JSON.stringify(await removed.json())).not.toContain(DUNE);
  });
});
