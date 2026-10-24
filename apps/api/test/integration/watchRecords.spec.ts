/**
 * #325 / #465 (PRD `A66`, US-074 / REQ-140) — the viewing record against a REAL
 * SQL Server: keyed on work identity, never deleted, hidden from the Library by
 * a flag that is neither a removal nor a suppression, and carried by fix-match.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { listListedWorkIdentities, type OwnerId } from '../../src/repository/ownerData.js';
import {
  carryWatchRecords,
  findWatchRecord,
  isLibraryHidden,
  latestTitlesByIdentity,
  listFinishedRecords,
  listHiddenIdentities,
  listWatchRecords,
  setLibraryHidden,
  writeWatchRecord,
} from '../../src/repository/watchRecords.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-watch-records';
const header = Buffer.from(
  JSON.stringify({
    claims: [
      { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
      { typ: OID, val: SUBJECT },
      { typ: 'preferred_username', val: 'owner@example.com' },
    ],
  }),
  'utf8',
).toString('base64');
const SNAPSHOT = { titleName: 'Show', releaseYear: 2022, mediaType: 'tv', posterPath: null };

let server: Server;
let origin: string;
let ownerId: OwnerId;

async function seedListed(id: string, tmdbId: number): Promise<string> {
  const workIdentity = `tmdb:movie:${String(tmdbId)}`;
  await testPrisma().title.create({
    data: {
      id,
      ownerId,
      workIdentity,
      state: 'active',
      matchState: 'matched',
      tmdbId,
      tmdbMediaType: 'movie',
      tmdbName: `Movie ${id}`,
      tmdbReleaseYear: 2022,
      tmdbGenres: '[]',
      sortDateAdded: new Date('2026-01-05T00:00:00.000Z'),
    },
  });
  await testPrisma().serviceListing.create({
    data: {
      listingId: `l-${id}`,
      ownerId,
      titleId: id,
      service: 'starz',
      state: 'active',
      dateAdded: new Date('2026-01-05T00:00:00.000Z'),
    },
  });
  return workIdentity;
}

const get = (path: string): Promise<Response> =>
  fetch(`${origin}${path}`, { headers: { [CLIENT_PRINCIPAL_HEADER]: header } });

beforeEach(async () => {
  await resetDatabase();
  resetAllowListWarning();
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  const res = await get('/api/me');
  ownerId = ((await res.json()) as { ownerId: string }).ownerId as OwnerId;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-VIEWED-090 — the viewing record persists (US-074)', () => {
  it('T-VIEWED-090a: one row per work and season; a rewatch updates the date; unfinish keeps date and rating', async () => {
    const work = 'tmdb:tv:7';
    await writeWatchRecord(ownerId, work, 1, { watchedOn: '2026-01-01', rating: 4 }, SNAPSHOT);
    await writeWatchRecord(ownerId, work, 1, { watchedOn: '2026-05-05' }, SNAPSHOT);
    await writeWatchRecord(ownerId, work, 2, { watchedOn: null }, SNAPSHOT);
    expect(await listWatchRecords(ownerId, work)).toHaveLength(2);
    expect(await findWatchRecord(ownerId, work, 1)).toMatchObject({
      watchedOn: '2026-05-05',
      rating: 4,
      finished: true,
    });
    await writeWatchRecord(ownerId, work, 1, { finished: false }, SNAPSHOT);
    expect(await findWatchRecord(ownerId, work, 1)).toMatchObject({
      watchedOn: '2026-05-05',
      rating: 4,
      finished: false,
    });
    expect(await testPrisma().watchRecord.count({ where: { ownerId } })).toBe(2);
  });

  it('T-VIEWED-090b: history is newest first, unknown dates last, finished only, and pages', async () => {
    await writeWatchRecord(ownerId, 'tmdb:movie:1', 0, { watchedOn: '2026-01-01' }, SNAPSHOT);
    await writeWatchRecord(ownerId, 'tmdb:movie:2', 0, { watchedOn: '2026-03-01' }, SNAPSHOT);
    await writeWatchRecord(ownerId, 'tmdb:movie:3', 0, { watchedOn: null }, SNAPSHOT);
    await writeWatchRecord(ownerId, 'tmdb:movie:4', 0, { finished: false }, SNAPSHOT);
    const first = await listFinishedRecords(ownerId, { limit: 2, offset: 0 });
    expect(first.items.map((item) => item.workIdentity)).toEqual(['tmdb:movie:2', 'tmdb:movie:1']);
    expect(first.hasMore).toBe(true);
    const second = await listFinishedRecords(ownerId, { limit: 2, offset: 2 });
    expect(second.items.map((item) => item.workIdentity)).toEqual(['tmdb:movie:3']);
    expect(second.hasMore).toBe(false);
  });

  it('T-VIEWED-090c: fix-match carries records, an existing destination wins, nothing is duplicated', async () => {
    await writeWatchRecord(ownerId, 'unmatched:old', 0, { rating: 2 }, SNAPSHOT);
    await writeWatchRecord(ownerId, 'unmatched:old', 1, { rating: 3 }, SNAPSHOT);
    await writeWatchRecord(ownerId, 'tmdb:tv:9', 1, { rating: 5 }, SNAPSHOT);
    await carryWatchRecords(
      ownerId,
      'unmatched:old',
      'tmdb:tv:9',
      { ...SNAPSHOT, titleName: 'Fixed' },
      testPrisma(),
    );
    await carryWatchRecords(ownerId, 'tmdb:tv:9', 'tmdb:tv:9', SNAPSHOT, testPrisma());
    const moved = await listWatchRecords(ownerId, 'tmdb:tv:9');
    expect(moved.map((row) => [row.seasonNumber, row.rating])).toEqual([
      [0, 2],
      [1, 5],
    ]);
    expect(moved[0]?.titleName).toBe('Fixed');
    expect(await listWatchRecords(ownerId, 'unmatched:old')).toHaveLength(1);
  });

  it('T-VIEWED-090d: setting a work aside hides it from the Library without touching a listing', async () => {
    const work = await seedListed('m1', 1);
    await seedListed('m2', 2);
    const ids = async (): Promise<string[]> =>
      ((await (await get('/api/titles')).json()) as { items: { titleId: string }[] }).items
        .map((item) => item.titleId)
        .sort();
    expect(await ids()).toEqual(['m1', 'm2']);

    await setLibraryHidden(ownerId, work, true);
    await setLibraryHidden(ownerId, work, true);
    expect(await isLibraryHidden(ownerId, work)).toBe(true);
    expect(await listHiddenIdentities(ownerId, [work, 'tmdb:movie:2'])).toEqual(new Set([work]));
    expect(await ids()).toEqual(['m2']);
    expect(await testPrisma().serviceListing.count({ where: { ownerId, state: 'active' } })).toBe(
      2,
    );
    // Capture dedupe still sees it; the visible set does not.
    expect((await listListedWorkIdentities(ownerId)).has(work)).toBe(true);
    expect(
      (await listListedWorkIdentities(ownerId, undefined, { visibleOnly: true })).has(work),
    ).toBe(false);
    expect(await testPrisma().suppression.count({ where: { ownerId } })).toBe(0);

    await setLibraryHidden(ownerId, work, false);
    expect(await ids()).toEqual(['m1', 'm2']);
    await setLibraryHidden(ownerId, 'tmdb:movie:404', false);
    expect(await isLibraryHidden(ownerId, 'tmdb:movie:404')).toBe(false);
  });

  it('T-VIEWED-090e: the newest title row per work is found for a history link', async () => {
    await seedListed('m9', 9);
    expect(
      (await latestTitlesByIdentity(ownerId, ['tmdb:movie:9', 'tmdb:movie:8'])).get('tmdb:movie:9')
        ?.titleId,
    ).toBe('m9');
    expect(await latestTitlesByIdentity(ownerId, [])).toEqual(new Map());
    expect(await listHiddenIdentities(ownerId, [])).toEqual(new Set());
  });
});
