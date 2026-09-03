/**
 * `useOutcomeFocus` — the second half of `T-A11Y-006`.
 *
 * `specs/ux-states.md` §1 *"Focus after a state change"*: on success focus
 * moves to the `role="status"` region. `useDialogFocus` closed the dialog half
 * of that id; this closes the outcome half.
 *
 * ⚠ **DELIBERATELY NOT APPLIED TO EVERY LIVE REGION, AND MUST NOT BE.** There
 * are 53 `role="status"`/`role="alert"` regions across 23 components and most
 * are AMBIENT — `OfflineBanner`, `FreshnessStrip`, `FilterBar`'s result count,
 * `LoadMoreSentinel`'s busy message. Those change while the owner is reading or
 * typing something else, and focusing them would yank the caret out of the
 * filter box on every poll: a worse defect than the one being fixed. Only an
 * outcome the owner *asked for* by pressing a control earns the focus move.
 *
 * The owner scoped it to exactly three outcomes:
 *
 *   1. the review close (`BatchAppliedNotice`),
 *   2. the fix-match confirmation (`FixMatchDialog`),
 *   3. the suppression (`SuppressDialog`).
 *
 * Adding a fourth is an owner-level design decision, not a mechanical sweep.
 *
 * ⚠ **THE DEPENDENCY ARRAY IS THE TRANSITION GUARD — DO NOT DROP IT.** The
 * outcome regions re-render for reasons the owner drives: pressing **Undo**
 * moves `BatchAppliedNotice` through `undoing` into `undone` or `failed`. An
 * effect without `[active]` would re-focus on each of those renders, yanking
 * focus off the very button being pressed and turning the remedy into a trap.
 * `T-A11Y-006j` fails if the array goes.
 *
 * ⚠ An explicit `wasActive` ref was tried here and removed: with `[active]` as
 * the dependency the effect ALREADY runs only when `active` changes, so the
 * ref could not be made to fail any mutation. Unverifiable code in an
 * accessibility hook reads as a guarantee that nothing is checking.
 */
import { useEffect, useRef, type RefObject } from 'react';

export function useOutcomeFocus<T extends HTMLElement>(active: boolean): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (active) {
      // ⚠ The element must carry `tabIndex={-1}`: a `<p>` is not focusable, and
      // `focus()` on it is a silent no-op that leaves focus wherever it was
      // while every test asserting "the region exists" still passes.
      ref.current?.focus();
    }
  }, [active]);

  return ref;
}
