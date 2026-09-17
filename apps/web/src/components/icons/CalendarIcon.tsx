// Release-year ordering for the library sort chooser.
//
// One of the CLOSED Revision 2 set of 21 (REQ-124, `specs/ui-refresh.md` §7c).
// Drawn on the 24 px grid, with no colour of its own — see `IconBase`.

import type { JSX } from 'react';

import { IconBase, type IconProps } from './IconBase';

export function CalendarIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M4 10h16" />
      <path d="M8 14h2" />
      <path d="M14 14h2" />
      <path d="M8 17h2" />
    </IconBase>
  );
}
