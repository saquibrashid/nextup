/**
 * TASK-102's unfinished half — the §2.3 row menu (`specs/ui.md` §2.2/§2.3,
 * `specs/ux-states.md` §3.1, `T-UX-030`).
 *
 * ⚠ THIS COMPONENT EXISTS BECAUSE TWO FINISHED FEATURES WERE UNREACHABLE.
 * `SuppressDialog` (TASK-102) and `FixMatchDialog` (TASK-111) were both built,
 * both fully unit-tested and both mounted by nothing: `TitleRow` rendered the
 * `⋮` and the "Find a match" button, but `ListPage` never passed `onOpenMenu`
 * or `onFixMatch`, so `onOpenMenu?.(item)` optional-chained to `undefined` on
 * every click. The buttons were present, focusable, correctly labelled and
 * inert — which is precisely why no test caught it. An a11y or tap-target
 * sweep counts a button that does nothing; only a test that asserts what
 * happens AFTER the click can tell the difference.
 *
 * US-030 AC-1 ("the owner chooses fix match ... from the row") and US-027's
 * row entry were therefore both unmet in the running app while every named
 * test for them passed.
 *
 * ⚠ THE MENU REPORTS AN INTENT; IT NEVER ACTS. Both items open a dialog that
 * asks for confirmation. `specs/ux-states.md` §3.1 makes the suppress confirm
 * a required state, and a menu item that suppressed on a single tap would turn
 * a mis-tap into a change the owner must then discover and undo.
 */

import { useEffect, useRef, type JSX } from 'react';

import type { TitleListItem } from './TitleRow';
import { OFFLINE_DISABLED_REASON } from '../copy';

export type RowMenuChoice = 'suppress' | 'fix-match';

export interface RowMenuProps {
  readonly item: TitleListItem;
  /**
   * §2.12 — the list is read-only offline. Both mutating items are disabled
   * and the reason is stated as visible text; **Cancel** stays live, because
   * a menu the owner cannot close is worse than one they cannot use.
   */
  readonly offline?: boolean;
  readonly onChoose: (choice: RowMenuChoice) => void;
  readonly onDismiss: () => void;
}

/** §2.2 names both items; the wording is the spec's, not a paraphrase. */
export const ROW_MENU_SUPPRESS_LABEL = 'Not interested';
export const ROW_MENU_FIX_MATCH_LABEL = 'Fix match';
export const ROW_MENU_CANCEL_LABEL = 'Cancel';

export function RowMenu({ item, offline = false, onChoose, onDismiss }: RowMenuProps): JSX.Element {
  const firstItem = useRef<HTMLButtonElement>(null);
  const cancelItem = useRef<HTMLButtonElement>(null);

  // The menu opens in response to a keyboard or pointer activation, so focus
  // has to follow it: leaving focus on the `⋮` behind an open menu strands a
  // keyboard owner outside the thing they just opened.
  //
  // ⚠ OFFLINE THE FIRST ITEM IS DISABLED, and `focus()` on a disabled button
  // does nothing at all — silently. Focus would stay on the `⋮`, which is the
  // precise stranding this effect exists to prevent, so the fallback is
  // **Cancel**: the one item that is still live.
  useEffect(() => {
    (offline ? cancelItem : firstItem).current?.focus();
  }, [offline]);

  return (
    <div
      className="row-menu"
      role="menu"
      data-testid="row-menu-popup"
      aria-label={`Actions for ${item.name}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDismiss();
      }}
    >
      <button
        type="button"
        ref={firstItem}
        role="menuitem"
        className="tap-target"
        data-testid="row-menu-suppress"
        disabled={offline}
        onClick={() => {
          onChoose('suppress');
        }}
      >
        {ROW_MENU_SUPPRESS_LABEL}
      </button>
      <button
        type="button"
        role="menuitem"
        className="tap-target"
        data-testid="row-menu-fix-match"
        disabled={offline}
        onClick={() => {
          onChoose('fix-match');
        }}
      >
        {ROW_MENU_FIX_MATCH_LABEL}
      </button>
      {offline && (
        <span className="offline-reason" data-testid="row-menu-offline-reason">
          {OFFLINE_DISABLED_REASON}
        </span>
      )}
      <button
        type="button"
        role="menuitem"
        ref={cancelItem}
        className="tap-target"
        data-testid="row-menu-cancel"
        onClick={onDismiss}
      >
        {ROW_MENU_CANCEL_LABEL}
      </button>
    </div>
  );
}
