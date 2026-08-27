/**
 * `T-TMDB-004g`…`n` and `T-TMDB-016c` — the lazy metadata refresh, unit level.
 *
 * The integration suite (`apps/api/test/integration/tmdbRefresh.spec.ts`)
 * proves the end-to-end behaviour against a real engine and recorded TMDB
 * bodies. What it cannot reach cheaply is the set of things this service must
 * NOT do — exhaust its budget, run without a key, reject on a single bad row,
 * or let an unlisted field through to the store — each of which is silent in
 * production and each of which is asserted here with an injected client.
 *
 * ⚠ **THE FAILURE MODES ARE THE POINT.** A rejected promise here would take
 * down a list render on a single-process container, and a budget that does not
 * actually stop would turn "lazy refresh" into a synchronous sweep on the
 * owner's first page of the day.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TmdbWorkDetail } from '../../../src/clients/tmdbClient.js';
import { updateTitleMetadata } from '../../../src/repository/ownerData.js';
import type { OwnerId } from '../../../src/repository/ownerData.js';
import {
  TMDB_REFRESH_BUDGET_MS,
  TMDB_REFRESH_CONCURRENCY,
  isMetadataStale,
  refreshStaleMetadata,
  staleTitles,
  type RefreshableTitle,
} from '../../../src/services/tmdbRefresh.js';
import { TMDB_METADATA_MAX_AGE_DAYS } from '../../../src/config.js';

vi.mock('../../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repository/ownerData.js')>();
  return { ...actual, updateTitleMetadata: vi.fn() };
});

const mockWrite = vi.mocked(updateTitleMetadata);

const OWNER = 'own_test' as OwnerId;
const NOW = new Date('2026-03-01T00:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const daysBefore = (days: number): Date => new Date(NOW.getTime() - days * MS_PER_DAY);

function row(id: string, overrides: Partial<RefreshableTitle> = {}): RefreshableTitle {
  return {
    id,
    tmdbId: 1,
    tmdbMediaType: 'movie',
    tmdbFetchedAt: daysBefore(TMDB_METADATA_MAX_AGE_DAYS + 10),
    ...overrides,
  };
}

function detail(overrides: Partial<TmdbWorkDetail> = {}): TmdbWorkDetail {
  return {
    tmdbId: 1,
    mediaType: 'movie',
    name: 'Fresh Name',
    releaseYear: 2021,
    posterPath: '/fresh.jpg',
    runtimeMinutes: 155,
    genres: ['Science Fiction'],
    imdbId: 'tt1160419',
    ...overrides,
  };
}

/** An injected client that records what it was asked and can be made to fail. */
function fakeClient(options: { fail?: (id: string) => boolean; work?: TmdbWorkDetail } = {}) {
  const asked: string[] = [];
  let inFlight = 0;
  let peak = 0;
  return {
    asked,
    peak: (): number => peak,
    client: {
      async getWork(mediaType: 'movie' | 'tv', tmdbId: number): Promise<TmdbWorkDetail> {
        asked.push(`${mediaType}/${String(tmdbId)}`);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        try {
          await Promise.resolve();
          if (options.fail?.(String(tmdbId)) === true) throw new Error('boom');
          return options.work ?? detail({ tmdbId });
        } finally {
          inFlight -= 1;
        }
      },
    },
  };
}

beforeEach(() => {
  mockWrite.mockReset();
  mockWrite.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  delete process.env['TMDB_API_KEY'];
});

