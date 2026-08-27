/**
 * TASK-061 — `T-TMDB-013` (US-007 AC-6, REQ-029).
 *
 * "Zod rejects any TMDB field outside the stored allow-list; nothing extra is
 * persisted."
 *
 * ⚠ THE ASSERTION IS "THROWS", NOT "OMITS". A test that parsed a payload with
 * an extra key and asserted the extra key is absent from the RESULT passes
 * under Zod's default stripping behaviour — which is the very behaviour the
 * acceptance criterion is worded against ("rather than stripping them", the
 * backlog row). Every positive case below therefore asserts the throw.
 */

import { describe, expect, it } from 'vitest';

import {
  TMDB_STORED_FIELDS,
  TmdbFieldNotAllowedError,
  parseStoredTmdbMetadata,
  tmdbMetadataSchema,
} from '../src/index.js';

const VALID = {
  tmdbId: 438631,
  mediaType: 'movie' as const,
  name: 'Dune',
  releaseYear: 2021,
  runtimeMinutes: 155,
  genres: ['Science Fiction', 'Adventure'],
  posterPath: '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg',
  fetchedAt: '2026-01-15T09:00:00.000Z',
};

describe('T-TMDB-013 · the TMDB storage allow-list rejects, it does not strip', () => {
  it('T-TMDB-013a: the allow-list is exactly the seven stored fields plus fetchedAt', () => {
    // The vacuity guard. Every case below is "this key is not allowed", so an
    // allow-list that had quietly grown would make them pass while storing the
    // field they exist to keep out.
    expect([...TMDB_STORED_FIELDS]).toEqual([
      'fetchedAt',
      'genres',
      'mediaType',
      'name',
      'posterPath',
      'releaseYear',
      'runtimeMinutes',
      'tmdbId',
    ]);
  });

  it('T-TMDB-013b: a listed payload parses and round-trips unchanged', () => {
    expect(parseStoredTmdbMetadata(VALID)).toEqual(VALID);
  });

  it('T-TMDB-013c: an unlisted field THROWS and is named in the error', () => {
    // `overview` is not a hypothetical: it is the field TMDB returns on every
    // detail response and the one a future "show a synopsis" change would
    // reach for first.
    expect(() => parseStoredTmdbMetadata({ ...VALID, overview: 'A noble family…' })).toThrow(
      TmdbFieldNotAllowedError,
    );

    try {
      parseStoredTmdbMetadata({ ...VALID, overview: 'A noble family…' });
      expect.unreachable('an unlisted field must not parse');
    } catch (error) {
      expect(error).toBeInstanceOf(TmdbFieldNotAllowedError);
      expect((error as TmdbFieldNotAllowedError).fields).toEqual(['overview']);
      expect((error as Error).message).toContain('overview');
    }
  });

  it('T-TMDB-013d: EVERY unlisted field is reported, not just the first', () => {
    // A one-key error invites a whack-a-mole fix that leaves the rest of a
    // changed TMDB response silently unexamined.
    try {
      parseStoredTmdbMetadata({
        ...VALID,
        overview: 'x',
        tagline: 'y',
        budget: 165_000_000,
        adult: false,
      });
      expect.unreachable('unlisted fields must not parse');
    } catch (error) {
      expect((error as TmdbFieldNotAllowedError).fields).toEqual([
        'adult',
        'budget',
        'overview',
        'tagline',
      ]);
    }
  });

  it('T-TMDB-013e: the Rule A prose fields are refused by name', () => {
    // RSK-022 in its storage form. These four are TMDB's free text; storing
    // any of them puts prose one field-read away from an extraction request,
    // which `specs/ai.md` §4.4 forbids. `T-AI-013` guards the wire; this is
    // the store's half of the same rule.
    for (const field of ['overview', 'tagline', 'keywords', 'reviews']) {
      expect(() => parseStoredTmdbMetadata({ ...VALID, [field]: 'anything' })).toThrow(
        TmdbFieldNotAllowedError,
      );
    }
  });

  it('T-TMDB-013f: a bad VALUE is a different failure from an unlisted KEY', () => {
    // They mean different things — an unlisted key is a change in TMDB or in
    // our client that a human must look at; a bad value is ordinary
    // corruption — and a caller that wants to log one and alert on the other
    // has to be able to tell them apart.
    expect(() => parseStoredTmdbMetadata({ ...VALID, tmdbId: -1 })).toThrow();
    expect(() => parseStoredTmdbMetadata({ ...VALID, tmdbId: -1 })).not.toThrow(
      TmdbFieldNotAllowedError,
    );
    // A poster URL, not a path — the schema's one content-shaped rule.
    expect(() =>
      parseStoredTmdbMetadata({ ...VALID, posterPath: 'https://image.tmdb.org/x.jpg' }),
    ).not.toThrow(TmdbFieldNotAllowedError);
  });

  it('T-TMDB-013g: the schema itself is strict, so nothing downstream can strip', () => {
    // ⚠ Asserted on the SCHEMA, not only through the helper. Every other case
    // here goes through `parseStoredTmdbMetadata`, so a future caller that
    // reached for `tmdbMetadataSchema.parse` directly — the obvious thing to
    // do — would bypass the policy entirely if the schema were not itself
    // strict. `.strict()` is the load-bearing call.
    expect(() => tmdbMetadataSchema.parse({ ...VALID, overview: 'x' })).toThrow();
    expect(tmdbMetadataSchema.parse(VALID)).toEqual(VALID);
  });

  it('T-TMDB-013h: `genres: []` survives and is never defaulted', () => {
    // US-019 AC-6. An empty genre list is a MEANINGFUL value — the title
    // matches no genre filter — and a parser that helpfully supplied a
    // default would make it invisible.
    expect(parseStoredTmdbMetadata({ ...VALID, genres: [] }).genres).toEqual([]);
  });
});
