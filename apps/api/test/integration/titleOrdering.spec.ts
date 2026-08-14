/**
 * TASK-036 — list ordering through the API (US-020), integration level.
 *
 * The unit half (`packages/domain/test/ordering.spec.ts`) states the rule as a
 * comparator. These cases assert the DATABASE obeys the same rule, which is a
 * genuinely separate question: the ordering happens in SQL, in a dialect whose
 * defaults are invisible at the call site. SQL Server sorts `NULL` first on
 * `ASC` and last on `DESC`, so "nulls last" is free in the default direction
 * and wrong in the reversed one, and nothing in the query text says so.
 *
 * Expected sequences are computed with `sortTitlesForList` rather than written
 * out by hand wherever more than a couple of rows are involved. A hand-written
 * expectation agrees with whatever the author believed the order should be,
 * which is the exact failure this rule exists to prevent — but each case also
 * pins at least one concrete property directly, so a comparator that broke in
 * the same way as the query could not make both agree vacuously.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { sortTitlesForList } from '@nextup/domain';
import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { encodeCursor } from '../../src/pagination.js';
import {
  asOwnerId,
  createServiceListing,
  createTitle,
  createUploadBatch,
  softDeleteServiceListing,
  updateTitle,
  type OwnerId,
} from '../../src/repository/ownerData.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-ordering';
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
  sortDateAdded: string | null;
}

interface ListBody {
  items: Item[];
  nextCursor: string | null;
  limit: number;
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

let seq = 0;

/**
 * A title whose `id` is given EXPLICITLY, because the tie-breaker is the
 * property under test — a generated id would make the expected sequence a
 * function of insertion order, which is what the tie-breaker exists to stop
 * mattering.
 *
 * `dateAdded: null` seeds a title that is `active` but dateless. The schema
 * permits it (`sort_date_added DATE`, nullable, no CHECK) and it is what a
 * title whose listings were all removed and one restored would transiently
 * look like — so `T-LIST-027` is asserting a reachable state, not a
 * hypothetical one.
 */
