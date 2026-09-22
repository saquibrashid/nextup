import type { JSX } from 'react';

const STAGES = [
  { id: 'prepare', label: 'Prepare' },
  { id: 'read', label: 'Read screenshots' },
  { id: 'review', label: 'Review' },
] as const;

export function CaptureProgress({
  stage,
}: {
  readonly stage: (typeof STAGES)[number]['id'];
}): JSX.Element {
  return (
    <ol className="capture-progress" aria-label="Capture progress">
      {STAGES.map(({ id, label }) => (
        <li key={id} aria-current={stage === id ? 'step' : undefined}>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}
