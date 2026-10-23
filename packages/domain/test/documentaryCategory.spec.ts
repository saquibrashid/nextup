import { describe, expect, it } from 'vitest';
import {
  TITLE_CATEGORIES,
  TITLE_CATEGORY_LABELS,
  isDocumentaryGenre,
  isTitleCategory,
  parseCategoryOverride,
  titleCategory,
} from '../src/index.js';

describe('T-DOC-001 Documentary is a derived display category (#456, A62)', () => {
  it('T-DOC-001a the TMDB Documentary genre classifies both movies and series, others are unaffected', () => {
    expect(titleCategory('movie', false, null, ['Documentary', 'History'])).toBe('documentary');
    expect(titleCategory('tv', null, undefined, ['Documentary'])).toBe('documentary');
    expect(titleCategory('movie', false, null, ['Drama'])).toBe('movie');
    expect(titleCategory('tv', false, null, [])).toBe('tv');
    expect(titleCategory('tv', false)).toBe('tv');
    expect(titleCategory('movie', false, null, ['Documentaries'])).toBe('movie');
    expect(titleCategory(null, null, null, ['Documentary'])).toBe('documentary');
    expect(isDocumentaryGenre(null)).toBe(false);
    expect(isDocumentaryGenre([' documentary '])).toBe(true);
  });
  it('T-DOC-001b the owner override wins both ways, and Comedy Show outranks the genre', () => {
    expect(titleCategory('movie', false, 'movie', ['Documentary'])).toBe('movie');
    expect(titleCategory('tv', false, 'comedy-show', ['Documentary'])).toBe('comedy-show');
    expect(titleCategory('movie', false, 'documentary', ['Drama'])).toBe('documentary');
    expect(titleCategory('tv', true, null, ['Documentary'])).toBe('comedy-show');
  });
  it('T-DOC-001c the registry, labels and override payload carry Documentary', () => {
    expect(TITLE_CATEGORIES).toEqual(['movie', 'tv', 'comedy-show', 'documentary']);
    expect(TITLE_CATEGORY_LABELS.documentary).toBe('Documentary');
    expect(Object.keys(TITLE_CATEGORY_LABELS).sort()).toEqual([...TITLE_CATEGORIES].sort());
    expect(isTitleCategory('documentary')).toBe(true);
    expect(parseCategoryOverride({ categoryOverride: 'documentary' })).toEqual({
      categoryOverride: 'documentary',
    });
    for (const value of ['Documentary', 'documentaries', 'docs']) {
      expect(parseCategoryOverride({ categoryOverride: value })).toBeNull();
    }
  });
});
