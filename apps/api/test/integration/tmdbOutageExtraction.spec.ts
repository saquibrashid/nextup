/**
 * TASK-192 — a LIVE TMDB outage records itself, and the owner is told.
 *
 * `specs/testing.md`:
 *   `T-AI-017` — TMDB unreachable ⇒ every candidate `unmatched:<hash>`, the
 *                batch still reaches `in-review`, and §4.3's banner renders
 *
 * ⚠ **THIS IS THE ONE LINK THE OTHER `T-AI-017` CASES DO NOT ASSERT.**
 * TASK-190 proved the outage is latched, and TASK-191 proved a *recorded*
 * outage reaches the review pass — but every one of those cases hands the
 * recorded flag to the code under test. Nothing showed that a real 503
 * writes the flag in the first place, which is exactly the shape of gap that
 * left stage 3 uncalled for four tasks: each half proven, the join proven by
 * nobody.
 *
 * ⚠ **NOTHING IN THE CHAIN IS STUBBED BETWEEN THE 503 AND THE BANNER.** The
 * real `TmdbClient` builds the real request, `msw` answers 503 at the HTTP
 * layer, the real stage-3 orchestrator latches it, the real repository writes
 * `extractionStats` through the `ISJSON`-CHECKed column, and the real review
 * route reads it back. Stubbing any middle step would re-prove what
 * `T-AI-017e`–`t` already prove and assert nothing new.
 *
 * The extractor IS a stub, and deliberately so: this test is about what
 * happens *after* the read, and CI configures no vision reader at all (see
 * `beginExtraction`, `T-BATCH-019a`). Standing up a fake reader is what makes
 * the rest of the chain real.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExtractedTextItem, ExtractionResult, TitleExtractor } from '@nextup/domain';

import { UNAVAILABLE, tmdbMswServer } from '../../../../tests/fixtures/msw/tmdb/index.js';
import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { TmdbClient } from '../../src/clients/tmdbClient.js';
import { startExtraction } from '../../src/jobs/startExtraction.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import {
  asOwnerId,
  createUploadBatch,
  createUploadedImage,
  findUploadBatch,
  type OwnerId,
} from '../../src/repository/ownerData.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-tmdb-outage';
const ISSUER = 'https://sts.windows.net/tenant/';

const principalHeader = (subject: string): string =>
  Buffer.from(
    JSON.stringify({
      claims: [
        { typ: 'iss', val: ISSUER },
        { typ: OID, val: subject },
      ],
    }),
    'utf8',
  ).toString('base64');

let server: Server;
let app: Express;
let origin: string;
let owner: OwnerId;
let msw: ReturnType<typeof tmdbMswServer> | undefined;
let calls: string[] = [];

/**
 * ⚠ A SCRIPT, not the query token. `TMDB_UNAVAILABLE_TOKEN` needs the outage
 * to survive title normalisation into the query string, which couples this
 * test to `normaliseTitleText`. The script answers 503 to whatever the client
 * actually sends, so the outage is unconditional — and §4.1 allows two
 * retries inside one search, so three entries cover one search completely.
 */
function startTmdbOutage(): void {
  msw?.close();
  calls = [];
  msw = tmdbMswServer({ calls, script: [UNAVAILABLE, UNAVAILABLE, UNAVAILABLE, UNAVAILABLE] });
  msw.listen({
    onUnhandledRequest: (request, print) => {
      const { hostname } = new URL(request.url);
      if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1') return;
      print.error();
    },
  });
}

function item(over: Partial<ExtractedTextItem> = {}): ExtractedTextItem {
  return {
    rawText: 'Arcane',
    inferredTitle: 'Arcane',
    basis: 'text',
    ocrSupport: 'exact',
    provider: 'llm',
    boundingBox: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
    boxSource: 'ocr',
    confidence: 0.9,
    ...over,
  };
}

/** A reader that returns two legible titles, so only matching can fail. */
const extractor: TitleExtractor = {
  name: 'hybrid',
  extract: async (): Promise<ExtractionResult> => ({
    items: [item(), item({ rawText: 'Dune', inferredTitle: 'Dune' })],
    crossCheck: 'ok',
    providerMeta: {},
  }),
};

