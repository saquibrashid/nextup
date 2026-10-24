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

import { useEffect, useRef, type JSX, type ReactNode, type Ref } from 'react';

import type { TitleListItem } from './TitleRow';
import { Button } from './ui/Button';
import { CheckIcon, CloseIcon, RefreshIcon, SuppressedIcon } from './icons';
import {
  OFFLINE_DISABLED_REASON,
  ROW_MENU_FINISHED_LABEL,
  ROW_MENU_FINISHED_SHORT_LABEL,
  ROW_MENU_REMOVE_LABEL,
  ROW_MENU_REMOVE_SHORT_LABEL,
} from '../copy';

export type RowMenuChoice = 'suppress' | 'fix-match' | 'remove' | 'finished';

export interface RowMenuProps {
  readonly item: TitleListItem;
  /**
   * §2.12 — the list is read-only offline. Every mutating item is disabled
   * and the reason is stated as visible text; the menu itself still closes
   * (Escape, an outside press, and the phone sheet's **Close**), because a
   * menu the owner cannot close is worse than one they cannot use.
   */
  readonly offline?: boolean;
  /**
   * ⚠ **THE REMOVE ITEM IS RENDERED ONLY WHEN ITS DIALOG CAN BE.** `ListPage`
   * mounts `RemoveTitleDialog` only when BOTH `onRemoveTitle` and
   * `onRestoreListing` are wired (it needs the undo as much as the call), so
   * an unconditional item would open nothing on a container that wired the
   * other handlers. That present-but-dead shape is exactly the defect
   * `rowMenu.spec.tsx` was written after — a finished dialog mounted by
   * nothing, with a green suite over it. Defaults to `false`: a caller that
   * forgets to pass it loses an affordance, which is visible, rather than
   * gaining an inert one, which is not.
   */
  readonly canRemove?: boolean;
  /**
   * US-074 — "Finished watching", rendered only when `ListPage` can mount its
   * dialog. ⚠ It is LAST, nearest the thumb: it is the least destructive item
   * (nothing leaves the Library without a further confirm), and the more
   * destructive items sit further from it.
   */
  readonly canFinish?: boolean;
  readonly onChoose: (choice: RowMenuChoice) => void;
  readonly onDismiss: () => void;
}

/** §2.2 names both items; the wording is the spec's, not a paraphrase. */
export const ROW_MENU_SUPPRESS_LABEL = 'Not interested';
export const ROW_MENU_FIX_MATCH_LABEL = 'Fix match';
/** Accessible name of the phone sheet's close control (#471). */
export const ROW_MENU_CANCEL_LABEL = 'Close menu';

interface MenuRowProps {
  readonly testId: string;
  readonly label: string;
  readonly fullLabel?: string;
  readonly icon: ReactNode;
  readonly disabled: boolean;
  readonly danger?: boolean;
  readonly innerRef?: Ref<HTMLButtonElement>;
  readonly onClick: () => void;
}

// #471 — a plain row, not a `Button`: the §7d variants are bordered, bold
// controls and this menu exists to be lighter than that. The visible label is
// short so it never wraps; the full wording is the accessible name and tooltip.
function MenuRow({
  testId,
  label,
  fullLabel,
  icon,
  disabled,
  danger = false,
  innerRef,
  onClick,
}: MenuRowProps): JSX.Element {
  return (
    <Button
      variant="ghost"
      ref={innerRef}
      role="menuitem"
      data-testid={testId}
      {...(danger ? { 'data-tone': 'danger' } : {})}
      disabled={disabled}
      title={fullLabel ?? label}
      {...(fullLabel === undefined ? {} : { 'aria-label': fullLabel })}
      onClick={onClick}
    >
      {icon}
      <span className="row-menu__label">{label}</span>
    </Button>
  );
}

