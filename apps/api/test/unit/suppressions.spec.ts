/**
 * TASK-101 — the pure half of suppression (`specs/api.md` §6.6, US-027/US-028).
 *
 * `T-SUP-001` is specified **U/I** deliberately. The integration suite proves
 * the key that reaches the database; these prove the key is a pure function of
 * the work identity and of nothing else, which is the property a future change
 * would break silently. They also carry the coverage: `npm run coverage`
 * excludes the integration project, so a route proven only there scores near
 * zero against the `apps/api/src/**` floor.
 */

import { suppressionIdFor } from '@nextup/domain';
import { describe, expect, it } from 'vitest';

import { toDisplaySnapshot } from '../../src/routes/suppressions.js';

describe('suppressionIdFor', () => {
  it('T-SUP-001e · US-028 AC-1 · the id is `supp:` + the work identity', () => {
    // Spelled out, not built from the constant under test.
    expect(suppressionIdFor('tmdb:movie:438631')).toBe('supp:tmdb:movie:438631');
    expect(suppressionIdFor('tmdb:tv:1396')).toBe('supp:tmdb:tv:1396');
    expect(suppressionIdFor('unmatched:0123456789abcdef')).toBe('supp:unmatched:0123456789abcdef');
  });

  it('T-SUP-001f · US-028 AC-1 · it is a pure function — same identity, same id', () => {
    // No clock, no randomness, no counter. If this ever stopped holding, the
    // route would create a second document per press and idempotency would go
    // with it — while every single-call test still passed.
    const a = suppressionIdFor('tmdb:movie:603');
    const b = suppressionIdFor('tmdb:movie:603');
    expect(a).toBe(b);
  });

  it('T-SUP-001g · REQ-071 · distinct identities never collide', () => {
    const ids = [
      'tmdb:movie:1',
      'tmdb:tv:1',
      'tmdb:movie:11',
      'unmatched:0123456789abcdef',
      'unmatched:fedcba9876543210',
    ].map(suppressionIdFor);
    // `tmdb:movie:1` vs `tmdb:tv:1` is the pair that a scheme dropping the
    // media type would merge — two different works, one suppression.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('T-SUP-001h · REQ-071 · a row id is refused, not silently accepted', () => {
    // The failure mode this guards is a caller passing `title.id` where a work
    // identity belongs. Accepted quietly, it produces a key that looks right,
    // works once, and is bypassed the moment the work reappears as a new row
    // (product invariant 7) — silently re-showing a rejected title.
    for (const notAnIdentity of [
      '01J8ZC9K2M3N4P5Q6R7S8T9V0W',
      'supp:tmdb:movie:1',
      'tmdb:movie:0',
      'tmdb:film:1',
      'unmatched:xyz',
      '',
    ]) {
      expect(() => suppressionIdFor(notAnIdentity)).toThrow(TypeError);
    }
  });
});

describe('toDisplaySnapshot', () => {
  it('T-SUP-010d · US-029 AC-1 · a matched title snapshots its TMDB metadata', () => {
    expect(
      toDisplaySnapshot({
        workIdentity: 'tmdb:movie:603',
        rawExtractedText: 'the matrx',
        tmdbName: 'The Matrix',
        tmdbReleaseYear: 1999,
        tmdbMediaType: 'movie',
        tmdbPosterPath: '/p.jpg',
      }),
    ).toEqual({
      displayName: 'The Matrix',
      displayReleaseYear: 1999,
      displayMediaType: 'movie',
      displayPosterPath: '/p.jpg',
    });
  });

  it('T-SUP-010e · OQ-015 · an unmatched title falls back to the raw text', () => {
    expect(
      toDisplaySnapshot({
        workIdentity: 'unmatched:0123456789abcdef',
        rawExtractedText: 'Sqwiggly OCR Text',
        tmdbName: null,
        tmdbReleaseYear: null,
        tmdbMediaType: null,
        tmdbPosterPath: null,
      }),
    ).toEqual({
      displayName: 'Sqwiggly OCR Text',
      displayReleaseYear: null,
      displayMediaType: null,
      displayPosterPath: null,
    });
  });

  it('T-SUP-010f · the snapshot never blocks the decision on missing metadata', () => {
    // `displayName` is NOT NULL in the store. Refusing the suppression because
    // a title has neither a TMDB name nor raw text would discard the owner's
    // decision to protect a label — the wrong trade in both directions.
    expect(
      toDisplaySnapshot({
        workIdentity: 'tmdb:movie:603',
        rawExtractedText: null,
        tmdbName: null,
        tmdbReleaseYear: null,
        tmdbMediaType: null,
        tmdbPosterPath: null,
      }).displayName,
    ).toBe('');
  });
});
