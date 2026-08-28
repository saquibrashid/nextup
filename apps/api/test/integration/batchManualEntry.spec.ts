/**
 * TASK-067 — `POST /api/batches/:batchId/manual-entry` (`specs/api.md` §6.20,
 * US-006 AC-5). `T-AI-023`.
 *
 * ⚠ **THIS ROUTE IS THE ONLY WAY A TITLE THE READER NEVER SAW GETS ONTO THE
 * LIST.** An artwork-only tile carries no readable text at all, so there is no
 * candidate to confirm and no wrong match to correct — without this the owner's
 * only option is to accept that the title is missing. That is why the tests
 * below assert the entry reaches the REVIEW RESPONSE rather than merely that a
 * row was written: a candidate the review pass does not show cannot be applied
 * at close and is indistinguishable, from the owner's side, from the failure
 * this route exists to fix.
 *
 * ⚠ **The suppression gate is asserted on WORK IDENTITY** (REQ-071, product
 * invariant 1). Manual entry is the most direct back door there is — the owner
 * types the name of the thing they told the product to stop showing them — and
 * a gate keyed on anything row-shaped would let it straight through.
 *
 * Run against a real SQL Server and the real Express app, with TMDB served
 * from the committed recordings through `msw` (`specs/testing.md` §3.2).
 * Nothing reaches the internet.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetTmdbRateLimiterForTests } from '../../src/clients/tmdbClient.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { asOwnerId, createSuppression, type OwnerId } from '../../src/repository/ownerData.js';
import { tmdbMswServer, type ReplayOptions } from '../../../../tests/fixtures/msw/tmdb/index.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-manual-entry';
const ISSUER = 'https://sts.windows.net/tenant/';

/** The one work the recordings cover: `movie/438631` — Dune. */
const DUNE_TMDB_ID = 438631;
const DUNE_IDENTITY = `tmdb:movie:${String(DUNE_TMDB_ID)}`;
/** Any other id 404s from the fixture server, which is the TMDB-miss path. */
const UNRECORDED_TMDB_ID = 999_111;

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

interface ManualEntryBody {
  candidateId: string;
  resolvedWorkIdentity: string;
  disposition: string;
}

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

let server: Server;
let app: Express;
let origin: string;
let ownerId: OwnerId;
let msw: ReturnType<typeof tmdbMswServer> | undefined;

function startTmdb(options: ReplayOptions = {}): void {
  msw?.close();
  msw = tmdbMswServer(options);
  msw.listen({
    // Loopback has to pass through: this suite drives a REAL listening API on
    // an ephemeral port, so every `fetch` to it is an unhandled msw request.
    onUnhandledRequest: (request, print) => {
      const { hostname } = new URL(request.url);
      if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1') return;
      print.error();
    },
  });
}

const manualEntry = (batchId: string, body: unknown): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/manual-entry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [CLIENT_PRINCIPAL_HEADER]: principalHeader },
    body: JSON.stringify(body),
  });

