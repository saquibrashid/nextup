/**
 * `T-IMDB-007a`…`h` — the access-triggered rating refresh (REQ-090, REQ-093).
 *
 * ⚠ What is under test here is mostly what the job does NOT do: it must not
 * throw, must not block the response, must not write outside its two columns,
 * and must not run at all when no key is configured. Each of those failures is
 * silent in production — a rejected promise on a single-process container
 * takes the API down with no log line attributable to a list render.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OmdbRating } from '../../../src/clients/omdbClient.js';
import {
  beginRatingRefresh,
  ratingRefreshSettled,
  runRatingRefresh,
} from '../../../src/jobs/refreshRatings.js';
import { updateTitleRating } from '../../../src/repository/ownerData.js';
import type { OwnerId } from '../../../src/repository/ownerData.js';
import type { RatingRow } from '../../../src/services/imdbRatings.js';

vi.mock('../../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repository/ownerData.js')>();
  return { ...actual, updateTitleRating: vi.fn() };
});

const mockWrite = vi.mocked(updateTitleRating);

const OWNER = 'own_test' as OwnerId;
const NOW = new Date('2026-03-01T00:00:00.000Z');

/**
 * ⚠ `imdbId` DEFAULTS TO A UNIQUE VALUE PER ROW. `selectForRefresh` dedupes by
 * IMDb id — two list rows can be the same work — so a shared fixture id
 * silently collapses a two-row case into one and the test asserts something
 * other than what it reads.
 */
let nextFixtureId = 0;
function staleRow(id: string, imdbId?: string | null): RatingRow {
  nextFixtureId += 1;
  return {
    id,
    imdbId: imdbId === undefined ? `tt${String(1_000_000 + nextFixtureId)}` : imdbId,
    imdbRatingTenths: null,
    imdbRatingFetchedAt: null,
  };
}

function fakeClient(rating: number | null = 8.7) {
  const asked: string[] = [];
  return {
    asked,
    client: {
      async getRating(imdbId: string): Promise<OmdbRating> {
        asked.push(imdbId);
        return { imdbId, rating, voteCount: 10 };
      },
    },
  };
}

beforeEach(() => {
  mockWrite.mockReset();
  mockWrite.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  delete process.env['OMDB_API_KEY'];
});

describe('T-IMDB-007 — access-triggered rating refresh', () => {
  it('T-IMDB-007a persists a fetched rating through the narrow writer', async () => {
    const c = fakeClient(8.7);

    const written = await runRatingRefresh(OWNER, [staleRow('t1')], {
      client: c.client,
      now: () => NOW,
    });

    expect(written).toBe(1);
    expect(mockWrite).toHaveBeenCalledWith(OWNER, 't1', {
      imdbRatingTenths: 87,
      imdbRatingFetchedAt: NOW,
    });
  });

  it('T-IMDB-007b does nothing, and asks OMDb nothing, with no key configured', async () => {
    // REQ-091's absent state is a SUPPORTED configuration, not an error: an
    // environment with no OMDb key still renders the whole list.
    const logged: string[] = [];

    const written = await runRatingRefresh(OWNER, [staleRow('t1')], {
      log: (event) => logged.push(event),
    });

    expect(written).toBe(0);
    expect(mockWrite).not.toHaveBeenCalled();
    expect(logged).toContain('imdb.refresh_skipped_no_key');
  });

  it('T-IMDB-007c survives a failing write and keeps going', async () => {
    mockWrite.mockRejectedValueOnce(new Error('deadlock'));
    const c = fakeClient(8.7);

    const written = await runRatingRefresh(OWNER, [staleRow('t1'), staleRow('t2')], {
      client: c.client,
      now: () => NOW,
    });

    // One row lost, the other persisted; the lost one is simply still stale
    // and is retried on a later render.
    expect(written).toBe(1);
    expect(mockWrite).toHaveBeenCalledTimes(2);
  });

  it('T-IMDB-007d never rejects, whatever the store does', async () => {
    mockWrite.mockRejectedValue(new Error('down'));
    const c = fakeClient(8.7);

    await expect(
      runRatingRefresh(OWNER, [staleRow('t1')], { client: c.client, now: () => NOW }),
    ).resolves.toBe(0);
  });

  it('T-IMDB-007e skips rows with no imdb_id without spending budget', async () => {
    const c = fakeClient(8.7);

    const written = await runRatingRefresh(OWNER, [staleRow('t1', null)], {
      client: c.client,
      now: () => NOW,
    });

    expect(c.asked).toEqual([]);
    expect(written).toBe(0);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('T-IMDB-007f begins without awaiting, and the seam waits for it', async () => {
    const c = fakeClient(8.7);

    beginRatingRefresh(OWNER, [staleRow('t1')], { client: c.client, now: () => NOW });

    // The point of the seam: nothing has happened yet on the line after the
    // call, which is exactly the race that makes a bare fire-and-forget
    // untestable.
    expect(mockWrite).not.toHaveBeenCalled();
    await ratingRefreshSettled();
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  it('T-IMDB-007g does no work at all for an empty page', async () => {
    beginRatingRefresh(OWNER, []);
    await ratingRefreshSettled();

    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('T-IMDB-007h writes only the two rating columns (product invariant 5)', () => {
    // The refresh is the third permitted non-owner process, and it is legal
    // ONLY because it cannot change membership, ordering or service badges.
    // That is a property of the columns it names.
    const source = readFileSync(
      fileURLToPath(new URL('../../../src/jobs/refreshRatings.ts', import.meta.url)),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).toContain('updateTitleRating');
    for (const forbidden of [
      'state:',
      'sortDateAdded',
      'workIdentity',
      'serviceListing',
      'suppression',
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });
});
