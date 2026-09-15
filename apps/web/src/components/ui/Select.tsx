import { forwardRef, type SelectHTMLAttributes } from 'react';

export const Select = forwardRef<
  HTMLSelectElement,
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'>
>(function Select(props, ref) {
  return <select {...props} ref={ref} className="select tap-target" />;
});