const blobStore = {
  get: async (): Promise<Uint8Array> => new Uint8Array([1, 2, 3]),
  put: async (): Promise<void> => undefined,
  remove: async (): Promise<void> => undefined,
};

async function seedSubmittedBatch(id: string): Promise<void> {
  await createUploadBatch(owner, {
    id,
    service: 'netflix',
    mode: 'append-only',
    status: 'submitted',
  });
  await createUploadedImage(owner, {
    id: `${id}-img`,
    batchId: id,
    blobPath: `owner/${id}/img.png`,
    fileName: 'IMG_0001.PNG',
    ingestSource: 'upload',
    uploadedFormat: 'png',
    format: 'png',
    byteSize: BigInt(1024),
    uploadedByteSize: BigInt(1088),
    retainUntil: new Date('2026-09-09T00:00:00.000Z'),
  });
}

const getReview = (batchId: string): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/review`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) },
  });

beforeEach(async () => {
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  testPrisma();
  await resetDatabase();

  app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const me = await fetch(`${origin}/api/me`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) },
  });
  owner = asOwnerId(((await me.json()) as { ownerId: string }).ownerId);
});

afterEach(async () => {
  msw?.close();
  msw = undefined;
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-AI-017 · §4.3 · a live TMDB 503 records itself and is shown to the owner', () => {
  it('T-AI-017u: 503 ⇒ everything unmatched, batch still in-review, banner rendered', async () => {
    startTmdbOutage();
    await seedSubmittedBatch('batch-outage-1');

    await startExtraction(owner, 'batch-outage-1', {
      blobStore,
      extractor,
      tmdbClient: new TmdbClient({ apiKey: 'test-key' }),
    });

    // 1 — the read succeeded and the batch is reviewable. An outage must never
    //     cost the owner work that is already done.
    const batch = await findUploadBatch(owner, 'batch-outage-1');
    expect(batch?.status).toBe('in-review');

    // 2 — the outage was RECORDED by the run that suffered it, not seeded.
    const stats = JSON.parse(batch?.extractionStats ?? '{}') as {
      stage3?: { tmdbUnavailable?: boolean; matched?: number; unmatched?: number };
    };
    expect(stats.stage3?.tmdbUnavailable).toBe(true);
    expect(stats.stage3?.matched).toBe(0);
    expect(stats.stage3?.unmatched).toBeGreaterThan(0);

    // 3 — every candidate resolved to an `unmatched:` identity, never `null`
    //     and never a guess.
    const candidates = await testPrisma().extractionCandidate.findMany({
      where: { ownerId: owner, batchId: 'batch-outage-1' },
    });
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.resolvedWorkIdentity).toMatch(/^unmatched:/);
    }

    // 4 — and the owner is told which of the two situations this is.
    const body = (await (await getReview('batch-outage-1')).json()) as {
      tmdbUnavailable: boolean;
      banner: string | null;
      sections: { unmatched: { count: number } };
    };
    expect(body.tmdbUnavailable).toBe(true);
    expect(body.banner).toContain('reach TMDB');
    expect(body.sections.unmatched.count).toBe(candidates.length);
  });

  it('T-AI-017v: the outage is latched — a second candidate does not re-query', async () => {
    // ⚠ §4.1 already allows two retries INSIDE one search. Retrying per
    // candidate on top of that turns a TMDB outage into a batch that hangs for
    // minutes against a 5-DTU database, which is a worse failure than the one
    // being handled. Asserted here against the real client's real requests,
    // where the unit case can only see the port.
    startTmdbOutage();
    await seedSubmittedBatch('batch-outage-2');

    await startExtraction(owner, 'batch-outage-2', {
      blobStore,
      extractor,
      tmdbClient: new TmdbClient({ apiKey: 'test-key' }),
    });

    const candidates = await testPrisma().extractionCandidate.findMany({
      where: { ownerId: owner, batchId: 'batch-outage-2' },
    });
    expect(candidates.length).toBe(2);
    const searches = calls.filter((call) => call.includes('/search/multi'));
    // One search — retries included — for the FIRST candidate, and nothing for
    // the second. More than one search per candidate would be the unlatched bug.
    expect(searches.length).toBeLessThan(candidates.length * 2);
  });
});
