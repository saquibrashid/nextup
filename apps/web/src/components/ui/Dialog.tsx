import { useLayoutEffect, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../../lib/useDialogFocus';

type DialogVariant = 'default' | 'removal' | 'overlay';
const DIALOG_CLASS: Record<DialogVariant, string> = {
  default: 'dialog',
  removal: 'dialog removal-confirm',
  overlay: 'dialog dialog--overlay',
};

interface DialogProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className'> {
  onDismiss: () => void;
  variant?: DialogVariant;
  'aria-labelledby': string;
}

export function Dialog({ onDismiss, variant = 'default', ...props }: DialogProps) {
  const ref = useDialogFocus(onDismiss);
  useLayoutEffect(() => {
    if (variant !== 'overlay') return;
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
  return variant === 'overlay'
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
