/**
 * `T-WADD-001`/`T-WADD-002` — richer lookup results (#457, `A61`, US-070).
 *
 * The search payload gains OPTIONAL `overview`, `genres` and `cast`. Cast costs
 * one credits call per row, so it is capped at `SEARCH_ENRICH_MAX` and is
 * best-effort: a credits failure must never fail the search.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  SEARCH_ENRICH_MAX,
  TmdbClient,
  TmdbUnavailableError,
  type TmdbSearchItem,
} from '../../../src/clients/tmdbClient.js';
import { searchTmdb } from '../../../src/routes/tmdb.js';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function client(handler: (path: string) => Response): TmdbClient {
  return new TmdbClient({
    apiKey: 'fixture-key-not-a-real-secret',
    sleep: () => Promise.resolve(),
    fetch: (input) => Promise.resolve(handler(new URL(String(input)).pathname)),
  });
}

describe('T-WADD-001 · additive search item shape', () => {
  it('T-WADD-001a · overview and genre names are read from the search row; unknown ids and blanks are omitted', async () => {
    const tmdb = client((path) =>
      path.includes('alternative_titles')
        ? json({ titles: [] })
        : json({
            results: [
              {
                media_type: 'movie',
                id: 1,
                title: 'Rich',
                release_date: '2020-01-01',
                poster_path: '/p.jpg',
                overview: `  ${'x'.repeat(400)}  `,
                genre_ids: [28, 878, 12, 18, 999999, 'bad'],
              },
              { media_type: 'tv', id: 2, name: 'Bare', overview: '   ', genre_ids: [999999] },
              { media_type: 'tv', id: 3, name: 'NoFields' },
              { media_type: 'person', id: 4, name: 'Someone' },
            ],
          }),
    );

    const items = await tmdb.searchMulti('x', { includeDisplay: true });

    expect(items[0]).toEqual({
      tmdbId: 1,
      mediaType: 'movie',
      name: 'Rich',
      releaseYear: 2020,
      posterPath: '/p.jpg',
      overview: 'x'.repeat(300),
      genres: ['Action', 'Science Fiction', 'Adventure'],
    });
    expect(items[1]).toEqual({
      tmdbId: 2,
      mediaType: 'tv',
      name: 'Bare',
      releaseYear: null,
      posterPath: null,
    });
    expect(items[2]).not.toHaveProperty('genres');
    expect(items).toHaveLength(3);
  });

  it('T-WADD-001d · matching keeps the allow-list: without includeDisplay no overview or genres are kept', async () => {
    const tmdb = client(() =>
      json({ results: [{ media_type: 'tv', id: 2, name: 'A', overview: 'o', genre_ids: [18] }] }),
    );
    expect(Object.keys((await tmdb.searchMulti('x'))[0] ?? {}).sort()).toEqual([
      'mediaType',
      'name',
      'posterPath',
      'releaseYear',
      'tmdbId',
    ]);
  });

  it('T-WADD-001b · lead cast is the top three billed names from /credits, cached per client', async () => {
    const paths: string[] = [];
    const tmdb = client((path) => {
      paths.push(path);
      return json({
        cast: [{ name: 'A' }, { name: '' }, { name: 'B' }, 7, { name: 'C' }, { name: 'D' }],
      });
    });

    expect(await tmdb.getLeadCast('movie', 9)).toEqual(['A', 'B', 'C']);
    expect(await tmdb.getLeadCast('movie', 9)).toEqual(['A', 'B', 'C']);
    expect(paths).toEqual(['/3/movie/9/credits']);
  });

  it('T-WADD-001c · a credits body with no cast list is an empty cast', async () => {
    expect(await client(() => json({})).getLeadCast('tv', 1)).toEqual([]);
  });
});

function fakeClient(count: number, getLeadCast: (id: number) => Promise<string[]>): TmdbClient {
  const items: TmdbSearchItem[] = Array.from({ length: count }, (_, i) => ({
    tmdbId: i + 1,
    mediaType: 'movie',
    name: `Title ${i + 1}`,
    releaseYear: 2000,
    posterPath: null,
  }));
  return {
    searchMulti: () => Promise.resolve(items),
    getLeadCast: (_type: string, id: number) => getLeadCast(id),
  } as unknown as TmdbClient;
}

describe('T-WADD-002 · bounded, best-effort cast enrichment', () => {
  it('T-WADD-002a · credits are fetched for at most SEARCH_ENRICH_MAX rows, none beyond', async () => {
    const getLeadCast = vi.fn((id: number) => Promise.resolve([`Actor ${id}`]));
    const items = await searchTmdb(fakeClient(15, getLeadCast), { q: 'x', limit: 15 });

    expect(items).toHaveLength(15);
    expect(getLeadCast).toHaveBeenCalledTimes(SEARCH_ENRICH_MAX);
    expect(items[0]?.cast).toEqual(['Actor 1']);
    expect(items[SEARCH_ENRICH_MAX - 1]?.cast).toEqual(['Actor 8']);
    expect(items[SEARCH_ENRICH_MAX]).not.toHaveProperty('cast');
  });

  it('T-WADD-002b · a failing credits call leaves that row without cast and never fails the search', async () => {
    const items = await searchTmdb(
      fakeClient(3, (id) =>
        id === 2
          ? Promise.reject(new TmdbUnavailableError('down', 503, true))
          : id === 3
            ? Promise.resolve([])
            : Promise.resolve(['Ok']),
      ),
      { q: 'x', limit: 3 },
    );

    expect(items.map((i) => i.cast)).toEqual([['Ok'], undefined, undefined]);
  });

  it('T-WADD-002c · enrichment copies the rows; the client-cached items are not mutated', async () => {
    const tmdb = fakeClient(1, () => Promise.resolve(['Ok']));
    const cached = await tmdb.searchMulti('x');
    await searchTmdb(tmdb, { q: 'x', limit: 1 });
    expect(cached[0]).not.toHaveProperty('cast');
  });
});
