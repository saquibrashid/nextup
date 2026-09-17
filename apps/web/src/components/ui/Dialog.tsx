import { useLayoutEffect, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../../lib/useDialogFocus';

type DialogVariant = 'default' | 'removal' | 'overlay' | 'panel';
const DIALOG_CLASS: Record<DialogVariant, string> = {
  default: 'dialog',
  removal: 'dialog removal-confirm',
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
const PORTALED: Readonly<Record<DialogVariant, boolean>> = {
  default: false,
  removal: false,
  overlay: true,
  panel: true,
};

interface DialogProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className'> {
  onDismiss: () => void;
  variant?: DialogVariant;
  'aria-labelledby': string;
}

export function Dialog({ onDismiss, variant = 'default', ...props }: DialogProps) {
  const ref = useDialogFocus(onDismiss);
  useLayoutEffect(() => {
    if (!PORTALED[variant]) return;
    const root = document.documentElement;
    const { overflow, scrollbarGutter } = root.style;
    const hasScrollbarSpace = window.innerWidth > root.clientWidth;
    root.style.overflow = 'hidden';
    if (hasScrollbarSpace) root.style.scrollbarGutter = 'stable';
    return () => {
      root.style.overflow = overflow;
      root.style.scrollbarGutter = scrollbarGutter;
    };
  }, [variant]);
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
  return PORTALED[variant]
    ? createPortal(
        <div
          className="dialog-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) onDismiss();
          }}
        >
          {dialog}
        </div>,
        document.body,
      )
    : dialog;
}
