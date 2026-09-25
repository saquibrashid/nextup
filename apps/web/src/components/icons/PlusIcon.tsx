// The phone library heading's Add title tool (TASK-255, owner mobile mockup).
//
// Drawn on the 24 px grid, with no colour of its own — see `IconBase`.

import type { JSX } from 'react';

import { IconBase, type IconProps } from './IconBase';

export function PlusIcon({ label }: IconProps): JSX.Element {
  return (
    <IconBase label={label}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </IconBase>
  );
}
