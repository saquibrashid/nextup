import { describe, expect, it } from 'vitest';
import {
  isComedyPerformance,
  isTitleCategory,
  titleCategory,
  parseCategoryOverride,
} from '../src/index.js';

describe('T-CATEGORY-001 category is not canonical identity', () => {
  it('T-CATEGORY-001a accepts only explicit performance keywords, not genre or narrative hints', () => {
    for (const keyword of [
      'stand-up comedy',
      ' Stand Up Comedy ',
      'STAND-UP SPECIAL',
      'live comedy',
    ]) {
      expect(isComedyPerformance([keyword])).toBe(true);
    }
    for (const keywords of [
      [],
      ['Comedy'],
      ['comedian', 'concert'],
      ['a stand-up comedian'],
      ['stand-up comedy documentary'],
    ]) {
      expect(isComedyPerformance(keywords)).toBe(false);
    }
  });
  it('T-CATEGORY-001b resolves overrides before metadata and never invents unmatched media types', () => {
    expect(titleCategory('movie', true)).toBe('comedy-show');
    expect(titleCategory('tv', true)).toBe('comedy-show');
    expect(titleCategory('movie', true, 'movie')).toBe('movie');
    expect(titleCategory('movie', false, 'comedy-show')).toBe('comedy-show');
    expect(titleCategory('tv', null)).toBe('tv');
    expect(titleCategory('movie', undefined, null)).toBe('movie');
    expect(titleCategory(null, null)).toBeNull();
    expect(titleCategory('unknown', false)).toBeNull();
  });
  it('T-CATEGORY-001c validates exact owner payloads including explicit Automatic', () => {
    for (const value of ['movie', 'tv', 'comedy-show', null]) {
      expect(parseCategoryOverride({ categoryOverride: value })).toEqual({
        categoryOverride: value,
      });
    }
    for (const body of [
      null,
      [],
      'movie',
      {},
      { categoryOverride: undefined },
      { categoryOverride: 'comedy' },
      { categoryOverride: 'movie', ownerId: 'other' },
    ]) {
      expect(parseCategoryOverride(body)).toBeNull();
    }
    expect(isTitleCategory('comedy-show')).toBe(true);
    expect(isTitleCategory(null)).toBe(false);
  });
});
