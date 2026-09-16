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
    panel.current
      ?.querySelector<HTMLElement>(
        'input:not(:disabled), button:not(:disabled), a[href], select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
      )
      ?.focus();

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
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        // Tab follows the document order; do not pull focus back into the picker.
        setOpen(false);
      }
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
