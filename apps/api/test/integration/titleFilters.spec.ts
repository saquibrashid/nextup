/**
 * TASK-037 — list filters (US-019, `specs/api.md` §6.2), integration level.
 *
 * ⚠ Before this task the `genre` parameter was PARSED and then dropped: the
 * handler never passed it to the query, so `?genre=Comedy` validated, returned
 * 200, and listed every title. A filter that silently does nothing is worse
 * than one that errors — the owner reads the unfiltered list as the filtered
 * answer. `T-LIST-022a` is the case that would have caught it.
 *
 * These run against a real SQL Server because every property here is a
 * property of the QUERY: the genre match is a token match inside a JSON
 * column under a binary collation, and the interaction between the filter's
 * `OR` and the keyset predicate's `OR` is a Prisma-object-shape hazard that no
 * mock would reproduce.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

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
  softDeleteServiceListing,
  type OwnerId,
} from '../../src/repository/ownerData.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-filters';
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
  genres: string[];
  badges: { service: string }[];
}

interface ListBody {
  items: Item[];
  nextCursor: string | null;
}

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

let server: Server;
let app: Express;
let origin: string;
let owner: OwnerId;

const get = (query = ''): Promise<Response> =>
  fetch(`${origin}/api/titles${query}`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) },
  });

const list = async (query = ''): Promise<ListBody> => {
  const res = await get(query);
  expect(res.status).toBe(200);
  return (await res.json()) as ListBody;
};

/** Ids in the order returned, so a case can assert membership AND order. */
const ids = (body: ListBody): string[] => body.items.map((i) => i.titleId);
/** Ids as a set, for the many cases where only membership is the point. */
const idSet = async (query = ''): Promise<string[]> => [...ids(await list(query))].sort();

let seq = 0;

/**
 * A title with one active listing per named service.
 *
 * `genres` is passed through verbatim — including `[]`, which is the whole
 * point of US-019 AC-6 and must never be defaulted anywhere in this helper.
 */
async function seedTitle(options: {
  id: string;
  services?: readonly string[];
  mediaType?: string;
  genres?: string[];
  dateAdded?: string;
}) {
  seq += 1;
  const services = options.services ?? ['netflix'];
  const date = options.dateAdded ?? '2026-04-02';
  const primary = services[0] ?? 'netflix';

  const batch = await createUploadBatch(owner, {
    id: `b-${options.id}`,
    service: primary,
    mode: 'append-only',
    status: 'applied',
  });
  const title = await createTitle(owner, {
    id: options.id,
    workIdentity: `tmdb:movie:${String(8000 + seq)}`,
    state: 'active',
    matchState: 'matched',
    tmdbId: 8000 + seq,
    tmdbMediaType: options.mediaType ?? 'movie',
    tmdbName: `Filter ${options.id}`,
    tmdbGenres: JSON.stringify(options.genres ?? ['Drama']),
    sortDateAdded: new Date(`${date}T00:00:00.000Z`),
    createdByBatchId: batch.id,
  });
  for (const service of services) {
    await createServiceListing(owner, {
      listingId: `l-${options.id}-${service}`,
      titleId: title.id,
      service,
      state: 'active',
      dateAdded: new Date(`${date}T00:00:00.000Z`),
      createdByBatchId: batch.id,
    });
  }
  return { title, batch };
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

describe('T-LIST-020 the service filter selects titles holding an ACTIVE listing there', () => {
  it('T-LIST-020a: only titles on the named service are returned', async () => {
    await seedTitle({ id: 't-nf', services: ['netflix'] });
    await seedTitle({ id: 't-max', services: ['max'] });

    expect(await idSet('?service=netflix')).toEqual(['t-nf']);
    expect(await idSet('?service=max')).toEqual(['t-max']);
  });

  it('T-LIST-020b: ⚠ filtering by one service does NOT hide the row\u2019s other badges', async () => {
    // REQ-032. The filter narrows which ROWS appear, never which badges a row
    // carries — a Netflix-filtered list still has to tell the owner the title
    // is also on Max, or the filter quietly misreports the library.
    await seedTitle({ id: 't-both', services: ['netflix', 'max'] });

    const body = await list('?service=netflix');
    expect(ids(body)).toEqual(['t-both']);
    expect(body.items[0]?.badges.map((b) => b.service).sort()).toEqual(['max', 'netflix']);
  });

  it('T-LIST-020c: a REMOVED listing does not satisfy the filter', async () => {
    const { batch } = await seedTitle({ id: 't-gone', services: ['netflix', 'max'] });
    await softDeleteServiceListing(owner, 'l-t-gone-netflix', {
      removedByBatchId: batch.id,
      removedAt: new Date('2026-05-01T00:00:00.000Z'),
    });

    expect(await idSet('?service=netflix')).toEqual([]);
    expect(await idSet('?service=max')).toEqual(['t-gone']);
  });

  it('T-LIST-020d: repeating service is OR within the dimension', async () => {
    await seedTitle({ id: 't-nf', services: ['netflix'] });
    await seedTitle({ id: 't-max', services: ['max'] });

    expect(await idSet('?service=netflix&service=max')).toEqual(['t-max', 't-nf']);
  });

  it('T-LIST-020e: no service filter returns every title', async () => {
    // Non-vacuity for the whole describe: proves the seeds are visible at all,
    // so a filter that returned nothing could not pass 020a by accident.
    await seedTitle({ id: 't-nf', services: ['netflix'] });
    await seedTitle({ id: 't-max', services: ['max'] });

    expect(await idSet()).toEqual(['t-max', 't-nf']);
  });
});

describe('T-LIST-021 the type filter', () => {
  it('T-LIST-021a: type=movie returns only movies', async () => {
    await seedTitle({ id: 't-movie', mediaType: 'movie' });
    await seedTitle({ id: 't-tv', mediaType: 'tv' });

    expect(await idSet('?type=movie')).toEqual(['t-movie']);
  });

  it('T-LIST-021b: type=tv returns only tv', async () => {
    await seedTitle({ id: 't-movie', mediaType: 'movie' });
    await seedTitle({ id: 't-tv', mediaType: 'tv' });

    expect(await idSet('?type=tv')).toEqual(['t-tv']);
  });

  it('T-LIST-021c: no type filter returns both', async () => {
    await seedTitle({ id: 't-movie', mediaType: 'movie' });
    await seedTitle({ id: 't-tv', mediaType: 'tv' });

    expect(await idSet()).toEqual(['t-movie', 't-tv']);
  });

  it('T-LIST-021d: an unsupported type is a 400 that does not echo the value', async () => {
    const res = await get('?type=documentary');
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(body)).not.toContain('documentary');
  });
});

