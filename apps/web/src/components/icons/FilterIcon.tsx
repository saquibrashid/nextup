// The library toolbar's Filters trigger (issue 370, ADR-0013 Revision 3).
//
// Drawn on the 24 px grid, with no colour of its own — see `IconBase`.

import type { JSX } from 'react';

import { IconBase, type IconProps } from './IconBase';

export function FilterIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <path d="M4 7h16" />
      <path d="M7 12h10" />
      <path d="M10 17h4" />
    </IconBase>
  );
}
