// An uploaded screenshot. ⚠ Screenshots are purged at 30 days (NFR-019) — the TITLES are kept forever (invariant 4).
//
// One of the CLOSED v1 set of thirteen (REQ-124, `specs/ui-refresh.md` §7c).
// Drawn on the 24 px grid, with no colour of its own — see `IconBase`.

import type { JSX } from 'react';

import { IconBase, type IconProps } from './IconBase';

export function ImageIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" />
    </IconBase>
  );
}
