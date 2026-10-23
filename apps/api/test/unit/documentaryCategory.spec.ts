import { describe, expect, it } from 'vitest';
import { parseTitleListQuery } from '../../src/routes/titlesQuery.js';
import { toListItem } from '../../src/routes/titles.js';

const row = {
  id: 'one',
  workIdentity: 'tmdb:movie:42',
  matchState: 'matched',
  rawExtractedText: null,
  sortDateAdded: new Date('2026-01-01'),
  tmdbId: 42,
  tmdbMediaType: 'movie',
  tmdbName: 'Reel Life',
  tmdbReleaseYear: 2025,
  tmdbRuntimeMinutes: 90,
  tmdbGenres: '["Documentary","History"]',
  tmdbPosterPath: null,
  tmdbComedyShow: false,
  listings: [],
};

describe('T-DOC-002 API projection and query validation for Documentary (#456, A62)', () => {
  it('T-DOC-002a a stored Documentary genre projects the category and keeps the media type', () => {
    expect(toListItem(row)).toMatchObject({
      category: 'documentary',
      automaticCategory: 'documentary',
      mediaType: 'movie',
      workIdentity: 'tmdb:movie:42',
      categoryPending: false,
    });
    expect(toListItem({ ...row, workIdentity: 'tmdb:tv:7', tmdbMediaType: 'tv' })).toMatchObject({
      category: 'documentary',
      mediaType: 'tv',
    });
  });
  it('T-DOC-002b a title without the genre is unaffected, and an override beats the genre', () => {
    expect(toListItem({ ...row, tmdbGenres: '["Drama"]' })).toMatchObject({ category: 'movie' });
    expect(toListItem({ ...row, tmdbGenres: 'not json' })).toMatchObject({ category: 'movie' });
    expect(toListItem({ ...row, categoryOverride: 'tv' })).toMatchObject({
      category: 'tv',
      categoryOverride: 'tv',
      automaticCategory: 'documentary',
    });
    expect(
      toListItem({ ...row, tmdbGenres: '["Drama"]', categoryOverride: 'documentary' }),
    ).toMatchObject({ category: 'documentary', automaticCategory: 'movie' });
  });
  it('T-DOC-002c the category query parameter accepts documentary and still rejects unknown values', () => {
    expect(parseTitleListQuery({ category: ['documentary', 'tv'] }).categories).toEqual([
      'documentary',
      'tv',
    ]);
    expect(() => parseTitleListQuery({ category: 'Documentary' })).toThrow();
    expect(() => parseTitleListQuery({ category: 'documentaries' })).toThrow();
  });
});