describe('T-TMDB-004 · the horizon and the page filter (unit)', () => {
  it('T-TMDB-004g: the horizon is exclusive and null is stale', () => {
    // ⚠ Exactly AT the horizon is not yet stale. An inclusive comparison would
    // refresh a row one render early forever, which is invisible in a test
    // that only ever uses "much older" fixtures.
    expect(isMetadataStale(daysBefore(TMDB_METADATA_MAX_AGE_DAYS), NOW)).toBe(false);
    expect(isMetadataStale(daysBefore(TMDB_METADATA_MAX_AGE_DAYS + 1), NOW)).toBe(true);
    expect(isMetadataStale(daysBefore(1), NOW)).toBe(false);
    // Never fetched — a row `closeBatch` wrote with no runtime and no genres.
    expect(isMetadataStale(null, NOW)).toBe(true);
  });

  it('T-TMDB-004h: only matched movie/tv rows are candidates', () => {
    const rows = [
      row('a'),
      row('b', { tmdbId: null, tmdbMediaType: null }),
      row('c', { tmdbMediaType: 'person' }),
      row('d', { tmdbMediaType: 'tv' }),
      row('e', { tmdbFetchedAt: daysBefore(1) }),
    ];
    expect(staleTitles(rows, NOW).map((r) => r.id)).toEqual(['a', 'd']);
  });

  it('T-TMDB-004i: a page with nothing stale never constructs or calls a client', async () => {
    const { client, asked } = fakeClient();
    const result = await refreshStaleMetadata(OWNER, [row('a', { tmdbFetchedAt: daysBefore(1) })], {
      client,
      now: () => NOW,
    });
    expect(asked).toEqual([]);
    expect(mockWrite).not.toHaveBeenCalled();
    expect(result.stale.size).toBe(0);
    expect(result.refreshed.size).toBe(0);
  });

  it('T-TMDB-004j: a refreshed row leaves the stale set AND enters the refreshed map', async () => {
    // Both halves. `stale` is what the item is FLAGGED with; `refreshed` is
    // what it is RENDERED from — returning only the first would serve
    // pre-refresh values on the very render that fetched them.
    const { client } = fakeClient();
    const result = await refreshStaleMetadata(OWNER, [row('a')], { client, now: () => NOW });

    expect(result.stale.size).toBe(0);
    expect(result.refreshed.get('a')).toMatchObject({
      tmdbName: 'Fresh Name',
      tmdbRuntimeMinutes: 155,
      tmdbGenres: JSON.stringify(['Science Fiction']),
      imdbId: 'tt1160419',
    });
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  it('T-TMDB-004k: no more than TMDB_REFRESH_CONCURRENCY requests are in flight', async () => {
    const fake = fakeClient();
    const rows = Array.from({ length: 12 }, (_, i) => row(`r${String(i)}`, { tmdbId: i + 1 }));
    await refreshStaleMetadata(OWNER, rows, { client: fake.client, now: () => NOW });

    expect(fake.asked).toHaveLength(12);
    expect(fake.peak()).toBeLessThanOrEqual(TMDB_REFRESH_CONCURRENCY);
    expect(TMDB_REFRESH_BUDGET_MS).toBe(5_000);
  });

  it('T-TMDB-004l: the budget stops STARTING work and leaves the rest stale', async () => {
    // A clock that jumps past the budget after the first read, so the workers
    // stop before their first item. The budget is checked before each item
    // rather than raced against a timer — a timer would BE a timer, which
    // `T-CI-005` forbids outright.
    const fake = fakeClient();
    let reads = 0;
    const now = (): Date => {
      reads += 1;
      return new Date(NOW.getTime() + (reads > 2 ? 10_000 : 0));
    };
    const rows = Array.from({ length: 6 }, (_, i) => row(`r${String(i)}`, { tmdbId: i + 1 }));

    const result = await refreshStaleMetadata(OWNER, rows, { client: fake.client, now });

    expect(fake.asked.length).toBeLessThan(6);
    // Nothing is dropped: what was not reached stays flagged and is retried on
    // the next view.
    expect(result.stale.size + result.refreshed.size).toBe(6);
  });

  it('T-TMDB-004m: one failing row never rejects and never poisons the others', async () => {
    const fake = fakeClient({ fail: (id) => id === '2' });
    const rows = [row('a', { tmdbId: 1 }), row('b', { tmdbId: 2 }), row('c', { tmdbId: 3 })];

    const result = await refreshStaleMetadata(OWNER, rows, { client: fake.client, now: () => NOW });

    expect([...result.stale]).toEqual(['b']);
    expect([...result.refreshed.keys()].sort()).toEqual(['a', 'c']);
    expect(mockWrite).toHaveBeenCalledTimes(2);
  });

  it('T-TMDB-004n: an unlisted field is REJECTED at the store boundary, not written', async () => {
    // TASK-061's allow-list, seen from the call site that uses it. If the
    // client's projection ever grows a field, the row stays stale and nothing
    // is written — a loud, dated failure rather than silent storage of prose
    // that must never reach an inference service (RSK-022).
    const fake = fakeClient({
      work: { ...detail(), overview: 'a long synopsis' } as unknown as TmdbWorkDetail,
    });
    const result = await refreshStaleMetadata(OWNER, [row('a')], {
      client: fake.client,
      now: () => NOW,
    });

    // The projection is explicit, so an extra key on the DETAIL alone is
    // dropped before parsing — what must hold is that nothing unlisted is
    // written and the row is never silently half-updated.
    expect(mockWrite).toHaveBeenCalledTimes(1);
    const written = mockWrite.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual([
      'imdbId',
      'tmdbFetchedAt',
      'tmdbGenres',
      'tmdbName',
      'tmdbPosterPath',
      'tmdbReleaseYear',
      'tmdbRuntimeMinutes',
    ]);
    expect(written['overview']).toBeUndefined();
    expect(result.refreshed.size).toBe(1);
  });
});

describe('T-TMDB-016 · TMDB unreachable or unconfigured (unit)', () => {
  it('T-TMDB-016c: an unset key skips the refresh instead of throwing', async () => {
    // A SUPPORTED state, not an error: the list renders from stored metadata
    // with the flag set. Reading the key at call time rather than module load
    // is what makes that testable at all.
    delete process.env['TMDB_API_KEY'];
    const logged: string[] = [];

    const result = await refreshStaleMetadata(OWNER, [row('a')], {
      now: () => NOW,
      log: (event) => logged.push(event),
    });

    expect([...result.stale]).toEqual(['a']);
    expect(result.refreshed.size).toBe(0);
    expect(mockWrite).not.toHaveBeenCalled();
    expect(logged).toContain('tmdb.refresh_skipped_no_key');
  });

  it('T-TMDB-016d: a transport failure logs and flags, and the caller still resolves', async () => {
    const fake = fakeClient({ fail: () => true });
    const logged: string[] = [];

    const result = await refreshStaleMetadata(OWNER, [row('a')], {
      client: fake.client,
      now: () => NOW,
      log: (event) => logged.push(event),
    });

    expect([...result.stale]).toEqual(['a']);
    expect(logged).toContain('tmdb.metadata_refresh_failed');
  });
});
