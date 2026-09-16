import type { JSX } from 'react';
import { IconBase, type IconProps } from './IconBase';

export function GridIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </IconBase>
  );
}
