/**
 * The shared chrome for every bundled service mark (ADR-0014, issue #288).
 *
 * ⚠ **THIS IS A SECOND, SEPARATE REGISTER — IT IS NOT AN EXTENSION OF THE
 * `icons/` SET.** The two cannot share a base. ADR-0013's closed icon register
 * is *drawn* line art: `T-UI-030a/d` require `stroke="currentColor"` at
 * `stroke-width="1.5"`, because a hand-authored set only looks like a set when
 * every member is built the same way. A brand mark is a **filled** glyph
 * someone else authored; stroking it would not render the logo, it would
 * render an outline of the logo. Putting them in one directory would force one
 * of the two gates to be weakened, and the weakened one would be ADR-0013's.
 *
 * ⚠ **MONOCHROME, INHERITED, ALWAYS.** `fill="currentColor"` is the whole
 * colour story. A brand-coloured mark would put a hex literal in a `.tsx`
 * file, which is exactly the half of the contrast gate the stylesheet scan
 * cannot see (`T-UI-030c`'s reasoning, mirrored here by `T-BRAND-001c`) — and
 * Netflix red on the dark theme's surface is a real contrast failure, not a
 * hypothetical one.
 *
 * ⚠ **THE MARK IS NEVER THE SOLE CARRIER OF MEANING** (`specs/ui.md` §10.2).
 * It renders `aria-hidden` by default; the service name is supplied as text by
 * the caller — visible in the upload chooser, visually hidden in a row badge.
 * A logo-only badge with no accessible name is unreadable to a screen reader
 * AND unfindable by in-page text search, and neither failure is visible in a
 * screenshot.
 */

import type { JSX, ReactNode } from 'react';

export interface BrandMarkProps {
  /**
   * Exposes the mark as an image with this name. Omit it — the normal case —
   * and the mark is decorative, because the caller already renders the name.
   */
  readonly label?: string;
}

export function BrandMarkBase({
  label,
  children,
}: BrandMarkProps & { readonly children: ReactNode }): JSX.Element {
  const named = label !== undefined;
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden={named ? undefined : true}
      // ⚠ `role="img"` is load-bearing: an `aria-label` on a bare `<svg>` is
      // ignored by several screen readers because there is no implicit role to
      // name, so the mark is silently anonymous with the attribute in place.
      role={named ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      {children}
    </svg>
  );
}