async function seedTitle(id: string, dateAdded: string | null, service = 'netflix') {
  seq += 1;
  const batch = await createUploadBatch(owner, {
    id: `b-${id}`,
    service,
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
    tmdbName: `Ordering ${id}`,
    tmdbGenres: JSON.stringify(['Drama']),
    sortDateAdded: dateAdded === null ? null : new Date(`${dateAdded}T00:00:00.000Z`),
    createdByBatchId: batch.id,
  });
  const listing = await createServiceListing(owner, {
    listingId: `l-${id}`,
    titleId: title.id,
    service,
    state: 'active',
    dateAdded: new Date(`${dateAdded ?? '2026-04-02'}T00:00:00.000Z`),
    createdByBatchId: batch.id,
  });
  return { title, listing, batch };
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

describe('T-LIST-025 the default order is sortDateAdded descending', () => {
  it('T-LIST-025a: newest-first with no dir parameter at all (REQ-038, A44)', async () => {
    await seedTitle('t-old', '2026-01-05');
    await seedTitle('t-new', '2026-09-30');
    await seedTitle('t-mid', '2026-04-02');

    expect(ids(await list())).toEqual(['t-new', 't-mid', 't-old']);
  });

  it('T-LIST-025b: an explicit dir=desc is identical to the default', async () => {
    await seedTitle('t-old', '2026-01-05');
    await seedTitle('t-new', '2026-09-30');

    expect(ids(await list())).toEqual(ids(await list('?dir=desc')));
  });

  it('T-LIST-025c: the SQL order matches the domain comparator exactly', async () => {
    for (const [id, date] of [
      ['t-c', '2026-04-02'],
      ['t-a', '2026-09-30'],
      ['t-d', '2026-01-05'],
      ['t-b', '2026-04-02'],
    ] as const) {
      await seedTitle(id, date);
    }
    const body = await list();
    const expected = sortTitlesForList(
      body.items.map((i) => ({ id: i.titleId, sortDateAdded: i.sortDateAdded })),
      'desc',
    ).map((r) => r.id);
    expect(ids(body)).toEqual(expected);
    // Pinned directly too, so a comparator broken the same way as the query
    // could not make the two agree vacuously.
    expect(ids(body)).toEqual(['t-a', 't-b', 't-c', 't-d']);
  });
});

describe('T-LIST-026 reversing the direction re-orders deterministically, tie-breaker unchanged', () => {
  it('T-LIST-026a: dir=asc is the exact reverse of the default when no dates tie', async () => {
    await seedTitle('t-old', '2026-01-05');
    await seedTitle('t-mid', '2026-04-02');
    await seedTitle('t-new', '2026-09-30');

    const desc = ids(await list('?dir=desc'));
    const asc = ids(await list('?dir=asc'));
    expect(asc).toEqual([...desc].reverse());
    expect(asc).toEqual(['t-old', 't-mid', 't-new']);
  });

  it('T-LIST-026b: ⚠ tied rows keep id-ASCENDING order in BOTH directions', async () => {
    // The regression this case exists for: `orderBy: [{ date: dir }, { id: dir }]`
    // reads as symmetric and is not. Under it, dir=desc returned c,b,a here and
    // dir=asc returned a,b,c — the tie order flipped, so reversing the sort
    // silently reshuffled every group of rows sharing a date. A first import
    // gives EVERY title the same date, so that is the common case, not a corner.
    for (const id of ['t-c', 't-a', 't-b']) await seedTitle(id, '2026-04-02');

    expect(ids(await list('?dir=desc'))).toEqual(['t-a', 't-b', 't-c']);
    expect(ids(await list('?dir=asc'))).toEqual(['t-a', 't-b', 't-c']);
  });

  it('T-LIST-026c: with ties present, asc is NOT simply the reverse of desc', async () => {
    // Non-vacuity for 026a. If the tie-breaker flipped with direction, asc
    // WOULD be the exact reverse of desc, and 026a would pass while 026b fails.
    // Stating the difference makes the two cases independent.
    await seedTitle('t-a', '2026-04-02');
    await seedTitle('t-b', '2026-04-02');
    await seedTitle('t-z', '2026-09-30');

    const desc = ids(await list('?dir=desc'));
    const asc = ids(await list('?dir=asc'));
    expect(desc).toEqual(['t-z', 't-a', 't-b']);
    expect(asc).toEqual(['t-a', 't-b', 't-z']);
    expect(asc).not.toEqual([...desc].reverse());
  });

  it('T-LIST-026d: repeated identical requests return an identical sequence', async () => {
    for (const id of ['t-c', 't-a', 't-b', 't-d']) await seedTitle(id, '2026-04-02');

    const runs = await Promise.all([list(), list(), list()]);
    const sequences = new Set(runs.map((r) => ids(r).join(',')));
    expect(sequences.size).toBe(1);
    expect([...sequences][0]).toBe('t-a,t-b,t-c,t-d');
  });

  it('T-LIST-026e: paging a tied group does not skip or repeat a row', async () => {
    // The keyset predicate must mirror the ORDER BY exactly. When the id branch
    // used the direction-dependent operator, page 2 of a tied group under
    // dir=desc asked for `id < cursor.id` while the ORDER BY walked ids
    // ascending — so page 2 was empty and three of five rows vanished. Rows
    // disappearing without being removed is the failure this product is built
    // against, and no error is raised when it happens.
    for (const id of ['t-a', 't-b', 't-c', 't-d', 't-e']) await seedTitle(id, '2026-04-02');

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const body: ListBody = await list(
        `?limit=2${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      seen.push(...ids(body));
      cursor = body.nextCursor;
      if (cursor === null) break;
    }

    expect(seen).toEqual(['t-a', 't-b', 't-c', 't-d', 't-e']);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('T-LIST-026f: a cursor mid-tie resumes after that id, not before it', async () => {
    for (const id of ['t-a', 't-b', 't-c']) await seedTitle(id, '2026-04-02');

    const body = await list(
      `?cursor=${encodeURIComponent(encodeCursor({ sortDateAdded: '2026-04-02', id: 't-a' }))}`,
    );
    expect(ids(body)).toEqual(['t-b', 't-c']);
  });
});

describe('T-LIST-027 a null sortDateAdded sorts last under BOTH directions', () => {
  it('T-LIST-027a: a dateless row is last under the desc default', async () => {
    await seedTitle('t-dated', '2026-04-02');
    await seedTitle('t-null', null);

    expect(ids(await list())).toEqual(['t-dated', 't-null']);
  });

  it('T-LIST-027b: ⚠ and last under dir=asc, where SQL Server would put it FIRST', async () => {
    // SQL Server orders NULLs first on ASC. Without the explicit
    // `nulls: 'last'`, the oldest-first control — which product invariant 6
    // makes `must`, not optional — would head the list with dateless rows.
    await seedTitle('t-dated', '2026-04-02');
    await seedTitle('t-null', null);

    expect(ids(await list('?dir=asc'))).toEqual(['t-dated', 't-null']);
  });

  it('T-LIST-027c: several dateless rows stay last and order by id ascending', async () => {
    await seedTitle('t-dated', '2026-04-02');
    await seedTitle('t-nb', null);
    await seedTitle('t-na', null);

    for (const dir of ['desc', 'asc'] as const) {
      expect(ids(await list(`?dir=${dir}`))).toEqual(['t-dated', 't-na', 't-nb']);
    }
  });

  it('T-LIST-027d: the null row still carries sortDateAdded: null in the payload', async () => {
    // Non-vacuity: if the seed silently defaulted the date, 027a–c would be
    // asserting the ordering of two ordinary dated rows.
    await seedTitle('t-dated', '2026-04-02');
    await seedTitle('t-null', null);

    const body = await list();
    expect(body.items.find((i) => i.titleId === 't-null')?.sortDateAdded).toBeNull();
    expect(body.items.find((i) => i.titleId === 't-dated')?.sortDateAdded).toBe('2026-04-02');
  });

  it('T-LIST-027e: nulls last agrees with the domain comparator', async () => {
    await seedTitle('t-dated', '2026-04-02');
    await seedTitle('t-later', '2026-09-30');
    await seedTitle('t-null', null);

    for (const dir of ['desc', 'asc'] as const) {
      const body = await list(`?dir=${dir}`);
      expect(ids(body)).toEqual(
        sortTitlesForList(
          body.items.map((i) => ({ id: i.titleId, sortDateAdded: i.sortDateAdded })),
          dir,
        ).map((r) => r.id),
      );
    }
  });
});

describe('T-LIST-014/015 the sort key through the API', () => {
  it('T-LIST-014e: adding a LATER listing does not move the row (US-020 AC-4)', async () => {
    const { title, batch } = await seedTitle('t-two', '2026-01-05');
    await seedTitle('t-mid', '2026-04-02');

    // Newest-first: t-mid (Apr) outranks t-two (Jan).
    expect(ids(await list())).toEqual(['t-mid', 't-two']);

    // t-two picks up a SEPTEMBER listing on a second service. Its key is the
    // EARLIEST date across its listings, so it stays January and the row does
    // not move. Sorting by the latest date — or recomputing the key from the
    // newest listing — would lift it above t-mid here.
    await createServiceListing(owner, {
      listingId: 'l-t-two-max',
      titleId: title.id,
      service: 'max',
      state: 'active',
      dateAdded: new Date('2026-09-30T00:00:00.000Z'),
      createdByBatchId: batch.id,
    });

    expect(ids(await list())).toEqual(['t-mid', 't-two']);
  });

  it('T-LIST-015d: removing the earliest listing recomputes the key and moves the row', async () => {
    const { title, batch } = await seedTitle('t-moves', '2026-01-05');
    await createServiceListing(owner, {
      listingId: 'l-t-moves-max',
      titleId: title.id,
      service: 'max',
      state: 'active',
      dateAdded: new Date('2026-09-30T00:00:00.000Z'),
      createdByBatchId: batch.id,
    });
    await seedTitle('t-anchor', '2026-04-02');

    expect(ids(await list())).toEqual(['t-anchor', 't-moves']);

    // The January listing goes; September becomes the earliest remaining one.
    // ⚠ `dateAdded` on the surviving listing is untouched — `T-INV-006` — and
    // the key is recomputed rather than edited in place on the listing.
    await softDeleteServiceListing(owner, 'l-t-moves', {
      removedByBatchId: batch.id,
      removedAt: new Date('2026-10-01T00:00:00.000Z'),
    });
    await updateTitle(owner, title.id, {
      sortDateAdded: new Date('2026-09-30T00:00:00.000Z'),
    });

    expect(ids(await list())).toEqual(['t-moves', 't-anchor']);
  });
});
