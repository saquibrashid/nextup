// Disclosure and pagination. Rotated by CSS, never by a second drawing.
//
// One of the CLOSED v1 set of thirteen (REQ-124, `specs/ui-refresh.md` §7c).
// Drawn on the 24 px grid, with no colour of its own — see `IconBase`.

import type { JSX } from 'react';

import { IconBase, type IconProps } from './IconBase';

export function ChevronIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <path d="m9 5 7 7-7 7" />
    </IconBase>
  );
}
