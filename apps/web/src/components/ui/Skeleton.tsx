import type { HTMLAttributes } from 'react';

type Shape = 'line' | 'card' | 'poster';
const SKELETON_CLASS: Record<Shape, string> = {
  line: 'skeleton skeleton--line',
  card: 'skeleton skeleton--card',
  poster: 'skeleton skeleton--poster',
};

export function Skeleton({
  shape = 'card',
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, 'className'> & { shape?: Shape }) {
  return <div {...props} className={SKELETON_CLASS[shape]} aria-hidden="true" />;
}
