/**
 * #396 (US-066, PRD `A57`, ADR-0010 Rev 6) — an AUTO-DETECT capture against a
 * REAL SQL Server: the review-time service lookup, the owner's override, and
 * the one-transaction close.
 *
 * ⚠ `T-AUTO-013a` IS THE INVARIANT-2/AC-7 ASSERTION: nothing lands on any
 * list until the owner closes. Loading the review looks services up and
 * writes ONLY the candidate's lookup columns.
 *
 * ⚠ `T-AUTO-015a` IS THE REQ-039 DECISION: an auto-detect close writes no
 * `ServiceState`. The freshness strip's "Netflix updated today" means the
 * owner captured Netflix's saved list; an auto-detect capture did not.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

/** tmdbId → the TMDB answer; `'throw'` simulates a timeout. */
const answers = new Map<number, { flatrate: string[]; rentOrBuy: string[] } | null | 'throw'>();
const providerCalls: number[] = [];

vi.mock('../../src/clients/tmdbClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/clients/tmdbClient.js')>();
  class StubTmdbClient extends actual.TmdbClient {
    override getWatchOffers(
      _mediaType: 'movie' | 'tv',
      tmdbId: number,
    ): Promise<{ flatrate: string[]; rentOrBuy: string[] } | null> {
      providerCalls.push(tmdbId);
      const answer = answers.get(tmdbId);
      if (answer === 'throw') return Promise.reject(new Error('TMDB timed out'));
      return Promise.resolve(answer ?? null);
    }
    override getReleaseFacts(): Promise<null> {
      return Promise.resolve(null);
    }
  }
  return { ...actual, TmdbClient: StubTmdbClient };
});

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-auto-detect';
const principalHeader = Buffer.from(
  JSON.stringify({
    claims: [
      { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
      { typ: OID, val: SUBJECT },
      { typ: 'preferred_username', val: 'owner@example.com' },
    ],
  }),
  'utf8',
).toString('base64');

const DUNE = 'tmdb:movie:438631';
const HEAT = 'tmdb:movie:949';
const ALIEN = 'tmdb:movie:348';
const BRAZIL = 'tmdb:movie:68';

let server: Server;
let app: Express;
let origin: string;
let ownerId: string;

type Json = Record<string, unknown>;

const call = async (
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Json }> => {
  const res = await fetch(`${origin}/api${path}`, {
    method,
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Json };
};

interface Candidate {
  candidateId: string;
  serviceLookup?: { status: string; services: string[]; lookedUpAt: string } | null;
  destination?: Json | null;
  effectiveDestination?: { kind: string; services?: string[] } | null;
}

const reviewCandidates = (body: Json): Candidate[] => {
  const sections = body['sections'] as Record<string, { items: Candidate[] }>;
  return Object.values(sections).flatMap((section) => section.items ?? []);
};

const candidateIn = (body: Json, id: string): Candidate => {
  const found = reviewCandidates(body).find((candidate) => candidate.candidateId === id);
  if (found === undefined) throw new Error(`candidate ${id} not in review`);
  return found;
};

/* ── fixtures ─────────────────────────────────────────────────────────── */

let batchSeq = 0;

async function makeAutoBatch(): Promise<string> {
  const id = `batch-auto-${String(++batchSeq)}`;
  await testPrisma().uploadBatch.create({
    data: {
      captureTracking: 'tracked',
      id,
      ownerId,
      service: null,
      discoverySource: null,
      autoDetect: true,
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

async function makeCandidate(
  batchId: string,
  workIdentity: string,
  name: string,
  disposition = 'confirmed',
): Promise<string> {
  const id = `cand-auto-${String(++candidateSeq)}`;
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

/** An existing active title + listing on `service`. */
async function seedListing(workIdentity: string, name: string, service: string): Promise<string> {
  const titleId = `title-auto-${workIdentity}`;
  await testPrisma().uploadBatch.upsert({
    where: { id: 'batch-auto-seed' },
    update: {},
    create: {
      id: 'batch-auto-seed',
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
      listingId: `listing-auto-${workIdentity}`,
      ownerId,
      titleId,
      service,
      state: 'active',
      dateAdded: new Date('2026-01-04'),
      createdByBatchId: 'batch-auto-seed',
    },
  });
  return titleId;
}

async function listCounts(): Promise<{ titles: number; listings: number; intents: number }> {
  return {
    titles: await testPrisma().title.count({ where: { ownerId } }),
    listings: await testPrisma().serviceListing.count({ where: { ownerId } }),
    intents: await testPrisma().watchIntent.count({ where: { ownerId } }),
  };
}

/* ── lifecycle ────────────────────────────────────────────────────────── */

beforeEach(async () => {
  await resetDatabase();
  resetAllowListWarning();
  batchSeq = 0;
  candidateSeq = 0;
  answers.clear();
  providerCalls.length = 0;
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  process.env['TMDB_API_KEY'] = '';
  app = createApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  const res = await fetch(`${origin}/api/me`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader },
  });
  ownerId = ((await res.json()) as { ownerId: string }).ownerId;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

afterAll(async () => {
  await closeTestPrisma();
});

/* ── tests ────────────────────────────────────────────────────────────── */

describe('T-AUTO-012 · US-066 AC-1/AC-2 · creating an auto-detect batch', () => {
  it('T-AUTO-012a: POST source auto stores neither source column, flags auto_detect, and is append-only', async () => {
    const created = await call('POST', '/batches', { source: 'auto', mode: 'append-only' });
    expect(created.status).toBe(201);
    const batchId = created.body['batchId'] as string;
    const row = await testPrisma().uploadBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(row).toMatchObject({ service: null, discoverySource: null, autoDetect: true });
    expect(row.mode).toBe('append-only');

    const detail = await call('GET', `/batches/${batchId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ service: null, autoDetect: true });
  });

  it('T-AUTO-012b: the store refuses an auto-detect full update even past the API (second line)', async () => {
    await expect(
      testPrisma().uploadBatch.create({
        data: {
          id: 'batch-auto-forged',
          ownerId,
          service: null,
          discoverySource: null,
          autoDetect: true,
          mode: 'full-update',
          status: 'in-review',
          lowYield: false,
          degradedExtraction: false,
        },
      }),
    ).rejects.toThrow(/ck_batch_auto_append_only/);
    // …and a batch naming a service AND auto is refused by ck_batch_source_kind.
    await expect(
      testPrisma().uploadBatch.create({
        data: {
          id: 'batch-auto-forged-2',
          ownerId,
          service: 'netflix',
          discoverySource: null,
          autoDetect: true,
          mode: 'append-only',
          status: 'in-review',
          lowYield: false,
          degradedExtraction: false,
        },
      }),
    ).rejects.toThrow(/ck_batch_source_kind/);
  });
});

describe('T-AUTO-013 · US-066 AC-3/AC-4/AC-5/AC-7 · the lookup runs at review, before commit', () => {
  it('T-AUTO-013a: one match, several matches, none and a failure — proposed, labelled, nothing landed', async () => {
    answers.set(438631, { flatrate: ['Netflix'], rentOrBuy: [] });
    answers.set(949, { flatrate: ['Max', 'Netflix'], rentOrBuy: ['Apple TV'] });
    answers.set(348, { flatrate: ['Some Other Service'], rentOrBuy: ['Apple TV'] });
    answers.set(68, 'throw');
    const batchId = await makeAutoBatch();
    const dune = await makeCandidate(batchId, DUNE, 'Dune');
    const heat = await makeCandidate(batchId, HEAT, 'Heat');
    const alien = await makeCandidate(batchId, ALIEN, 'Alien');
    const brazil = await makeCandidate(batchId, BRAZIL, 'Brazil');
    const before = await listCounts();

    const review = await call('GET', `/batches/${batchId}/review`);
    expect(review.status).toBe(200);
    expect(review.body['autoDetect']).toBe(true);
    expect(review.body['service']).toBeNull();

    expect(candidateIn(review.body, dune).serviceLookup).toMatchObject({
      status: 'found',
      services: ['netflix'],
    });
    expect(candidateIn(review.body, dune).effectiveDestination).toEqual({
      kind: 'services',
      services: ['netflix'],
    });
    // AC-4: EVERY matching service is pre-selected, one badge each.
    expect(candidateIn(review.body, heat).effectiveDestination).toEqual({
      kind: 'services',
      services: ['netflix', 'max'],
    });
    // AC-5: on none of the owner's services → proposed for Waiting to stream.
    expect(candidateIn(review.body, alien).serviceLookup?.status).toBe('none');
    expect(candidateIn(review.body, alien).effectiveDestination).toEqual({ kind: 'waiting' });
    // AC-3: a failure never blocks review; it proposes nothing.
    expect(candidateIn(review.body, brazil).serviceLookup?.status).toBe('failed');
    expect(candidateIn(review.body, brazil).effectiveDestination).toBeNull();

    // Invariant 2 / AC-7: the lookup wrote no list state.
    expect(await listCounts()).toEqual(before);

    // A second load re-uses stored answers: no further TMDB calls.
    const calls = providerCalls.length;
    expect((await call('GET', `/batches/${batchId}/review`)).status).toBe(200);
    expect(providerCalls).toHaveLength(calls);
  });

  it('T-AUTO-013b: "Look up again" retries only the failed lookup, on the owner request', async () => {
    answers.set(438631, { flatrate: ['Netflix'], rentOrBuy: [] });
    answers.set(68, 'throw');
    const batchId = await makeAutoBatch();
    await makeCandidate(batchId, DUNE, 'Dune');
    const brazil = await makeCandidate(batchId, BRAZIL, 'Brazil');
    expect((await call('GET', `/batches/${batchId}/review`)).status).toBe(200);

    answers.set(68, { flatrate: ['Peacock Premium'], rentOrBuy: [] });
    providerCalls.length = 0;
    const retried = await call('POST', `/batches/${batchId}/service-lookup`, {});
    expect(retried.status).toBe(200);
    expect(providerCalls).toEqual([68]);

    const review = await call('GET', `/batches/${batchId}/review`);
    expect(candidateIn(review.body, brazil).effectiveDestination).toEqual({
      kind: 'services',
      services: ['peacock'],
    });
  });

  it('T-AUTO-013c: the lookup endpoints refuse a batch whose service was named', async () => {
    const named = await call('POST', '/batches', { service: 'netflix', mode: 'append-only' });
    const batchId = named.body['batchId'] as string;
    await testPrisma().uploadBatch.update({
      where: { id: batchId },
      data: { status: 'in-review' },
    });
    const candidateId = await makeCandidate(batchId, DUNE, 'Dune');
    const lookup = await call('POST', `/batches/${batchId}/service-lookup`, {});
    expect(lookup.status).toBe(409);
    expect((lookup.body['error'] as Json)['code']).toBe('BATCH_NOT_AUTO_DETECT');
    const patched = await call(
      'PATCH',
      `/batches/${batchId}/candidates/${candidateId}/destination`,
      { kind: 'waiting' },
    );
    expect(patched.status).toBe(409);
    expect((patched.body['error'] as Json)['code']).toBe('BATCH_NOT_AUTO_DETECT');
  });
});

describe('T-AUTO-014 · US-066 AC-4/AC-5 · the owner overrides the proposal', () => {
  it('T-AUTO-014a: untick a service, route to Waiting, pick by hand, and reset to the proposal', async () => {
    answers.set(949, { flatrate: ['Max', 'Netflix'], rentOrBuy: [] });
    answers.set(68, 'throw');
    const batchId = await makeAutoBatch();
    const heat = await makeCandidate(batchId, HEAT, 'Heat');
    const brazil = await makeCandidate(batchId, BRAZIL, 'Brazil');
    expect((await call('GET', `/batches/${batchId}/review`)).status).toBe(200);
    const path = (id: string): string => `/batches/${batchId}/candidates/${id}/destination`;

    const untick = await call('PATCH', path(heat), { kind: 'services', services: ['max'] });
    expect(untick.status).toBe(200);
    expect(untick.body['effectiveDestination']).toEqual({ kind: 'services', services: ['max'] });

    const toWaiting = await call('PATCH', path(heat), { kind: 'waiting' });
    expect(toWaiting.body['effectiveDestination']).toEqual({ kind: 'waiting' });

    // A failed lookup is picked by hand (AC-3).
    const manual = await call('PATCH', path(brazil), { kind: 'services', services: ['starz'] });
    expect(manual.body['effectiveDestination']).toEqual({ kind: 'services', services: ['starz'] });

    const reset = await call('PATCH', path(heat), { kind: null });
    expect(reset.body['destination']).toBeNull();
    expect(reset.body['effectiveDestination']).toEqual({
      kind: 'services',
      services: ['netflix', 'max'],
    });

    // "No services" is not a destination, and an unknown service is refused.
    expect((await call('PATCH', path(heat), { kind: 'services', services: [] })).status).toBe(400);
    expect(
      (await call('PATCH', path(heat), { kind: 'services', services: ['fandango-at-home'] }))
        .status,
    ).toBe(400);
    expect((await call('PATCH', path('cand-nope'), { kind: 'waiting' })).status).toBe(404);
  });
});

describe('T-AUTO-015 · US-066 AC-6/AC-8/AC-9 · the close is one transaction', () => {
  it('T-AUTO-015a: listings per service, Waiting intents, availability stored, and NO ServiceState', async () => {
    answers.set(438631, { flatrate: ['Netflix'], rentOrBuy: [] });
    answers.set(949, { flatrate: ['Max', 'Netflix'], rentOrBuy: ['Apple TV'] });
    answers.set(348, { flatrate: [], rentOrBuy: ['Apple TV'] });
    const batchId = await makeAutoBatch();
    await makeCandidate(batchId, DUNE, 'Dune');
    await makeCandidate(batchId, HEAT, 'Heat');
    await makeCandidate(batchId, ALIEN, 'Alien');
    expect((await call('GET', `/batches/${batchId}/review`)).status).toBe(200);

    const closed = await call('POST', `/batches/${batchId}/close`, {});
    expect(closed.status).toBe(200);
    expect(closed.body['serviceState']).toBeNull();
    expect(closed.body['autoDetect']).toMatchObject({ titlesListed: 2, intentsCreated: 1 });
    // Routed something to Waiting → undo is not offered (`waiting-routed`).
    expect(closed.body['undoable']).toBe(false);

    const listings = await testPrisma().serviceListing.findMany({
      where: { ownerId },
      include: { title: true },
      orderBy: [{ service: 'asc' }],
    });
    expect(listings.map((row) => `${row.title.workIdentity}@${row.service}`).sort()).toEqual(
      [`${DUNE}@netflix`, `${HEAT}@max`, `${HEAT}@netflix`].sort(),
    );
    for (const row of listings) expect(row.createdByBatchId).toBe(batchId);

    const intent = await testPrisma().watchIntent.findFirstOrThrow({
      where: { workIdentity: ALIEN },
    });
    expect(intent).toMatchObject({
      state: 'waiting',
      discoverySource: 'search',
      sourceBatchId: null,
    });

    // The lookup is stored as the Library's availability answer (#410).
    const heatTitle = await testPrisma().title.findFirstOrThrow({ where: { workIdentity: HEAT } });
    expect(heatTitle.availabilityCheckedAt).not.toBeNull();
    expect(JSON.parse(heatTitle.availableOn ?? 'null')).toEqual(['Max', 'Netflix']);

    // ⚠ REQ-039: no service's saved list was refreshed.
    expect(await testPrisma().serviceState.count({ where: { ownerId } })).toBe(0);
    const freshness = await call('GET', '/service-state');
    expect(freshness.status).toBe(200);
    expect(JSON.stringify(freshness.body)).not.toContain(batchId);

    // An undo is refused, and says why.
    const undo = await call('POST', `/batches/${batchId}/undo`, {});
    expect(undo.status).toBe(409);
    expect(((undo.body['error'] as Json)['details'] as Json)['reason']).toBe('waiting-routed');
  });

  it('T-AUTO-015b: an existing listing on the same service is a no-op; a new service adds a badge', async () => {
    answers.set(949, { flatrate: ['Max', 'Netflix'], rentOrBuy: [] });
    const heatTitle = await seedListing(HEAT, 'Heat', 'netflix');
    // Max is one of the owner's services because another title is listed there.
    await seedListing(BRAZIL, 'Brazil', 'max');
    const batchId = await makeAutoBatch();
    await makeCandidate(batchId, HEAT, 'Heat');
    expect((await call('GET', `/batches/${batchId}/review`)).status).toBe(200);

    const closed = await call('POST', `/batches/${batchId}/close`, {});
    expect(closed.status).toBe(200);
    expect(closed.body['autoDetect']).toMatchObject({ alreadyOnService: 1, intentsCreated: 0 });
    expect(closed.body['undoable']).toBe(true);

    const listings = await testPrisma().serviceListing.findMany({ where: { titleId: heatTitle } });
    expect(listings.map((row) => row.service).sort()).toEqual(['max', 'netflix']);
    // REQ-030: the existing listing's date is untouched.
    const netflix = listings.find((row) => row.service === 'netflix');
    expect(netflix?.dateAdded.toISOString().slice(0, 10)).toBe('2026-01-04');
    expect(await testPrisma().title.count({ where: { ownerId, workIdentity: HEAT } })).toBe(1);
  });

  it('T-AUTO-015c: a suppressed work is never listed or sent to Waiting (keyed on work identity)', async () => {
    answers.set(949, { flatrate: ['Netflix'], rentOrBuy: [] });
    answers.set(348, { flatrate: [], rentOrBuy: [] });
    await testPrisma().suppression.create({
      data: { id: 'sup-heat', ownerId, workIdentity: HEAT, active: true, displayName: 'Heat' },
    });
    await testPrisma().suppression.create({
      data: { id: 'sup-alien', ownerId, workIdentity: ALIEN, active: true, displayName: 'Alien' },
    });
    const batchId = await makeAutoBatch();
    await makeCandidate(batchId, HEAT, 'Heat');
    await makeCandidate(batchId, ALIEN, 'Alien');
    await call('GET', `/batches/${batchId}/review`);

    const closed = await call('POST', `/batches/${batchId}/close`, {});
    expect(closed.status).toBe(200);
    expect(await testPrisma().serviceListing.count({ where: { ownerId } })).toBe(0);
    expect(await testPrisma().watchIntent.count({ where: { ownerId } })).toBe(0);
  });

  it('T-AUTO-015d: a title with no destination refuses the WHOLE close; picking one releases it', async () => {
    answers.set(438631, { flatrate: ['Netflix'], rentOrBuy: [] });
    answers.set(68, 'throw');
    const batchId = await makeAutoBatch();
    await makeCandidate(batchId, DUNE, 'Dune');
    const brazil = await makeCandidate(batchId, BRAZIL, 'Brazil');
    await call('GET', `/batches/${batchId}/review`);
    const before = await listCounts();

    const refused = await call('POST', `/batches/${batchId}/close`, {});
    expect(refused.status).toBe(409);
    const error = refused.body['error'] as Json;
    expect(error['code']).toBe('AUTO_DESTINATION_REQUIRED');
    expect((error['details'] as Json)['candidateIds']).toEqual([brazil]);
    // Nothing landed — not even Dune, whose destination was known.
    expect(await listCounts()).toEqual(before);
    expect(
      (await testPrisma().uploadBatch.findUniqueOrThrow({ where: { id: batchId } })).status,
    ).toBe('in-review');

    await call('PATCH', `/batches/${batchId}/candidates/${brazil}/destination`, {
      kind: 'waiting',
    });
    const closed = await call('POST', `/batches/${batchId}/close`, {});
    expect(closed.status).toBe(200);
    expect(closed.body['autoDetect']).toMatchObject({ titlesListed: 1, intentsCreated: 1 });
  });

  it('T-AUTO-015e: a discarded title needs no destination and lands nowhere', async () => {
    answers.set(68, 'throw');
    const batchId = await makeAutoBatch();
    await makeCandidate(batchId, BRAZIL, 'Brazil', 'discarded');
    await call('GET', `/batches/${batchId}/review`);
    expect(providerCalls).toEqual([]);
    const closed = await call('POST', `/batches/${batchId}/close`, {});
    expect(closed.status).toBe(200);
    expect(await listCounts()).toMatchObject({ listings: 0, intents: 0 });
    expect(closed.body['undoable']).toBe(true);
  });

  it('T-AUTO-015f: a services-only auto close undoes cleanly and still writes no ServiceState', async () => {
    answers.set(438631, { flatrate: ['Netflix'], rentOrBuy: [] });
    const batchId = await makeAutoBatch();
    await makeCandidate(batchId, DUNE, 'Dune');
    await call('GET', `/batches/${batchId}/review`);
    const closed = await call('POST', `/batches/${batchId}/close`, {});
    expect(closed.status).toBe(200);
    expect(closed.body['undoable']).toBe(true);
    expect(await testPrisma().serviceListing.count({ where: { ownerId, state: 'active' } })).toBe(
      1,
    );

    const undo = await call('POST', `/batches/${batchId}/undo`, {});
    expect(undo.status).toBe(200);
    // Its close wrote no ServiceState, so there is none to revert.
    expect(undo.body['serviceState']).toBeNull();
    expect(await testPrisma().serviceListing.count({ where: { ownerId, state: 'active' } })).toBe(
      0,
    );
    expect(await testPrisma().serviceState.count({ where: { ownerId } })).toBe(0);
  });
});
