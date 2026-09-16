// Dismiss. Every dialog also answers to `Esc` (§7d) — this is never the only way out.
//
// One of the CLOSED v1 set of thirteen (REQ-124, `specs/ui-refresh.md` §7c).
// Drawn on the 24 px grid, with no colour of its own — see `IconBase`.

import type { JSX } from 'react';

import { IconBase, type IconProps } from './IconBase';

export function CloseIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </IconBase>
  );
}
