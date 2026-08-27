/**
 * `POST /api/titles/:titleId/fix-match` — the handler's branch arms and the
 * pure body parser, with the repository and TMDB mocked (TASK-109/TASK-110,
 * `specs/api.md` §6.5, US-030).
 *
 * This is not a duplicate of `test/integration/fixMatch.spec.ts`. That suite
 * proves what the STORE does — that listings survive byte-identical, that the
 * suppression really moves, that `title_one_active_per_work` admits an
 * acknowledged duplicate. This one proves what the HANDLER does at the seams a
 * real database cannot be made to take on demand: a TMDB outage, and the exact
 * shape of the write it issues.
 *
 * ⚠ **The write's SHAPE is asserted here, not just its effect.** `T-FIX-002`
 * and `T-FIX-003` are promises about data the owner cannot recover, and they
 * hold only because this handler names a closed set of columns. Reading the
 * argument back means a future refactor that widens it to `sortDateAdded` — or
 * to anything else that participates in ordering — fails here rather than
 * silently moving a row on the owner's list.
 *
 * It also carries the coverage. `npm run coverage` excludes the integration
 * project, so a route proven only there scores near zero against the
 * `apps/api/src/**` floor — which is a gate failure, not a formality.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findTitleDetail = vi.fn();
const findActiveSuppression = vi.fn();
const findActiveTitleByWorkIdentity = vi.fn();
const migrateSuppression = vi.fn();
const updateTitle = vi.fn();
const getWork = vi.fn();

vi.mock('../../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repository/ownerData.js')>();
  return {
    ...actual,
    findTitleDetail: (...args: unknown[]) => findTitleDetail(...args) as unknown,
    findActiveSuppression: (...args: unknown[]) => findActiveSuppression(...args) as unknown,
    findActiveTitleByWorkIdentity: (...args: unknown[]) =>
      findActiveTitleByWorkIdentity(...args) as unknown,
    migrateSuppression: (...args: unknown[]) => migrateSuppression(...args) as unknown,
    updateTitle: (...args: unknown[]) => updateTitle(...args) as unknown,
    // The transaction is a pass-through here: what is under test is which
    // writes are issued, not that the store groups them.
    runInTransaction: async (work: (tx: unknown) => Promise<unknown>) => work(undefined),
  };
});

vi.mock('../../../src/clients/tmdbClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/clients/tmdbClient.js')>();
  return {
    ...actual,
    // The error classes stay REAL: the handler decides between 404 and 502 with
    // `instanceof`, and a stubbed class would make both arms pass whatever it
    // threw.
    TmdbClient: class {
      getWork = (...args: unknown[]) => getWork(...args) as unknown;
    },
  };
});

const { createApp } = await import('../../../src/app.js');
const { CLIENT_PRINCIPAL_HEADER } = await import('../../../src/auth/principal.js');
const { resetAllowListWarning } = await import('../../../src/middleware/allowList.js');
const { TmdbUnavailableError, TmdbWorkNotFoundError } =
  await import('../../../src/clients/tmdbClient.js');
const { parseFixMatchRequest, toPreserved } = await import('../../../src/routes/fixMatch.js');

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-fix-match-unit';

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

const TITLE = {
  id: 't-0001',
  workIdentity: 'unmatched:0123456789abcdef',
  sortDateAdded: new Date('2025-06-15T00:00:00.000Z'),
  listings: [
    { listingId: 'l-a', dateAdded: new Date('2025-06-15T00:00:00.000Z') },
    { listingId: 'l-b', dateAdded: new Date('2025-09-01T00:00:00.000Z') },
  ],
};

const DETAIL = {
  tmdbId: 438631,
  mediaType: 'movie' as const,
  name: 'Dune',
  releaseYear: 2021,
  posterPath: '/dune.jpg',
  runtimeMinutes: 155,
  genres: ['Science Fiction', 'Adventure'],
  imdbId: 'tt1160419',
};

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

let server: Server;
let app: Express;
let origin: string;

const post = (body: unknown, titleId = 't-0001'): Promise<Response> =>
  fetch(`${origin}/api/titles/${titleId}/fix-match`, {
    method: 'POST',
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const GOOD = { tmdbId: 438631, mediaType: 'movie' };

beforeEach(async () => {
  vi.clearAllMocks();
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  process.env['TMDB_API_KEY'] = 'test-key';

  findTitleDetail.mockResolvedValue(TITLE);
  findActiveSuppression.mockResolvedValue(null);
  findActiveTitleByWorkIdentity.mockResolvedValue(null);
  migrateSuppression.mockResolvedValue(undefined);
  updateTitle.mockResolvedValue({ count: 1 });
  getWork.mockResolvedValue(DETAIL);

  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      resolve();
    });
  });
});

afterEach(async () => {
  delete process.env['TMDB_API_KEY'];
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
});

describe('parseFixMatchRequest', () => {
  it('T-FIX-010a · accepts a well-formed body and defaults confirmDuplicate', () => {
    expect(parseFixMatchRequest({ tmdbId: 438631, mediaType: 'movie' })).toEqual({
      ok: true,
      value: { tmdbId: 438631, mediaType: 'movie', confirmDuplicate: false },
    });
    expect(parseFixMatchRequest({ tmdbId: 1399, mediaType: 'tv', confirmDuplicate: true })).toEqual(
      { ok: true, value: { tmdbId: 1399, mediaType: 'tv', confirmDuplicate: true } },
    );
  });

  it('T-FIX-010b · refuses everything that is not a positive integer tmdbId', () => {
    for (const body of [
      {},
      { tmdbId: 0, mediaType: 'movie' },
      { tmdbId: -1, mediaType: 'movie' },
      { tmdbId: 1.5, mediaType: 'movie' },
      { tmdbId: '438631', mediaType: 'movie' },
      { tmdbId: Number.NaN, mediaType: 'movie' },
    ]) {
      const result = parseFixMatchRequest(body);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.details['field']).toBe('tmdbId');
    }
  });

  it('T-FIX-010c · refuses a media type outside the closed set', () => {
    const result = parseFixMatchRequest({ tmdbId: 1, mediaType: 'film' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details['permitted']).toEqual(['movie', 'tv']);
  });

  it('T-FIX-010d · refuses a non-boolean confirmDuplicate rather than coercing it', () => {
    // ⚠ Coercing `"true"` would let a client that stringifies its body create a
    // second copy of a work while believing it had asked a question — and
    // US-030 AC-4 exists precisely so that never happens silently.
    for (const value of ['true', 1, null]) {
      const result = parseFixMatchRequest({ ...GOOD, confirmDuplicate: value });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.details['field']).toBe('confirmDuplicate');
    }
  });

  it('T-FIX-010e · refuses a body that is not an object', () => {
    for (const body of [null, [], 'movie', 7]) {
      expect(parseFixMatchRequest(body).ok).toBe(false);
    }
  });
});

describe('toPreserved', () => {
  it('T-FIX-002a · reports every listing, keyed by id, as a date-only string', () => {
    expect(toPreserved(TITLE.listings, TITLE.sortDateAdded)).toEqual({
      listingIds: ['l-a', 'l-b'],
      dateAdded: { 'l-a': '2025-06-15', 'l-b': '2025-09-01' },
      sortDateAdded: '2025-06-15',
    });
  });

  it('T-FIX-003a · a title with no dated listings reports a null sort date', () => {
    expect(toPreserved([], null)).toEqual({ listingIds: [], dateAdded: {}, sortDateAdded: null });
  });
});

describe('POST /api/titles/:titleId/fix-match — handler arms', () => {
  it('T-FIX-002b · the write names a closed set of columns and no ordering column', async () => {
    const res = await post(GOOD);
    expect(res.status).toBe(200);

    expect(updateTitle).toHaveBeenCalledTimes(1);
    const data = updateTitle.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(data['workIdentity']).toBe('tmdb:movie:438631');
    expect(data['matchState']).toBe('matched');
    // `title_match_coherent` requires this of a matched row, and §6.3 step 4
    // requires it of the product: the extracted text was evidence for a match
    // that is now settled.
    expect(data['rawExtractedText']).toBeNull();
    expect(data['normalisedText']).toBeNull();
    expect(data['tmdbName']).toBe('Dune');
    expect(data['tmdbGenres']).toBe('["Science Fiction","Adventure"]');
    expect(data['imdbId']).toBe('tt1160419');
    // ⚠ The stored rating belonged to the work this row USED to be. Left in
    // place it would show one work's name beside another work's score, and the
    // 14-day horizon would keep it there.
    expect(data['imdbRatingTenths']).toBeNull();
    expect(data['imdbRatingFetchedAt']).toBeNull();

    // ⚠ THE ABSENCES ARE THE ASSERTION. US-030 AC-2/AC-3 hold only because
    // nothing here touches the ordering column or the row's identity.
    expect(data).not.toHaveProperty('sortDateAdded');
    expect(data).not.toHaveProperty('id');
    expect(data).not.toHaveProperty('createdAt');
    expect(data).not.toHaveProperty('state');
    // Not an acknowledged duplicate, so the column is left at its default —
    // writing `''` explicitly would be harmless today and wrong the moment
    // the default changes.
    expect(data).not.toHaveProperty('duplicateAckSeq');
  });

  it('T-FIX-004a · writes a non-empty duplicate acknowledgement only when confirmed', async () => {
    findActiveTitleByWorkIdentity.mockResolvedValue({ id: 't-other' });

    const refused = await post(GOOD);
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as ErrorBody;
    expect(body.error.code).toBe('DUPLICATE_WORK_IDENTITY');
    expect(body.error.details['existingTitleId']).toBe('t-other');
    expect(updateTitle).not.toHaveBeenCalled();

    const confirmed = await post({ ...GOOD, confirmDuplicate: true });
    expect(confirmed.status).toBe(200);
    const data = updateTitle.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(data['duplicateAckSeq']).toBe('t-0001');
    expect(data['duplicateAckSeq']).not.toBe('');
  });

  it('T-FIX-004b · a title already holding the target is not a duplicate of itself', async () => {
    // The owner re-runs a fix-match onto the work the row already carries —
    // refusing here would make a metadata-only re-match impossible.
    findTitleDetail.mockResolvedValue({ ...TITLE, workIdentity: 'tmdb:movie:438631' });
    findActiveTitleByWorkIdentity.mockResolvedValue({ id: 't-0001' });

    const res = await post(GOOD);
    expect(res.status).toBe(200);
    // The gates are skipped entirely when the identity does not change, so the
    // owner's OWN suppression cannot block their own re-match.
    expect(findActiveSuppression).not.toHaveBeenCalled();
    expect(migrateSuppression).not.toHaveBeenCalled();
  });

  it('T-FIX-006a · reports the suppressed target with the way out of it', async () => {
    findActiveSuppression.mockResolvedValue({ id: 'supp:tmdb:movie:438631' });

    const res = await post(GOOD);
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('TARGET_WORK_SUPPRESSED');
    expect(body.error.details['unsuppressHref']).toBe(
      '/api/suppressions/supp%3Atmdb%3Amovie%3A438631/unsuppress',
    );
    // ⚠ Checked BEFORE the duplicate gate and before TMDB: a gate that needs no
    // network must not be able to fail for want of one.
    expect(findActiveTitleByWorkIdentity).not.toHaveBeenCalled();
    expect(getWork).not.toHaveBeenCalled();
    expect(updateTitle).not.toHaveBeenCalled();
  });

  it('T-FIX-005a · migrates the old identity’s suppression and reports the move', async () => {
    findActiveSuppression.mockImplementation((_owner: unknown, identity: unknown) =>
      Promise.resolve(identity === TITLE.workIdentity ? { id: `supp:${String(identity)}` } : null),
    );

    const res = await post(GOOD);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      suppressionMigrated: { from: TITLE.workIdentity, to: 'tmdb:movie:438631' },
    });

    expect(migrateSuppression).toHaveBeenCalledTimes(1);
    const params = migrateSuppression.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(params['id']).toBe('supp:tmdb:movie:438631');
    expect(params['from']).toBe(TITLE.workIdentity);
    expect(params['to']).toBe('tmdb:movie:438631');
    // The snapshot is taken from the NEW work: the suppressed view renders
    // without a title row, so a stale name there is the only name the owner
    // would ever see for the decision.
    expect(params['snapshot']).toMatchObject({ displayName: 'Dune', displayReleaseYear: 2021 });
  });

  it('T-FIX-005b · reports null and writes nothing when there is no suppression to move', async () => {
    const res = await post(GOOD);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ suppressionMigrated: null });
    expect(migrateSuppression).not.toHaveBeenCalled();
  });

  it('T-FIX-010f · a TMDB miss is 404 and a TMDB outage is 502 — never the same answer', async () => {
    getWork.mockRejectedValueOnce(new TmdbWorkNotFoundError('movie', 1));
    const missing = await post(GOOD);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as ErrorBody).error.code).toBe('TMDB_WORK_NOT_FOUND');

    getWork.mockRejectedValueOnce(new TmdbUnavailableError('boom', null, true));
    const down = await post(GOOD);
    expect(down.status).toBe(502);
    const body = (await down.json()) as ErrorBody;
    expect(body.error.code).toBe('TMDB_UNAVAILABLE');
    // ⚠ The upstream text never reaches the owner: a fetch failure message can
    // carry the request URL, and the TMDB URL carries the API key.
    expect(body.error.message).not.toContain('boom');

    expect(updateTitle).not.toHaveBeenCalled();
  });

  it('T-SEC-002e · an unknown title is 404 before the body is read', async () => {
    findTitleDetail.mockResolvedValue(null);
    const res = await post({ tmdbId: 'nonsense' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
  });

  it('T-FIX-010g · a malformed body is 400 and reaches neither TMDB nor the store', async () => {
    const res = await post({ tmdbId: 438631 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    expect(getWork).not.toHaveBeenCalled();
    expect(updateTitle).not.toHaveBeenCalled();
  });
});
