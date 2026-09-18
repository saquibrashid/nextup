import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './ui/Button';
import { ChevronIcon } from './icons';

export interface FilterDisclosureProps {
  readonly label: string;
  readonly children: ReactNode;
  readonly value?: string;
}

export function FilterDisclosure({ label, children, value }: FilterDisclosureProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  function close(): void {
    setOpen(false);
    trigger.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const first = panel.current?.querySelector<HTMLElement>(
      'input:not(:disabled), button:not(:disabled), a[href], select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    );
    /*
     * ⚠ A TEXT FIELD IS NOT AUTOFOCUSED ON A TOUCH DEVICE, AND THAT IS THE
     * WHOLE POINT (TASK-289).
     *
     * Several of these popovers open on a "Search services" box. Focusing it
     * raises the on-screen keyboard, which on a phone covers the very list of
     * checkboxes the owner opened the popover to reach — and it does so before
     * they have asked to type anything. On a desktop, where focusing a search
     * box costs nothing and saves a keystroke, the behaviour is unchanged.
     *
     * The panel itself takes focus instead, so the popover is still announced
     * and still contains focus for anyone navigating by keyboard or screen
     * reader; only the keyboard-raising side effect is dropped.
     */
    const raisesKeyboard =
      first instanceof HTMLInputElement &&
      !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(first.type);
    const coarsePointer =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    if (raisesKeyboard && coarsePointer) panel.current?.focus();
    else first?.focus();

    function onEscape(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }

    function onOutsideClick(event: Event): void {
      if (!(event.target instanceof Node) || root.current?.contains(event.target)) return;
      setOpen(false);
      if (
        document.activeElement === document.body ||
        panel.current?.contains(document.activeElement)
      ) {
        trigger.current?.focus();
      }
    }

    function onFocusLeave(event: FocusEvent): void {
      if (!(event.target instanceof Node) || root.current?.contains(event.target)) return;
      /*
       * ⚠ ONLY A GENUINELY TABBABLE TARGET COUNTS AS THE OWNER MOVING ON, AND
       * THE OWNER HIT THE CASE THIS GUARDS (TASK-289).
       *
       * WebKit does not focus a checkbox, radio or button when it is TAPPED.
       * Tapping a service checkbox inside this popover on iOS instead drops
       * focus onto `div.dialog--panel`, the dialog's `tabIndex={-1}` focus
       * container. That looked exactly like "focus left the picker", so the
       * popover closed on the very tap that ticked the box — every filter
       * behaved as though Done had been pressed, and the phone was unusable
       * for filtering.
       *
       * A `tabIndex` below zero is never somewhere Tab can land, so it is
       * never the owner navigating away; it is the browser parking focus.
       * Tabbing to the next control — a button or input at `tabIndex` 0 —
       * still closes the popover, which is what the document order rule below
       * is for.
       */
      if (!(event.target instanceof HTMLElement) || event.target.tabIndex < 0) return;
      // Tab follows the document order; do not pull focus back into the picker.
      setOpen(false);
    }

    document.addEventListener('keydown', onEscape);
    document.addEventListener('click', onOutsideClick);
    document.addEventListener('focusin', onFocusLeave);
    return () => {
      document.removeEventListener('keydown', onEscape);
      document.removeEventListener('click', onOutsideClick);
      document.removeEventListener('focusin', onFocusLeave);
    };
  }, [open]);

  return (
    <div
      className="filter-disclosure"
      ref={root}
      data-filter-field={value !== undefined || undefined}
    >
      {value !== undefined && (
        <label className="filter-disclosure__label" id={`${id}-label`} htmlFor={`${id}-trigger`}>
          {label}
        </label>
      )}
      <Button
        ref={trigger}
        id={`${id}-trigger`}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        aria-labelledby={value === undefined ? undefined : `${id}-label ${id}-value`}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {value === undefined ? (
          label
        ) : (
          <>
            <span className="filter-disclosure__value" id={`${id}-value`}>
              {value}
            </span>
            <ChevronIcon />
          </>
        )}
      </Button>
      <div
        className="filter-disclosure__panel"
        ref={panel}
        id={`${id}-panel`}
        role="group"
        /* Focusable only programmatically — see the touch-device note above. */
        tabIndex={-1}
        aria-labelledby={value === undefined ? `${id}-trigger` : `${id}-label`}
        hidden={!open}
      >
        {open && (
          <>
            {children}
            <Button onClick={close}>Done</Button>
          </>
        )}
      </div>
    </div>
  );
}
