/**
 * `T-API-029` — `sort=name` AGAINST A REAL DATABASE (TASK-219).
 *
 * ⚠ **THIS SUITE IS THE FEATURE'S ONLY REAL PROOF, AND A UNIT TEST CANNOT
 * REPLACE IT.** The defect this task exists to prevent lives entirely in the
 * database: the default collation is `Latin1_General_100_BIN2`, which is
 * BINARY, so an unqualified `ORDER BY` puts every lower-case title after every
 * upper-case one (`apple` after `Zebra`) and every accented word after every
 * unaccented one (`Amélie` after `Zodiac`). A mocked repository returns
 * whatever the mock was told to return and proves none of it.
 *
 * ⚠ **AND THE FIXTURES MUST BE ADVERSARIAL OR THE SUITE IS DECORATIVE.** On a
 * title-cased fixture — `Arrival`, `The Matrix`, `Zodiac` — binary order and
 * human order are IDENTICAL. A suite written against realistic-looking data
 * therefore passes against the broken implementation. Every lower-case and
 * accented row below is there for that reason.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { compareTitlesByName, deriveSortName } from '@nextup/domain';
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
const SUBJECT = 'oid-owner-name-sort';
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

/**
 * Seed one active, matched title carrying `name`.
 *
 * ⚠ `tmdbName` is nullable even on a MATCHED title — `tmdbFieldsFor` in
 * `batchClose.ts` writes `known?.name ?? null` when the confirmed work was not
 * among the candidate's alternatives. That is how a row legitimately ends up
 * with no sort key at all, and it is the `null` case these tests exercise. The
 * `title_match_coherent` CHECK constrains `tmdb_id`, not `tmdb_name`.
 */
