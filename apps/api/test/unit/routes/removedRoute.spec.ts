/**
 * TASK-095 — the `GET /api/removed` HANDLER, driven through the real Express
 * app with the repository mocked (`specs/api.md` §6.9).
 *
 * ⚠ THIS FILE EXISTS BECAUSE OF HOW COVERAGE IS MEASURED, AND THAT IS NOT A
 * FORMALITY. CI job 4 runs `--project unit` only, so a route proven solely by
 * the integration suite scores zero against the `apps/api/src/**` floor and
 * fails the gate. Splitting it out also buys something real: with the store
 * mocked, the two follow-up reads (`countRemovalsForWorks`,
 * `findActiveSuppressedWorks`) are OBSERVABLE, so the properties that matter
 * most here — that ranking is never given the caller's filters, and that
 * `hasMore` costs no COUNT — become assertions instead of inferences.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listRemovedView = vi.fn();
const countRemovalsForWorks = vi.fn();
const findActiveSuppressedWorks = vi.fn();

vi.mock('../../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repository/ownerData.js')>();
  return {
    ...actual,
    listRemovedView: (...args: unknown[]) => listRemovedView(...args) as unknown,
    countRemovalsForWorks: (...args: unknown[]) => countRemovalsForWorks(...args) as unknown,
    findActiveSuppressedWorks: (...args: unknown[]) =>
      findActiveSuppressedWorks(...args) as unknown,
  };
});

const { createApp } = await import('../../../src/app.js');
const { CLIENT_PRINCIPAL_HEADER } = await import('../../../src/auth/principal.js');
const { resetAllowListWarning } = await import('../../../src/middleware/allowList.js');
const { encodeRemovedCursor } = await import('../../../src/routes/removedQuery.js');

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-removed-route-unit';

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

interface StoreRow {
  listing_id: string;
  title_id: string;
  service: string;
  removed_at: Date;
  date_added: Date;
  removed_by_batch_id: string | null;
  removed_by_group_id: string | null;
  work_identity: string;
  match_state: string;
  tmdb_name: string | null;
  tmdb_media_type: string | null;
  tmdb_release_year: number | null;
  tmdb_poster_path: string | null;
  raw_extracted_text: string | null;
}

const storeRow = (overrides: Partial<StoreRow> = {}): StoreRow => ({
  listing_id: 'l-1',
  title_id: 't-1',
  service: 'netflix',
  removed_at: new Date('2026-07-14T09:31:02.117Z'),
  date_added: new Date('2026-04-02T00:00:00.000Z'),
  removed_by_batch_id: 'b-1',
  removed_by_group_id: null,
  work_identity: 'tmdb:movie:438631',
  match_state: 'matched',
  tmdb_name: 'Dune',
  tmdb_media_type: 'movie',
  tmdb_release_year: 2021,
  tmdb_poster_path: '/dune.jpg',
  raw_extracted_text: null,
  ...overrides,
});

interface Page {
  items: { listingId: string; removalOrdinal: number; removalTotalForWork: number }[];
  nextCursor: string | null;
  limit: number;
}

let server: Server;
let app: Express;
let origin: string;

const get = (query = ''): Promise<Response> =>
  fetch(`${origin}/api/removed${query}`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader },
  });

const page = async (query = ''): Promise<Page> => {
  const res = await get(query);
  expect(res.status).toBe(200);
  return (await res.json()) as Page;
};

beforeEach(async () => {
  vi.clearAllMocks();
  resetAllowListWarning();
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  listRemovedView.mockResolvedValue([]);
  countRemovalsForWorks.mockResolvedValue([]);
  findActiveSuppressedWorks.mockResolvedValue(new Set());
  app = createApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('GET /api/removed (handler)', () => {
  it('T-REM-020i: an empty log is an empty page, not an error', async () => {
    const body = await page();
    expect(body).toEqual({ items: [], nextCursor: null, limit: 50 });
  });

  it('T-REM-020j: asks the store for ONE MORE ROW than the page, never a COUNT', async () => {
    // A COUNT over an append-only log that grows for ever is exactly the
    // unbounded cost keyset pagination exists to avoid (NFR-018).
    await page('?limit=10');
    expect(listRemovedView).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ limit: 11 }),
    );
  });

  it('T-REM-020k: the extra row decides nextCursor and is NOT served', async () => {
    listRemovedView.mockResolvedValue([
      storeRow({ listing_id: 'l-1' }),
      storeRow({ listing_id: 'l-2' }),
      storeRow({ listing_id: 'l-3' }),
    ]);

    const body = await page('?limit=2');

    expect(body.items.map((i) => i.listingId)).toEqual(['l-1', 'l-2']);
    expect(body.nextCursor).toBe(
      encodeRemovedCursor({ removedAt: '2026-07-14T09:31:02.117Z', listingId: 'l-2' }),
    );
  });

  it('T-REM-020l: a full-but-final page reports no next cursor', async () => {
    listRemovedView.mockResolvedValue([storeRow({ listing_id: 'l-1' })]);
    expect((await page('?limit=1')).nextCursor).toBeNull();
  });

  it('T-REM-022g: the FILTERS reach the listing read', async () => {
    await page('?q=dune&service=max');
    expect(listRemovedView).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ q: 'dune', service: 'max' }),
    );
  });

  it('T-REM-022h: the filters do NOT reach the ranking read', async () => {
    // The ordinal is a property of the work's history, not of the current
    // view. If the filter reached this call, narrowing to one service would
    // renumber a work removed from two — history that renumbers itself when you
    // narrow the view is worse than no annotation at all.
    listRemovedView.mockResolvedValue([storeRow()]);
    await page('?q=dune&service=max');

    expect(countRemovalsForWorks).toHaveBeenCalledWith(expect.any(String), ['tmdb:movie:438631']);
    const args = countRemovalsForWorks.mock.calls[0] ?? [];
    expect(JSON.stringify(args)).not.toContain('max');
  });

  it('T-REM-006h: asks for each work ONCE even when it holds several rows', async () => {
    listRemovedView.mockResolvedValue([
      storeRow({ listing_id: 'l-1' }),
      storeRow({ listing_id: 'l-2' }),
      storeRow({ listing_id: 'l-3' }),
    ]);

    await page();

    expect(countRemovalsForWorks).toHaveBeenCalledWith(expect.any(String), ['tmdb:movie:438631']);
  });

  it('T-REM-006i: rows are served one per LISTING, never collapsed by work', async () => {
    listRemovedView.mockResolvedValue([
      storeRow({ listing_id: 'l-1' }),
      storeRow({ listing_id: 'l-2' }),
      storeRow({ listing_id: 'l-3' }),
    ]);
    countRemovalsForWorks.mockResolvedValue([
      { work_identity: 'tmdb:movie:438631', listing_id: 'l-1', removed_at: new Date(3) },
      { work_identity: 'tmdb:movie:438631', listing_id: 'l-2', removed_at: new Date(2) },
      { work_identity: 'tmdb:movie:438631', listing_id: 'l-3', removed_at: new Date(1) },
    ]);

    const body = await page();

    expect(body.items).toHaveLength(3);
    expect(body.items.map((i) => i.removalOrdinal)).toEqual([3, 2, 1]);
    expect(body.items.every((i) => i.removalTotalForWork === 3)).toBe(true);
  });

  it('T-REM-006j: a row the ranking read cannot see still renders as 1 of 1', async () => {
    // Unreachable while soft-delete-forever holds, but "1 of 1" is the honest
    // answer for a row we can see exactly once — and a crash here would take
    // the owner's whole log out over one missing annotation.
    listRemovedView.mockResolvedValue([storeRow()]);
    countRemovalsForWorks.mockResolvedValue([]);

    const body = await page();

    expect(body.items[0]).toMatchObject({ removalOrdinal: 1, removalTotalForWork: 1 });
  });

  it('T-REM-020m: no store read happens at all when the query is malformed', async () => {
    // Validated BEFORE the lookup, so the same bad request is a 400 whatever
    // is in the database.
    const res = await get('?limit=5000');

    expect(res.status).toBe(400);
    expect(listRemovedView).not.toHaveBeenCalled();
  });

  it('T-SEC-006c: the owner id comes from the principal, never from the query', async () => {
    await page('?ownerId=o_somebodyelse');
    const [ownerArg] = listRemovedView.mock.calls[0] ?? [];
    expect(ownerArg).not.toBe('o_somebodyelse');
    expect(String(ownerArg)).toMatch(/^o_/);
  });
});