const getReview = (batchId: string): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/review`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader },
  });

let batchSeq = 0;

async function makeBatch(status = 'in-review'): Promise<string> {
  const id = `batch-manual-${String(++batchSeq)}`;
  await testPrisma().uploadBatch.create({
    data: {
      id,
      ownerId,
      service: 'netflix',
      mode: 'append-only',
      status,
      lowYield: false,
      degradedExtraction: false,
      crossCheck: 'ok',
    },
  });
  return id;
}

let candidateSeq = 0;

/** A candidate already resolved to Dune, so the ALREADY_IN_BATCH gate has something to see. */
async function makeCandidate(batchId: string, disposition: string): Promise<string> {
  const id = `cand-manual-${String(++candidateSeq)}`;
  await testPrisma().extractionCandidate.create({
    data: {
      id,
      ownerId,
      batchId,
      rawText: 'Dune',
      inferredTitle: 'Dune',
      basis: 'both',
      ocrSupport: 'exact',
      provider: 'llm',
      normalisedText: 'dune',
      boxSource: 'llm',
      cleanupVerdict: 'title-candidate',
      resolvedWorkIdentity: DUNE_IDENTITY,
      reviewDisposition: disposition,
    },
  });
  return id;
}

const storedCandidates = async (batchId: string) =>
  testPrisma().extractionCandidate.findMany({ where: { batchId }, orderBy: { id: 'asc' } });

beforeEach(async () => {
  resetAllowListWarning();
  resetTmdbRateLimiterForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  // A key must be present or the client refuses before any request is made,
  // which would make every success case below vacuous.
  process.env['TMDB_API_KEY'] = 'test-key';
  testPrisma();
  await resetDatabase();
  startTmdb();

  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      resolve();
    });
  });

  const res = await fetch(`${origin}/api/me`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader },
  });
  ownerId = asOwnerId(((await res.json()) as { ownerId: string }).ownerId);
});

afterEach(async () => {
  msw?.close();
  msw = undefined;
  delete process.env['TMDB_API_KEY'];
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-AI-023 · POST /api/batches/:batchId/manual-entry', () => {
  it('T-AI-023a: adds an owner-supplied work to an open batch as a confirmed candidate', async () => {
    const batchId = await makeBatch();

    const res = await manualEntry(batchId, { tmdbId: DUNE_TMDB_ID, mediaType: 'movie' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ManualEntryBody;
    expect(body.resolvedWorkIdentity).toBe(DUNE_IDENTITY);
    // Confirmed by definition: the owner picked this work themselves, so there
    // is nothing left for them to decide. §6.20.
    expect(body.disposition).toBe('confirmed');

    const rows = await storedCandidates(batchId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(body.candidateId);
    expect(rows[0]?.reviewDisposition).toBe('confirmed');
    // The name comes off TMDB, never off the request (SD-05).
    expect(rows[0]?.rawText).toBe('Dune');
    expect(rows[0]?.correctedToTmdbId).toBe(DUNE_TMDB_ID);
    // No screenshot was read, so there is no evidence of one.
    expect(rows[0]?.boundingBoxes).toBeNull();
    expect(rows[0]?.ocrConfidence).toBeNull();
    expect(rows[0]?.basis).toBe('unknown');
    expect(rows[0]?.ocrSupport).toBe('not-checked');
  });

  it('T-AI-023b: the manual entry is IN THE REVIEW RESPONSE, not merely in the store', async () => {
    const batchId = await makeBatch();
    const created = (await (
      await manualEntry(batchId, { tmdbId: DUNE_TMDB_ID, mediaType: 'movie' })
    ).json()) as ManualEntryBody;

    const review = (await (await getReview(batchId)).json()) as {
      sections: {
        additions: {
          items: { candidateId: string; resolvedWorkIdentity: string; disposition: string }[];
        };
      };
    };
    const item = review.sections.additions.items.find((i) => i.candidateId === created.candidateId);
    expect(item?.resolvedWorkIdentity).toBe(DUNE_IDENTITY);
    expect(item?.disposition).toBe('confirmed');
  });

  it('T-AI-023c: refuses entry on a closed batch and writes nothing', async () => {
    const batchId = await makeBatch('applied');

    const res = await manualEntry(batchId, { tmdbId: DUNE_TMDB_ID, mediaType: 'movie' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('BATCH_NOT_IN_REVIEW');
    expect(await storedCandidates(batchId)).toHaveLength(0);
  });

  it('T-AI-023d: refuses a suppressed work — the back door REQ-071 closes', async () => {
    const batchId = await makeBatch();
    await createSuppression(ownerId, {
      id: `supp:${DUNE_IDENTITY}`,
      workIdentity: DUNE_IDENTITY,
      active: true,
      suppressedAt: new Date('2026-01-01T00:00:00.000Z'),
      displayName: 'Dune',
      displayReleaseYear: 2021,
      displayMediaType: 'movie',
      displayPosterPath: null,
    });

    const res = await manualEntry(batchId, { tmdbId: DUNE_TMDB_ID, mediaType: 'movie' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('WORK_SUPPRESSED');
    expect(body.error.details['workIdentity']).toBe(DUNE_IDENTITY);
    expect(await storedCandidates(batchId)).toHaveLength(0);
  });

  it('T-AI-023e: refuses a work already in this batch', async () => {
    const batchId = await makeBatch();
    const existing = await makeCandidate(batchId, 'pending');

    const res = await manualEntry(batchId, { tmdbId: DUNE_TMDB_ID, mediaType: 'movie' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('ALREADY_IN_BATCH');
    expect(body.error.details['candidateId']).toBe(existing);
    expect(await storedCandidates(batchId)).toHaveLength(1);
  });

  it('T-AI-023f: a DISCARDED candidate for the same work does not block the entry', async () => {
    // The ordinary path through an artwork-only tile: the owner discards the
    // mis-read row and adds the right work by hand. Blocking here would refuse
    // the only affordance that fixes it.
    const batchId = await makeBatch();
    await makeCandidate(batchId, 'discarded');

    const res = await manualEntry(batchId, { tmdbId: DUNE_TMDB_ID, mediaType: 'movie' });
    expect(res.status).toBe(201);
    expect(await storedCandidates(batchId)).toHaveLength(2);
  });

  it('T-AI-023g: refuses a work TMDB does not have, rather than writing a blank row', async () => {
    const batchId = await makeBatch();

    const res = await manualEntry(batchId, { tmdbId: UNRECORDED_TMDB_ID, mediaType: 'movie' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('TMDB_WORK_NOT_FOUND');
    expect(await storedCandidates(batchId)).toHaveLength(0);
  });

  it('T-AI-023h: a TMDB outage is a 502 and writes nothing', async () => {
    const batchId = await makeBatch();
    startTmdb({ script: ['network-error', 'network-error', 'network-error'] });

    const res = await manualEntry(batchId, { tmdbId: DUNE_TMDB_ID, mediaType: 'movie' });
    expect(res.status).toBe(502);
    expect(((await res.json()) as ErrorBody).error.code).toBe('TMDB_UNAVAILABLE');
    expect(await storedCandidates(batchId)).toHaveLength(0);
  });

  it('T-AI-023i: refuses a malformed body before it reaches TMDB', async () => {
    const batchId = await makeBatch();

    const res = await manualEntry(batchId, { tmdbId: 'dune', mediaType: 'movie' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    expect(await storedCandidates(batchId)).toHaveLength(0);
  });
});
