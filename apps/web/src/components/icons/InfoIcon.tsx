// `specs/ui.md` prose has referred to an "info icon" since before one existed.
//
// One of the CLOSED v1 set of thirteen (REQ-124, `specs/ui-refresh.md` §7c).
// Drawn on the 24 px grid, with no colour of its own — see `IconBase`.

import type { JSX } from 'react';

import { IconBase, type IconProps } from './IconBase';

export function InfoIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.75v.5" />
    </IconBase>
  );
}
