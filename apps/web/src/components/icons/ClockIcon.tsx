// Runtime ordering for the library sort chooser.
//
// One of the CLOSED Revision 2 set of 21 (REQ-124, `specs/ui-refresh.md` §7c).
// Drawn on the 24 px grid, with no colour of its own — see `IconBase`.

import type { JSX } from 'react';

import { IconBase, type IconProps } from './IconBase';

export function ClockIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2" />
    </IconBase>
  );
}