export function RowMenu({
  item,
  offline = false,
  canRemove = false,
  canFinish = false,
  onChoose,
  onDismiss,
}: RowMenuProps): JSX.Element {
  const menu = useRef<HTMLDivElement>(null);
  const firstItem = useRef<HTMLButtonElement>(null);
  const closeItem = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);

  // The menu opens in response to a keyboard or pointer activation, so focus
  // has to follow it: leaving focus on the `⋮` behind an open menu strands a
  // keyboard owner outside the thing they just opened.
  //
  // ⚠ OFFLINE THE FIRST ITEM IS DISABLED, and `focus()` on a disabled button
  // does nothing at all — silently. Focus would stay on the `⋮`, which is the
  // precise stranding this effect exists to prevent, so the fallback is the
  // phone sheet's **Close** when it is visible and otherwise the menu itself.
  useEffect(() => {
    if (trigger.current === null && document.activeElement instanceof HTMLElement)
      trigger.current = document.activeElement;
    if (!offline) {
      firstItem.current?.focus();
      return;
    }
    const close = closeItem.current;
    (close !== null && close.offsetParent !== null ? close : menu.current)?.focus();
  }, [offline]);

  const returnFocus = (): void => {
    trigger.current?.focus({ preventScroll: true });
  };
  const dismiss = (): void => {
    returnFocus();
    onDismiss();
  };
  const choose = (choice: RowMenuChoice): void => {
    returnFocus();
    onChoose(choice);
  };

  // An outside press closes the menu. The row's own actions box is "inside":
  // pressing the `⋮` again is that button's job, and treating it as outside
  // would close the menu on pointer-down and reopen it on the click.
  useEffect(() => {
    const press = (event: PointerEvent): void => {
      const scope = menu.current?.parentElement ?? menu.current;
      if (scope !== null && scope !== undefined && !scope.contains(event.target as Node))
        onDismiss();
    };
    document.addEventListener('pointerdown', press);
    return () => {
      document.removeEventListener('pointerdown', press);
    };
  }, [onDismiss]);

  return (
    <div
      className="row-menu"
      role="menu"
      ref={menu}
      tabIndex={-1}
      data-testid="row-menu-popup"
      aria-label={`Actions for ${item.name}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') dismiss();
      }}
    >
      {/*
        Groups by intent (#471): dismiss, fix, watching. ⚠ The DISMISS group is
        FIRST, farthest from the thumb, and "Finished" is LAST, nearest it: both
        dismiss items hide the row, so whichever is nearest is the one a hurried
        owner picks, and "Not interested" is the irreversible-by-default one
        (it survives every future upload, keyed on work identity — REQ-071).
        "Remove" sits below it: recoverable, but still destructive to a real
        work. ⚠ Every mutating item is disabled offline (§2.12): a remove that
        appeared to work and then did not would look exactly like the data loss
        the removed log exists to disprove.
      */}
      <MenuRow
        innerRef={firstItem}
        testId="row-menu-suppress"
        label={ROW_MENU_SUPPRESS_LABEL}
        icon={<SuppressedIcon />}
        disabled={offline}
        danger
        onClick={() => {
          choose('suppress');
        }}
      />
      {canRemove && (
        <MenuRow
          testId="row-menu-remove"
          label={ROW_MENU_REMOVE_SHORT_LABEL}
          fullLabel={ROW_MENU_REMOVE_LABEL}
          icon={<CloseIcon />}
          disabled={offline}
          danger
          onClick={() => {
            choose('remove');
          }}
        />
      )}
      <div className="row-menu__divider" role="separator" />
      <MenuRow
        testId="row-menu-fix-match"
        label={ROW_MENU_FIX_MATCH_LABEL}
        icon={<RefreshIcon />}
        disabled={offline}
        onClick={() => {
          choose('fix-match');
        }}
      />
      {canFinish && (
        <>
          <div className="row-menu__divider" role="separator" />
          <MenuRow
            testId="row-menu-finished"
            label={ROW_MENU_FINISHED_SHORT_LABEL}
            fullLabel={ROW_MENU_FINISHED_LABEL}
            icon={<CheckIcon />}
            disabled={offline}
            onClick={() => {
              choose('finished');
            }}
          />
        </>
      )}
      {offline && (
        <span className="offline-reason" data-testid="row-menu-offline-reason">
          {OFFLINE_DISABLED_REASON}
        </span>
      )}
      {/* Shown only in the phone sheet (CSS); desktop closes on Escape or an outside press. */}
      <Button
        variant="ghost"
        role="menuitem"
        data-menu-close=""
        ref={closeItem}
        data-testid="row-menu-cancel"
        aria-label={ROW_MENU_CANCEL_LABEL}
        onClick={dismiss}
      >
        Close
      </Button>
    </div>
  );
}
