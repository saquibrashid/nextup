/**
 * `useDialogFocus` — the focus contract every modal in this app owes the
 * keyboard and screen-reader user (`T-A11Y-006`, `specs/ui.md` §9 *"Dialogs
 * trap focus, restore it to the trigger on close, and close on `Escape`"*).
 *
 * ⚠ **ALL THREE DIALOGS SHIPPED WITH `aria-modal="true"` AND NONE OF THE
 * BEHAVIOUR IT PROMISES.** `role="dialog"` + `aria-modal` tells assistive
 * technology that the rest of the page is inert. When focus is not actually
 * trapped, that announcement is false in the worst direction: a screen-reader
 * user tabs straight out of the dialog into content their software has been
 * told is not there, with no indication they have left. The attribute made the
 * page *describe* a modal while behaving like an ordinary div — which is
 * strictly worse than never claiming to be modal at all.
 *
 * ⚠ **RESTORING FOCUS IS NOT A COURTESY.** Every one of these dialogs is
 * opened from a control inside a long list. Unmounting without restoring drops
 * focus to `<body>`, so the next Tab starts again from the top of the document
 * — the owner is returned to the start of a list they were part-way down, with
 * no way to know where they were. On the review screen that is the difference
 * between confirming the removals you inspected and hunting for your place.
 *
 * ⚠ **`onDismiss` IS HELD IN A REF ON PURPOSE.** Call sites naturally pass an
 * inline arrow, whose identity changes every render. In the effect's dependency
 * array that would tear down and re-run the whole setup on each render, and the
 * setup *moves focus* — the owner would be thrown back to the first control
 * mid-typing on every keystroke. The listeners are installed once per mount.
 */
import { useEffect, useRef, type RefObject } from 'react';

/**
 * Elements that can hold focus. ⚠ `:not([disabled])` is load-bearing: §6.12
 * disables every control while a close is in flight, and a trap that cycles
 * through disabled buttons traps focus on nothing the owner can act on.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Returns a ref to attach to the dialog's outermost element.
 *
 * The element **must** carry `tabIndex={-1}`: while a close is in flight every
 * control inside is disabled, so there is nothing else to hold focus, and
 * focus falling to `<body>` at that moment escapes the trap entirely.
 */
export function useDialogFocus(onDismiss: () => void): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    // ⚠ Captured BEFORE the first focus move, or the trigger is already gone.
    const trigger = document.activeElement;

    const first = focusable(element)[0];
    (first ?? element).focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (element === null) return;

      if (event.key === 'Escape') {
        event.stopPropagation();
        dismiss.current();
        return;
      }

      if (event.key !== 'Tab') return;

      const items = focusable(element);
      if (items.length === 0) {
        // Nothing to move to, but Tab must still not leave the dialog.
        event.preventDefault();
        element.focus();
        return;
      }

      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (firstItem === undefined || lastItem === undefined) return;

      const active = document.activeElement;
      if (event.shiftKey && (active === firstItem || active === element)) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault();
        firstItem.focus();
      } else if (active !== null && !element.contains(active)) {
        // Focus escaped some other way; pull it back rather than let Tab walk
        // the page behind a dialog that claims the page is inert.
        event.preventDefault();
        firstItem.focus();
      }
    }

    element.addEventListener('keydown', onKeyDown);
    return () => {
      element.removeEventListener('keydown', onKeyDown);
      // ⚠ `isConnected` — the trigger is often a row control inside a list the
      // dialog's own action has just re-rendered away. Focusing a detached
      // node silently sends focus to `<body>`, which is the bug this restore
      // exists to prevent, so only restore to something still on the page.
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  return ref;
}
