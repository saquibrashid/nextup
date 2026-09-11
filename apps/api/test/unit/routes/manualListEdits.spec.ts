/**
 * `POST /api/titles` and `DELETE /api/titles/:titleId` — the handlers' branch
 * arms and the pure body parser, with the repository and TMDB mocked
 * (TASK-207, `specs/api.md` §6.30/§6.32, US-047/US-048).
 *
 * This is not a duplicate of `test/integration/manualListEdits.spec.ts`. That
 * suite proves what the STORE does — that the filtered unique index really
 * fires, that a removed listing does not collide with a new active one, that
 * the soft delete is visible in the removed log. This one proves what the
 * HANDLER does at the seams a real database cannot be made to take on demand:
 * a TMDB outage, a unique violation raced between two adds, and the exact
 * shape of the rows it writes.
 *
 * ⚠ **It also carries the coverage, and that is not a formality.**
 * `npm run coverage` runs `--project unit --project web` only — the
 * integration project needs SQL Server and cannot be in it. A route proven
 * only there scores near zero against the `apps/api/src/**` floor: this file
 * exists because `manualListEdits.ts` sat at **2.7% statements / 0% branches**
 * and took the whole gate below its 90%/85% thresholds while being, in truth,
 * thoroughly tested. The same note appears on `suppressRoute.spec.ts` and
 * `fixMatch.spec.ts`; this is the third time the gap has been paid for.
 *
 * ⚠ **`isUniqueViolation` is kept REAL.** Stubbing it would make the
 * duplicate-vs-500 fork pass whatever the store threw, which is the one thing
 * that fork exists to distinguish. The tests throw an error carrying a genuine
 * SQL Server `number: 2627` instead.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findTitle = vi.fn();
const findTitleByWorkIdentity = vi.fn();
const findActiveSuppression = vi.fn();
const createTitle = vi.fn();
const createServiceListing = vi.fn();
const updateTitle = vi.fn();
const listListingsForTitle = vi.fn();
const softDeleteServiceListing = vi.fn();
const getWork = vi.fn();

vi.mock('../../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repository/ownerData.js')>();
  return {
    ...actual,
    findTitle: (...args: unknown[]) => findTitle(...args) as unknown,
    findTitleByWorkIdentity: (...args: unknown[]) => findTitleByWorkIdentity(...args) as unknown,
    findActiveSuppression: (...args: unknown[]) => findActiveSuppression(...args) as unknown,
    createTitle: (...args: unknown[]) => createTitle(...args) as unknown,
    createServiceListing: (...args: unknown[]) => createServiceListing(...args) as unknown,
    updateTitle: (...args: unknown[]) => updateTitle(...args) as unknown,
    listListingsForTitle: (...args: unknown[]) => listListingsForTitle(...args) as unknown,
    softDeleteServiceListing: (...args: unknown[]) => softDeleteServiceListing(...args) as unknown,
    // ⚠ `isUniqueViolation` is deliberately NOT overridden — see the header.
    // The transaction is a pass-through: what is under test is which writes are
    // issued, not that the store groups them.
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
const { parseAddTitleRequest, dateOnlyUtc } =
  await import('../../../src/routes/manualListEdits.js');

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-manual-list-edits-unit';

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

const GOOD = { tmdbId: 438631, mediaType: 'movie', service: 'netflix' };
const WORK_IDENTITY = 'tmdb:movie:438631';

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

interface AddBody {
  titleId: string;
  listingId: string;
  workIdentity: string;
  service: string;
  name: string;
  dateAdded: string;
  titleWasCreated: boolean;
}

interface DeleteBody {
  titleId: string;
  state: string;
  removedListingIds: string[];
  removedAt: string;
  suppressed: boolean;
}

let server: Server;
let app: Express;
let origin: string;

const add = (body: unknown = GOOD): Promise<Response> =>
  fetch(`${origin}/api/titles`, {
    method: 'POST',
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const remove = (titleId = 't-0001'): Promise<Response> =>
  fetch(`${origin}/api/titles/${titleId}`, {
    method: 'DELETE',
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader },
  });

/** A SQL Server unique-index violation, as the driver actually raises it. */
const uniqueViolation = (): Error =>
  Object.assign(new Error('Violation of index.'), { number: 2627 });

