// The navigation Menu toggle (issue 369, ADR-0013 Revision 4): three equal
// lines, distinct from `FilterIcon`'s decreasing ones.
//
// Drawn on the 24 px grid, with no colour of its own — see `IconBase`.

import type { JSX } from 'react';

import { IconBase, type IconProps } from './IconBase';

export function MenuIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </IconBase>
  );
}
