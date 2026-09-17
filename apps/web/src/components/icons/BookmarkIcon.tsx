// Date-added ordering for the library sort chooser.
//
// One of the CLOSED Revision 2 set of 21 (REQ-124, `specs/ui-refresh.md` §7c).
// Drawn on the 24 px grid, with no colour of its own — see `IconBase`.

import type { JSX } from 'react';

import { IconBase, type IconProps } from './IconBase';

export function BookmarkIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z" />
    </IconBase>
  );
}
