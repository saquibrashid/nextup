// The one `<svg>` element in the application (REQ-124, `specs/ui-refresh.md`
// §7c, TASK-209).
//
// ⚠ EVERY ICON RENDERS THROUGH THIS, AND THAT IS THE POINT. The accessibility
// contract in §7c is not a property of any one drawing — it is a property of
// the wrapper. If a thirteenth icon were to hand-author its own `<svg>` it
// would inherit none of it, and the defect is invisible: the icon still draws
// correctly, and only a screen reader ever learns that the button it sits in
// has no name. `T-A11Y-016` therefore forbids an `<svg>` anywhere in
// `apps/web/src/**` outside this directory.
//
// ⚠ `stroke="currentColor"` AND NO COLOUR OF ITS OWN. An icon inherits the
// token of the text around it, so it is covered by `T-CSS-004`'s computed
// contrast without needing a token — and an icon carrying its own `#hex` is
// invisible to that gate while being exactly the thing it exists to catch.
// That also keeps `T-CSS-003b` honest: a colour here would sit outside
// `:root` in a file the stylesheet gate never reads.
//
// ⚠ NO ICON LIBRARY, NO FONT, NO SPRITE URL. The owner accepted icons at
// `A53` (OQ-8) specifically on the basis that neither a runtime dependency
// nor a network request is incurred. A sprite is a request; a font is both a
// request and a block of invisible text. NFR-004's justification burden is met
// here by adding nothing at all.

import type { JSX, ReactNode } from 'react';

export interface IconProps {
  /**
   * The accessible name.
   *
   * ⚠ OMIT IT ONLY WHEN THE ICON IS GENUINELY DECORATIVE — i.e. a visible
   * text label sits beside it. An undecorated icon that is the *only* content
   * of a control produces a control whose accessible name is **empty**;
   * `axe-core` reports that as `button-name`, and in a diff it reads as a
   * styling change rather than as the accessibility regression it is (§7c).
   *
   * When omitted the icon is `aria-hidden` and contributes nothing to the
   * accessibility tree — which is correct beside a label and wrong alone.
   */
  readonly label?: string | undefined;
}

interface IconBaseProps extends IconProps {
  readonly children: ReactNode;
}

/**
 * Draws one 24 px-grid icon.
 *
 * ⚠ `focusable="false"` is not redundant with `aria-hidden`. Legacy engines
 * put SVG elements in the tab order regardless, which strands keyboard focus
 * on a decoration with no name and no action.
 */
export function IconBase({ children, label }: IconBaseProps): JSX.Element {
  const decorative = label === undefined;
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : 'img'}
      aria-label={label}
    >
      {children}
    </svg>
  );
}
