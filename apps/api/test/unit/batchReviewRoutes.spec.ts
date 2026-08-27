/**
 * TASK-065 / TASK-066 — the review and candidate-disposition routes driven
 * WITHOUT a store (`specs/api.md` §6.17–§6.22).
 *
 * ⚠ These are not a second copy of the integration suite. Coverage is measured
 * on the `unit` project, which CI job 4 runs with no database at all, so a
 * route proven only in `test/integration` scores near zero against the
 * `apps/api/src/**` floor — the same reasoning `test/unit/suppressions.spec.ts`
 * and `test/unit/batchesValidation.spec.ts` already carry. What the integration
 * suite proves and this cannot is the part a stub could only agree with: owner
 * scoping enforced by the query, the CHECK constraints, and transactions.
 *
 * The repository module is stubbed at its module boundary rather than the
 * Prisma client, because that boundary is where owner scoping is expressed:
 * stubbing below it would let a route that forgot `ownerId` still pass here.
 * `T-SEC-002` covers the real thing against a real engine.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-routes-unit';

interface BatchRow {
  id: string;
  service: string;
  status: string;
  mode: string;
  lowYield?: boolean;
  degradedExtraction?: boolean;
  crossCheck?: string | null;
}

interface ListingRow {
  listingId: string;
  titleId: string;
  service: string;
  /**
   * ⚠ Carried because `computeRemovals` (TASK-083) re-checks it. A stub that
   * omits a column the route reads yields `undefined` and fails as though the
   * implementation were broken.
   */
  state: string;
  dateAdded: Date;
  title: {
    workIdentity: string;
    tmdbName: string | null;
    tmdbReleaseYear: number | null;
    tmdbPosterPath: string | null;
    rawExtractedText: string | null;
  };
}

const makeListing = (listingId: string, workIdentity: string, name: string): ListingRow => ({
  listingId,
  titleId: `t-${listingId}`,
  service: 'netflix',
  state: 'active',
  dateAdded: new Date('2026-01-05T00:00:00Z'),
  title: {
    workIdentity,
    tmdbName: name,
    tmdbReleaseYear: 2021,
    tmdbPosterPath: null,
    rawExtractedText: null,
  },
});

interface CandidateRow {
  id: string;
  batchId: string;
  rawText: string;
  normalisedText: string;
  inferredTitle: string | null;
  cleanupVerdict: string;
  classification: string | null;
  matchState: string | null;
  resolvedWorkIdentity: string | null;
  correctedToTmdbId: number | null;
  reviewDisposition: string;
  collapsedIntoCandidateId: string | null;
  matchCandidates: string | null;
  sourceImages: { imageId: string }[];
  ocrSupport: string;
  boundingBoxes: string | null;
  ocrConfidence: number | null;
  provider: string;
  basis: string;
}

/**
 * The stub store. Mutated per test; every repository function below reads it,
 * so a route reaching for data the test did not set gets an empty answer
 * rather than a stale one from the previous case.
 */
const store: {
  batch: BatchRow | null;
  candidates: CandidateRow[];
  suppressions: { workIdentity: string }[];
  listings: ListingRow[];
  images: { id: string; candidateCount: number | null }[];
  writes: { id: string; data: Record<string, unknown> }[];
  bulkConfirmed: string[];
  searchMulti: (query: string) => Promise<unknown[]>;
} = {
  batch: null,
  candidates: [],
  suppressions: [],
  listings: [],
  images: [],
  writes: [],
  bulkConfirmed: [],
  searchMulti: () => Promise.resolve([]),
};

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  // Partial: the real module is kept so unrelated helpers (`asOwnerId`, used
  // by the auth chain) still exist. Only the reads and writes these two routes
  // make are replaced.
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    findUploadBatch: (_ownerId: string, batchId: string) =>
      Promise.resolve(store.batch !== null && store.batch.id === batchId ? store.batch : null),
    listCandidatesForReview: () => Promise.resolve(store.candidates),
    listActiveSuppressions: () => Promise.resolve(store.suppressions),
    listActiveListingsForService: () => Promise.resolve(store.listings),
    // TASK-085 — the review route now reads the owner's tick/untick
    // deviations. Stubbed empty: absence of a row means ticked (REQ-055), so
    // this is the state every one of these cases is asserting against.
    listRemovalDecisions: () => Promise.resolve([]),
    listImagesForBatch: () => Promise.resolve(store.images),
    findExtractionCandidate: (_ownerId: string, id: string) =>
      Promise.resolve(store.candidates.find((candidate) => candidate.id === id) ?? null),
    updateCandidateDisposition: (_ownerId: string, id: string, data: Record<string, unknown>) => {
      store.writes.push({ id, data });
      const row = store.candidates.find((candidate) => candidate.id === id);
      if (row !== undefined) Object.assign(row, data);
      return Promise.resolve({ count: row === undefined ? 0 : 1 });
    },
    confirmPendingCandidates: (_ownerId: string, ids: readonly string[]) => {
      const changed = store.candidates.filter(
        (candidate) => ids.includes(candidate.id) && candidate.reviewDisposition === 'pending',
      );
      for (const row of changed) row.reviewDisposition = 'confirmed';
      store.bulkConfirmed.push(...changed.map((row) => row.id));
      return Promise.resolve({ count: changed.length });
    },
  };
});

