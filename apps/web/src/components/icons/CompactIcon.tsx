import type { JSX } from 'react';
import { IconBase, type IconProps } from './IconBase';

export function CompactIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <path d="M9 5h12M9 12h12M9 19h12" />
      <rect x="3" y="3" width="3" height="4" rx="0.5" />
      <rect x="3" y="10" width="3" height="4" rx="0.5" />
      <rect x="3" y="17" width="3" height="4" rx="0.5" />
    </IconBase>
  );
}
