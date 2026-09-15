/**
 * `T-API-023` / `T-API-027` — the release-year and rating orderings AGAINST A
 * REAL DATABASE (`A53`, `specs/api.md` §6.2a, ADR-0011 Revision 1).
 *
 * ⚠ **THE HANDLER-LEVEL PROOF IS IN `test/unit/titlesSortRoute.spec.ts` AND IT
 * IS NOT ENOUGH.** That suite mocks the repository, so it can prove which sort
 * the handler forwards and which cursor it issues, but not what SQL Server
 * does with `NULL` — which is the whole hazard here. SQL Server sorts `NULL`
 * FIRST on `ASC`, so "Oldest first" and "Lowest rated first" would open with
 * every title whose year or rating is unknown, presenting an absence of data
 * as a claim about the work. Only a real engine can tell us the `ORDER BY`
 * says otherwise.
 *
 * ⚠ **AND THE PAGING PROOF ONLY EXISTS HERE.** A nullable keyset needs three
 * branches, and the third — "any row with no value at all" — is the one that
 * silently truncates the list at the first unknown value if it is missing. A
 * single-page assertion cannot see that. `walk` forces several real
 * boundaries.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { compareTitlesByNullableKey } from '@nextup/domain';
import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import {
  asOwnerId,
  createServiceListing,
  createTitle,
  createUploadBatch,
  type OwnerId,
} from '../../src/repository/ownerData.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-sorts';
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

interface ListBody {
  items: { titleId: string }[];
  nextCursor: string | null;
}

let server: Server;
let app: Express;
let origin: string;
let owner: OwnerId;

const list = async (query = ''): Promise<ListBody> => {
  const res = await fetch(`${origin}/api/titles${query}`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as ListBody;
};

const ids = (body: ListBody): string[] => body.items.map((i) => i.titleId);

const walk = async (query: string, limit: number): Promise<string[]> => {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const suffix: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
    const body: ListBody = await list(`${query}&limit=${String(limit)}${suffix}`);
    seen.push(...ids(body));
    cursor = body.nextCursor;
    if (cursor === null) return seen;
  }
  throw new Error('pagination did not terminate');
};

let seq = 0;

async function seedTitle(
  id: string,
  fields: { releaseYear?: number | null; ratingTenths?: number | null },
) {
  seq += 1;
  const batch = await createUploadBatch(owner, {
    id: `b-${id}`,
    service: 'netflix',
    mode: 'append-only',
    status: 'applied',
  });
  const title = await createTitle(owner, {
    id,
    workIdentity: `tmdb:movie:${String(9000 + seq)}`,
    state: 'active',
    matchState: 'matched',
    tmdbId: 9000 + seq,
    tmdbMediaType: 'movie',
    tmdbName: `Sorted ${id}`,
    tmdbGenres: JSON.stringify(['Drama']),
    tmdbReleaseYear: fields.releaseYear ?? null,
    imdbRatingTenths: fields.ratingTenths ?? null,
    // ⚠ A non-null `fetchedAt` with a null rating is the "asked, none
    // available" state, and it is what stops the synchronous sweep re-asking
    // OMDb for every unrated row on every rating-sorted render. Seeding it
    // null instead would make these tests reach the network.
    imdbRatingFetchedAt: new Date(),
    sortDateAdded: new Date('2026-04-02T00:00:00.000Z'),
    createdByBatchId: batch.id,
  });
  await createServiceListing(owner, {
    listingId: `l-${id}`,
    titleId: title.id,
    service: 'netflix',
    state: 'active',
    dateAdded: new Date('2026-04-02T00:00:00.000Z'),
    createdByBatchId: batch.id,
  });
  return title;
}

beforeEach(async () => {
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  testPrisma();
  await resetDatabase();

  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      resolve();
    });
  });

  const res = await fetch(`${origin}/api/me`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) },
  });
  owner = asOwnerId(((await res.json()) as { ownerId: string }).ownerId);
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-API-027 sort=releaseYear orders by year with NULLs last in BOTH directions', () => {
  const seedMixed = async (): Promise<void> => {
    await seedTitle('y-1999', { releaseYear: 1999 });
    await seedTitle('y-null-a', { releaseYear: null });
    await seedTitle('y-2021', { releaseYear: 2021 });
    await seedTitle('y-null-b', { releaseYear: null });
    await seedTitle('y-1974', { releaseYear: 1974 });
  };

  it('T-API-027d: ascending is oldest-first and does NOT open with the undated', async () => {
    await seedMixed();
    expect(ids(await list('?sort=releaseYear&dir=asc'))).toEqual([
      'y-1974',
      'y-1999',
      'y-2021',
      'y-null-a',
      'y-null-b',
    ]);
  });

  it('T-API-027e: descending is newest-first and ALSO ends with the undated', async () => {
    await seedMixed();
    expect(ids(await list('?sort=releaseYear&dir=desc'))).toEqual([
      'y-2021',
      'y-1999',
      'y-1974',
      'y-null-a',
      'y-null-b',
    ]);
  });

  it('T-API-027f: the SQL order matches the domain comparator exactly, both ways', async () => {
    await seedMixed();
    const rows = [
      { id: 'y-1999', key: 1999 },
      { id: 'y-null-a', key: null },
      { id: 'y-2021', key: 2021 },
      { id: 'y-null-b', key: null },
      { id: 'y-1974', key: 1974 },
    ];
    for (const dir of ['asc', 'desc'] as const) {
      const expected = [...rows]
        .sort((a, b) => compareTitlesByNullableKey(a, b, dir))
        .map((row) => row.id);
      expect(ids(await list(`?sort=releaseYear&dir=${dir}`)), dir).toEqual(expected);
    }
  });

  it('T-API-027g: ties break on id ASCENDING in both directions', async () => {
    await seedTitle('y-tie-z', { releaseYear: 2001 });
    await seedTitle('y-tie-a', { releaseYear: 2001 });
    expect(ids(await list('?sort=releaseYear&dir=asc'))).toEqual(['y-tie-a', 'y-tie-z']);
    expect(ids(await list('?sort=releaseYear&dir=desc'))).toEqual(['y-tie-a', 'y-tie-z']);
  });

  it('T-API-027h: PAGING a year-sorted list loses and repeats nothing', async () => {
    // ⚠ THE THIRD KEYSET BRANCH. A predicate that omits "any row with no year
    // at all" stops dead at the first undated title — the rows are still in
    // the database and simply never arrive.
    await seedMixed();
    for (const dir of ['asc', 'desc'] as const) {
      const paged = await walk(`?sort=releaseYear&dir=${dir}`, 2);
      expect(paged, dir).toEqual(ids(await list(`?sort=releaseYear&dir=${dir}`)));
      expect(new Set(paged).size, dir).toBe(paged.length);
    }
  });

  it('T-API-027i: a page boundary landing INSIDE the null block still terminates', async () => {
    await seedTitle('y-2000', { releaseYear: 2000 });
    await seedTitle('y-n1', { releaseYear: null });
    await seedTitle('y-n2', { releaseYear: null });
    await seedTitle('y-n3', { releaseYear: null });
    // Page size 2 puts the second boundary between two null rows, where only
    // the `{ year: null, id: { gt } }` branch applies. Re-admitting the
    // non-null branches there would replay rows already paged past.
    const paged = await walk('?sort=releaseYear&dir=asc', 2);
    expect(paged).toEqual(['y-2000', 'y-n1', 'y-n2', 'y-n3']);
  });
});

describe('T-API-023 sort=rating orders by rating with NULLs last in BOTH directions', () => {
  const seedMixed = async (): Promise<void> => {
    await seedTitle('s-84', { ratingTenths: 84 });
    await seedTitle('s-null-a', { ratingTenths: null });
    await seedTitle('s-71', { ratingTenths: 71 });
    await seedTitle('s-null-b', { ratingTenths: null });
    await seedTitle('s-92', { ratingTenths: 92 });
  };

  it('T-API-023c: descending is highest-first and the unrated are LAST', async () => {
    await seedMixed();
    expect(ids(await list('?sort=rating&dir=desc'))).toEqual([
      's-92',
      's-84',
      's-71',
      's-null-a',
      's-null-b',
    ]);
  });

  it('T-API-023d: ascending is lowest-first and the unrated are STILL last', async () => {
    // ⚠ THE SHARPEST CASE IN THIS FILE. On `ASC` SQL Server puts `NULL` first
    // for free, so "Lowest rated first" would open with every title nobody has
    // rated — the list reading as an opinion the product does not hold.
    await seedMixed();
    expect(ids(await list('?sort=rating&dir=asc'))).toEqual([
      's-71',
      's-84',
      's-92',
      's-null-a',
      's-null-b',
    ]);
  });

  it('T-API-023e: the SQL order matches the domain comparator exactly, both ways', async () => {
    await seedMixed();
    const rows = [
      { id: 's-84', key: 84 },
      { id: 's-null-a', key: null },
      { id: 's-71', key: 71 },
      { id: 's-null-b', key: null },
      { id: 's-92', key: 92 },
    ];
    for (const dir of ['asc', 'desc'] as const) {
      const expected = [...rows]
        .sort((a, b) => compareTitlesByNullableKey(a, b, dir))
        .map((row) => row.id);
      expect(ids(await list(`?sort=rating&dir=${dir}`)), dir).toEqual(expected);
    }
  });

  it('T-API-023f: ties break on id ASCENDING in both directions', async () => {
    await seedTitle('s-tie-z', { ratingTenths: 80 });
    await seedTitle('s-tie-a', { ratingTenths: 80 });
    expect(ids(await list('?sort=rating&dir=asc'))).toEqual(['s-tie-a', 's-tie-z']);
    expect(ids(await list('?sort=rating&dir=desc'))).toEqual(['s-tie-a', 's-tie-z']);
  });

  it('T-API-023g: PAGING a rating-sorted list loses and repeats nothing', async () => {
    await seedMixed();
    for (const dir of ['asc', 'desc'] as const) {
      const paged = await walk(`?sort=rating&dir=${dir}`, 2);
      expect(paged, dir).toEqual(ids(await list(`?sort=rating&dir=${dir}`)));
      expect(new Set(paged).size, dir).toBe(paged.length);
    }
  });

  it('T-API-023h: a cursor cut from the DATE sort is refused, never silently mispaged', async () => {
    await seedMixed();
    const dateCursor = (await list('?sort=dateAdded&limit=2')).nextCursor;
    expect(dateCursor).not.toBeNull();
    const res = await fetch(
      `${origin}/api/titles?sort=rating&cursor=${encodeURIComponent(dateCursor as string)}`,
      { headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) } },
    );
    expect(res.status).toBe(400);
  });
});
