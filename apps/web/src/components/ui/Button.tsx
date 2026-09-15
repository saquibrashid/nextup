// `Button` — the primitive every control in the application is built from
// (REQ-125, `specs/ui-refresh.md` §7d, TASK-210).
//
// ⚠ 66 OF THE 75 BUTTONS IN THIS APPLICATION CARRIED `className="tap-target"`
// AND NOTHING ELSE — no border, no fill, no radius, no hover. That is not a
// styling oversight, it is the entire defect the owner reported: a screen of
// raw platform widgets, each individually correct, none of them related to
// any other. The remaining nine had each grown their own private rule, and
// seven of those nine were the same border-plus-radius written out again.
//
// ⚠ THE VARIANT IS A STATIC LOOKUP FROM A LITERAL MAP, AND THAT IS A HARD
// CONSTRAINT, NOT A STYLE CHOICE. `T-CSS-001` scans components and stylesheet
// against each other in BOTH directions, and its power depends on every class
// name being a literal it can find. A template literal — `btn btn--${variant}`
// — makes the vocabulary unscannable: the reverse direction then reports every
// variant as dead CSS, and the natural fix is to weaken the gate. §7d widens
// `T-CSS-001c` to permit `MAP[key]` and nothing else, and `T-UI-032` pins it.
//
// ⚠ EVERY VARIANT CARRIES `.tap-target`, so NFR-006's 44 px floor cannot be
// lost for every control at once by editing one file. §8 already flags this
// as the easiest place in the codebase to lose it — REQ-107 narrows the `⋮`
// BOX and reads like licence to shrink the target, which it is not.
//
// ⚠ LAYOUT IS NOT A VARIANT. A button that needs a margin or a flex rule gets
// a wrapper element carrying that class; appearance belongs to the primitive,
// position belongs to the parent. Folding `margin-top` into a variant is how
// a fifth and sixth variant appear that differ from the first only in where
// they happen to sit.

import { forwardRef, type ButtonHTMLAttributes, type JSX } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * ⚠ THE LITERAL MAP. Values are whole class strings, never assembled — see
 * the header. `T-UI-032` asserts every value here resolves to a rule that
 * actually exists in `index.css`.
 */
const BUTTON_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn btn--primary tap-target',
  secondary: 'btn btn--secondary tap-target',
  ghost: 'btn btn--ghost tap-target',
  danger: 'btn btn--danger tap-target',
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  /**
   * Defaults to `secondary` — the neutral bordered control.
   *
   * ⚠ `primary` IS THE ONE PER SCREEN that advances the owner's task. Two
   * filled accent buttons beside each other tell them nothing about which is
   * the point, which is the state most of these screens were already in.
   */
  readonly variant?: ButtonVariant | undefined;
}

/**
 * ⚠ `className` IS DELIBERATELY OMITTED FROM THE PROPS. Accepting one would
 * reintroduce per-call-site styling — the exact drift §7d exists to end — and
 * would have to be joined to the variant at runtime, which is the computed
 * `className` `T-CSS-001c` forbids.
 *
 * ⚠ `forwardRef` IS REQUIRED, NOT DECORATIVE. Call sites focus a button
 * imperatively (the dialog focus trap among them), and a primitive that drops
 * the ref breaks focus management silently — the dialog still opens, the
 * keyboard user is simply left behind on the page underneath.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', type = 'button', ...rest },
  ref,
): JSX.Element {
  return <button {...rest} ref={ref} type={type} className={BUTTON_CLASS[variant]} />;
});
