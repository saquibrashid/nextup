/**
 * US-067 — the permanent-delete HANDLERS and SERVICE, driven through the real
 * Express app with the repository mocked.
 *
 * ⚠ EXISTS BECAUSE OF HOW COVERAGE IS MEASURED: the integration suite
 * (`permanentDelete.spec.ts`) proves the behaviour against a real database;
 * the unit project is the one that counts towards the API coverage floor. The
 * mock also makes the ORDER observable — the refusal is decided before any
 * purge step is attempted.
 *
 * T-PURGE-001: removed-only, 404 for an unknown id.
 * T-PURGE-002: refused WHOLE when any listing of the work is active.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findServiceListingWithWork = vi.fn();
const listListingsForWork = vi.fn();
const deleteProducingCandidates = vi.fn();
const detachPurgedProvenance = vi.fn();
const deleteRemovedListings = vi.fn();
const deleteTitleIfUnreferenced = vi.fn();

vi.mock('../../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repository/ownerData.js')>();
  return {
    ...actual,
    runInTransaction: (work: (tx: unknown) => Promise<unknown>) => work({}),
    findServiceListingWithWork: (...a: unknown[]) => findServiceListingWithWork(...a) as unknown,
    listListingsForWork: (...a: unknown[]) => listListingsForWork(...a) as unknown,
  };
});

vi.mock('../../../src/repository/purgeRemoved.js', () => ({
  deleteProducingCandidates: (...a: unknown[]) => deleteProducingCandidates(...a) as unknown,
  detachPurgedProvenance: (...a: unknown[]) => detachPurgedProvenance(...a) as unknown,
  deleteRemovedListings: (...a: unknown[]) => deleteRemovedListings(...a) as unknown,
  deleteTitleIfUnreferenced: (...a: unknown[]) => deleteTitleIfUnreferenced(...a) as unknown,
}));

const { createApp } = await import('../../../src/app.js');
const { CLIENT_PRINCIPAL_HEADER } = await import('../../../src/auth/principal.js');
const { resetAllowListWarning } = await import('../../../src/middleware/allowList.js');

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-purge-unit';
const principalHeader = Buffer.from(
  JSON.stringify({
    claims: [
      { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
      { typ: OID, val: SUBJECT },
    ],
  }),
  'utf8',
).toString('base64');

interface ErrorBody {
  error: { code: string };
}

let server: Server;
let origin: string;

const call = (path: string): Promise<Response> =>
  fetch(`${origin}${path}`, {
    method: 'DELETE',
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader },
  });

const removedListing = (over: Record<string, unknown> = {}) => ({
  listingId: 'l-1',
  titleId: 't-1',
  state: 'removed',
  createdByBatchId: 'b-1',
  ...over,
});

beforeEach(async () => {
  vi.resetAllMocks();
  resetAllowListWarning();
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  deleteProducingCandidates.mockResolvedValue(1);
  deleteRemovedListings.mockImplementation((_o: unknown, ids: string[]) =>
    Promise.resolve(ids.length),
  );
  deleteTitleIfUnreferenced.mockResolvedValue(true);
  if (server === undefined) {
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  }
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('DELETE /api/listings/:listingId/permanent', () => {
  it('T-PURGE-001e: purges a removed listing and reports the counts', async () => {
    findServiceListingWithWork.mockResolvedValue(removedListing());

    const res = await call('/api/listings/l-1/permanent');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      listingsDeleted: 1,
      candidatesDeleted: 1,
      titlesDeleted: 1,
    });
    expect(deleteRemovedListings).toHaveBeenCalledTimes(1);
  });

  it('T-PURGE-001f: an unknown listing is 404 and nothing is purged', async () => {
    findServiceListingWithWork.mockResolvedValue(null);

    const res = await call('/api/listings/l-1/permanent');

    expect(res.status).toBe(404);
    expect(deleteProducingCandidates).not.toHaveBeenCalled();
  });

  it('T-PURGE-001g: an active listing is 409 LISTING_NOT_REMOVED before any purge step', async () => {
    findServiceListingWithWork.mockResolvedValue(removedListing({ state: 'active' }));

    const res = await call('/api/listings/l-1/permanent');

    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LISTING_NOT_REMOVED');
    expect(deleteProducingCandidates).not.toHaveBeenCalled();
    expect(deleteRemovedListings).not.toHaveBeenCalled();
  });

  it('T-PURGE-001h: a title kept by another reference is not counted as deleted', async () => {
    findServiceListingWithWork.mockResolvedValue(removedListing());
    deleteTitleIfUnreferenced.mockResolvedValue(false);

    const res = await call('/api/listings/l-1/permanent');

    expect(await res.json()).toEqual({
      listingsDeleted: 1,
      candidatesDeleted: 1,
      titlesDeleted: 0,
    });
  });
});

describe('DELETE /api/works/:workIdentity/history', () => {
  it('T-PURGE-002c: purges every removed listing of the work', async () => {
    listListingsForWork.mockResolvedValue([
      removedListing(),
      removedListing({ listingId: 'l-2', titleId: 't-1' }),
    ]);

    const res = await call(`/api/works/${encodeURIComponent('tmdb:movie:1')}/history`);

    expect(res.status).toBe(200);
    expect(listListingsForWork).toHaveBeenCalledWith(expect.anything(), 'tmdb:movie:1', {});
    expect(await res.json()).toEqual({
      listingsDeleted: 2,
      candidatesDeleted: 1,
      titlesDeleted: 1,
    });
  });

  it('T-PURGE-002d: an unknown work is 404', async () => {
    listListingsForWork.mockResolvedValue([]);

    expect((await call('/api/works/tmdb%3Amovie%3A9/history')).status).toBe(404);
  });

  it('T-PURGE-002e: any active listing refuses the whole request with WORK_HAS_ACTIVE_LISTING', async () => {
    listListingsForWork.mockResolvedValue([
      removedListing(),
      removedListing({ listingId: 'l-2', state: 'active' }),
    ]);

    const res = await call('/api/works/tmdb%3Amovie%3A1/history');

    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('WORK_HAS_ACTIVE_LISTING');
    expect(deleteProducingCandidates).not.toHaveBeenCalled();
    expect(deleteRemovedListings).not.toHaveBeenCalled();
  });
});
