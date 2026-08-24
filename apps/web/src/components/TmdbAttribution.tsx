/**
 * `TmdbAttribution` (TASK-026) - the TMDB logo and disclaimer, rendered in the
 * global footer of `AppShell` so it is present on every one of the nine routes
 * (`specs/ui.md` §8).
 *
 * ⚠ This is a LICENSING obligation (NFR-013, `specs/security.md`), not a design
 * element, and §8 is blunt about why it is tested three separate ways: **its
 * failure is invisible from inside the product.** nextup looks perfectly
 * healthy with the attribution missing. So:
 *
 * - The disclaimer is rendered as VISIBLE TEXT - never a `title`, never an
 *   `aria-label`, never baked into the image (US-011 AC-2).
 * - It is never behind an expander, a tooltip, a modal, or an "about" link
 *   (US-011 AC-3). `/about` says MORE; it is not where the sentence lives.
 * - It renders synchronously from a constant. It is deliberately NOT gated on
 *   a fetch: a compliance statement that disappears while `/api/me` is slow,
 *   offline or erroring is a compliance statement that is absent exactly when
 *   the owner is most likely to be looking at an error screen.
 *
 * The sentence itself is not written in this file, and is no longer written in
 * `copy.ts` either. `packages/domain/src/attribution.ts` is the one source;
 * `specs/api.md` §6.1 and `specs/ui.md` §8 require ONE source, verbatim, never
 * re-typed - which is what `T-ATTR-001` asserts by comparing the constant, the
 * API value and the rendered DOM text for byte equality.
 *
 * The props are the third leg of that chain: once `GET /api/me` is wired up the
 * caller passes the API's `attribution` values straight in, and all three are
 * compared. They default to the domain constants, which are the same bytes the
 * API serves - so an unwired caller renders the correct sentence rather than
 * nothing, and the fallback can never drift from what the API would have said.
 */

import type { JSX } from 'react';

import { TMDB_DISCLAIMER, TMDB_LOGO_PATH, OMDB_DISCLAIMER } from '@nextup/domain';

/**
 * `specs/api.md` §6.1 - `attribution.tmdbLogoPath`.
 *
 * Re-exported from `packages/domain/src/attribution.ts` rather than redeclared,
 * so the path the API advertises and the path the SPA actually requests cannot
 * disagree. A second literal would 404 silently: the disclaimer would still
 * render, so the page would look compliant while the logo was missing.
 */
export { TMDB_LOGO_PATH };

/** `specs/ui.md` §10.2 - the TMDB logo is the one image with meaningful alt text. */
export const TMDB_LOGO_ALT = 'TMDB';

export interface TmdbAttributionProps {
  /** `attribution.tmdbDisclaimer` from `GET /api/me`, once TASK-024 lands. */
  readonly disclaimer?: string;
  /** `attribution.tmdbLogoPath` from `GET /api/me`, once TASK-024 lands. */
  readonly logoPath?: string;
  /** `attribution.omdbDisclaimer` from `GET /api/me` (ADR-0011 D-1a). */
  readonly omdbDisclaimer?: string;
}

export function TmdbAttribution({
  disclaimer = TMDB_DISCLAIMER,
  logoPath = TMDB_LOGO_PATH,
  omdbDisclaimer = OMDB_DISCLAIMER,
}: TmdbAttributionProps = {}): JSX.Element {
  return (
    <div className="tmdb-attribution" data-testid="tmdb-attribution">
      <img src={logoPath} alt={TMDB_LOGO_ALT} className="tmdb-attribution__logo" />
      {/*
        A <p>, not a <span> inside a wrapping line: at the 320px floor the
        sentence has to wrap and stay fully visible rather than being clipped or
        ellipsised (T-ATTR-004). Nothing here may set `text-overflow`,
        `white-space: nowrap`, or a fixed height.
      */}
      <p className="tmdb-attribution__disclaimer">{disclaimer}</p>
      {/*
        ADR-0011 D-1a. Rendered under the same rules and for a related reason:
        a number labelled "IMDb" that in fact came from a third-party
        republisher misstates its own provenance, and that is invisible from
        inside the product exactly like a missing TMDB line.
      */}
      <p className="tmdb-attribution__disclaimer" data-testid="omdb-disclaimer">
        {omdbDisclaimer}
      </p>
    </div>
  );
}
