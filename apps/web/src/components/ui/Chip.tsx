import type { HTMLAttributes } from 'react';

export function Chip(props: Omit<HTMLAttributes<HTMLSpanElement>, 'className'>) {
  return <span {...props} className="chip" />;
}
