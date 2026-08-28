/**
 * TASK-098 — the `POST /api/listings/:listingId/restore` HANDLER, driven
 * through the real Express app with the repository mocked.
 *
 * ⚠ THIS FILE EXISTS BECAUSE OF HOW COVERAGE IS MEASURED. The integration
 * suite proves the route end-to-end, but the unit project is the one that
 * counts towards the API coverage floor, so the handler must be exercised
 * here too. The mock also makes the pre-condition order OBSERVABLE — the
 * order suppression-before-duplicate means "un-suppress first" is always a
 * specific, actionable step rather than an ambiguous one. Without a separate
 * unit test that ordering is invisible.
 *
 * Pre-condition order under test:
 *   existence → LISTING_NOT_REMOVED → WORK_SUPPRESSED → DUPLICATE_WORK_IDENTITY
 *
 * T-RES-013: suppressed work → 409 WORK_SUPPRESSED
 * T-RES-014: duplicate active title → 409 DUPLICATE_WORK_IDENTITY; retry with
 *            confirmDuplicate:true → 200
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findServiceListingWithWork = vi.fn();
const findActiveSuppression = vi.fn();
const findActiveTitleByWorkIdentity = vi.fn();
const restoreServiceListing = vi.fn();
const findServiceListing = vi.fn();
const listListingsForTitle = vi.fn();
const updateTitle = vi.fn();

vi.mock('../../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repository/ownerData.js')>();
  return {
    ...actual,
    findServiceListingWithWork: (...args: unknown[]) =>
      findServiceListingWithWork(...args) as unknown,
    findActiveSuppression: (...args: unknown[]) => findActiveSuppression(...args) as unknown,
    findActiveTitleByWorkIdentity: (...args: unknown[]) =>
      findActiveTitleByWorkIdentity(...args) as unknown,
    restoreServiceListing: (...args: unknown[]) => restoreServiceListing(...args) as unknown,
    findServiceListing: (...args: unknown[]) => findServiceListing(...args) as unknown,
    listListingsForTitle: (...args: unknown[]) => listListingsForTitle(...args) as unknown,
    updateTitle: (...args: unknown[]) => updateTitle(...args) as unknown,
  };
});

const { createApp } = await import('../../../src/app.js');
const { CLIENT_PRINCIPAL_HEADER } = await import('../../../src/auth/principal.js');
const { resetAllowListWarning } = await import('../../../src/middleware/allowList.js');

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-listings-route-unit';

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

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

const LISTING_ID = 'l-001';
const TITLE_ID = 't-001';
const WORK_IDENTITY = 'tmdb:movie:12345';
const SUPP_ID = 'supp-001';

/** A removed listing row with workIdentity included. */
const removedListingWithWork = () => ({
  listingId: LISTING_ID,
  titleId: TITLE_ID,
  service: 'netflix' as const,
  state: 'removed' as const,
  dateAdded: new Date('2026-01-01T00:00:00.000Z'),
  removedAt: new Date('2026-07-01T00:00:00.000Z'),
  removedByBatchId: 'b-001',
  removedByGroupId: null,
  createdByBatchId: 'b-001',
  ownerId: 'owner-x',
  title: { workIdentity: WORK_IDENTITY },
});

/** An active title with the same workIdentity. */
const activeTitle = () => ({
  id: 'other-title',
  workIdentity: WORK_IDENTITY,
  state: 'active' as const,
  sortDateAdded: new Date('2026-01-01T00:00:00.000Z'),
  matchState: 'matched' as const,
  tmdbId: 12345,
  tmdbMediaType: 'movie' as const,
  tmdbName: 'Test Film',
  tmdbReleaseYear: 2020,
  tmdbPosterPath: null,
  createdByBatchId: 'b-002',
  ownerId: 'owner-x',
  rawExtractedText: null,
  normalisedText: null,
  tmdbGenres: '[]',
  duplicateAckSeq: 0,
});

let server: Server;
let app: Express;
let origin: string;

const postRestore = (listingId: string, body: Record<string, unknown> = {}): Promise<Response> =>
  fetch(`${origin}/api/listings/${encodeURIComponent(listingId)}/restore`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      [CLIENT_PRINCIPAL_HEADER]: principalHeader,
    },
  });

