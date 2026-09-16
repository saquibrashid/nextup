// ⚠ CONSEQUENTIAL, NOT DECORATIVE. §6a.1's removals marker must be non-colour — this is that marker.
//
// One of the CLOSED v1 set of thirteen (REQ-124, `specs/ui-refresh.md` §7c).
// Drawn on the 24 px grid, with no colour of its own — see `IconBase`.

import type { JSX } from 'react';

import { IconBase, type IconProps } from './IconBase';

export function WarningIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <path d="M12 4 2.8 20h18.4z" />
      <path d="M12 10v4.5" />
      <path d="M12 17.25v.5" />
    </IconBase>
  );
}
