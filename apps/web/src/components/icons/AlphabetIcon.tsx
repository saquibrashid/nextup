// Alphabetical ordering for the library sort chooser.
//
// One of the CLOSED Revision 2 set of 21 (REQ-124, `specs/ui-refresh.md` §7c).
// Drawn on the 24 px grid, with no colour of its own — see `IconBase`.

import type { JSX } from 'react';

import { IconBase, type IconProps } from './IconBase';

export function AlphabetIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <path d="M4 18 8 6l4 12" />
      <path d="M5.5 14h5" />
      <path d="M14 7h6l-6 10h6" />
      <path d="m18 19 2 2 2-2" />
    </IconBase>
  );
}