beforeEach(async () => {
  vi.resetAllMocks();
  resetAllowListWarning();
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  if (server === undefined) {
    app = createApp();
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  }
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('POST /api/listings/:listingId/restore — pre-conditions', () => {
  it('T-RES-010a: not-found listing returns 404', async () => {
    findServiceListingWithWork.mockResolvedValue(null);

    const res = await postRestore(LISTING_ID);
    expect(res.status).toBe(404);
  });

  it('T-RES-010b: already-active listing returns 409 LISTING_NOT_REMOVED', async () => {
    findServiceListingWithWork.mockResolvedValue({
      ...removedListingWithWork(),
      state: 'active' as const,
    });

    const res = await postRestore(LISTING_ID);
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('LISTING_NOT_REMOVED');
  });

  it('T-RES-013: suppressed work returns 409 WORK_SUPPRESSED with unsuppressHref', async () => {
    findServiceListingWithWork.mockResolvedValue(removedListingWithWork());
    findActiveSuppression.mockResolvedValue({ id: SUPP_ID, workIdentity: WORK_IDENTITY });

    const res = await postRestore(LISTING_ID);
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('WORK_SUPPRESSED');
    expect(body.error.details['unsuppressHref']).toContain(
      `/api/suppressions/${SUPP_ID}/unsuppress`,
    );
    // Suppression check must come BEFORE duplicate check.
    expect(findActiveTitleByWorkIdentity).not.toHaveBeenCalled();
  });

  it('T-RES-014: duplicate active title returns 409 first, then 200 when confirmed', async () => {
    // 409 path: confirmDuplicate absent/false.
    findServiceListingWithWork.mockResolvedValue(removedListingWithWork());
    findActiveSuppression.mockResolvedValue(null);
    findActiveTitleByWorkIdentity.mockResolvedValue(activeTitle());

    const res409 = await postRestore(LISTING_ID, { confirmDuplicate: false });
    expect(res409.status).toBe(409);
    const body409 = (await res409.json()) as ErrorBody;
    expect(body409.error.code).toBe('DUPLICATE_WORK_IDENTITY');
    expect(body409.error.details['existingTitleId']).toBe(activeTitle().id);

    // 200 path: confirmDuplicate:true.
    vi.resetAllMocks();
    const active = activeTitle();
    findServiceListingWithWork.mockResolvedValue(removedListingWithWork());
    findActiveSuppression.mockResolvedValue(null);
    findActiveTitleByWorkIdentity.mockResolvedValue(active);
    restoreServiceListing.mockResolvedValue(undefined);
    listListingsForTitle.mockResolvedValue([
      {
        state: 'active',
        dateAdded: new Date('2026-01-01T00:00:00.000Z'),
        listingId: LISTING_ID,
        service: 'netflix',
      },
    ]);
    updateTitle.mockResolvedValue(undefined);
    findServiceListing.mockResolvedValue({
      listingId: LISTING_ID,
      titleId: TITLE_ID,
      state: 'active',
      dateAdded: new Date('2026-01-01T00:00:00.000Z'),
    });

    const res200 = await postRestore(LISTING_ID, { confirmDuplicate: true });
    expect(res200.status).toBe(200);
    const data200 = (await res200.json()) as { listingId: string; titleId: string; state: string };
    expect(data200.listingId).toBe(LISTING_ID);
    // Listing stays on its original title (now active).
    expect(data200.titleId).toBe(TITLE_ID);
    expect(data200.state).toBe('active');
    expect(restoreServiceListing).toHaveBeenCalledWith(expect.anything(), LISTING_ID);
    // duplicateAckSeq is set via updateTitle when existingActive != null.
    expect(updateTitle).toHaveBeenCalledWith(
      expect.anything(),
      TITLE_ID,
      expect.objectContaining({ duplicateAckSeq: TITLE_ID }),
    );
  });
});

describe('POST /api/listings/:listingId/restore — normal path', () => {
  it('T-RES-010: returns 200 and restores the listing when no conflicts exist', async () => {
    findServiceListingWithWork.mockResolvedValue(removedListingWithWork());
    findActiveSuppression.mockResolvedValue(null);
    findActiveTitleByWorkIdentity.mockResolvedValue(null);
    restoreServiceListing.mockResolvedValue(undefined);
    listListingsForTitle.mockResolvedValue([
      {
        state: 'active',
        dateAdded: new Date('2026-01-01T00:00:00.000Z'),
        listingId: LISTING_ID,
        service: 'netflix',
      },
    ]);
    updateTitle.mockResolvedValue(undefined);
    findServiceListing.mockResolvedValue({
      listingId: LISTING_ID,
      titleId: TITLE_ID,
      state: 'active',
      dateAdded: new Date('2026-01-01T00:00:00.000Z'),
    });
    findActiveTitleByWorkIdentity.mockResolvedValue(null);

    const res = await postRestore(LISTING_ID);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { listingId: string; titleId: string; state: string };
    expect(data.listingId).toBe(LISTING_ID);
    expect(data.state).toBe('active');
    expect(restoreServiceListing).toHaveBeenCalledWith(expect.anything(), LISTING_ID);
  });
});
