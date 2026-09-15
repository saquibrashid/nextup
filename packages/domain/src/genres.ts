// TASK-213 — the genre vocabulary, normalised on read (REQ-120,
// `specs/ui-refresh.md` §4.4).
//
// ⚠ **THIS IS A FILTER-CORRECTNESS BUG, NOT A COSMETIC ONE.** TMDB maintains
// two genre vocabularies — one for film, one for TV — and this product puts
// film and TV rows in ONE genre filter dimension. `tmdbClient.ts` stores the
// names verbatim, so a TV title tagged `Action & Adventure` (TMDB id 10759)
// shares no token with a film tagged `Action` (28). **`?genre=Action`
// therefore silently misses every TV title today, and nothing on screen says
// so** — the same silent-omission shape this project guards against
// everywhere else. The owner reported the symptom ("some of the genres are
// redundant") rather than the bug; the redundant chips are what the collision
// looks like from the outside.
//
// ⚠ **NORMALISED ON READ. STORED DATA IS NOT REWRITTEN AND THERE IS NO
// MIGRATION** (`A53`, OQ-9). The mapping is applied at query time and at
// display time, so the change is fully reversible and `T-MIG-001` is not
// engaged.
//
// ⚠ **THE MAP IS A CLOSED LITERAL, NEVER A `" & "` SPLIT HEURISTIC.**
// Splitting on the ampersand would also shatter a legitimate single genre and
// would silently invent genres from any future TMDB name containing one.
// The three entries below are the whole map.

/**
 * The TV-only combined names, each expressed as its constituent **film**
 * genres. The film vocabulary is the canonical one — it is the finer-grained
 * of the two, so every combined name has an expansion while the reverse is not
 * true.
 *
 * ⚠ `War & Politics` EXPANDS TO ONE NAME, NOT TWO, AND THAT IS DELIBERATE.
 * The film vocabulary has `War` (10752) and has no `Politics` at all, so
 * emitting a `Politics` chip would invent a genre that can never appear on a
 * film, can never be offered as a filter option from the owner's own data on a
 * film-only list, and would return nothing the moment it was. §4.4's own table
 * calls this row *"two chips for one concept"*.
 */
export const TV_COMBINED_GENRES: Readonly<Record<string, readonly string[]>> = {
  'Action & Adventure': ['Action', 'Adventure'],
  'Sci-Fi & Fantasy': ['Science Fiction', 'Fantasy'],
  'War & Politics': ['War'],
};

/**
 * Every combined TV name, for the assertions that no such name may survive
 * into a rendered chip or a filter option (`T-UX-125`, `T-UX-126`).
 */
export const COMBINED_TV_GENRE_NAMES: readonly string[] = Object.keys(TV_COMBINED_GENRES);

/**
 * The canonical, film-vocabulary genres for a stored genre list — the DISPLAY
 * half of REQ-120.
 *
 * Order is preserved and duplicates are collapsed: a TV title tagged both
 * `Action & Adventure` and `Action` (TMDB does not do this today, but nothing
 * stops it) must not render `Action` twice.
 *
 * ⚠ **`[]` IN, `[]` OUT — AND THAT IS A TESTED ACCEPTANCE CRITERION.** US-019
 * AC-6 requires an empty genre list to render *nothing at all*, never
 * "Unknown" and never a placeholder. This function must therefore never
 * substitute a default for an empty input.
 */
export function normaliseGenres(stored: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of stored) {
    for (const canonical of TV_COMBINED_GENRES[name] ?? [name]) {
      if (!out.includes(canonical)) out.push(canonical);
    }
  }
  return out;
}

/**
 * Every STORED name that should match a canonical genre — the FILTER half of
 * REQ-120, and the half a display-only fix leaves broken.
 *
 * ⚠ **THE OWNER-REPORTED SYMPTOM DISAPPEARS AFTER A DISPLAY-ONLY FIX**, which
 * is exactly what makes a half-fix convincing: the redundant chips are gone,
 * the list looks right, and `?genre=Action` still misses every TV title.
 * `T-API-028` is the test that stays red.
 *
 * Derived from the same closed map as {@link normaliseGenres} rather than
 * written out as a second literal, so the two halves cannot drift: an entry
 * added to the map is expanded on both sides or on neither, which is §4.4's
 * "both, or neither" stated in code.
 */
export function storedGenreVariants(canonical: string): string[] {
  const variants = [canonical];
  for (const [combined, constituents] of Object.entries(TV_COMBINED_GENRES)) {
    if (constituents.includes(canonical)) variants.push(combined);
  }
  return variants;
}
