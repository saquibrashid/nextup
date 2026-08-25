/**
 * `T-IMDB-006a`…`h` — `GET /api/imdb/lookup` (REQ-092, US-045).
 *
 * The resolution chain and the WRITES-NOTHING property, which is the whole
 * point of the route. Driven mostly through `lookupImdbRating` directly: the
 * interesting behaviour is which upstream calls are made and which are NOT,
 * and that is invisible from the outside of an HTTP response.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { OmdbRating } from '../../../src/clients/omdbClient.js';
import type { TmdbClient } from '../../../src/clients/tmdbClient.js';
import { TmdbUnavailableError } from '../../../src/clients/tmdbClient.js';
import { AppError } from '../../../src/errors/AppError.js';
import { lookupImdbRating } from '../../../src/routes/imdb.js';

interface Calls {
  search: string[];
  work: string[];
  omdb: string[];
}

function fakes(overrides: {
  results?: { tmdbId: number; mediaType: 'movie' | 'tv'; name: string }[];
  imdbId?: string | null;
  rating?: OmdbRating;
  searchThrows?: unknown;
  inList?: { id: string } | null;
}) {
  const calls: Calls = { search: [], work: [], omdb: [] };

  const tmdb = {
    async searchMulti(q: string) {
      calls.search.push(q);
      if (overrides.searchThrows !== undefined) throw overrides.searchThrows;
      return (overrides.results ?? []).map((r) => ({
        tmdbId: r.tmdbId,
        mediaType: r.mediaType,
        name: r.name,
        releaseYear: 1999,
        posterPath: '/p.jpg',
      }));
    },
    async getWork(mediaType: string, tmdbId: number) {
      calls.work.push(`${mediaType}/${tmdbId}`);
      return {
        tmdbId,
        mediaType,
        name: 'The Matrix',
        releaseYear: 1999,
        posterPath: '/p.jpg',
        runtimeMinutes: 136,
        genres: ['Action'],
        imdbId: overrides.imdbId === undefined ? 'tt0133093' : overrides.imdbId,
      };
    },
  } as unknown as TmdbClient;

  const omdb = {
    async getRating(imdbId: string): Promise<OmdbRating> {
      calls.omdb.push(imdbId);
      return overrides.rating ?? { imdbId, rating: 8.7, voteCount: 1_900_000 };
    },
  };

  const lookupInList = async (): Promise<{ id: string } | null> => overrides.inList ?? null;

  return { clients: { tmdb, omdb }, lookupInList, calls };
}

describe('T-IMDB-006 — GET /api/imdb/lookup (REQ-092)', () => {
  it('T-IMDB-006a resolves TMDB search → imdb_id → OMDb and returns the rating', async () => {
    const f = fakes({ results: [{ tmdbId: 603, mediaType: 'movie', name: 'The Matrix' }] });

    const result = await lookupImdbRating(f.clients, { q: 'matrix' }, f.lookupInList);

    expect(result?.imdbRating).toBe(8.7);
    expect(result?.imdbId).toBe('tt0133093');
    // The order of the chain is the assertion, not a side effect of it.
    expect(f.calls.search).toEqual(['matrix']);
    expect(f.calls.work).toEqual(['movie/603']);
    expect(f.calls.omdb).toEqual(['tt0133093']);
  });

  it('T-IMDB-006b returns null — not an unrated result — when TMDB matches nothing', async () => {
    // US-045 AC-3. A found-but-unrated work and a work that does not exist are
    // DIFFERENT answers; conflating them tells the owner a film exists when it
    // does not.
    const f = fakes({ results: [] });

    expect(await lookupImdbRating(f.clients, { q: 'zzzz' }, f.lookupInList)).toBeNull();
    expect(f.calls.work).toEqual([]);
    expect(f.calls.omdb).toEqual([]);
  });

  it('T-IMDB-006c gives the no-rating state, and asks OMDb nothing, when there is no imdb_id', async () => {
    // US-046 AC-3. Spending one of 1,000 daily requests to be told nothing is
    // waste (REQ-093), and a `?t=` fallback would be a defect (US-046 AC-1).
    const f = fakes({
      results: [{ tmdbId: 1, mediaType: 'tv', name: 'Obscure' }],
      imdbId: null,
    });

    const result = await lookupImdbRating(f.clients, { q: 'obscure' }, f.lookupInList);

    expect(result).not.toBeNull();
    expect(result?.imdbRating).toBeNull();
    expect(result?.imdbRating).not.toBe(0);
    expect(f.calls.omdb).toEqual([]);
  });

  it('T-IMDB-006d reports a work already on the owner list', async () => {
    const f = fakes({
      results: [{ tmdbId: 603, mediaType: 'movie', name: 'The Matrix' }],
      inList: { id: 'ttl_abc' },
    });

    const result = await lookupImdbRating(f.clients, { q: 'matrix' }, f.lookupInList);

    expect(result?.inList).toBe(true);
    expect(result?.titleId).toBe('ttl_abc');
  });

  it('T-IMDB-006e is false for a work that is not on the list', async () => {
    const f = fakes({ results: [{ tmdbId: 603, mediaType: 'movie', name: 'The Matrix' }] });

    const result = await lookupImdbRating(f.clients, { q: 'matrix' }, f.lookupInList);

    expect(result?.inList).toBe(false);
    expect(result?.titleId).toBeNull();
  });

  it('T-IMDB-006f still resolves the title when OMDb has no rating', async () => {
    // US-045 AC-5 — the lookup itself does not error.
    const f = fakes({
      results: [{ tmdbId: 603, mediaType: 'movie', name: 'The Matrix' }],
      rating: { imdbId: 'tt0133093', rating: null, voteCount: null },
    });

    const result = await lookupImdbRating(f.clients, { q: 'matrix' }, f.lookupInList);

    expect(result?.name).toBe('The Matrix');
    expect(result?.imdbRating).toBeNull();
  });

  it('T-IMDB-006g maps an unreachable TMDB onto the closed error code, never the upstream text', async () => {
    // The upstream message can carry the request URL, and the TMDB URL carries
    // the API key.
    const f = fakes({
      searchThrows: new TmdbUnavailableError(
        'fetch failed https://api.themoviedb.org/3/search/multi?api_key=SECRETKEY',
        null,
        true,
      ),
    });

    let thrown: unknown;
    try {
      await lookupImdbRating(f.clients, { q: 'matrix' }, f.lookupInList);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe('TMDB_UNAVAILABLE');
    expect((thrown as AppError).message).not.toContain('SECRETKEY');
  });

  it('T-IMDB-006h writes nothing — the module contains no repository writer', () => {
    // US-045 AC-2. Asserted against the SOURCE because "I checked and it does
    // not write" is a property that decays silently the first time somebody
    // adds a convenience cache-write to the row it just looked up.
    const source = readFileSync(
      fileURLToPath(new URL('../../../src/routes/imdb.ts', import.meta.url)),
      'utf8',
    );
    // Comment prose mentions writing; strip comments before matching so the
    // guard tests the CODE and cannot be defeated — or tripped — by a comment.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    for (const writer of ['create', 'update', 'delete', 'upsert', 'createMany', 'updateMany']) {
      expect(code).not.toContain(`.${writer}(`);
    }
    expect(code).not.toContain('$transaction');
    // The one repository call it may make is a read.
    expect(code).toContain('findTitleByWorkIdentity');
  });
});
