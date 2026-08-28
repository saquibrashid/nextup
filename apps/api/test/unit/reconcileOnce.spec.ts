/**
 * TASK-073 — reconciliation runs ONCE per batch, at the call boundary
 * (US-005 AC-2, REQ-006, `T-BATCH-004`).
 *
 * ⚠ **`reconcile.spec.ts` PROVES THE FUNCTION IS BATCH-SCOPED; IT CANNOT PROVE
 * THE ROUTE CALLS IT THAT WAY.** A route that looped over six images and
 * invoked a correct, correctly-batch-scoped `reconcile()` once per image with
 * that image's candidates would pass every assertion in the domain spec and
 * still propose removing almost the entire service. The only place that
 * failure is observable is the CALL — how many times, and with what — so this
 * file mocks `@nextup/domain` to spy on it and drives the real review route
 * over a six-image batch.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-reconcile-once';

const reconcileSpy = vi.fn();

vi.mock('@nextup/domain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nextup/domain')>();
  return {
    ...actual,
    // A pass-through spy: the real implementation still runs, so the response
    // stays honest and only the call boundary is instrumented.
    reconcile: (input: Parameters<typeof actual.reconcile>[0]) => {
      reconcileSpy(input);
      return actual.reconcile(input);
    },
  };
});

interface CandidateRow {
  id: string;
  resolvedWorkIdentity: string | null;
  collapsedIntoCandidateId: string | null;
  sourceImages: { imageId: string }[];
  rawText: string;
  normalisedText: string;
  inferredTitle: string | null;
  cleanupVerdict: string;
  reviewDisposition: string;
  matchCandidates: string | null;
  ocrSupport: string;
  ocrConfidence: number | null;
  provider: string;
  basis: string;
}

const store: {
  candidates: CandidateRow[];
  listings: unknown[];
  images: { id: string; candidateCount: number | null }[];
} = { candidates: [], listings: [], images: [] };

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    findUploadBatch: () =>
      Promise.resolve({
        id: 'batch-1',
        service: 'netflix',
        status: 'in-review',
        mode: 'full-update',
        lowYield: false,
        degradedExtraction: false,
        crossCheck: 'ok',
      }),
    listCandidatesForReview: () => Promise.resolve(store.candidates),
    listActiveSuppressions: () => Promise.resolve([]),
    listActiveListingsForService: () => Promise.resolve(store.listings),
    listRemovalDecisions: () => Promise.resolve([]),
    listImagesForBatch: () => Promise.resolve(store.images),
  };
});

const candidate = (n: number): CandidateRow => ({
  id: `c-${String(n)}`,
  resolvedWorkIdentity: `tmdb:movie:${String(n)}`,
  collapsedIntoCandidateId: null,
  sourceImages: [{ imageId: `img-${String(n)}` }],
  rawText: `Film ${String(n)}`,
  normalisedText: `film ${String(n)}`,
  inferredTitle: `Film ${String(n)}`,
  cleanupVerdict: 'title-candidate',
  reviewDisposition: 'pending',
  matchCandidates: null,
  ocrSupport: 'corroborated',
  ocrConfidence: 0.9,
  provider: 'azure-openai',
  basis: 'vision',
});

const listing = (n: number) => ({
  listingId: `l-${String(n)}`,
  titleId: `t-${String(n)}`,
  service: 'netflix',
  state: 'active',
  dateAdded: new Date('2026-01-05T00:00:00Z'),
  title: {
    workIdentity: `tmdb:movie:${String(n)}`,
    tmdbName: `Film ${String(n)}`,
    tmdbReleaseYear: 2021,
    tmdbPosterPath: null,
    rawExtractedText: null,
  },
});

const principalHeader = (): string =>
  Buffer.from(
    JSON.stringify({
      claims: [
        { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
        { typ: OID, val: SUBJECT },
      ],
    }),
    'utf8',
  ).toString('base64');

let server: Server;
let app: Express;
let origin: string;

interface ReviewBody {
  sections: { removals: { items: { listingId: string }[]; count: number } };
}

beforeEach(async () => {
  reconcileSpy.mockClear();
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  process.env['TMDB_API_KEY'] = 'unit-fixture-key-not-a-real-secret';

  // Six images, six works, one per image — the whole saved list photographed
  // across six screenshots, which is the ordinary case for a full update.
  store.candidates = [1, 2, 3, 4, 5, 6].map(candidate);
  store.listings = [1, 2, 3, 4, 5, 6].map(listing);
  store.images = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `img-${String(n)}`, candidateCount: 1 }));

  const { createApp } = await import('../../src/app.js');
  app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const getReview = (): Promise<Response> =>
  fetch(`${origin}/api/batches/batch-1/review`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader() },
  });

describe('T-BATCH-004 · reconciliation is called once per batch', () => {
  it('T-BATCH-004j: exactly ONE call for a six-image batch', async () => {
    const res = await getReview();

    expect(res.status).toBe(200);
    expect(reconcileSpy).toHaveBeenCalledTimes(1);
  });

  it('T-BATCH-004k: that one call carries the union of all six images', async () => {
    await getReview();

    const input = reconcileSpy.mock.calls[0]?.[0] as {
      candidates: { sourceImageIds: string[] }[];
    };
    expect(input.candidates).toHaveLength(6);
    expect(input.candidates.flatMap((c) => c.sourceImageIds).sort()).toEqual([
      'img-1',
      'img-2',
      'img-3',
      'img-4',
      'img-5',
      'img-6',
    ]);
  });

  it('T-BATCH-004l: a fully-photographed list proposes NO removals', async () => {
    // The observable consequence. Per-image reconciliation would offer to
    // remove five of the six on every image — 30 proposals for a capture that
    // confirmed the whole service.
    const body = (await (await getReview()).json()) as ReviewBody;

    // ⚠ `sections.removals`, not `removals`. An earlier draft of this file read
    // `body.removals?.items ?? []`, which is `undefined` for every response and
    // therefore passed against `[]` no matter what the route did — a test that
    // asserted the product's largest silent-loss failure could not happen, by
    // never looking.
    expect(body.sections.removals.items).toEqual([]);
    expect(body.sections.removals.count).toBe(0);
  });

  it('T-BATCH-004m: dropping five images does NOT change the number of calls', async () => {
    // Guards the shape of the defect rather than one instance of it: a route
    // that had become per-image would answer this with one call and the
    // previous case with six, so both must be pinned.
    store.candidates = [candidate(1)];
    store.images = [{ id: 'img-1', candidateCount: 1 }];

    const body = (await (await getReview()).json()) as ReviewBody;

    expect(reconcileSpy).toHaveBeenCalledTimes(1);
    // …and the five works no longer photographed are correctly proposed.
    expect(body.sections.removals.items.map((item) => item.listingId)).toEqual([
      'l-2',
      'l-3',
      'l-4',
      'l-5',
      'l-6',
    ]);
  });
});
