/**
 * TASK-213 — the genre vocabulary collision (REQ-120, `specs/ui-refresh.md`
 * §4.4). The pure half: one closed map, two derived readings of it.
 *
 * ⚠ **THIS IS A FILTER-CORRECTNESS BUG WITH A COSMETIC SYMPTOM**, which is
 * what makes a half-fix convincing. The owner reported redundant chips; the
 * defect is that `?genre=Action` silently misses every TV title. Normalising
 * the DISPLAY makes the reported symptom disappear entirely while the filter
 * stays broken — see `storedGenreVariants` below, and `T-API-028` for the
 * integration half that stays red after a display-only fix.
 */

import { describe, expect, it } from 'vitest';

import {
  COMBINED_TV_GENRE_NAMES,
  TV_COMBINED_GENRES,
  normaliseGenres,
  storedGenreVariants,
} from '../src/genres.js';

describe('T-UX-125 · ui-refresh.md §4.4 · the display half — combined TV names expand', () => {
  it('T-UX-125a: `Action & Adventure` becomes `Action` and `Adventure`, and does not survive', () => {
    expect(normaliseGenres(['Action & Adventure'])).toStrictEqual(['Action', 'Adventure']);
    expect(normaliseGenres(['Action & Adventure'])).not.toContain('Action & Adventure');
  });

  it('T-UX-125b: the other two combined names expand to the film vocabulary', () => {
    expect(normaliseGenres(['Sci-Fi & Fantasy'])).toStrictEqual(['Science Fiction', 'Fantasy']);
    // ⚠ ONE NAME, NOT TWO. The film vocabulary has `War` (10752) and has no
    // `Politics` at all, so a `Politics` chip would invent a genre that can
    // never appear on a film and can never be offered as an option from a
    // film-only list. §4.4's table calls this row "two chips for one concept".
    expect(normaliseGenres(['War & Politics'])).toStrictEqual(['War']);
  });

  it('T-UX-125c: a film genre passes through untouched', () => {
    expect(normaliseGenres(['Drama', 'Thriller'])).toStrictEqual(['Drama', 'Thriller']);
  });

  it('T-UX-125d: order is preserved and duplicates collapse', () => {
    // TMDB does not tag a title both ways today, but nothing stops it, and the
    // visible failure would be the row rendering `Action` twice.
    expect(normaliseGenres(['Action & Adventure', 'Action'])).toStrictEqual([
      'Action',
      'Adventure',
    ]);
    expect(normaliseGenres(['Drama', 'Action & Adventure'])).toStrictEqual([
      'Drama',
      'Action',
      'Adventure',
    ]);
  });

  it('T-UX-125e: `[]` in, `[]` out — US-019 AC-6 has no default to substitute', () => {
    // A placeholder reads as a fact about the work rather than an absence of
    // data, and the owner cannot tell the difference. The absence of a default
    // here is the requirement.
    expect(normaliseGenres([])).toStrictEqual([]);
  });
});

describe('T-UX-126 · ui-refresh.md §4.4 · no combined TV name can be offered as an option', () => {
  it('T-UX-126a: every combined name is a KEY of the map and never a value', () => {
    // The direction matters. A combined name appearing as a value would make
    // it reachable as a filter option, and selecting it would match only TV
    // rows — re-creating the same silent under-return in mirror image.
    const values = Object.values(TV_COMBINED_GENRES).flat();
    for (const combined of COMBINED_TV_GENRE_NAMES) {
      expect(values).not.toContain(combined);
    }
  });

  it('T-UX-126b: the three names §4.4 enumerates are exactly the map', () => {
    // Pinned as an exact set, not a superset. The map is a CLOSED literal —
    // §4.4 is explicit that a `" & "` split heuristic is forbidden, because it
    // would also shatter a legitimate single genre and would silently invent
    // genres from any future TMDB name containing an ampersand. A fourth entry
    // arriving here is a deliberate decision, so it should break a test.
    expect([...COMBINED_TV_GENRE_NAMES].sort()).toStrictEqual([
      'Action & Adventure',
      'Sci-Fi & Fantasy',
      'War & Politics',
    ]);
  });

  it('T-UX-126c: normalising any combined name yields no combined name', () => {
    for (const combined of COMBINED_TV_GENRE_NAMES) {
      for (const canonical of normaliseGenres([combined])) {
        expect(COMBINED_TV_GENRE_NAMES).not.toContain(canonical);
      }
    }
  });
});

describe('T-API-028 (pure half) · ui-refresh.md §4.4 · the filter half expands the other way', () => {
  it('T-API-028p: `Action` matches both the film name and the combined TV name', () => {
    expect(storedGenreVariants('Action')).toStrictEqual(['Action', 'Action & Adventure']);
    expect(storedGenreVariants('Adventure')).toStrictEqual(['Adventure', 'Action & Adventure']);
  });

  it('T-API-028q: `War` reaches `War & Politics`', () => {
    expect(storedGenreVariants('War')).toStrictEqual(['War', 'War & Politics']);
  });

  it('T-API-028r: a genre with no TV counterpart expands to itself alone', () => {
    // Not a no-op to assert: an implementation that returned every combined
    // name unconditionally would pass every test above and quietly widen every
    // filter in the app.
    expect(storedGenreVariants('Drama')).toStrictEqual(['Drama']);
  });

  it('T-API-028s: the two halves are derived from ONE map and cannot drift', () => {
    // §4.4: "THE MAPPING IS ONE-TO-MANY AND MUST BE APPLIED ON BOTH SIDES.
    // Expanding only the display leaves the filter broken; expanding only the
    // filter leaves the row showing a chip the owner cannot click. Both, or
    // neither." This asserts the round trip rather than the coincidence: every
    // canonical name the display can produce must be a name the filter can
    // reach back through.
    for (const [combined, constituents] of Object.entries(TV_COMBINED_GENRES)) {
      for (const canonical of constituents) {
        expect(storedGenreVariants(canonical)).toContain(combined);
      }
      expect(normaliseGenres([combined])).toStrictEqual([...constituents]);
    }
  });
});
