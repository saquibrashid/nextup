import type { ReactNode } from 'react';

interface FieldsetProps {
  readonly legend: string;
  readonly hideLegend?: boolean;
  readonly disabled?: boolean;
  readonly children: ReactNode;
}

const LEGEND_CLASS = {
  shown: 'segmented__legend',
  hidden: 'segmented__legend segmented__legend--hidden',
} as const;

export function Fieldset({
  legend,
  hideLegend = false,
  disabled = false,
  children,
}: FieldsetProps) {
  const visibility = hideLegend ? 'hidden' : 'shown';
  return (
    <fieldset className="field-group" disabled={disabled}>
      <legend className={LEGEND_CLASS[visibility]}>{legend}</legend>
      {children}
    </fieldset>
  );
}
