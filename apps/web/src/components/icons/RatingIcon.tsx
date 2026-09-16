// The IMDb rating. ⚠ Since `A53` the rating is ALSO a sort key (ADR-0011 Rev 1) — see §7a.
//
// One of the CLOSED v1 set of thirteen (REQ-124, `specs/ui-refresh.md` §7c).
// Drawn on the 24 px grid, with no colour of its own — see `IconBase`.

import type { JSX } from 'react';

import { IconBase, type IconProps } from './IconBase';

export function RatingIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <path d="m12 4 2.5 5.1 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z" />
    </IconBase>
  );
}
