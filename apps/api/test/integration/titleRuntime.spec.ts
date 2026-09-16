/**
 * `T-API-019` / `T-API-020` — runtime sorting, the runtime filter and the
 * hidden-unknown count, AGAINST A REAL DATABASE (`specs/ui-refresh.md` §5a,
 * `specs/api.md` §6.2).
 *
 * ⚠ **THESE CANNOT BE UNIT TESTS, AND THE UNIT HALF DOES NOT COVER THEM.**
 * `packages/domain/test/titleRuntime.spec.ts` states the rules as pure
 * functions; every rule under test HERE lives in SQL, where the pure functions
 * have no reach:
 *
 * - **Nulls-last is a dialect fact.** SQL Server sorts `NULL` FIRST on `ASC`
 *   and last on `DESC`. A comparator that says "nulls last" proves nothing
 *   about a query whose `ORDER BY` omits it — the two disagree only in the
 *   reversed direction, which is the one the owner reaches by clicking once.
 * - **The keyset predicate is only wrong on PAGE 2.** `runtimeKeyset` has
 *   three branches over a nullable column, and the branch that admits the
 *   `NULL` block is invisible to any test that asks for a single page: the
 *   list simply stops at the first unknown runtime and looks complete.
 * - **`runtimeUnknownHidden` is a count over rows the response never
 *   contains.** Nothing in memory can check it.
 *
 * Expected sequences come from `compareTitlesByRuntime` rather than being
 * written out by hand, for the reason `titleOrdering.spec.ts` gives — but each
 * case also pins a concrete property directly, so a comparator broken in the
 * same way as the query cannot make both agree vacuously.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { RUNTIME_BUCKETS, compareTitlesByRuntime } from '@nextup/domain';
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
const SUBJECT = 'oid-owner-runtime';
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

interface Item {
  titleId: string;
  runtimeMinutes: number | null;
}

interface ListBody {
  items: Item[];
  nextCursor: string | null;
  limit: number;
  runtimeUnknownHidden: number | null;
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

/**
 * Walks EVERY page and returns the ids in order.
 *
 * ⚠ THE POINT OF THIS SUITE. A single-page assertion cannot distinguish a
 * correct keyset from one that drops the `NULL` block, repeats a row, or skips
 * across a boundary. The page size is forced small so a handful of rows
 * produces several real boundaries.
 */
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

