/**
 * `T-PURGE-007` — US-067 AC-8 — a failure mid-purge deletes NOTHING.
 *
 * ⚠ SEPARATE FILE, DELIBERATELY: `vi.mock` is hoisted for the whole module
 * graph, so the injected failure is armed by a flag and lives apart from
 * `permanentDelete.spec.ts`. ⚠ AND AN INTEGRATION TEST: the claim is that the
 * DATABASE rolled back — candidates already deleted and provenance already
 * detached when the listing delete throws. An in-memory transaction stub would
 * leave those fake writes applied and still pass.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const injected = { failListingDelete: false };

vi.mock('../../src/repository/purgeRemoved.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/purgeRemoved.js')>();
  return {
    ...actual,
    deleteRemovedListings: (...args: Parameters<typeof actual.deleteRemovedListings>) => {
      if (injected.failListingDelete) throw new Error('injected mid-purge failure');
      return actual.deleteRemovedListings(...args);
    },
  };
});

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-purge-rollback';
const header = Buffer.from(
  JSON.stringify({
    claims: [
      { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
      { typ: OID, val: SUBJECT },
    ],
  }),
  'utf8',
).toString('base64');
const authed = { 'content-type': 'application/json', [CLIENT_PRINCIPAL_HEADER]: header };

let server: Server;
let origin: string;
let ownerId: string;

beforeEach(async () => {
  injected.failListingDelete = false;
  resetAllowListWarning();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  testPrisma();
  await resetDatabase();
  if (server === undefined) {
    const { createApp } = await import('../../src/app.js');
    server = createApp({ webRoot: '/nonexistent-web-root' }).listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  const me = await fetch(`${origin}/api/me`, { headers: authed });
  ownerId = ((await me.json()) as { ownerId: string }).ownerId;
});

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await closeTestPrisma();
});

describe('T-PURGE-007 · a failure mid-purge deletes nothing', () => {
  it('T-PURGE-007a: candidates, provenance, listing and title all survive intact', async () => {
    const db = testPrisma();
    await db.uploadBatch.create({
      data: {
        id: 'b-rb',
        ownerId,
        service: 'netflix',
        mode: 'append-only',
        status: 'applied',
        lowYield: false,
        degradedExtraction: false,
        crossCheck: 'ok',
      },
    });
    await db.title.create({
      data: {
        id: 't-rb',
        ownerId,
        workIdentity: 'tmdb:movie:900',
        state: 'removed',
        matchState: 'matched',
        tmdbId: 900,
        tmdbMediaType: 'movie',
        tmdbName: 'Rollback Film',
        tmdbReleaseYear: 2020,
        tmdbGenres: '[]',
        sortDateAdded: new Date('2026-04-01T00:00:00.000Z'),
        createdByBatchId: 'b-rb',
      },
    });
    await db.serviceListing.create({
      data: {
        listingId: 'l-rb',
        ownerId,
        titleId: 't-rb',
        service: 'netflix',
        state: 'removed',
        dateAdded: new Date('2026-04-01T00:00:00.000Z'),
        removedAt: new Date('2026-07-01T00:00:00.000Z'),
        removedByBatchId: 'b-rb',
        createdByBatchId: 'b-rb',
      },
    });
    await db.batchChange.create({
      data: { ownerId, batchId: 'b-rb', kind: 'listing_added', titleId: 't-rb', listingId: 'l-rb' },
    });
    await db.extractionCandidate.create({
      data: {
        id: 'c-rb',
        ownerId,
        batchId: 'b-rb',
        rawText: 'Rollback Film',
        basis: 'both',
        ocrSupport: 'exact',
        provider: 'llm',
        normalisedText: 'rollback film',
        boxSource: 'llm',
        cleanupVerdict: 'title-candidate',
        resolvedTitleId: 't-rb',
      },
    });

    injected.failListingDelete = true;
    const res = await fetch(`${origin}/api/listings/l-rb/permanent`, {
      method: 'DELETE',
      headers: authed,
    });

    expect(res.status).toBe(500);
    expect(await db.extractionCandidate.count({ where: { id: 'c-rb' } })).toBe(1);
    expect(await db.serviceListing.count({ where: { listingId: 'l-rb' } })).toBe(1);
    expect(await db.title.count({ where: { id: 't-rb' } })).toBe(1);
    const change = await db.batchChange.findFirst({ where: { batchId: 'b-rb' } });
    expect(change?.listingId).toBe('l-rb');
    expect(change?.attr).toBeNull();
  });
});
