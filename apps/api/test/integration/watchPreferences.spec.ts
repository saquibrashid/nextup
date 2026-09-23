import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { WatchPreferences, WatchPriority } from '@nextup/domain';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetTmdbRateLimiterForTests } from '../../src/clients/tmdbClient.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import {
  asOwnerId,
  createServiceListing,
  createSuppression,
  createTitle,
  createUploadBatch,
  findWatchPreference,
  listTitleRatingRows,
  runInTransaction,
  carryWatchPreference,
  updateTitleMetadata,
  type OwnerId,
} from '../../src/repository/ownerData.js';
import { tmdbMswServer } from '../../../../tests/fixtures/msw/tmdb/index.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const SUBJECT = 'watch-owner';
const OTHER_SUBJECT = 'watch-other';
const DUNE = 'tmdb:movie:438631';
const principal = (subject: string) =>
  Buffer.from(
    JSON.stringify({
      claims: [
        { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
        { typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: subject },
      ],
    }),
  ).toString('base64');

let server: Server;
let origin: string;
let owner: OwnerId;
let other: OwnerId;
let seq = 0;
let msw: ReturnType<typeof tmdbMswServer>;

interface Item extends WatchPreferences {
  category?: string;
  categoryOverride?: string | null;
  titleId: string;
  workIdentity: string;
  badges: { service: string }[];
}
interface ListBody {
  categoryPending?: number;
  items: Item[];
  nextCursor: string | null;
  runtimeUnknownHidden: number | null;
}

function request(path: string, method = 'GET', body?: unknown, subject = SUBJECT) {
  return fetch(`${origin}/api${path}`, {
    method,
    headers: {
      [CLIENT_PRINCIPAL_HEADER]: principal(subject),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function patch(id: string, body: unknown, status = 200, subject = SUBJECT) {
  const response = await request(`/titles/${id}/watch-preferences`, 'PATCH', body, subject);
  expect(response.status, await response.clone().text()).toBe(status);
  return response.json() as Promise<Item>;
}

async function list(query = ''): Promise<ListBody> {
  const response = await request(`/titles${query}`);
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json() as Promise<ListBody>;
}

async function detail(id: string): Promise<Item> {
  const response = await request(`/titles/${id}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<Item>;
}

async function seed(
  id: string,
  options: {
    owner?: OwnerId;
    identity?: string;
    runtime?: number | null;
    service?: string;
    batchStatus?: string;
    duplicate?: boolean;
    mediaType?: 'movie' | 'tv';
    name?: string;
  } = {},
) {
  const on = options.owner ?? owner;
  seq += 1;
  const workIdentity = options.identity ?? `tmdb:${options.mediaType ?? 'movie'}:${seq}`;
  const unmatched = workIdentity.startsWith('unmatched:');
  let createdByBatchId: string | null = null;
  if (options.batchStatus !== undefined) {
    createdByBatchId = `batch-${id}`;
    await createUploadBatch(on, {
      id: createdByBatchId,
      mode: 'append-only',
      service: 'netflix',
      status: options.batchStatus,
    });
  }
  const title = await createTitle(on, {
    id,
    workIdentity,
    state: 'active',
    matchState: unmatched ? 'unmatched' : 'matched',
    tmdbId: unmatched ? null : Number(workIdentity.split(':')[2]),
    tmdbMediaType: unmatched ? null : (options.mediaType ?? 'movie'),
    tmdbName: unmatched ? null : (options.name ?? id),
    rawExtractedText: unmatched ? 'Unread title' : null,
    normalisedText: unmatched ? 'unread title' : null,
    tmdbGenres: '["Drama"]',
    tmdbRuntimeMinutes: options.runtime === undefined ? 100 : options.runtime,
    tmdbFetchedAt: new Date(),
    sortDateAdded: new Date('2026-01-01'),
    createdByBatchId,
    duplicateAckSeq: options.duplicate === true ? id : '',
  });
  await createServiceListing(on, {
    listingId: `listing-${id}`,
    titleId: id,
    service: options.service ?? 'netflix',
    state: 'active',
    dateAdded: new Date('2026-01-01'),
    createdByBatchId,
  });
  return title;
}

async function importWork(service = 'netflix') {
  seq += 1;
  const batchId = `import-${seq}`;
  await createUploadBatch(owner, {
    id: batchId,
    mode: 'append-only',
    service,
    status: 'in-review',
    submittedAt: new Date(),
  });
  await testPrisma().extractionCandidate.create({
    data: {
      id: `candidate-${seq}`,
      ownerId: owner,
      batchId,
      rawText: 'Dune',
      inferredTitle: 'Dune',
      basis: 'both',
      ocrSupport: 'exact',
      provider: 'llm',
      normalisedText: 'dune',
      boxSource: 'llm',
      cleanupVerdict: 'title-candidate',
      resolvedWorkIdentity: DUNE,
      classification: 'new',
      reviewDisposition: 'confirmed',
      matchCandidates: JSON.stringify([
        {
          tmdbId: 438631,
          mediaType: 'movie',
          name: 'Dune',
          releaseYear: 2021,
          posterPath: '/dune.jpg',
          score: 1,
        },
      ]),
    },
  });
  const response = await request(`/batches/${batchId}/close`, 'POST', {});
  expect(response.status, await response.clone().text()).toBe(200);
}

beforeEach(async () => {
  resetAllowListWarning();
  resetTmdbRateLimiterForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = `${SUBJECT},${OTHER_SUBJECT}`;
  process.env['TMDB_API_KEY'] = 'test-key';
  testPrisma();
  await resetDatabase();
  msw = tmdbMswServer();
  msw.listen({
    onUnhandledRequest: (req, print) => {
      if (new URL(req.url).hostname === '127.0.0.1') return;
      print.error();
    },
  });
  await new Promise<void>((resolve) => {
    server = createApp({ webRoot: 'C:\\nonexistent-web-root' }).listen(0, () => {
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
  owner = asOwnerId(((await (await request('/me')).json()) as { ownerId: string }).ownerId);
  other = asOwnerId(
    ((await (await request('/me', 'GET', undefined, OTHER_SUBJECT)).json()) as { ownerId: string })
      .ownerId,
  );
});

afterEach(async () => {
  msw.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
  delete process.env['TMDB_API_KEY'];
});
afterAll(closeTestPrisma);

describe('T-CATEGORY-003 real SQL category persistence and filtering', () => {
  async function category(id: string, value: string | null, subject = SUBJECT) {
    return request(`/titles/${id}/category`, 'PATCH', { categoryOverride: value }, subject);
  }
  async function classified(id: string, comedy: boolean, mediaType: 'movie' | 'tv' = 'movie') {
    const title = await seed(id, { mediaType });
    await testPrisma().title.updateMany({
      where: { ownerId: owner, id },
      data: { tmdbComedyShow: comedy },
    });
    return title;
  }
  it('T-CATEGORY-003a owner overrides survive refresh and reappearance without changing title or listing facts', async () => {
    const title = await classified('special', true);
    await seed('foreign', { owner: other, identity: title.workIdentity });
    expect((await category('special', 'movie', OTHER_SUBJECT)).status).toBe(404);
    const before = await testPrisma().title.findFirstOrThrow({
      where: { ownerId: owner, id: title.id },
    });
    const listings = await testPrisma().serviceListing.findMany({
      where: { ownerId: owner, titleId: title.id },
    });
    await patch(title.id, { watching: true, priority: 'someday' });
    expect((await category(title.id, 'movie')).status).toBe(200);
    expect(await detail(title.id)).toMatchObject({
      category: 'movie',
      watching: true,
      priority: 'someday',
    });
    expect(
      await testPrisma().title.findFirstOrThrow({ where: { ownerId: owner, id: title.id } }),
    ).toEqual(before);
    expect(
      await testPrisma().serviceListing.findMany({ where: { ownerId: owner, titleId: title.id } }),
    ).toEqual(listings);
    await updateTitleMetadata(owner, title.id, {
      tmdbName: before.tmdbName ?? '',
      tmdbReleaseYear: null,
      tmdbRuntimeMinutes: 100,
      tmdbGenres: '["Comedy"]',
      tmdbPosterPath: null,
      imdbId: null,
      tmdbFetchedAt: new Date(),
      tmdbComedyShow: true,
    });
    expect((await detail(title.id)).category).toBe('movie');
    expect((await category(title.id, null)).status).toBe(200);
    expect((await detail(title.id)).category).toBe('comedy-show');
    await category(title.id, 'tv');
    await testPrisma().serviceListing.updateMany({
      where: { ownerId: owner, titleId: title.id },
      data: { state: 'removed', removedAt: new Date(), removalReason: 'service-removed' },
    });
    await testPrisma().title.updateMany({
      where: { ownerId: owner, id: title.id },
      data: { state: 'removed' },
    });
    await seed('reappeared', { identity: title.workIdentity });
    expect(await detail('reappeared')).toMatchObject({ category: 'tv', categoryOverride: 'tv' });
    expect(await findWatchPreference(other, title.workIdentity)).toBeNull();
    await runInTransaction(async (tx) =>
      carryWatchPreference(owner, title.workIdentity, 'tmdb:movie:999999', tx),
    );
    expect(await findWatchPreference(owner, 'tmdb:movie:999999')).toMatchObject({
      categoryOverride: 'tv',
      watching: true,
    });
  });
  it('T-CATEGORY-003b category SQL filtering agrees across page cursors, mixed filters and hidden runtime count', async () => {
    await classified('a-special', true);
    await classified('b-special', true, 'tv');
    await classified('c-comedy-film', false);
    await classified('d-sitcom', false, 'tv');
    await testPrisma().title.updateMany({
      where: { ownerId: owner, id: 'b-special' },
      data: { tmdbRuntimeMinutes: null },
    });
    const first = await list('?category=comedy-show&limit=1&sort=name&dir=asc');
    expect(first.items.map((item) => item.titleId)).toEqual(['a-special']);
    expect(first.categoryPending).toBe(0);
    expect(first.nextCursor).not.toBeNull();
    const second = await list(
      `?category=comedy-show&limit=1&sort=name&dir=asc&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
    );
    expect(second.items.map((item) => item.titleId)).toEqual(['b-special']);
    expect(second.nextCursor).toBeNull();
    const runtime = await list('?category=comedy-show&runtime=90-120&service=netflix');
    expect(runtime.items.map((item) => item.titleId)).toEqual(['a-special']);
    expect(runtime.runtimeUnknownHidden).toBe(1);
    expect((await list('?category=movie')).items.map((item) => item.titleId)).toEqual([
      'c-comedy-film',
    ]);
    expect((await list('?category=tv')).items.map((item) => item.titleId)).toEqual(['d-sitcom']);
    expect((await list('?type=tv')).items).toHaveLength(2);
    expect((await list('?category=movie&category=comedy-show')).items).toHaveLength(3);
    await category('d-sitcom', 'comedy-show');
    expect((await list('?category=comedy-show')).items).toHaveLength(3);
  });
  it('T-CATEGORY-003c old fresh caches are classified before filtering in bounded retryable batches', async () => {
    const seen: string[] = [];
    msw.use(
      http.get('https://api.themoviedb.org/3/movie/:id', ({ params, request: incoming }) => {
        const id = String(params['id']);
        seen.push(id);
        expect(new URL(incoming.url).searchParams.get('append_to_response')).toContain('keywords');
        return HttpResponse.json({
          title: 'Stand-up special',
          runtime: 70,
          genres: [{ name: 'Comedy' }],
          ...(id === '900000' ? {} : { keywords: { keywords: [{ name: 'stand-up comedy' }] } }),
        });
      }),
    );
    for (let i = 0; i < 27; i += 1) {
      await seed(`old-${String(i).padStart(2, '0')}`, {
        identity: `tmdb:movie:${String(900000 + i)}`,
      });
    }
    const first = await list('?category=comedy-show');
    expect(seen).toHaveLength(25);
    expect(first.items).toHaveLength(24);
    expect(first.categoryPending).toBe(3);
    const second = await list('?category=comedy-show');
    expect(second.items).toHaveLength(26);
    expect(second.categoryPending).toBe(1);
    expect(seen).toContain('900026');
    expect(await testPrisma().title.count({ where: { ownerId: owner } })).toBe(27);
    expect(
      await testPrisma().title.findFirstOrThrow({ where: { ownerId: owner, id: 'old-00' } }),
    ).toMatchObject({
      tmdbComedyShow: null,
      workIdentity: 'tmdb:movie:900000',
      sortDateAdded: new Date('2026-01-01'),
    });
  });
});

describe('T-WATCH-001 mutation and canonical-work persistence on real SQL', () => {
  it('T-WATCH-001d defaults, partial edits, independence, idempotency, and two-owner isolation', async () => {
    await seed('mine', { identity: DUNE });
    await seed('theirs', { identity: DUNE, owner: other });
    expect(await detail('mine')).toMatchObject({ watching: false, priority: 'normal' });
    expect((await list()).items[0]).toMatchObject({ watching: false, priority: 'normal' });
    expect(await findWatchPreference(owner, DUNE)).toBeNull();
    expect(await patch('mine', { priority: 'someday' })).toEqual({
      titleId: 'mine',
      watching: false,
      priority: 'someday',
    });
    expect(await patch('mine', { watching: true })).toEqual({
      titleId: 'mine',
      watching: true,
      priority: 'someday',
    });
    await patch('mine', { watching: true });
    await patch('theirs', { priority: 'up-next' }, 200, OTHER_SUBJECT);
    expect(await findWatchPreference(owner, DUNE)).toMatchObject({
      watching: true,
      priority: 'someday',
    });
    expect(await findWatchPreference(other, DUNE)).toMatchObject({
      watching: false,
      priority: 'up-next',
    });
    expect(await testPrisma().watchPreference.count()).toBe(2);
    expect(await detail('mine')).toMatchObject({ watching: true, priority: 'someday' });
    expect((await list()).items[0]).toMatchObject({ watching: true, priority: 'someday' });
    expect(await patch('mine', { watching: false })).toMatchObject({
      watching: false,
      priority: 'someday',
    });
  });

  it('T-WATCH-001e refuses missing, foreign, hidden-batch and suppressed titles without writes', async () => {
    await seed('foreign', { owner: other });
    await seed('hidden', { batchStatus: 'in-review' });
    const suppressed = await seed('suppressed');
    await createSuppression(owner, {
      id: 'suppressed-work',
      workIdentity: suppressed.workIdentity,
      displayName: 'Suppressed',
    });
    for (const titleId of ['missing', 'foreign', 'hidden']) {
      await patch(titleId, {}, 404);
      await patch(titleId, { watching: true }, 404);
    }
    await patch('suppressed', { watching: true }, 409);
    expect((await request('/titles/hidden')).status).toBe(404);
    expect((await list('?sort=watchPriority')).items).toEqual([]);
    expect(await testPrisma().watchPreference.count()).toBe(0);
    expect(
      (
        await fetch(`${origin}/api/titles/foreign/watch-preferences`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: '{"watching":true}',
        })
      ).status,
    ).toBe(401);
  });

  it('T-WATCH-001f strictly validates JSON bodies and leaves preferences unchanged', async () => {
    await seed('valid');
    await patch('valid', { priority: 'up-next' });
    for (const body of [
      {},
      [],
      { watching: 'false' },
      { watching: null },
      { priority: 'NORMAL' },
      { priority: '' },
      { priority: 1 },
      { watching: true, extra: true },
      { ownerId: other },
      { priority: ['normal'] },
    ])
      await patch('valid', body, 400);
    const malformed = await fetch(`${origin}/api/titles/valid/watch-preferences`, {
      method: 'PATCH',
      headers: {
        [CLIENT_PRINCIPAL_HEADER]: principal(SUBJECT),
        'content-type': 'application/json',
      },
      body: '{',
    });
    expect(malformed.status).toBe(400);
    expect(await detail('valid')).toMatchObject({ watching: false, priority: 'up-next' });
  });

  it('T-WATCH-001g import, metadata refresh, removal and fresh-row reappearance preserve choices', async () => {
    const old = await seed('old', { identity: DUNE });
    await patch(old.id, { watching: true, priority: 'someday' });
    await importWork('max');
    expect((await detail(old.id)).badges.map((badge) => badge.service).sort()).toEqual([
      'max',
      'netflix',
    ]);
    await updateTitleMetadata(owner, old.id, {
      tmdbName: 'Refreshed Dune',
      tmdbReleaseYear: 2021,
      tmdbRuntimeMinutes: 155,
      tmdbGenres: '["Adventure"]',
      tmdbPosterPath: '/dune.jpg',
      imdbId: null,
      tmdbFetchedAt: new Date(),
    });
    expect(await detail(old.id)).toMatchObject({ watching: true, priority: 'someday' });
    const removed = await request(`/titles/${old.id}`, 'DELETE');
    expect(removed.status, await removed.clone().text()).toBe(200);
    expect((await list()).items).toEqual([]);
    await patch(old.id, { watching: false, priority: 'normal' }, 404);
    expect(await findWatchPreference(owner, DUNE)).toMatchObject({
      watching: true,
      priority: 'someday',
    });
    await importWork();
    const items = (await list()).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.titleId).not.toBe(old.id);
    expect(items[0]).toMatchObject({ watching: true, priority: 'someday' });
    expect(await detail(old.id)).toMatchObject({ watching: true, priority: 'someday' });
    expect(await testPrisma().watchPreference.count()).toBe(1);
  });

  it('T-WATCH-001h fix-match carries preferences and destination explicit choices win for duplicates', async () => {
    const source = await seed('source', { identity: 'unmatched:0123456789abcdef' });
    await patch(source.id, { watching: true, priority: 'someday' });
    let response = await request(`/titles/${source.id}/fix-match`, 'POST', {
      tmdbId: 438631,
      mediaType: 'movie',
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await detail(source.id)).toMatchObject({
      workIdentity: DUNE,
      watching: true,
      priority: 'someday',
    });
    expect(await findWatchPreference(owner, source.workIdentity)).toBeNull();
    await patch(source.id, { watching: false, priority: 'normal' });
    const duplicate = await seed('duplicate');
    await patch(duplicate.id, { watching: true, priority: 'up-next' });
    response = await request(`/titles/${duplicate.id}/fix-match`, 'POST', {
      tmdbId: 438631,
      mediaType: 'movie',
      confirmDuplicate: true,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await detail(duplicate.id)).toMatchObject({ watching: false, priority: 'normal' });
    expect(await findWatchPreference(owner, duplicate.workIdentity)).toMatchObject({
      watching: true,
      priority: 'up-next',
    });
    await patch(duplicate.id, { watching: true });
    expect(await detail(source.id)).toMatchObject({ watching: true, priority: 'normal' });
    expect((await list('?watching=true&priority=normal')).items).toHaveLength(2);
  });

  it('T-WATCH-001i preference carry rolls back with the enclosing transaction and never crosses owners', async () => {
    const source = await seed('source');
    await seed('other-source', { owner: other, identity: source.workIdentity });
    await patch(source.id, { priority: 'someday' });
    const stop = new Error('rollback');
    await expect(
      runInTransaction(async (tx) => {
        await carryWatchPreference(owner, source.workIdentity, DUNE, tx);
        throw stop;
      }),
    ).rejects.toBe(stop);
    expect(await findWatchPreference(owner, DUNE)).toBeNull();
    await runInTransaction(async (tx) => {
      await carryWatchPreference(other, source.workIdentity, DUNE, tx);
      await carryWatchPreference(owner, source.workIdentity, source.workIdentity, tx);
    });
    expect(await findWatchPreference(other, DUNE)).toBeNull();
    expect(await findWatchPreference(owner, source.workIdentity)).toMatchObject({
      priority: 'someday',
    });
  });

  it('T-WATCH-001j executes additive migration SQL and enforces defaults, unique owner/work key and checks', async () => {
    const migration = await readFile(
      new URL('../../../../prisma/migrations/0011_watch_preference/migration.sql', import.meta.url),
      'utf8',
    );
    const rollback = new Error('rollback migration probe');
    await expect(
      testPrisma().$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          migration.replaceAll('watch_preference', 'watch_preference_probe'),
        );
        await tx.$executeRaw`INSERT INTO watch_preference_probe (owner_id, work_identity)
        VALUES (${owner}, N'tmdb:tv:123')`;
        const rows = await tx.$queryRaw<
          WatchPreferences[]
        >`SELECT watching, priority FROM watch_preference_probe`;
        expect(rows).toEqual([{ watching: false, priority: 'normal' }]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    await testPrisma().watchPreference.create({ data: { ownerId: owner, workIdentity: DUNE } });
    expect(await findWatchPreference(owner, DUNE)).toMatchObject({
      watching: false,
      priority: 'normal',
    });
    await testPrisma().watchPreference.create({
      data: { ownerId: owner, workIdentity: 'tmdb:tv:123', priority: 'someday' },
    });
    await expect(
      testPrisma().watchPreference.create({
        data: { ownerId: owner, workIdentity: DUNE },
      }),
    ).rejects.toThrow();
    await expect(
      testPrisma().watchPreference.create({
        data: { ownerId: owner, workIdentity: 'invalid', priority: 'normal' },
      }),
    ).rejects.toThrow();
    for (const priority of ['invalid', 'NORMAL', 'normal ']) {
      await expect(
        testPrisma().watchPreference.updateMany({
          where: { ownerId: owner },
          data: { priority },
        }),
      ).rejects.toThrow();
    }
  });

  it('T-WATCH-001o concurrent partial edits through duplicate rows preserve both choices', async () => {
    await seed('canonical', { identity: DUNE });
    await seed('acknowledged', { identity: DUNE, duplicate: true, service: 'max' });
    await Promise.all([
      patch('canonical', { watching: true }),
      patch('acknowledged', { priority: 'someday' }),
    ]);
    expect(await detail('canonical')).toMatchObject({ watching: true, priority: 'someday' });
    expect(await detail('acknowledged')).toMatchObject({ watching: true, priority: 'someday' });
    expect(await testPrisma().watchPreference.count()).toBe(1);
  });
});

describe('T-WATCH-002 server filtering, rank ordering and pagination', () => {
  async function rankingFixtures() {
    const choices: [string, boolean, WatchPriority][] = [
      ['w-a', true, 'someday'],
      ['w-b', true, 'normal'],
      ['w-c', true, 'up-next'],
      ['u-a', false, 'up-next'],
      ['u-b', false, 'up-next'],
      ['n-a', false, 'normal'],
      ['n-b', false, 'normal'],
      ['s-a', false, 'someday'],
      ['s-b', false, 'someday'],
    ];
    for (const [id, watching, priority] of choices) {
      await seed(id);
      if (id !== 'n-b') await patch(id, { watching, priority });
    }
  }

  async function walk(query: string, limit: number): Promise<string[]> {
    let cursor: string | null = null;
    const ids: string[] = [];
    for (let page = 0; page < 20; page += 1) {
      const body: ListBody = await list(
        `${query}&limit=${limit}${cursor === null ? '' : `&cursor=${cursor}`}`,
      );
      ids.push(...body.items.map((item) => item.titleId));
      cursor = body.nextCursor;
      if (cursor === null) return ids;
    }
    throw new Error('page walk did not terminate');
  }

  it('T-WATCH-002c walks every rank and tie in both directions including absent defaults', async () => {
    await rankingFixtures();
    const ascending = ['w-a', 'w-b', 'w-c', 'u-a', 'u-b', 'n-a', 'n-b', 's-a', 's-b'];
    const descending = ['s-a', 's-b', 'n-a', 'n-b', 'u-a', 'u-b', 'w-a', 'w-b', 'w-c'];
    expect((await list('?sort=watchPriority')).items.map((item) => item.titleId)).toEqual(
      ascending,
    );
    for (const limit of [1, 2, 4]) {
      expect(await walk('?sort=watchPriority&dir=asc', limit)).toEqual(ascending);
      expect(await walk('?sort=watchPriority&dir=desc', limit)).toEqual(descending);
    }
    expect(
      await walk('?sort=watchPriority&watching=false&priority=normal&priority=someday', 1),
    ).toEqual(['n-a', 'n-b', 's-a', 's-b']);
    expect(await walk('?sort=watchPriority&watching=true&priority=someday', 1)).toEqual(['w-a']);
  });

  it('T-WATCH-002d filters before page selection, unknown-runtime counts and eligible rating scope', async () => {
    await seed('excluded');
    await seed('eligible-a', { runtime: 20, service: 'max' });
    await seed('eligible-b', { runtime: 25, service: 'max' });
    await seed('unknown', { runtime: null, service: 'max' });
    await seed('other-priority', { runtime: null, service: 'max' });
    await seed('other-service', { runtime: null });
    await seed('other-owner', { runtime: null, owner: other, service: 'max' });
    await seed('hidden', { runtime: null, batchStatus: 'in-review', service: 'max' });
    const suppressed = await seed('suppressed', { runtime: null, service: 'max' });
    await createSuppression(owner, {
      id: 'supp',
      workIdentity: suppressed.workIdentity,
      displayName: 'Hidden',
    });
    for (const id of ['eligible-a', 'eligible-b', 'unknown', 'other-service']) {
      await patch(id, { watching: true, priority: 'up-next' });
    }
    const query =
      '?sort=watchPriority&watching=true&priority=up-next&service=max&type=movie&genre=Drama&runtime=under30';
    const first = await list(`${query}&limit=1`);
    expect(first.items.map((item) => item.titleId)).toEqual(['eligible-a']);
    expect(first.nextCursor).not.toBeNull();
    expect(first.runtimeUnknownHidden).toBe(1);
    const second = await list(`${query}&limit=1&cursor=${first.nextCursor}`);
    expect(second.items.map((item) => item.titleId)).toEqual(['eligible-b']);
    expect(second.runtimeUnknownHidden).toBe(1);
    expect(second.nextCursor).toBeNull();
    const eligible = await listTitleRatingRows(owner, {
      watching: true,
      priorities: ['up-next'],
      services: ['max'],
      mediaType: 'movie',
      genres: ['Drama'],
      runtimes: ['under30'],
    });
    expect(eligible.map((row) => row.id)).toEqual(['eligible-a', 'eligible-b']);
    expect(
      (await list('?watching=false&priority=normal&runtime=under30')).runtimeUnknownHidden,
    ).toBe(1);
    expect((await list('?watching=true&priority=up-next&q=eligible')).items).toHaveLength(2);
  });

  it('T-WATCH-002e rejects invalid filters and wrong-sort cursors over real HTTP', async () => {
    await seed('a');
    await seed('b');
    const body = await list('?sort=watchPriority&limit=1');
    for (const query of [
      '?watching=1',
      '?watching=true&watching=true',
      '?priority=next',
      `?${Array<string>(21).fill('priority=normal').join('&')}`,
      `?sort=dateAdded&cursor=${body.nextCursor}`,
    ])
      expect((await request(`/titles${query}`)).status).toBe(400);
  });
});
