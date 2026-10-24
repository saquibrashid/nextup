// #467/#470 — the overflow menu on a Waiting card. "Not interested" is a rare
// action, so it lives here instead of repeating at full weight on every card.
//
// ⚠ It does not change what the action DOES: choosing it calls the same
// suppression the button always did, keyed on work identity (REQ-071).

import { useEffect, useRef, useState, type JSX } from 'react';

import { MoreIcon, SuppressedIcon } from './icons';
import { ROW_MENU_CANCEL_LABEL } from './RowMenu';
import { Button } from './ui/Button';
import { OFFLINE_DISABLED_REASON, WAITING_NOT_INTERESTED } from '../copy';

export interface WaitingRowMenuProps {
  readonly name: string;
  readonly offline: boolean;
  readonly onSuppress: () => void;
}

export function WaitingRowMenu({ name, offline, onSuppress }: WaitingRowMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  return (
    <span
      className="waiting-row__menu"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <Button
        ref={trigger}
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${name}`}
        data-testid="waiting-row-menu"
        onClick={() => setOpen((previous) => !previous)}
      >
        <MoreIcon />
      </Button>
      {open && (
        <div
          className="row-menu waiting-row__menu-panel"
          role="menu"
          aria-label={`Actions for ${name}`}
        >
          <Button
            variant="ghost"
            role="menuitem"
            data-tone="danger"
            data-testid="waiting-not-interested"
            aria-label={`${WAITING_NOT_INTERESTED}: ${name}`}
            title={WAITING_NOT_INTERESTED}
            disabled={offline}
            autoFocus
            onClick={() => {
              setOpen(false);
              onSuppress();
            }}
          >
            <SuppressedIcon />
            <span className="row-menu__label">{WAITING_NOT_INTERESTED}</span>
          </Button>
          {offline && <span className="offline-reason">{OFFLINE_DISABLED_REASON}</span>}
          {/* Shown only in the phone sheet (CSS); desktop closes on Escape or an outside press. */}
          <Button
            variant="ghost"
            role="menuitem"
            data-menu-close=""
            aria-label={ROW_MENU_CANCEL_LABEL}
            onClick={() => {
              setOpen(false);
              trigger.current?.focus();
            }}
          >
            Close
          </Button>
        </div>
      )}
    </span>
  );
}
