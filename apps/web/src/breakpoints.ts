/**
 * The breakpoints, as NUMBERS, for the one job CSS cannot do (TASK-211).
 *
 * ⚠ **A CSS CUSTOM PROPERTY CANNOT BE USED IN A MEDIA QUERY.** `@media
 * (min-width: var(--bp-sm))` is invalid CSS and is silently dropped — the
 * whole block simply never applies, and the page looks like the rule was never
 * written. That is why `index.css` already spells `640px` out inside its
 * `@media` prelude, and why a second literal is needed here for
 * `window.matchMedia`.
 *
 * ⚠ **THE DUPLICATION IS REAL AND IS GATED, NOT WISHED AWAY.** `--bp-sm` in
 * `:root` says "this is the width", the `@media` prelude acts on it, and
 * `matchMedia` here acts on it a third time. Three copies that can disagree is
 * exactly the failure `:root`'s own comment warns about — *"named so the same
 * width cannot be typed twice differently"* — and the symptom is the nastiest
 * kind: at one narrow band of widths the JavaScript believes it is on a phone
 * while the stylesheet believes it is not, so the phone bar renders with
 * desktop rules and nothing anywhere reports an error. `T-UX-132d` parses
 * `index.css` and asserts all three agree.
 *
 * ⚠ **`--bp-md` AND `--bp-lg` ARE DELIBERATELY ABSENT.** They have no
 * JavaScript consumer; adding them here "for symmetry" creates two more values
 * that can drift with nothing reading them. `T-UX-132d` checks what is
 * exported, so an unused export would weaken nothing — but an unused export
 * that later drifts is a trap set for whoever reaches for it.
 */

/**
 * `--bp-sm`, in `px`, without the unit.
 *
 * Below this width the navigation presents REQ-117's three-slot destination
 * bar; at or above it, every destination is a link in its own right.
 */
export const BP_SM = 640;

/**
 * The media query REQ-117's bar is keyed on.
 *
 * ⚠ **EXPRESSED AS `min-width`, MATCHING THE STYLESHEET, NOT AS `max-width`.**
 * `index.css` is mobile-first: the 320 px rules are the unconditional ones and
 * `@media (min-width: 640px)` is the override. A `max-width: 639.98px` query
 * here would be the same intent written the other way up, and the two
 * expressions disagree at exactly the fractional widths a zoomed browser
 * produces — the one place nobody tests.
 */
export const WIDE_VIEWPORT_QUERY = `(min-width: ${String(BP_SM)}px)`;
