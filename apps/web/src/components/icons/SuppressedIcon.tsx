// "Not interested" — keyed on canonical WORK IDENTITY, not on a row (invariant 1).
//
// One of the CLOSED v1 set of thirteen (REQ-124, `specs/ui-refresh.md` §7c).
// Drawn on the 24 px grid, with no colour of its own — see `IconBase`.

import type { JSX } from 'react';

import { IconBase, type IconProps } from './IconBase';

export function SuppressedIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A9.9 9.9 0 0 1 12 5c5 0 9 4.5 9 7a11 11 0 0 1-2.4 3.6" />
      <path d="M6.2 7.4C4.2 8.9 3 10.9 3 12c0 2.5 4 7 9 7a9.6 9.6 0 0 0 4.1-.9" />
      <path d="M9.9 10.1a3 3 0 0 0 4.1 4.2" />
    </IconBase>
  );
}
