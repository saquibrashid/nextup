import type { HTMLAttributes } from 'react';

export function Badge(props: Omit<HTMLAttributes<HTMLSpanElement>, 'className'>) {
  return <span {...props} className="badge" />;
}
