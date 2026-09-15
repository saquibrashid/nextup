// ⚠ NEVER THE SOLE SIGNAL OF STATE. Colour-or-glyph alone fails §10; a marker pairs with a label.
//
// One of the CLOSED v1 set of thirteen (REQ-124, `specs/ui-refresh.md` §7c).
// Drawn on the 24 px grid, with no colour of its own — see `IconBase`.

import type { JSX } from 'react';

import { IconBase, type IconProps } from './IconBase';

export function CheckIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <path d="m4.5 12.5 5 5 10-11" />
    </IconBase>
  );
}
