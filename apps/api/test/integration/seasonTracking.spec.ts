/**
 * #454 (PRD `A64`, US-072) — the new-season tracking repository against a REAL
 * SQL Server: the opt-in, the metadata-only season facts, and which tracked
 * works are eligible for a re-check.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import type { OwnerId } from '../../src/repository/ownerData.js';
import {
  listTrackedSeasonWorks,
  listTrackedWorkIdentities,
  recordSeasonFacts,
  setSeasonTracking,
} from '../../src/repository/seasonTracking.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-season-tracking';
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

let server: Server;
let ownerId: OwnerId;

async function seedShow(id: string, tmdbId: number, state: 'active' | 'removed'): Promise<string> {
  const workIdentity = `tmdb:tv:${String(tmdbId)}`;
  await testPrisma().title.create({
    data: {
      id,
      ownerId,
      workIdentity,
      state,
      matchState: 'matched',
      tmdbId,
      tmdbMediaType: 'tv',
      tmdbName: `Show ${id}`,
      tmdbReleaseYear: 2022,
      tmdbGenres: '[]',
      sortDateAdded: new Date('2026-01-05T00:00:00.000Z'),
    },
  });
  return workIdentity;
}

beforeEach(async () => {
  await resetDatabase();
  resetAllowListWarning();
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  const res = await fetch(`${origin}/api/me`, { headers: { [CLIENT_PRINCIPAL_HEADER]: header } });
  ownerId = ((await res.json()) as { ownerId: string }).ownerId as OwnerId;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-SEAS-090 — new-season tracking persists as metadata (US-072)', () => {
  it('T-SEAS-090a: the opt-in is written once, toggled, and listed', async () => {
    const work = await seedShow('t1', 1, 'removed');
    await setSeasonTracking(ownerId, work, true);
    await setSeasonTracking(ownerId, work, true);
    expect(await listTrackedWorkIdentities(ownerId, [work])).toEqual(new Set([work]));
    expect(await listTrackedWorkIdentities(ownerId, [])).toEqual(new Set());
    await setSeasonTracking(ownerId, work, false);
    expect(await listTrackedWorkIdentities(ownerId, [work])).toEqual(new Set());
  });

  it('T-SEAS-090b: season facts touch only the season columns', async () => {
    const work = await seedShow('t2', 2, 'removed');
    await setSeasonTracking(ownerId, work, true);
    const checkedAt = new Date('2026-09-01T00:00:00.000Z');
    await recordSeasonFacts(ownerId, work, {
      checkedAt,
      season: { seasonNumber: 3, airsOn: '2026-12-01' },
    });
    const row = await testPrisma().watchPreference.findFirstOrThrow({ where: { ownerId } });
    expect(row.trackNewSeason).toBe(true);
    expect(row.seasonNumber).toBe(3);
    expect(row.seasonAirOn?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(row.seasonCheckedAt?.toISOString()).toBe(checkedAt.toISOString());

    await recordSeasonFacts(ownerId, work, { checkedAt, season: null });
    const cleared = await testPrisma().watchPreference.findFirstOrThrow({ where: { ownerId } });
    expect(cleared.seasonNumber).toBeNull();
    expect(cleared.seasonAirOn).toBeNull();
    expect(await testPrisma().title.count({ where: { ownerId, state: 'removed' } })).toBe(1);
  });

  it('T-SEAS-090c: tracked works exclude Library and already-waiting shows', async () => {
    const removed = await seedShow('t3', 3, 'removed');
    const listed = await seedShow('t4', 4, 'active');
    await testPrisma().serviceListing.create({
      data: {
        listingId: 'l-t4',
        ownerId,
        titleId: 't4',
        service: 'starz',
        state: 'active',
        dateAdded: new Date('2026-01-05T00:00:00.000Z'),
      },
    });
    await setSeasonTracking(ownerId, removed, true);
    await setSeasonTracking(ownerId, listed, true);
    await setSeasonTracking(ownerId, 'tmdb:tv:99', true);

    const works = await listTrackedSeasonWorks(ownerId);
    expect(works.map((work) => work.workIdentity)).toEqual([removed]);
    expect(works[0]).toMatchObject({ titleId: 't3', name: 'Show t3', tmdbId: 3 });
  });
});