describe('T-LIST-022 the genre filter', () => {
  it('T-LIST-022a: ⚠ genre actually filters — it is not parsed and dropped', async () => {
    // The regression this case exists for: `genre` was validated and then never
    // reached the query, so this returned BOTH titles with a 200.
    await seedTitle({ id: 't-comedy', genres: ['Comedy'] });
    await seedTitle({ id: 't-drama', genres: ['Drama'] });

    expect(await idSet('?genre=Comedy')).toEqual(['t-comedy']);
  });

  it('T-LIST-022b: a title matches on ANY of its genres, not only the first', async () => {
    await seedTitle({ id: 't-multi', genres: ['Science Fiction', 'Adventure'] });

    expect(await idSet('?genre=Adventure')).toEqual(['t-multi']);
    expect(await idSet('?genre=Science Fiction')).toEqual(['t-multi']);
  });

  it('T-LIST-022c: ⚠ a genre that is a PREFIX of another does not match it', async () => {
    // The match is on the quoted token `"Drama"`, not on the bare name. Drop
    // the quotes and this title is returned for `?genre=Drama`, which is a
    // wrong row appearing in a filtered list — the least visible kind of bug.
    await seedTitle({ id: 't-dramatic', genres: ['Dramatic Arts'] });

    expect(await idSet('?genre=Drama')).toEqual([]);
    expect(await idSet('?genre=Dramatic Arts')).toEqual(['t-dramatic']);
  });

  it('T-LIST-022d: matching is case- and accent-sensitive (BIN2 collation)', async () => {
    // Recorded so it cannot change by accident. The values come from TMDB's
    // fixed vocabulary and the filter bar offers them from the owner's own
    // data, so a near-miss spelling returning nothing is correct — guessing
    // would be worse.
    await seedTitle({ id: 't-comedy', genres: ['Comedy'] });

    expect(await idSet('?genre=comedy')).toEqual([]);
    expect(await idSet('?genre=Comedy')).toEqual(['t-comedy']);
  });

  it('T-LIST-022e: repeating genre is OR within the dimension', async () => {
    await seedTitle({ id: 't-comedy', genres: ['Comedy'] });
    await seedTitle({ id: 't-drama', genres: ['Drama'] });
    await seedTitle({ id: 't-horror', genres: ['Horror'] });

    expect(await idSet('?genre=Comedy&genre=Drama')).toEqual(['t-comedy', 't-drama']);
  });

  it('T-LIST-022f: a LIKE metacharacter is refused, not treated as a wildcard', async () => {
    // Prisma's `contains` does not escape `%`, so without the guard this would
    // match every title and read as "the filter found everything".
    await seedTitle({ id: 't-comedy', genres: ['Comedy'] });

    for (const bad of ['%', '_', 'Com%dy', '[Cc]omedy']) {
      const res = await get(`?genre=${encodeURIComponent(bad)}`);
      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('T-LIST-022g: a JSON escape character is refused', async () => {
    for (const bad of ['"', 'Com\\edy', 'Com"edy']) {
      const res = await get(`?genre=${encodeURIComponent(bad)}`);
      expect(res.status).toBe(400);
    }
  });

  it('T-LIST-022h: the genre filter survives paging (the two-OR hazard)', async () => {
    // The genre predicate and the keyset predicate are both `OR`s. As sibling
    // keys in one object the second replaces the first, so page 1 would filter
    // and page 2 would return everything. Nothing errors when that happens.
    for (const id of ['t-c1', 't-c2', 't-c3']) {
      await seedTitle({ id, genres: ['Comedy'] });
    }
    for (const id of ['t-d1', 't-d2', 't-d3']) {
      await seedTitle({ id, genres: ['Drama'] });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const body: ListBody = await list(
        `?genre=Comedy&limit=2${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      seen.push(...ids(body));
      cursor = body.nextCursor;
      if (cursor === null) break;
    }

    expect([...seen].sort()).toEqual(['t-c1', 't-c2', 't-c3']);
  });
});

describe('T-LIST-023 filters AND across dimensions, OR within one', () => {
  beforeEach(async () => {
    await seedTitle({
      id: 't-nf-movie-comedy',
      services: ['netflix'],
      mediaType: 'movie',
      genres: ['Comedy'],
    });
    await seedTitle({
      id: 't-nf-tv-comedy',
      services: ['netflix'],
      mediaType: 'tv',
      genres: ['Comedy'],
    });
    await seedTitle({
      id: 't-max-movie-comedy',
      services: ['max'],
      mediaType: 'movie',
      genres: ['Comedy'],
    });
    await seedTitle({
      id: 't-nf-movie-drama',
      services: ['netflix'],
      mediaType: 'movie',
      genres: ['Drama'],
    });
  });

  it('T-LIST-023a: service AND type AND genre all narrow together', async () => {
    expect(await idSet('?service=netflix&type=movie&genre=Comedy')).toEqual(['t-nf-movie-comedy']);
  });

  it('T-LIST-023b: OR within a dimension widens only that dimension', async () => {
    // Two services OR'd, still AND'd against type=movie and genre=Comedy.
    expect(await idSet('?service=netflix&service=max&type=movie&genre=Comedy')).toEqual([
      't-max-movie-comedy',
      't-nf-movie-comedy',
    ]);
  });

  it('T-LIST-023c: ⚠ dimensions are AND, not OR — a match on one is not enough', async () => {
    // If the dimensions were OR'd, this would return all four seeds. It is the
    // discriminating case: every other case here passes under either reading.
    const got = await idSet('?service=max&type=tv');
    expect(got).toEqual([]);
  });

  it('T-LIST-023d: dropping one dimension widens the result predictably', async () => {
    expect(await idSet('?service=netflix&genre=Comedy')).toEqual([
      't-nf-movie-comedy',
      't-nf-tv-comedy',
    ]);
    expect(await idSet('?service=netflix&type=movie')).toEqual([
      't-nf-movie-comedy',
      't-nf-movie-drama',
    ]);
  });

  it('T-LIST-023e: no filters at all returns every title', async () => {
    expect(await idSet()).toEqual([
      't-max-movie-comedy',
      't-nf-movie-comedy',
      't-nf-movie-drama',
      't-nf-tv-comedy',
    ]);
  });
});

describe('T-LIST-024 a title with genres: [] is excluded when filtering, included when not', () => {
  it('T-LIST-024a: an empty-genre title is EXCLUDED from a genre-filtered result', async () => {
    await seedTitle({ id: 't-none', genres: [] });
    await seedTitle({ id: 't-comedy', genres: ['Comedy'] });

    expect(await idSet('?genre=Comedy')).toEqual(['t-comedy']);
  });

  it('T-LIST-024b: and INCLUDED when no genre filter is set', async () => {
    await seedTitle({ id: 't-none', genres: [] });
    await seedTitle({ id: 't-comedy', genres: ['Comedy'] });

    expect(await idSet()).toEqual(['t-comedy', 't-none']);
  });

  it('T-LIST-024c: ⚠ genres are NEVER defaulted — the payload says [] and means it', async () => {
    // US-019 AC-6 and `specs/data-model.md` §5. If anything substituted a
    // placeholder genre, 024a would still pass (the title would simply not
    // match "Comedy") while the product quietly claimed a genre TMDB never
    // gave. Asserting the payload is what makes 024a non-vacuous.
    await seedTitle({ id: 't-none', genres: [] });

    const body = await list();
    expect(body.items[0]?.genres).toEqual([]);
  });

  it('T-LIST-024d: an empty-genre title is excluded no matter which genre is asked for', async () => {
    await seedTitle({ id: 't-none', genres: [] });

    for (const genre of ['Comedy', 'Drama', 'Documentary']) {
      expect(await idSet(`?genre=${encodeURIComponent(genre)}`)).toEqual([]);
    }
  });
});
