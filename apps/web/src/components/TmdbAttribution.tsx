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
 * The sentence itself is not written in this file. `specs/api.md` §6.1 and
 * `specs/ui.md` §8 require ONE source, verbatim, never re-typed - which is what
 * `T-ATTR-001` asserts by comparing the constant, the API value and the
 * rendered DOM text for byte equality.
 *
 * The props exist for that third leg. `TASK-024` adds `attribution` to
 * `GET /api/me` and `packages/domain/src/attribution.ts`; at that point the
 * caller passes the API's values straight in and `T-ATTR-001` compares all
 * three. Until then the defaults come from `copy.ts`, which is byte-equal to
 * the required wording.
 */

import type { JSX } from 'react';

import { TMDB_DISCLAIMER } from '../copy';

/** `specs/api.md` §6.1 - `attribution.tmdbLogoPath`. */
export const TMDB_LOGO_PATH = '/assets/tmdb-logo.svg';

/** `specs/ui.md` §10.2 - the TMDB logo is the one image with meaningful alt text. */
export const TMDB_LOGO_ALT = 'TMDB';

export interface TmdbAttributionProps {
  /** `attribution.tmdbDisclaimer` from `GET /api/me`, once TASK-024 lands. */
  readonly disclaimer?: string;
  /** `attribution.tmdbLogoPath` from `GET /api/me`, once TASK-024 lands. */
  readonly logoPath?: string;
}

export function TmdbAttribution({
  disclaimer = TMDB_DISCLAIMER,
  logoPath = TMDB_LOGO_PATH,
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
    </div>
  );
}
