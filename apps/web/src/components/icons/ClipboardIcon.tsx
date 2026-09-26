// The phone import's Paste card (TASK-260, owner mobile import mockup).
//
// Drawn on the 24 px grid, with no colour of its own — see `IconBase`.

import type { JSX } from 'react';

import { IconBase, type IconProps } from './IconBase';

export function ClipboardIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <rect x="6" y="4.5" width="12" height="16" rx="2" />
      <path d="M9.5 4.5V3.75A.75.75 0 0 1 10.25 3h3.5a.75.75 0 0 1 .75.75v.75" />
      <path d="M9 10h6" />
      <path d="M9 13.5h6" />
      <path d="M9 17h3.5" />
    </IconBase>
  );
}
