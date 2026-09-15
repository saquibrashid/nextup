import type { HTMLAttributes } from 'react';

export function Card(props: Omit<HTMLAttributes<HTMLDivElement>, 'className'>) {
  return <div {...props} className="card" />;
}
