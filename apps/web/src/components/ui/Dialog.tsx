import { useLayoutEffect, type HTMLAttributes, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../../lib/useDialogFocus';

type DialogVariant = 'default' | 'removal' | 'overlay' | 'panel';
const DIALOG_CLASS: Record<DialogVariant, string> = {
  default: 'dialog dialog--overlay',
  removal: 'dialog dialog--overlay removal-confirm',
  overlay: 'dialog dialog--overlay',
  panel: 'dialog dialog--panel',
};

/**
 * ⚠ `panel` IS `overlay` IN EVERY RESPECT EXCEPT WHERE IT SITS. It portals to
 * the same backdrop, locks the same scroll and keeps the same focus contract;
 * only CSS moves it to the edge (a right-hand panel from 640 px, a bottom
 * sheet below it). Giving it its own portal/scroll code would be a second
 * implementation of `T-UI-031f`'s contract that no test is watching.
 */
interface DialogProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className'> {
  onDismiss: () => void;
  variant?: DialogVariant;
  returnFocus?: RefObject<HTMLElement | null>;
  'aria-labelledby': string;
}

export function Dialog({ onDismiss, variant = 'default', returnFocus, ...props }: DialogProps) {
  const ref = useDialogFocus(onDismiss, returnFocus);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const { overflow, scrollbarGutter } = root.style;
    const hasScrollbarSpace = window.innerWidth > root.clientWidth;
    root.style.overflow = 'hidden';
    if (hasScrollbarSpace) root.style.scrollbarGutter = 'stable';
    const background = [...document.body.children].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && !element.contains(ref.current),
    );
    const inert = background.map((element) => element.hasAttribute('inert'));
    background.forEach((element) => element.setAttribute('inert', ''));
    return () => {
      root.style.overflow = overflow;
      root.style.scrollbarGutter = scrollbarGutter;
      background.forEach((element, index) => {
        if (!inert[index]) element.removeAttribute('inert');
      });
    };
  }, [ref]);
  const dialog = (
    <div
      {...props}
      ref={ref}
      className={DIALOG_CLASS[variant]}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
    />
  );
  return createPortal(
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      {dialog}
    </div>,
    document.body,
  );
}