beforeEach(async () => {
  vi.clearAllMocks();
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  process.env['TMDB_API_KEY'] = 'test-key';

  findActiveSuppression.mockResolvedValue(null);
  findTitleByWorkIdentity.mockResolvedValue(null);
  findTitle.mockResolvedValue({ id: 't-0001', workIdentity: WORK_IDENTITY, state: 'active' });
  createTitle.mockResolvedValue(undefined);
  createServiceListing.mockResolvedValue(undefined);
  updateTitle.mockResolvedValue({ count: 1 });
  softDeleteServiceListing.mockResolvedValue(undefined);
  listListingsForTitle.mockResolvedValue([
    { listingId: 'l-a', service: 'netflix', state: 'active', dateAdded: new Date('2026-04-02') },
  ]);
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

describe('parseAddTitleRequest', () => {
  it('T-MANUAL-032a · accepts a well-formed body and nothing else from it', () => {
    expect(parseAddTitleRequest({ ...GOOD, name: 'Dune', dateAdded: '2020-01-01' })).toEqual({
      ok: true,
      value: { tmdbId: 438631, mediaType: 'movie', service: 'netflix' },
    });
  });

  it('T-MANUAL-032b · refuses a body that is not an object', () => {
    for (const body of [null, undefined, 'x', 7, [], [GOOD]]) {
      expect(parseAddTitleRequest(body).ok).toBe(false);
    }
  });

  it('T-MANUAL-032c · refuses everything that is not a positive integer tmdbId', () => {
    for (const tmdbId of [undefined, 0, -1, 1.5, '438631', Number.NaN]) {
      const result = parseAddTitleRequest({ ...GOOD, tmdbId });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.details['field']).toBe('tmdbId');
    }
  });

  it('T-MANUAL-032d · refuses a media type outside the closed set', () => {
    const result = parseAddTitleRequest({ ...GOOD, mediaType: 'film' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details['permitted']).toEqual(['movie', 'tv']);
  });

  it('T-MANUAL-032e · refuses a service outside the closed set', () => {
    const result = parseAddTitleRequest({ ...GOOD, service: 'hulu' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details['field']).toBe('service');
  });

  it('T-MANUAL-033 · dateOnlyUtc truncates to midnight UTC, not local midnight', () => {
    // A late-evening UTC instant is the case that would shift a day under a
    // local-time truncation, which `service_listing.date_added` is write-once
    // about (`T-INV-006`).
    expect(dateOnlyUtc(new Date('2026-04-02T23:45:12.345Z')).toISOString()).toBe(
      '2026-04-02T00:00:00.000Z',
    );
    expect(dateOnlyUtc(new Date('2026-04-02T00:00:00.000Z')).toISOString()).toBe(
      '2026-04-02T00:00:00.000Z',
    );
  });
});

describe('POST /api/titles — §6.30 add by hand', () => {
  it('T-MANUAL-034a · a work not on the list creates a title AND a listing, with no batch id', async () => {
    const response = await add();
    expect(response.status).toBe(201);

    const body = (await response.json()) as AddBody;
    expect(body.workIdentity).toBe(WORK_IDENTITY);
    expect(body.name).toBe('Dune');
    expect(body.titleWasCreated).toBe(true);

    const [, title] = createTitle.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(title['workIdentity']).toBe(WORK_IDENTITY);
    expect(title['state']).toBe('active');
    expect(title['matchState']).toBe('matched');
    expect(title['tmdbName']).toBe('Dune');
    // ⚠ NULL, never a synthetic batch id — migration `0007_manual_list_edits`
    // exists for this value, and a fabricated one would make the row look like
    // it came from an upload the owner never made.
    expect(title['createdByBatchId']).toBeNull();

    const [, listing] = createServiceListing.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(listing['service']).toBe('netflix');
    expect(listing['state']).toBe('active');
    expect(listing['createdByBatchId']).toBeNull();
  });

  it('T-MANUAL-034b · a work ALREADY on another service gains a badge, never a second row', async () => {
    /*
      REQ-005 is one row per WORK with a badge per service (product invariant
      described in `specs/data-model.md`). A second title row here would be a
      duplicate the owner cannot merge from the UI.
    */
    findTitleByWorkIdentity.mockResolvedValue({
      id: 't-existing',
      state: 'active',
      sortDateAdded: new Date('2025-04-02T00:00:00.000Z'),
    });

    const response = await add({ ...GOOD, service: 'max' });
    expect(response.status).toBe(201);

    const body = (await response.json()) as AddBody;
    expect(body.titleId).toBe('t-existing');
    expect(body.titleWasCreated).toBe(false);
    expect(createTitle).not.toHaveBeenCalled();
    expect(createServiceListing).toHaveBeenCalledTimes(1);
  });

  it('T-MANUAL-034c · adding a second service does NOT reorder a row held since April', async () => {
    /*
      ⚠ Product invariant 6 — the title-level date is the EARLIEST across the
      title's listings. Writing today's date here would jump a long-held row to
      the top of a newest-first list, which is a silent reordering of the
      owner's list as a side effect of adding a badge.
    */
    findTitleByWorkIdentity.mockResolvedValue({
      id: 't-existing',
      state: 'active',
      sortDateAdded: new Date('2025-04-02T00:00:00.000Z'),
    });

    expect((await add({ ...GOOD, service: 'max' })).status).toBe(201);
    expect(updateTitle).not.toHaveBeenCalled();
  });

  it('T-MANUAL-034d · a LATER stored date is pulled back to today, and a null one is filled', async () => {
    for (const sortDateAdded of [new Date('2099-01-01T00:00:00.000Z'), null]) {
      vi.clearAllMocks();
      findActiveSuppression.mockResolvedValue(null);
      getWork.mockResolvedValue(DETAIL);
      findTitleByWorkIdentity.mockResolvedValue({
        id: 't-existing',
        state: 'active',
        sortDateAdded,
      });

      expect((await add({ ...GOOD, service: 'max' })).status).toBe(201);
      expect(updateTitle).toHaveBeenCalledTimes(1);
      const [, , patch] = updateTitle.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
      expect(patch).toHaveProperty('sortDateAdded');
    }
  });

  it('T-MANUAL-034e · a REMOVED title for the same work is re-created, not resurrected in place', async () => {
    // Product invariant 7: a reappearance is a brand-new row dated today. The
    // removed view is a log, not a recycle bin.
    findTitleByWorkIdentity.mockResolvedValue({
      id: 't-removed',
      state: 'removed',
      sortDateAdded: new Date('2024-01-01T00:00:00.000Z'),
    });

    const response = await add();
    expect(response.status).toBe(201);
    expect(createTitle).toHaveBeenCalledTimes(1);
    expect(((await response.json()) as AddBody).titleWasCreated).toBe(true);
  });

  it('T-MANUAL-035a · a SUPPRESSED work is refused before TMDB is ever called', async () => {
    /*
      ⚠ GATE ORDER IS THE ASSERTION. Suppression needs no network, so a TMDB
      outage must not stop it answering — and "you told me to stop showing you
      this" is the reason the owner needs to hear first. §6.20 calls manual
      entry "the most direct back door there is"; this is that door.
    */
    findActiveSuppression.mockResolvedValue({ id: 'supp-1' });

    const response = await add();
    expect(response.status).toBe(409);

    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe('WORK_SUPPRESSED');
    expect(body.error.details['unsuppressHref']).toBe('/api/suppressions/supp-1/unsuppress');
    expect(getWork).not.toHaveBeenCalled();
    expect(createTitle).not.toHaveBeenCalled();
    expect(createServiceListing).not.toHaveBeenCalled();
  });

  it('T-MANUAL-035b · a work TMDB does not hold is a 404 and writes NOTHING', async () => {
    // A title TMDB cannot resolve has no name and no poster, and would sit on
    // the list permanently blank.
    getWork.mockRejectedValue(new TmdbWorkNotFoundError('movie', 438631));

    const response = await add();
    expect(response.status).toBe(404);
    expect(((await response.json()) as ErrorBody).error.code).toBe('TMDB_WORK_NOT_FOUND');
    expect(createTitle).not.toHaveBeenCalled();
    expect(createServiceListing).not.toHaveBeenCalled();
  });

  it('T-MANUAL-035c · a TMDB outage is reported as an outage, and writes NOTHING', async () => {
    getWork.mockRejectedValue(new TmdbUnavailableError('boom', 503, true));

    const response = await add();
    expect(((await response.json()) as ErrorBody).error.code).toBe('TMDB_UNAVAILABLE');
    expect(createTitle).not.toHaveBeenCalled();
  });

  it('T-MANUAL-035d · a raced duplicate is a 409 the owner can act on, not a 500', async () => {
    /*
      ⚠ `listing_one_per_service` is a FILTERED unique index, and it is the only
      thing that sees the race between two adds of the same work. Detected from
      the store rather than pre-checked, so an unmapped store error here would
      show the owner "something went wrong" for a situation they can resolve.
    */
    createServiceListing.mockRejectedValue(uniqueViolation());

    const response = await add();
    expect(response.status).toBe(409);

    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe('DUPLICATE_WORK_IDENTITY');
    expect(body.error.details['service']).toBe('netflix');
  });

  it('T-MANUAL-035e · a store error that is NOT a unique violation is not disguised as one', async () => {
    createServiceListing.mockRejectedValue(new Error('connection reset'));

    const response = await add();
    expect(response.status).toBe(500);
    expect(((await response.json()) as ErrorBody).error.code).not.toBe('DUPLICATE_WORK_IDENTITY');
  });

  it('T-MANUAL-035f · a malformed body is refused before any gate runs', async () => {
    const response = await add({ tmdbId: 'not-a-number', mediaType: 'movie', service: 'netflix' });
    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    expect(findActiveSuppression).not.toHaveBeenCalled();
    expect(getWork).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/titles/:titleId — §6.32 remove by hand', () => {
  it('T-MANUAL-036a · an unknown or foreign title is a 404, never a 403', async () => {
    // Owner-scoped, so a foreign id must be indistinguishable from a missing
    // one: a 403 would confirm the row exists (`T-SEC-002d`).
    findTitle.mockResolvedValue(null);

    const response = await remove('t-someone-elses');
    expect(response.status).toBe(404);
    expect(softDeleteServiceListing).not.toHaveBeenCalled();
  });

  it('T-MANUAL-036b · a SUPPRESSED work is refused, and nothing is written', async () => {
    /*
      ⚠ Suppression sits ABOVE listing state, in a separate table. `title.state`
      only ever holds `active` or `removed`, so a state check alone lets this
      through — and a hidden edit here would silently change WHERE the work
      lands on a later un-suppression (US-029 AC-3 vs AC-4).
    */
    findActiveSuppression.mockResolvedValue({ id: 'supp-9' });

    const response = await remove();
    expect(response.status).toBe(409);

    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe('WORK_SUPPRESSED');
    expect(body.error.details['unsuppressHref']).toBe('/api/suppressions/supp-9/unsuppress');
    expect(softDeleteServiceListing).not.toHaveBeenCalled();
    expect(updateTitle).not.toHaveBeenCalled();
  });

  it('T-MANUAL-036c · a title with no ACTIVE listings is a 409, not a 404', async () => {
    // The title exists and the owner may be looking at it in the removed view.
    // A 404 there would read as data loss.
    listListingsForTitle.mockResolvedValue([
      { listingId: 'l-a', service: 'netflix', state: 'removed', dateAdded: new Date('2026-04-02') },
    ]);

    const response = await remove();
    expect(response.status).toBe(409);
    expect(((await response.json()) as ErrorBody).error.code).toBe('TITLE_NOT_ACTIVE');
    expect(softDeleteServiceListing).not.toHaveBeenCalled();
  });

  it('T-MANUAL-036d · a two-badge title removes BOTH listings, each with no batch and no group', async () => {
    /*
      §6.9 is "one item per removed listing", so a two-badge delete correctly
      writes two log entries, each independently restorable. Both ids are NULL
      because no batch and no removal group did this — §6.9 reads exactly that
      to say "Removed by you".
    */
    listListingsForTitle.mockResolvedValue([
      { listingId: 'l-a', service: 'netflix', state: 'active', dateAdded: new Date('2026-04-02') },
      { listingId: 'l-b', service: 'max', state: 'active', dateAdded: new Date('2026-05-09') },
    ]);

    const response = await remove();
    expect(response.status).toBe(200);

    const body = (await response.json()) as DeleteBody;
    expect(body.removedListingIds).toEqual(['l-a', 'l-b']);
    expect(body.state).toBe('removed');
    expect(softDeleteServiceListing).toHaveBeenCalledTimes(2);

    for (const call of softDeleteServiceListing.mock.calls) {
      const [, , patch] = call as [unknown, unknown, Record<string, unknown>];
      expect(patch['removedByBatchId']).toBeNull();
      expect(patch['removedByGroupId']).toBeNull();
    }
  });

  it('T-MANUAL-036e · removal writes NO suppression, and says so in the response', async () => {
    /*
      ⚠ THIS IS THE WHOLE DISTINCTION THE ROUTE EXISTS FOR. Removing says "this
      is not on my list" and the work may legitimately return in a later capture
      as a brand-new row (product invariant 7). Suppression says "never show me
      this work again" and is keyed on canonical work identity for ever
      (REQ-071). Conflating them is the defect §6.32 was built to fix.
    */
    const response = await remove();
    expect(((await response.json()) as DeleteBody).suppressed).toBe(false);
  });

  it('T-MANUAL-037 · the title state is DERIVED from the listings, never assigned', async () => {
    /*
      Deriving rather than writing `'removed'` directly is what keeps this path
      and the §6.10 restore path from disagreeing when a title holds a listing
      this handler did not touch. Here the second read returns a still-active
      listing, so the title must NOT be marked removed.
    */
    listListingsForTitle
      .mockResolvedValueOnce([
        {
          listingId: 'l-a',
          service: 'netflix',
          state: 'active',
          dateAdded: new Date('2026-04-02'),
        },
      ])
      .mockResolvedValueOnce([
        {
          listingId: 'l-a',
          service: 'netflix',
          state: 'removed',
          dateAdded: new Date('2026-04-02'),
        },
        { listingId: 'l-b', service: 'max', state: 'active', dateAdded: new Date('2026-05-09') },
      ]);

    expect((await remove()).status).toBe(200);

    const [, , patch] = updateTitle.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
    expect(patch['state']).toBe('active');
    expect(patch['sortDateAdded']).toEqual(new Date('2026-05-09T00:00:00.000Z'));
  });
});
