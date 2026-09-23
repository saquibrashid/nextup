import { forwardRef, type InputHTMLAttributes } from 'react';

type InputKind = 'text' | 'choice' | 'file' | 'range';
const INPUT_CLASS: Record<InputKind, string> = {
  text: 'input',
  choice: 'input input--choice',
  file: 'input input--file',
  range: 'input input--range',
};

export const Input = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>
>(function Input({ type = 'text', ...props }, ref) {
  const kind: InputKind =
    type === 'checkbox' || type === 'radio'
      ? 'choice'
      : type === 'file'
        ? 'file'
        : type === 'range'
          ? 'range'
          : 'text';
  return <input {...props} ref={ref} type={type} className={INPUT_CLASS[kind]} />;
});
