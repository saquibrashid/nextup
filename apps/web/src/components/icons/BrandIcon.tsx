import type { JSX } from 'react';
import { IconBase, type IconProps } from './IconBase';

export function BrandIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <rect x="2" y="2" width="20" height="20" rx="6" />
      <path d="m8 6 8 6-8 6Z" fill="currentColor" stroke="none" />
      <path d="M18 7v10" />
    </IconBase>
  );
}
