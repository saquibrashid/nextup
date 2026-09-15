// REQ-117's overflow AND REQ-105's row menu. ⚠ REQ-107 narrows the BOX, never the 44px tap target (invariant on `.tap-target`).
//
// One of the CLOSED v1 set of thirteen (REQ-124, `specs/ui-refresh.md` §7c).
// Drawn on the 24 px grid, with no colour of its own — see `IconBase`.

import type { JSX } from 'react';

import { IconBase, type IconProps } from './IconBase';

export function MoreIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <circle cx="12" cy="5" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.25" fill="currentColor" stroke="none" />
    </IconBase>
  );
}
