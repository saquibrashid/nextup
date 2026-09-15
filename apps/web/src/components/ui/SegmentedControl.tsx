import { useId, type ReactNode } from 'react';

interface SegmentedControlProps {
  legend: string;
  testId?: string;
  children: ReactNode;
}

// Native radios retain arrow-key navigation, form semantics and visible selection.
export function SegmentedControl({ legend, testId, children }: SegmentedControlProps) {
  const legendId = useId();
  return (
    <fieldset
      className="segmented"
      data-testid={testId}
      role="radiogroup"
      aria-labelledby={legendId}
    >
      <legend className="segmented__legend" id={legendId}>
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}
