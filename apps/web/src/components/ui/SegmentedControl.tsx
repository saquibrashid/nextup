import { useId, type ReactNode } from 'react';

interface SegmentedControlProps {
  legend: string;
  testId?: string;
  /**
   * Render the legend for assistive technology only.
   *
   * ⚠ THE LEGEND IS NEVER DROPPED, ONLY HIDDEN VISUALLY. The `/upload` wizard
   * renders the same question as the step's heading, so showing both prints it
   * twice — but deleting the legend would leave the radio group with no
   * accessible name at all, announcing eight bare service names with nothing
   * saying what is being chosen. The group keeps its name; the sighted reader
   * sees it once.
   */
  hideLegend?: boolean;
  children: ReactNode;
}

const LEGEND_CLASS = {
  shown: 'segmented__legend',
  hidden: 'segmented__legend segmented__legend--hidden',
} as const;

// Native radios retain arrow-key navigation, form semantics and visible selection.
export function SegmentedControl({
  legend,
  testId,
  hideLegend = false,
  children,
}: SegmentedControlProps) {
  const legendId = useId();
  // ⚠ The key is computed FIRST: `T-CSS-001c`'s analyzer harvests map values
  // only for `MAP[identifier]`, so an inline ternary index makes both class
  // names invisible to the vocabulary scan and trips `T-CSS-001b` as unused.
  const legendVisibility = hideLegend ? 'hidden' : 'shown';
  return (
    <fieldset
      className="segmented"
      data-testid={testId}
      role="radiogroup"
      aria-labelledby={legendId}
    >
      <legend className={LEGEND_CLASS[legendVisibility]} id={legendId}>
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}
