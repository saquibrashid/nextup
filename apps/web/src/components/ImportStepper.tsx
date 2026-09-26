/**
 * TASK-260 — the phone import's three-step progress (owner mobile mockup):
 * Service, Mode, Screenshots, joined by a rule, with a check on each answered
 * step.
 *
 * ⚠ **IT REPORTS ANSWERS; IT NEVER GIVES THEM.** A step is `done` only because
 * the owner chose something on the screen, so the stepper can never be the
 * reason a mode is agreed to (US-003 AC-1/AC-2).
 *
 * ⚠ On the Screenshots screen the two answered steps are buttons back to the
 * first screen, where both answers are still checked. Going back clears
 * nothing — the held screenshots stay with the container.
 */

import type { JSX } from 'react';

import { CheckIcon } from './icons';
import { Button } from './ui/Button';
import {
  IMPORT_STEPPER_LABEL,
  IMPORT_STEP_MODE,
  IMPORT_STEP_SCREENSHOTS,
  IMPORT_STEP_SERVICE,
} from '../copy';

export type ImportStepState = 'done' | 'current' | 'upcoming';

export interface ImportStepperProps {
  readonly service: ImportStepState;
  readonly mode: ImportStepState;
  readonly screenshots: ImportStepState;
  /** Present on the Screenshots screen: returns to Service and Mode. */
  readonly onBack?: (() => void) | undefined;
}

export function ImportStepper({
  service,
  mode,
  screenshots,
  onBack,
}: ImportStepperProps): JSX.Element {
  const steps = [
    { label: IMPORT_STEP_SERVICE, state: service, index: 1 },
    { label: IMPORT_STEP_MODE, state: mode, index: 2 },
    { label: IMPORT_STEP_SCREENSHOTS, state: screenshots, index: 3 },
  ] as const;
  return (
    <ol className="import-stepper" aria-label={IMPORT_STEPPER_LABEL} data-testid="import-stepper">
      {steps.map(({ label, state, index }) => {
        const body = (
          <>
            <span className="import-stepper__marker" aria-hidden="true">
              {state === 'done' ? <CheckIcon /> : index}
            </span>
            <span className="import-stepper__label">{label}</span>
            {state === 'done' && <span className="sr-only">, done</span>}
          </>
        );
        return (
          <li
            key={label}
            className="import-stepper__step"
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            {state === 'done' && onBack !== undefined ? (
              <Button
                variant="ghost"
                type="button"
                aria-label={`Back to ${label}`}
                data-testid={`import-step-back-${String(index)}`}
                onClick={onBack}
              >
                {body}
              </Button>
            ) : (
              <span className="import-stepper__static">{body}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
