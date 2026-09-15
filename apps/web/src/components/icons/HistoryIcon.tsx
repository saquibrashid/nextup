// The batch history — a LOG, not a recycle bin (invariant 7).
//
// One of the CLOSED v1 set of thirteen (REQ-124, `specs/ui-refresh.md` §7c).
// Drawn on the 24 px grid, with no colour of its own — see `IconBase`.

import type { JSX } from 'react';

import { IconBase, type IconProps } from './IconBase';

export function HistoryIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4v4h4" />
      <path d="M12 7.5V12l3 2" />
    </IconBase>
  );
}