async function seedTitle(id: string, name: string | null) {
  seq += 1;
  const batch = await createUploadBatch(owner, {
    id: `bn-${id}`,
    service: 'netflix',
    mode: 'append-only',
    status: 'applied',
  });
  const title = await createTitle(owner, {
    id,
    workIdentity: `tmdb:movie:${String(7000 + seq)}`,
    state: 'active',
    matchState: 'matched',
    tmdbId: 7000 + seq,
    tmdbMediaType: 'movie',
    tmdbName: name,
    tmdbGenres: JSON.stringify(['Drama']),
    sortDateAdded: new Date('2026-04-02T00:00:00.000Z'),
    createdByBatchId: batch.id,
  });
  await createServiceListing(owner, {
    listingId: `ln-${id}`,
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

describe('T-API-029 sort=name is case- and accent-insensitive in the DATABASE', () => {
  it('T-API-029p: lower-case titles interleave with upper-case ones', async () => {
    // ⚠ THE ENTIRE POINT. Under the BIN2 database default this order is
    // `Banana, Zebra, apple` — every capital before every lower-case letter.
    // If this test ever reads that way, the `COLLATE` clause has been lost
    // from migration `0010` or the `ORDER BY` has moved to `tmdb_name`.
    await seedTitle('n-apple', 'apple');
    await seedTitle('n-zebra', 'Zebra');
    await seedTitle('n-banana', 'Banana');

    expect(ids(await list('?sort=name&dir=asc'))).toEqual(['n-apple', 'n-banana', 'n-zebra']);
  });

  it('T-API-029q: accented titles sort with their unaccented spelling', async () => {
    // Under BIN2 `Amélie` (`0xE9`) sorts after `Zodiac`. Under CI_AI it sorts
    // between `Alien` and `Arrival`, which is where the owner will look.
    await seedTitle('n-alien', 'Alien');
    await seedTitle('n-amelie', 'Amélie');
    await seedTitle('n-arrival', 'Arrival');
    await seedTitle('n-zodiac', 'Zodiac');

    expect(ids(await list('?sort=name&dir=asc'))).toEqual([
      'n-alien',
      'n-amelie',
      'n-arrival',
      'n-zodiac',
    ]);
  });

  it('T-API-029r: a leading English article is ignored for ordering', async () => {
    // `The Matrix` files under M, between `Lion` and `Nope`.
    await seedTitle('n-lion', 'Lion');
    await seedTitle('n-matrix', 'The Matrix');
    await seedTitle('n-nope', 'Nope');

    expect(ids(await list('?sort=name&dir=asc'))).toEqual(['n-lion', 'n-matrix', 'n-nope']);
  });

  it('T-API-029s: a FOREIGN article is part of the title', async () => {
    // ⚠ OWNER DECISION, 2026-09-15, and this is its end-to-end guard:
    // `Les Misérables` under L and `El Camino` under E. If someone
    // "completes" the article list in `deriveSortName`, these two rows move
    // and this test fails — which is the only thing that would say so.
    await seedTitle('n-el-camino', 'El Camino');
    await seedTitle('n-fargo', 'Fargo');
    await seedTitle('n-les-mis', 'Les Misérables');
    await seedTitle('n-moon', 'Moon');

    expect(ids(await list('?sort=name&dir=asc'))).toEqual([
      'n-el-camino',
      'n-fargo',
      'n-les-mis',
      'n-moon',
    ]);
  });

  it('T-API-029t: nameless titles sort LAST in BOTH directions', async () => {
    // SQL Server puts `NULL` FIRST on `ASC`, so without the explicit
    // `nulls: 'last'` an A–Z list opens with every title whose name could not
    // be read from the screenshot — an absence of data presented as a claim.
    await seedTitle('n-alpha', 'Alpha');
    await seedTitle('n-omega', 'Omega');
    await seedTitle('n-nameless', null);

    expect(ids(await list('?sort=name&dir=asc'))).toEqual(['n-alpha', 'n-omega', 'n-nameless']);
    expect(ids(await list('?sort=name&dir=desc'))).toEqual(['n-omega', 'n-alpha', 'n-nameless']);
  });

  it('T-API-029u: paging a name-ordered list returns every row exactly once', async () => {
    // ⚠ THE THREE-BRANCH KEYSET IS ONLY OBSERVABLE HERE. A single-page
    // assertion cannot see a missing "any row with no value at all" branch;
    // it truncates the list at the first nameless title, silently.
    //
    // ⚠ THE TIED PAIR IS DELIBERATE. `Amelie` and `Amélie` compare EQUAL under
    // CI_AI, so the boundary between them is resolved by the `id` tie-break
    // alone. Without it one of the two vanishes between pages.
    const names: [string, string | null][] = [
      ['n-p1', 'apple'],
      ['n-p2', 'Amelie'],
      ['n-p3', 'Amélie'],
      ['n-p4', 'The Bear'],
      ['n-p5', 'Zebra'],
      ['n-p6', null],
      ['n-p7', 'Casino'],
      ['n-p8', null],
      ['n-p9', 'les misérables'],
    ];
    for (const [id, name] of names) await seedTitle(id, name);

    const expected = [...names]
      .map(([id, name]) => ({
        id,
        sortName: deriveSortName({ tmdbName: name, rawExtractedText: null }),
      }))
      .sort((a, b) => compareTitlesByName(a, b, 'asc'))
      .map((row) => row.id);

    const walked = await walk('?sort=name&dir=asc', 2);

    expect(walked).toHaveLength(names.length);
    expect(new Set(walked).size).toBe(names.length);
    expect(walked).toEqual(expected);
  });

  it('T-API-029v: reversing the direction reverses the named rows', async () => {
    await seedTitle('n-r1', 'apple');
    await seedTitle('n-r2', 'Banana');
    await seedTitle('n-r3', 'Cherry');

    expect(ids(await list('?sort=name&dir=desc'))).toEqual(['n-r3', 'n-r2', 'n-r1']);
  });

  it('T-API-029w: a name cursor is refused by a differently-sorted list', async () => {
    // Switching sort mid-page must be a loud `INVALID_CURSOR`, not a page of
    // quietly wrong rows — the cursor shapes are discriminated by key set and
    // this is what makes that safe.
    await seedTitle('n-c1', 'apple');
    await seedTitle('n-c2', 'Banana');

    const page = await list('?sort=name&dir=asc&limit=1');
    expect(page.nextCursor).not.toBeNull();

    const res = await fetch(
      `${origin}/api/titles?sort=dateAdded&cursor=${encodeURIComponent(page.nextCursor ?? '')}`,
      { headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) } },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_CURSOR');
  });
});

describe('T-INV-025 the stored sort key equals what the domain deriver computes', () => {
  it('T-INV-025a: every row written through the repository matches deriveSortName', async () => {
    // ⚠ THIS IS THE DRIFT GUARD FOR THE WHOLE FEATURE. `sortName` is derived
    // and stored, and it is maintained at a choke point (`withSortName`)
    // precisely so no write path can forget it. The failure mode of forgetting
    // is not an error — it is one row with a NULL key, sorting silently to the
    // end of an A–Z list.
    //
    // It is also what makes a MISSED BACKFILL loud: an environment where
    // `npm run backfill:sort-name` was never run after migration `0010` fails
    // here rather than serving a list quietly ordered by nothing.
    await seedTitle('n-i1', 'The Matrix');
    await seedTitle('n-i2', 'les misérables');
    await seedTitle('n-i3', null);
    await seedTitle('n-i4', '  spaced   out  ');

    const rows = await testPrisma().title.findMany({
      select: { id: true, tmdbName: true, rawExtractedText: true, sortName: true },
    });

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.sortName, `sortName drifted for ${row.id}`).toBe(deriveSortName(row));
    }
  });
});
