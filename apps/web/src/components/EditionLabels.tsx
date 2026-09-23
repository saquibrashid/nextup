import { editionLabelText, type EditionLabel } from '@nextup/domain';
import type { JSX } from 'react';

export function EditionLabels({
  labels = [],
}: {
  labels?: readonly EditionLabel[] | undefined;
}): JSX.Element | null {
  if (labels.length === 0) return null;
  return (
    <span data-testid="edition-labels">
      {labels.map((edition) => (
        <span className="edition-label" key={`${edition.kind}:${edition.name}`}>
          {editionLabelText(edition)}
        </span>
      ))}
    </span>
  );
}
