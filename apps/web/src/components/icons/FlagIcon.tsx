// Watch-priority ordering for the library sort chooser.
//
// One of the CLOSED Revision 2 set of 21 (REQ-124, `specs/ui-refresh.md` §7c).
// Drawn on the 24 px grid, with no colour of its own — see `IconBase`.

import type { JSX } from 'react';

import { IconBase, type IconProps } from './IconBase';

export function FlagIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <path d="M5 20V4" />
      <path d="M5 5h11l-1 4 1 4H5" />
    </IconBase>
  );
}