vi.mock('../../src/clients/tmdbClient.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/clients/tmdbClient.js')>(
    '../../src/clients/tmdbClient.js',
  );
  return {
    ...actual,
    TmdbClient: class {
      searchMulti(query: string) {
        return store.searchMulti(query);
      }
    },
  };
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

const headers = (): Record<string, string> => ({
  'content-type': 'application/json',
  [CLIENT_PRINCIPAL_HEADER]: principalHeader(),
});

const getReview = (batchId: string): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/review`, { headers: headers() });

const patchCandidate = (batchId: string, candidateId: string, body: unknown): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/candidates/${candidateId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body),
  });

const confirmAll = (batchId: string, body: unknown): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/candidates/confirm-all`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });

function makeCandidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
  const row: CandidateRow = {
    id: `cand-${store.candidates.length + 1}`,
    batchId: 'batch-1',
    rawText: 'Dune',
    normalisedText: 'dune',
    inferredTitle: 'Dune',
    cleanupVerdict: 'title-candidate',
    classification: 'new',
    matchState: 'matched',
    resolvedWorkIdentity: 'tmdb:movie:438631',
    correctedToTmdbId: null,
    reviewDisposition: 'pending',
    collapsedIntoCandidateId: null,
    matchCandidates: null,
    sourceImages: [{ imageId: 'img-1' }],
    ocrSupport: 'corroborated',
    boundingBoxes: null,
    ocrConfidence: 0.9,
    provider: 'azure-openai',
    basis: 'vision',
    ...overrides,
  };
  store.candidates.push(row);
  return row;
}

