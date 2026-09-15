import type { HTMLAttributes } from 'react';
import { useDialogFocus } from '../../lib/useDialogFocus';

type DialogVariant = 'default' | 'removal';
const DIALOG_CLASS: Record<DialogVariant, string> = {
  default: 'dialog',
  removal: 'dialog removal-confirm',
};

interface DialogProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className'> {
  onDismiss: () => void;
  variant?: DialogVariant;
  'aria-labelledby': string;
}

export function Dialog({ onDismiss, variant = 'default', ...props }: DialogProps) {
  const ref = useDialogFocus(onDismiss);
  return (
    <div
      {...props}
      ref={ref}
      className={DIALOG_CLASS[variant]}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
    />
  );
}
