// The phone import's Full update mode card (TASK-260, owner mobile import mockup).
//
// Drawn on the 24 px grid, with no colour of its own — see `IconBase`.

import type { JSX } from 'react';

import { IconBase, type IconProps } from './IconBase';

export function RefreshIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <path d="M19.5 12a7.5 7.5 0 0 1-13.2 4.9" />
      <path d="M4.5 12a7.5 7.5 0 0 1 13.2-4.9" />
      <path d="M18 3.5v4h-4" />
      <path d="M6 20.5v-4h4" />
    </IconBase>
  );
}