beforeEach(async () => {
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  process.env['TMDB_API_KEY'] = 'unit-fixture-key-not-a-real-secret';

  store.batch = { id: 'batch-1', service: 'netflix', status: 'in-review', mode: 'append-only' };
  store.candidates = [];
  store.suppressions = [];
  store.listings = [];
  store.images = [];
  store.writes = [];
  store.bulkConfirmed = [];
  store.searchMulti = () => Promise.resolve([]);

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

describe('T-REV-010 · GET /review without a store', () => {
  it('T-REV-010o: 404 when the batch does not belong to the owner', async () => {
    const res = await getReview('batch-elsewhere');
    expect(res.status).toBe(404);
  });

  it('T-REV-010p: 409 while the batch is still extracting', async () => {
    store.batch = { id: 'batch-1', service: 'netflix', status: 'extracting', mode: 'append-only' };
    const res = await getReview('batch-1');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'BATCH_NOT_IN_REVIEW',
    );
  });

  it('T-REV-010q: routes candidates into their sections and counts empty images', async () => {
    makeCandidate({ id: 'c-new' });
    makeCandidate({
      id: 'c-unmatched',
      matchState: 'unmatched',
      resolvedWorkIdentity: null,
      classification: null,
    });
    makeCandidate({ id: 'c-chrome', cleanupVerdict: 'chrome-suspected' });
    store.images = [
      { id: 'img-1', candidateCount: 3 },
      // 0 is "extracted, found nothing"; null is "not extracted yet". Only the
      // first is an empty image (US-006 AC-3).
      { id: 'img-2', candidateCount: 0 },
      { id: 'img-3', candidateCount: null },
    ];

    const res = await getReview('batch-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sections: Record<string, { items: { candidateId: string }[] }>;
      imagesWithNoText: { imageId: string }[];
    };
    expect(body.sections['additions']?.items.map((i) => i.candidateId)).toEqual(['c-new']);
    expect(body.sections['unmatched']?.items.map((i) => i.candidateId)).toEqual(['c-unmatched']);
    expect(body.sections['probablyNotTitles']?.items.map((i) => i.candidateId)).toEqual([
      'c-chrome',
    ]);
    expect(body.imagesWithNoText).toEqual([{ imageId: 'img-2' }]);
  });

  it('T-REV-010r: a suppressed work never reaches the owner', async () => {
    makeCandidate({ id: 'c-suppressed', resolvedWorkIdentity: 'tmdb:movie:603' });
    store.suppressions = [{ workIdentity: 'tmdb:movie:603' }];

    const body = (await (await getReview('batch-1')).json()) as {
      sections: Record<string, { items: unknown[] }>;
    };
    expect(body.sections['additions']?.items).toEqual([]);
  });

  it('T-REV-006k: full-update lists every already-present title and never marks them omitted', async () => {
    // Product invariant 2, the single most important safety property: a failed
    // extraction of a known title must never read as a removal.
    store.batch = { id: 'batch-1', service: 'netflix', status: 'in-review', mode: 'full-update' };
    makeCandidate({ id: 'c-known', classification: 'already-present' });
    store.listings = [
      makeListing('l-1', 'tmdb:movie:438631', 'Dune'),
      // Nothing extracted resolved to this one, so it disappeared.
      makeListing('l-2', 'tmdb:movie:603', 'The Matrix'),
    ];

    const body = (await (await getReview('batch-1')).json()) as {
      sections: Record<string, { items: { name?: string }[]; omitted?: boolean }>;
    };
    expect(body.sections['alreadyOnYourList']?.omitted).toBe(false);
    expect(body.sections['removals']?.items.map((i) => i.name)).toEqual(['The Matrix']);
  });

  it('T-REV-006l: append-only proposes no removals at all', async () => {
    store.listings = [makeListing('l-2', 'tmdb:movie:603', 'The Matrix')];
    const body = (await (await getReview('batch-1')).json()) as {
      sections: Record<string, { items: unknown[] }>;
    };
    expect(body.sections['removals']?.items).toEqual([]);
  });

  it('T-SUP-004b: a suppressed work holding an active listing is not proposed for removal', async () => {
    // The gate must precede the DISAPPEARED computation, not merely
    // classification, or this listing is offered for removal on every
    // full-update batch.
    store.batch = { id: 'batch-1', service: 'netflix', status: 'in-review', mode: 'full-update' };
    store.suppressions = [{ workIdentity: 'tmdb:movie:603' }];
    store.listings = [makeListing('l-2', 'tmdb:movie:603', 'The Matrix')];

    const body = (await (await getReview('batch-1')).json()) as {
      sections: Record<string, { items: unknown[] }>;
    };
    expect(body.sections['removals']?.items).toEqual([]);
  });

  it('T-UNM-011b: an unmatched listing is offered under its raw text, never blank', async () => {
    store.batch = { id: 'batch-1', service: 'netflix', status: 'in-review', mode: 'full-update' };
    store.listings = [
      {
        listingId: 'l-3',
        titleId: 't-3',
        service: 'netflix',
        state: 'active',
        dateAdded: new Date('2026-01-05T00:00:00Z'),
        title: {
          workIdentity: 'unmatched:0123456789abcdef',
          tmdbName: null,
          tmdbReleaseYear: null,
          tmdbPosterPath: null,
          rawExtractedText: 'the matrx',
        },
      },
    ];

    const body = (await (await getReview('batch-1')).json()) as {
      sections: Record<string, { items: { name: string; dateAdded: string }[] }>;
    };
    expect(body.sections['removals']?.items[0]?.name).toBe('the matrx');
    expect(body.sections['removals']?.items[0]?.dateAdded).toBe('2026-01-05');
  });

  it('T-AI-004ag: a degraded extraction withholds removals rather than proposing them', async () => {
    // ⚠ The trigger is `crossCheck === 'llm-unavailable'` — the PRIMARY reader
    // failed — not the `degradedExtraction` flag. `ocr-unavailable` is the
    // corroboration failing and deliberately does not withhold.
    store.batch = {
      id: 'batch-1',
      service: 'netflix',
      status: 'in-review',
      mode: 'full-update',
      degradedExtraction: true,
      crossCheck: 'llm-unavailable',
    };
    store.listings = [makeListing('l-2', 'tmdb:movie:603', 'The Matrix')];

    const body = (await (await getReview('batch-1')).json()) as {
      sections: Record<string, { items: unknown[]; withheldReason?: string | null }>;
    };
    expect(body.sections['removals']?.items).toEqual([]);
    expect(body.sections['removals']?.withheldReason).toBe('degraded-extraction');
  });

  it('T-AI-021m: an ocr-unavailable cross-check does NOT withhold removals', async () => {
    // The primary reader ran; only the corroboration is missing. Withholding
    // here would block the owner on an outage of the cross-check alone.
    store.batch = {
      id: 'batch-1',
      service: 'netflix',
      status: 'in-review',
      mode: 'full-update',
      crossCheck: 'ocr-unavailable',
    };
    store.listings = [makeListing('l-2', 'tmdb:movie:603', 'The Matrix')];

    const body = (await (await getReview('batch-1')).json()) as {
      sections: Record<string, { items: unknown[]; withheldReason?: string | null }>;
    };
    expect(body.sections['removals']?.items).toHaveLength(1);
    expect(body.sections['removals']?.withheldReason).toBeNull();
  });

  it('T-AI-004ah: an SD-02 collapse loser keeps its survivor alive, and is not itself offered', async () => {
    store.batch = { id: 'batch-1', service: 'netflix', status: 'in-review', mode: 'full-update' };
    makeCandidate({ id: 'c-survivor' });
    // Reading resolvedWorkIdentity off a discarded loser is the shape of a bug
    // where a rejected candidate keeps a title alive; the survivor already
    // carries the identity, so excluding losers changes nothing here.
    makeCandidate({
      id: 'c-loser',
      collapsedIntoCandidateId: 'c-survivor',
      reviewDisposition: 'discarded',
    });
    store.listings = [makeListing('l-1', 'tmdb:movie:438631', 'Dune')];

    const body = (await (await getReview('batch-1')).json()) as {
      sections: Record<string, { items: { candidateId?: string }[] }>;
    };
    expect(body.sections['removals']?.items).toEqual([]);
    // The survivor resolves to the listing's work, so it reads as already
    // present — the point is that the loser did NOT keep a second title alive
    // and is not offered on its own.
    expect(body.sections['alreadyOnYourList']?.items.map((i) => i.candidateId)).toEqual([
      'c-survivor',
    ]);
  });

  it('T-REV-006m: alternatives are filtered entry by entry, and the match is derived from the best', async () => {
    // Lines the malformed-blob case cannot reach: a WELL-FORMED array carrying
    // one bad entry. Dropping the whole array there would lose the owner's
    // alternatives because of one bad row.
    makeCandidate({
      id: 'c-alts',
      matchCandidates: JSON.stringify([
        { tmdbId: 438631, mediaType: 'movie', name: 'Dune', releaseYear: 2021, score: 0.98 },
        { name: 'no id — not a match ref' },
        { tmdbId: 841, mediaType: 'movie', name: 'Dune', releaseYear: 1984, score: 0.95 },
      ]),
    });

    const body = (await (await getReview('batch-1')).json()) as {
      sections: Record<
        string,
        {
          items: {
            alternatives: { tmdbId: number }[];
            match: { uncertain: boolean; ambiguous: boolean } | null;
          }[];
        }
      >;
    };
    const item = body.sections['additions']?.items[0];
    expect(item?.alternatives.map((a) => a.tmdbId)).toEqual([438631, 841]);
    // < 1 is uncertain; the runner-up within 0.05 makes it ambiguous.
    expect(item?.match).toMatchObject({ uncertain: true, ambiguous: true });
  });

  it('T-REV-006n: a JSON scalar in matchCandidates degrades to no alternatives', async () => {
    // Valid JSON, wrong shape — a different path from unparseable text.
    makeCandidate({ id: 'c-scalar', matchCandidates: '"just a string"' });
    const body = (await (await getReview('batch-1')).json()) as {
      sections: Record<string, { items: { alternatives: unknown[]; match: unknown }[] }>;
    };
    expect(body.sections['additions']?.items[0]?.alternatives).toEqual([]);
    expect(body.sections['additions']?.items[0]?.match).toBeNull();
  });

  it('T-REV-006j: a malformed matchCandidates blob degrades, it does not 500', async () => {
    // Written by an earlier version of the pipeline; a shape change must not
    // make the batch unreviewable.
    makeCandidate({ id: 'c-bad', matchCandidates: '{not json' });
    const res = await getReview('batch-1');
    expect(res.status).toBe(200);
  });
});

describe('T-REV-011 · PATCH a candidate without a store', () => {
  it('T-REV-011ao: state is consulted before the body, so a foreign id cannot 400', async () => {
    store.batch = { id: 'batch-1', service: 'netflix', status: 'extracting', mode: 'append-only' };
    // ⚠ Inverted from its first version, which required 400 here. That
    // ordering failed `T-SEC-002g`: parsing first makes a foreign batch id
    // answer 400 while a missing one answers 404, and that difference is a
    // disclosure. Existence and ownership now come first everywhere.
    const res = await patchCandidate('batch-1', 'c-1', { disposition: 'applied' });
    expect(res.status).toBe(409);

    // The accept half: a reviewable batch still validates the body.
    store.batch = { id: 'batch-1', service: 'netflix', status: 'in-review', mode: 'append-only' };
    makeCandidate({ id: 'c-1' });
    const bad = await patchCandidate('batch-1', 'c-1', { disposition: 'applied' });
    expect(bad.status).toBe(400);
  });

  it('T-REV-011ap: a candidate from another batch is a 404, not a 403', async () => {
    makeCandidate({ id: 'c-1', batchId: 'batch-other' });
    const res = await patchCandidate('batch-1', 'c-1', { disposition: 'confirmed' });
    expect(res.status).toBe(404);
  });

  it('T-REV-011aq: a plain disposition writes exactly that field', async () => {
    makeCandidate({ id: 'c-1' });
    const res = await patchCandidate('batch-1', 'c-1', { disposition: 'discarded' });
    expect(res.status).toBe(200);
    expect(store.writes).toEqual([{ id: 'c-1', data: { reviewDisposition: 'discarded' } }]);
  });

  it('T-SUP-002e: a correction onto a suppressed work is refused BEFORE the duplicate check', async () => {
    makeCandidate({ id: 'c-1' });
    store.suppressions = [{ workIdentity: 'tmdb:movie:603' }];
    // Also a duplicate. The suppression must win: telling the owner it is a
    // duplicate is true but not the reason they cannot proceed.
    store.listings = [makeListing('l-1', 'tmdb:movie:603', 'The Matrix')];

    const res = await patchCandidate('batch-1', 'c-1', {
      disposition: 'corrected',
      tmdbId: 603,
      mediaType: 'movie',
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'TARGET_WORK_SUPPRESSED',
    );
    expect(store.writes).toEqual([]);
  });

  it('T-REV-014d: a duplicate is refused, and confirmDuplicate overrides it', async () => {
    makeCandidate({ id: 'c-1' });
    store.listings = [makeListing('l-1', 'tmdb:movie:603', 'The Matrix')];

    const refused = await patchCandidate('batch-1', 'c-1', {
      disposition: 'corrected',
      tmdbId: 603,
      mediaType: 'movie',
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'DUPLICATE_WORK_IDENTITY',
    );

    const forced = await patchCandidate('batch-1', 'c-1', {
      disposition: 'corrected',
      tmdbId: 603,
      mediaType: 'movie',
      confirmDuplicate: true,
    });
    expect(forced.status).toBe(200);
    expect(store.writes.at(-1)?.data).toMatchObject({
      reviewDisposition: 'corrected',
      resolvedWorkIdentity: 'tmdb:movie:603',
      // Reset so a rescued item does not stay collapsed behind the expander.
      cleanupVerdict: 'title-candidate',
      classification: null,
    });
  });

  it('T-REV-011ar: reclassify flips the verdict and stores the alternatives it found', async () => {
    makeCandidate({ id: 'c-1', cleanupVerdict: 'chrome-suspected', inferredTitle: 'Duen' });
    store.searchMulti = () =>
      Promise.resolve([
        { tmdbId: 438631, mediaType: 'movie', name: 'Dune', releaseYear: 2021, posterPath: null },
        { tmdbId: 841, mediaType: 'movie', name: 'Dune', releaseYear: 1984, posterPath: null },
      ]);

    const res = await patchCandidate('batch-1', 'c-1', { reclassifyAsTitle: true });
    expect(res.status).toBe(200);
    expect(store.writes[0]?.data).toEqual({
      cleanupVerdict: 'title-candidate',
      // Back to pending: the rescue says "this IS a title", not "add it".
      reviewDisposition: 'pending',
    });
    const alternatives = JSON.parse(String(store.writes[1]?.data['matchCandidates'])) as {
      tmdbId: number;
      score: number;
    }[];
    expect(alternatives.map((a) => a.tmdbId)).toEqual([438631, 841]);
    // Rank-derived, deliberately NOT the matcher's score.
    expect(alternatives[0]?.score).toBeCloseTo(0.9);
    expect(alternatives[1]?.score).toBeCloseTo(0.8);
  });

  it('T-REV-011as: a TMDB outage does not lose the rescue', async () => {
    const { TmdbUnavailableError } = await import('../../src/clients/tmdbClient.js');
    makeCandidate({ id: 'c-1', cleanupVerdict: 'chrome-suspected' });
    store.searchMulti = () => Promise.reject(new TmdbUnavailableError('down', 503, true));

    const res = await patchCandidate('batch-1', 'c-1', { reclassifyAsTitle: true });
    expect(res.status).toBe(200);
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]?.data['cleanupVerdict']).toBe('title-candidate');
  });

  it('T-REV-011at: a non-TMDB failure from the search is NOT swallowed', async () => {
    // Only a TMDB outage is tolerated. Swallowing everything would hide a
    // programming error behind a 200 that reports a rescue that half-happened.
    makeCandidate({ id: 'c-1', cleanupVerdict: 'chrome-suspected' });
    store.searchMulti = () => Promise.reject(new TypeError('boom'));

    const res = await patchCandidate('batch-1', 'c-1', { reclassifyAsTitle: true });
    expect(res.status).toBe(500);
  });

  it('T-REV-011au: an empty query skips the search entirely', async () => {
    makeCandidate({
      id: 'c-1',
      cleanupVerdict: 'unreadable-tile',
      rawText: '  ',
      inferredTitle: null,
    });
    let called = false;
    store.searchMulti = () => {
      called = true;
      return Promise.resolve([]);
    };

    const res = await patchCandidate('batch-1', 'c-1', { reclassifyAsTitle: true });
    expect(res.status).toBe(200);
    expect(called).toBe(false);
  });
});

describe('T-REV-011 · confirm-all without a store', () => {
  it('T-REV-011av: it confirms the named section and reports what it skipped', async () => {
    makeCandidate({ id: 'c-1' });
    makeCandidate({ id: 'c-2', reviewDisposition: 'discarded' });
    makeCandidate({ id: 'c-3', cleanupVerdict: 'chrome-suspected' });

    const res = await confirmAll('batch-1', { section: 'additions' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ section: 'additions', confirmed: 1, skipped: 1 });
    // The chrome item is in another section and must not have been touched.
    expect(store.bulkConfirmed).toEqual(['c-1']);
  });

  it('T-REV-011aw: a collapsed-by-default section is refused', async () => {
    const res = await confirmAll('batch-1', { section: 'probablyNotTitles' });
    expect(res.status).toBe(400);
  });

  it('T-REV-011ax: confirm-all on a batch that is not in review is 409', async () => {
    store.batch = { id: 'batch-1', service: 'netflix', status: 'extracting', mode: 'append-only' };
    const res = await confirmAll('batch-1', { section: 'additions' });
    expect(res.status).toBe(409);
  });
});
