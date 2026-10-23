/**
 * #325 / #465 (PRD `A66`, US-074 / REQ-140) — the viewing record's pure rules.
 */

import { describe, expect, it } from 'vitest';

import {
  allAiredSeasonsFinished,
  isCalendarDay,
  isStarRating,
  parseFinishedRequest,
  parseWatchedPatch,
  seasonProgress,
} from '../src/index.js';

describe('T-VIEWED-001 · input rules', () => {
  it('T-VIEWED-001a · stars are whole numbers 1 to 5', () => {
    expect([1, 3, 5].every(isStarRating)).toBe(true);
    expect([0, 6, 2.5, '3', null, undefined].some(isStarRating)).toBe(false);
  });

  it('T-VIEWED-001b · a date is a real calendar day', () => {
    expect(isCalendarDay('2026-02-28')).toBe(true);
    expect(isCalendarDay('2026-02-30')).toBe(false);
    expect(isCalendarDay('26-02-28')).toBe(false);
    expect(isCalendarDay(20260228)).toBe(false);
  });

  it('T-VIEWED-001c · a finished request keeps unknown date and unrated distinct from absent', () => {
    expect(parseFinishedRequest({ seasons: [2, 1, 2], watchedOn: null, rating: 4 })).toEqual({
      ok: true,
      value: { seasons: [1, 2], watchedOn: null, rating: 4 },
    });
    expect(parseFinishedRequest({ seasons: [0] })).toEqual({
      ok: true,
      value: { seasons: [0], watchedOn: undefined, rating: undefined },
    });
  });

  it('T-VIEWED-001d · a finished request refuses bad shapes with a plain message', () => {
    for (const body of [
      null,
      [],
      { seasons: [] },
      { seasons: ['1'] },
      { seasons: [-1] },
      { seasons: [1], extra: true },
      { seasons: [1], watchedOn: 'yesterday' },
      { seasons: [1], rating: 6 },
    ]) {
      expect(parseFinishedRequest(body).ok, JSON.stringify(body)).toBe(false);
    }
  });

  it('T-VIEWED-001e · an edit carries only what was supplied', () => {
    expect(parseWatchedPatch({ rating: null })).toEqual({ ok: true, value: { rating: null } });
    expect(parseWatchedPatch({ watchedOn: '2026-01-02' })).toEqual({
      ok: true,
      value: { watchedOn: '2026-01-02' },
    });
    for (const body of [null, {}, { other: 1 }, { rating: 0 }, { watchedOn: 'x' }]) {
      expect(parseWatchedPatch(body).ok, JSON.stringify(body)).toBe(false);
    }
  });
});

describe('T-VIEWED-002 · season progress', () => {
  const seasons = [
    { seasonNumber: 0, airDate: '2019-01-01' },
    { seasonNumber: 1, airDate: '2020-01-01' },
    { seasonNumber: 2, airDate: '2021-01-01' },
    { seasonNumber: 3, airDate: '2030-01-01' },
    { seasonNumber: 4, airDate: null },
  ];

  it('T-VIEWED-002a · specials are excluded and an unaired or undated season is not aired', () => {
    const progress = seasonProgress(seasons, new Set([1]), '2026-06-01');
    expect(progress.map((s) => [s.seasonNumber, s.aired, s.finished])).toEqual([
      [1, true, true],
      [2, true, false],
      [3, false, false],
      [4, false, false],
    ]);
  });

  it('T-VIEWED-002b · all aired finished needs one aired season, ignores unaired, and reopens for a new season', () => {
    const done = seasonProgress(seasons, new Set([1, 2]), '2026-06-01');
    expect(allAiredSeasonsFinished(done)).toBe(true);
    expect(allAiredSeasonsFinished(seasonProgress(seasons, new Set([1]), '2026-06-01'))).toBe(
      false,
    );
    expect(allAiredSeasonsFinished(seasonProgress(seasons, new Set(), '2010-01-01'))).toBe(false);
    // Season 3 premieres: it is simply unwatched, so the show is no longer complete.
    expect(allAiredSeasonsFinished(seasonProgress(seasons, new Set([1, 2]), '2031-01-01'))).toBe(
      false,
    );
  });
});
