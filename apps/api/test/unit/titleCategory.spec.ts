import { describe, expect, it } from 'vitest';
import { readComedyShow } from '../../src/clients/tmdbClient.js';
import { parseTitleListQuery } from '../../src/routes/titlesQuery.js';
import { toListItem } from '../../src/routes/titles.js';

describe('T-CATEGORY-002 provider projection and API category', () => {
  it('T-CATEGORY-002a reads both documented keyword shapes and distinguishes absent from negative', () => {
    expect(readComedyShow({ keywords: [{ name: 'stand-up comedy' }] }, 'movie')).toBe(true);
    expect(readComedyShow({ results: [{ name: 'live comedy' }] }, 'tv')).toBe(true);
    expect(readComedyShow({ keywords: [] }, 'movie')).toBe(false);
    expect(readComedyShow({ results: [{ name: 'sitcom' }] }, 'tv')).toBe(false);
    for (const value of [
      null,
      undefined,
      [],
      {},
      { keywords: {} },
      { keywords: [null] },
      { keywords: [{ name: 5 }] },
    ]) {
      expect(readComedyShow(value, 'movie')).toBeNull();
    }
  });
  it('T-CATEGORY-002b validates OR category filters independently of legacy canonical type', () => {
    expect(parseTitleListQuery({ category: ['movie', 'comedy-show'], type: 'tv' })).toMatchObject({
      categories: ['movie', 'comedy-show'],
      mediaType: 'tv',
    });
    expect(() => parseTitleListQuery({ category: 'Comedy' })).toThrow();
    expect(() => parseTitleListQuery({ category: { owner: 'movie' } })).toThrow();
    expect(parseTitleListQuery({}).categories).toEqual([]);
  });
  it('T-CATEGORY-002c projects effective category without changing identity or runtime semantics', () => {
    const row = {
      id: 'one',
      workIdentity: 'tmdb:tv:42',
      matchState: 'matched',
      rawExtractedText: null,
      sortDateAdded: new Date('2026-01-01'),
      tmdbId: 42,
      tmdbMediaType: 'tv',
      tmdbName: 'Special',
      tmdbReleaseYear: 2025,
      tmdbRuntimeMinutes: 50,
      tmdbGenres: '["Comedy"]',
      tmdbPosterPath: null,
      tmdbComedyShow: true,
      listings: [],
    };
    expect(toListItem(row)).toMatchObject({
      category: 'comedy-show',
      mediaType: 'tv',
      workIdentity: row.workIdentity,
      categoryPending: false,
    });
    expect(toListItem({ ...row, categoryOverride: 'movie' })).toMatchObject({
      category: 'movie',
      categoryOverride: 'movie',
      automaticCategory: 'comedy-show',
    });
    expect(toListItem({ ...row, tmdbComedyShow: null })).toMatchObject({
      category: 'tv',
      categoryPending: true,
    });
  });
});
