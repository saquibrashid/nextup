/**
 * TMDB attribution — a LICENSING OBLIGATION, not product copy (US-011 AC-2,
 * `specs/security.md`, `specs/api.md` §6.1).
 *
 * ⚠ ONE SOURCE, VERBATIM, NEVER RE-TYPED. TMDB requires this exact sentence.
 * The API serves it from here (`GET /api/me` → `attribution.tmdbDisclaimer`),
 * and the SPA renders what the API returns. `T-ATTR-001` asserts the constant,
 * the API value and the rendered DOM text are all byte-equal.
 *
 * Do not "fix" the punctuation, expand "TMDB", or reflow this string. A
 * reworded disclaimer is a different disclaimer, and the whole point of the
 * assertion chain is that nobody can quietly reword one copy of it.
 */

/** The exact sentence TMDB requires. Byte-for-byte. */
export const TMDB_DISCLAIMER =
  'This product uses the TMDB API but is not endorsed or certified by TMDB.';

/**
 * Where the SPA serves the TMDB logo from (`specs/ui.md` §8, rendered with
 * `alt="TMDB"`). Served as a path rather than a remote URL: hot-linking TMDB's
 * asset would be an outbound request on every page load, which the outbound
 * host allow-list (`T-SEC-031`) exists to prevent.
 */
export const TMDB_LOGO_PATH = '/assets/tmdb-logo.svg';

/** The `attribution` object of `GET /api/me` (`specs/api.md` §6.1). */
export interface Attribution {
  readonly tmdbDisclaimer: string;
  readonly tmdbLogoPath: string;
}

/**
 * The attribution payload, built from the constants above.
 *
 * A function rather than an exported literal so a caller cannot mutate the
 * shared object and change what every later response says.
 */
export function attributionPayload(): Attribution {
  return {
    tmdbDisclaimer: TMDB_DISCLAIMER,
    tmdbLogoPath: TMDB_LOGO_PATH,
  };
}
