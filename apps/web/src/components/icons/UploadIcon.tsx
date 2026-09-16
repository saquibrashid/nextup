// REQ-117's second destination, and the ingest affordances of invariant 16.
//
// One of the CLOSED v1 set of thirteen (REQ-124, `specs/ui-refresh.md` §7c).
// Drawn on the 24 px grid, with no colour of its own — see `IconBase`.

import type { JSX } from 'react';

import { IconBase, type IconProps } from './IconBase';

export function UploadIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <path d="M12 16V4" />
      <path d="m8 8 4-4 4 4" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </IconBase>
  );
}