async function seedTitle(id: string, runtimeMinutes: number | null, mediaType = 'movie') {
  seq += 1;
  const batch = await createUploadBatch(owner, {
    id: `b-${id}`,
    service: 'netflix',
    mode: 'append-only',
    status: 'applied',
  });
  const title = await createTitle(owner, {
    id,
    workIdentity: `tmdb:${mediaType}:${String(8000 + seq)}`,
    state: 'active',
    matchState: 'matched',
    tmdbId: 8000 + seq,
    tmdbMediaType: mediaType,
    tmdbName: `Runtime ${id}`,
    tmdbGenres: JSON.stringify(['Drama']),
    tmdbRuntimeMinutes: runtimeMinutes,
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

describe('T-API-019 sort=runtime orders by runtime with NULLs last in BOTH directions', () => {
  const seedMixed = async (): Promise<void> => {
    await seedTitle('r-090', 90);
    await seedTitle('r-null-a', null);
    await seedTitle('r-045', 45);
    await seedTitle('r-null-b', null);
    await seedTitle('r-200', 200);
  };

  it('T-API-019a: ascending is shortest-first and does NOT open with the unknowns', async () => {
    // ⚠ THE DIALECT CASE. SQL Server sorts NULL FIRST on ASC, so an `ORDER BY`
    // without an explicit `nulls: 'last'` puts every unknown runtime at the
    // top of "Shortest first" — an absence of data rendered as a claim that
    // those titles are the shortest the owner owns.
    await seedMixed();

    expect(ids(await list('?sort=runtime&dir=asc'))).toEqual([
      'r-045',
      'r-090',
      'r-200',
      'r-null-a',
      'r-null-b',
    ]);
  });

  it('T-API-019b: descending is longest-first and ALSO ends with the unknowns', async () => {
    await seedMixed();

    expect(ids(await list('?sort=runtime&dir=desc'))).toEqual([
      'r-200',
      'r-090',
      'r-045',
      'r-null-a',
      'r-null-b',
    ]);
  });

  it('T-API-019c: the SQL order matches the domain comparator exactly, both ways', async () => {
    await seedMixed();

    const rows = [
      { id: 'r-090', runtimeMinutes: 90 },
      { id: 'r-null-a', runtimeMinutes: null },
      { id: 'r-045', runtimeMinutes: 45 },
      { id: 'r-null-b', runtimeMinutes: null },
      { id: 'r-200', runtimeMinutes: 200 },
    ];

    for (const dir of ['asc', 'desc'] as const) {
      const expected = [...rows]
        .sort((a, b) => compareTitlesByRuntime(a, b, dir))
        .map((row) => row.id);
      expect(ids(await list(`?sort=runtime&dir=${dir}`)), dir).toEqual(expected);
    }
  });

  it('T-API-019d: ties break on id ASCENDING in both directions', async () => {
    await seedTitle('r-tie-z', 90);
    await seedTitle('r-tie-a', 90);

    expect(ids(await list('?sort=runtime&dir=asc'))).toEqual(['r-tie-a', 'r-tie-z']);
    expect(ids(await list('?sort=runtime&dir=desc'))).toEqual(['r-tie-a', 'r-tie-z']);
  });

  it('T-API-019e: a ZERO runtime cannot be STORED at all — unknown is spelled NULL', async () => {
    // ⚠ THIS CASE FAILED IN CI AND THE FIX WAS A MIGRATION, NOT AN ASSERTION.
    //
    // TMDB returns `runtime: 0` for works it has no runtime for, so 0 was a
    // real stored value. The application treated it as unknown when
    // DISPLAYING, FILTERING and COUNTING — and could not when ORDERING:
    // `ORDER BY` sees a number, Prisma's `orderBy` has no CASE, and rewriting
    // this query as raw SQL would take it out of reach of `T-SEC-021`'s
    // textual `ownerId` check. This test read
    //   expected [ 'r-zero', 'r-045' ] to deeply equal [ 'r-045', 'r-zero' ]
    // — the zero-runtime title sorting FIRST under "Shortest first" while
    // every other surface called it unknown.
    //
    // `0009_runtime_unknown_is_null` deletes the state instead of teaching a
    // fourth consumer about it: existing rows normalised to NULL, and a CHECK
    // constraint so no new one arrives. Four consumers agreeing by convention
    // is a rule that holds only while every future reader remembers it; a
    // constraint holds without being remembered.
    //
    // So the strong claim is not "a zero sorts correctly" — it is that a zero
    // cannot reach the ordering code at all. NULL then sorts last explicitly
    // (`a`/`b` above) and the whole contradiction is unreachable.
    await expect(seedTitle('r-zero', 0)).rejects.toThrow();
    await expect(seedTitle('r-neg', -5)).rejects.toThrow();

    // NULL is how unknown is spelled, and it is still accepted.
    await seedTitle('r-null', null);
    await seedTitle('r-045', 45);
    expect(ids(await list('?sort=runtime&dir=asc'))).toEqual(['r-045', 'r-null']);
  });

  it('T-API-019f: PAGING a runtime-sorted list loses and repeats nothing', async () => {
    // ⚠ THE KEYSET CASE, AND THE REASON THIS FILE EXISTS. The predicate has
    // three branches over a nullable column. Drop the one that admits the
    // `NULL` block and the list ends at the first unknown runtime — the
    // response looks like a complete list, not like an error. Re-admit the
    // non-null branches from a position inside the block and rows already
    // paged past come back. Only a full walk across several boundaries can
    // tell any of that from a correct page 1.
    await seedMixed();
    await seedTitle('r-120', 120);
    await seedTitle('r-null-c', null);

    for (const dir of ['asc', 'desc'] as const) {
      const walked = await walk(`?sort=runtime&dir=${dir}`, 2);
      const whole = ids(await list(`?sort=runtime&dir=${dir}&limit=50`));

      expect(walked, `${dir}: paged walk`).toEqual(whole);
      expect(new Set(walked).size, `${dir}: no repeats`).toBe(walked.length);
      expect(walked, `${dir}: nothing lost`).toHaveLength(7);
    }
  });

  it('T-API-019g: a page boundary landing INSIDE the null block still terminates correctly', async () => {
    // The third branch in isolation: with `limit=1` every boundary after the
    // first unknown is a null-to-null step, which is the only case the
    // "position inside the null block" branch handles.
    await seedTitle('r-090', 90);
    await seedTitle('r-null-a', null);
    await seedTitle('r-null-b', null);
    await seedTitle('r-null-c', null);

    expect(await walk('?sort=runtime&dir=asc', 1)).toEqual([
      'r-090',
      'r-null-a',
      'r-null-b',
      'r-null-c',
    ]);
  });

  it('T-API-019h: a cursor cut from the DATE sort is refused, never silently mispaged', async () => {
    // ⚠ The keyset would otherwise not mirror its own ORDER BY, which skips
    // and repeats rows at every boundary. A 400 is the whole point: the owner
    // sees an error rather than a plausible page of wrong rows.
    await seedMixed();

    const dateCursor = (await list('?limit=2')).nextCursor;
    expect(dateCursor).not.toBeNull();

    const res = await fetch(
      `${origin}/api/titles?sort=runtime&cursor=${encodeURIComponent(dateCursor ?? '')}`,
      { headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) } },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_CURSOR');
  });

  it('T-API-019i: the default sort is unchanged — absent `sort` is still date-added', async () => {
    // REQ-038/`A44`. Adding a sort key must not move the default out from
    // under an owner who never asked for one.
    await seedTitle('r-090', 90);
    await seedTitle('r-045', 45);

    expect(ids(await list())).toEqual(ids(await list('?sort=dateAdded')));
  });
});

describe('T-API-020 runtimeUnknownHidden counts the whole filtered set', () => {
  it('T-API-020a: null when NO runtime filter is active', async () => {
    // `null` and `0` are different states: "not asked" versus "asked, none
    // hidden". Collapsing them loses the ability to tell them apart.
    await seedTitle('r-null-a', null);
    await seedTitle('r-090', 90);

    expect((await list()).runtimeUnknownHidden).toBeNull();
    expect((await list('?service=netflix')).runtimeUnknownHidden).toBeNull();
  });

  it('T-API-020b: counts the WHOLE filtered set, not the returned page', async () => {
    // ⚠ THE DEFECT THIS PINS. A page-scoped count under-reports, and
    // under-reports DIFFERENTLY on every page — a disclosure whose number
    // changes as the owner scrolls is worse than none at all.
    for (let i = 0; i < 5; i += 1) await seedTitle(`r-null-${String(i)}`, null);
    await seedTitle('r-060', 60);
    await seedTitle('r-089', 89);
    await seedTitle('r-090', 90);
    await seedTitle('r-119', 119);

    for (const runtime of [
      'runtime=60-90',
      'runtime=90-120',
      'runtime=60-120',
      'runtime=60-120&runtime=60-90&runtime=90-120',
    ]) {
      const firstPage = await list(`?${runtime}&limit=1`);
      expect(firstPage.items).toHaveLength(1);
      expect(firstPage.runtimeUnknownHidden).toBe(5);
      expect(firstPage.nextCursor).not.toBeNull();
      const secondPage = await list(
        `?${runtime}&limit=1&cursor=${encodeURIComponent(firstPage.nextCursor ?? '')}`,
      );
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.runtimeUnknownHidden).toBe(5);
      expect(ids(secondPage)).not.toEqual(ids(firstPage));
    }
  });

  it('T-API-020c: zero when the filter is active and nothing was hidden', async () => {
    await seedTitle('r-090', 90);

    expect((await list('?runtime=90-120')).runtimeUnknownHidden).toBe(0);
  });

  it('T-API-020d: the count and the filter stay exact complements of each other', async () => {
    // ⚠ THE COUNT IS THE EXACT COMPLEMENT OF THE FILTER. Anything the filter
    // excludes for want of a runtime must appear in the number that says how
    // many it hid; otherwise the list silently shortens, which is the whole
    // reason the disclosure exists.
    //
    // ⚠ This used to seed a ZERO runtime, because `0` could be stored.
    // `0009_runtime_unknown_is_null` makes that unrepresentable (see
    // `T-API-019e`), so the case is asserted where it is now REACHABLE: the
    // `> 0` floor in `runtimeFilter` and the `<= 0` arm of the count predicate
    // remain as DEFENCE IN DEPTH, and this pins that they agree. Deleting
    // either because "zero cannot happen now" would make the next change that
    // relaxes the constraint silently wrong again.
    await seedTitle('r-null', null);
    await seedTitle('r-null-2', null);
    await seedTitle('r-020', 20);

    const body = await list('?runtime=under30');
    expect(ids(body)).toEqual(['r-020']);
    expect(body.runtimeUnknownHidden).toBe(2);

    // The complement holds: hidden + shown === the unfiltered total.
    const all = await list();
    expect(ids(body).length + (body.runtimeUnknownHidden ?? 0)).toBe(ids(all).length);
  });

  it('T-API-020e: it respects the OTHER active filters', async () => {
    // It counts what the runtime filter hid from THIS list, not from the
    // library. A count over every title would over-report the moment any other
    // filter was on, and the two numbers on screen would not add up.
    await seedTitle('r-null-movie', null, 'movie');
    await seedTitle('r-null-tv', null, 'tv');
    await seedTitle('r-090', 90);

    for (const runtime of ['60-90', '90-120', '60-120']) {
      expect((await list(`?runtime=${runtime}&type=movie`)).runtimeUnknownHidden).toBe(1);
      expect((await list(`?runtime=${runtime}`)).runtimeUnknownHidden).toBe(2);
    }
  });
});

describe('REQ-035 the runtime filter against the database', () => {
  it('T-API-020f: the bucket boundaries are half-open in SQL, exactly as in the domain', async () => {
    await seedTitle('r-029', 29);
    await seedTitle('r-030', 30);
    await seedTitle('r-059', 59);
    await seedTitle('r-060', 60);
    await seedTitle('r-089', 89);
    await seedTitle('r-090', 90);
    await seedTitle('r-119', 119);
    await seedTitle('r-120', 120);
    await seedTitle('r-null', null);

    expect(ids(await list('?runtime=under30'))).toEqual(['r-029']);
    expect(ids(await list('?runtime=30-60'))).toEqual(['r-030', 'r-059']);
    expect(ids(await list('?runtime=60-90'))).toEqual(['r-060', 'r-089']);
    expect(ids(await list('?runtime=90-120'))).toEqual(['r-090', 'r-119']);
    expect(ids(await list('?runtime=over120'))).toEqual(['r-120']);
  });

  it('T-API-020g: buckets are OR-ed within the dimension and AND-ed against other filters', async () => {
    await seedTitle('r-020', 20);
    await seedTitle('r-200', 200);
    await seedTitle('r-090', 90);

    expect(ids(await list('?runtime=under30&runtime=over120')).sort()).toEqual(['r-020', 'r-200']);
    expect(ids(await list('?runtime=under30&runtime=over120&type=tv'))).toEqual([]);
  });

  it('T-API-020h: the runtime filter composes with the GENRE filter rather than replacing it', async () => {
    // ⚠ Both predicates are `OR`-shaped, and two `OR` keys in one Prisma
    // `where` means the second silently REPLACES the first. That failure looks
    // like the genre filter giving up, not like an error, and only shows up
    // when both are active at once.
    await seedTitle('r-090', 90);

    expect(ids(await list('?runtime=90-120&genre=Drama'))).toEqual(['r-090']);
    expect(ids(await list('?runtime=90-120&genre=Comedy'))).toEqual([]);
    expect(ids(await list('?runtime=under30&genre=Drama'))).toEqual([]);
  });

  it('T-API-020i: an unknown runtime is excluded by any bucket and included by none', async () => {
    await seedTitle('r-null', null);
    await seedTitle('r-090', 90);

    for (const runtime of RUNTIME_BUCKETS) {
      const filtered = await list(`?runtime=${runtime}`);
      expect(ids(filtered)).not.toContain('r-null');
      expect(filtered.runtimeUnknownHidden).toBe(1);
    }
    expect(ids(await list('?runtime=90-120'))).toEqual(['r-090']);
    expect(ids(await list()).sort()).toEqual(['r-090', 'r-null']);
  });

  it('T-API-020j: the legacy alias is exactly both half-open buckets, with repeat-safe OR and paging', async () => {
    for (const minutes of [29, 59, 60, 89, 90, 119, 120]) {
      await seedTitle(`r-${String(minutes).padStart(3, '0')}`, minutes);
    }
    await seedTitle('r-null', null);

    const expected = ['r-060', 'r-089', 'r-090', 'r-119'];
    expect(ids(await list('?runtime=60-120'))).toEqual(expected);
    expect(ids(await list('?runtime=60-90&runtime=90-120'))).toEqual(expected);
    expect(
      await walk(
        '?runtime=60-120&runtime=60-90&runtime=90-120&runtime=60-120&sort=runtime&dir=asc',
        1,
      ),
    ).toEqual(expected);
    expect(ids(await list('?runtime=60-120&runtime=under30'))).toEqual(['r-029', ...expected]);
    expect(ids(await list('?runtime=60-120&genre=Drama'))).toEqual(expected);
    expect(ids(await list('?runtime=60-120&genre=Comedy'))).toEqual([]);
    expect(ids(await list('?runtime=60-120&type=tv'))).toEqual([]);
    expect(ids(await list('?runtime=60-120&service=max'))).toEqual([]);
    expect((await list('?runtime=60-120&genre=Comedy')).runtimeUnknownHidden).toBe(0);
  });
});
