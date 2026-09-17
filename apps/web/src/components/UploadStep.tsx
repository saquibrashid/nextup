/**
 * The `/upload` wizard's step chrome (issue #287, `specs/ui.md` §3.0).
 *
 * ⚠ **PROGRESSIVE REVEAL IS PRESENTATION ONLY. IT DOES NOT DEFAULT ANYTHING.**
 * US-003 AC-1/AC-2 and REQ-002/REQ-003 forbid a default that can be accepted
 * by inaction, and the step that would matter — full update — proposes
 * removals. Every step still starts unanswered; what changes is only which
 * question is asked first.
 *
 * ⚠ **A LOCKED STEP IS DIMMED AND DISABLED, NEVER REMOVED.** `hidden`, an
 * unmounted branch or `display: none` would take the question out of the
 * accessibility tree entirely, so a screen-reader owner would not know the
 * step exists, would not know why it cannot be answered, and would meet it
 * appearing out of nowhere. The controls stay in the DOM, stay announced, and
 * point at the hint that says what to do first via `aria-describedby`.
 *
 * ⚠ **AN ANSWERED STEP COLLAPSES TO ITS ANSWER, AND THAT IS THE ONLY PLACE
 * `hidden` IS USED HERE.** It is applied to the BODY of a step the owner has
 * already answered, with the answer itself rendered beside a labelled `Change`
 * button in the head — so nothing is silently unreachable. That is the whole
 * point of the redesign: on a phone the three steps did not fit on one screen,
 * and the owner had to scroll past two answered questions to reach the submit.
 */

import type { JSX, ReactNode } from 'react';

import { Button } from './ui/Button';
import { STEP_CHANGE_LABEL } from '../copy';

/**
 * `locked` — cannot be answered yet; `active` — being answered; `done` —
 * answered and collapsed.
 *
 * ⚠ There is deliberately no `waiting` member. Step 3 is ALWAYS `active`: it
 * accepts images before the questions above are answered, because
 * `ImageDropzone`/`PasteButton` hold what arrives early (`ux-states.md` §4.3)
 * and the owner's primary path is pasting the moment they have a screenshot. A
 * state that dimmed it would advertise the opposite of what it does.
 */
export type UploadStepState = 'locked' | 'active' | 'done';

export interface UploadStepProps {
  /** 1-based, for the visible marker only — never the source of order. */
  readonly index: number;
  readonly legend: string;
  readonly state: UploadStepState;
  /** The collapsed summary. Required when `state` is `done`. */
  readonly answer?: string | null;
  /** Why the step cannot be answered yet, or what will happen to early input. */
  readonly hint?: string | null;
  /** The id a locked step's controls point at with `aria-describedby`. */
  readonly hintId?: string;
  readonly onChange?: (() => void) | undefined;
  readonly testId: string;
  readonly children: ReactNode;
}

export function UploadStep({
  index,
  legend,
  state,
  answer = null,
  hint = null,
  hintId,
  onChange,
  testId,
  children,
}: UploadStepProps): JSX.Element {
  const done = state === 'done';
  return (
    <section className="upload-step" data-state={state} data-testid={testId}>
      <div className="upload-step__head">
        {/*
          ⚠ `aria-hidden`: the number is a visual landmark, and announcing
          "1 ✓" before every heading is noise. The heading text is the step.
        */}
        <span className="upload-step__index" aria-hidden="true">
          {done ? '✓' : index}
        </span>
        <div className="upload-step__titles">
          <h2 className="upload-step__legend">{legend}</h2>
          {done && answer !== null && (
            <p className="upload-step__answer" data-testid={`${testId}-answer`}>
              {answer}
            </p>
          )}
          {!done && hint !== null && (
            <p className="upload-step__hint" id={hintId} data-testid={`${testId}-hint`}>
              {hint}
            </p>
          )}
        </div>
        {done && onChange !== undefined && (
          <Button
            variant="secondary"
            data-testid={`${testId}-change`}
            onClick={onChange}
            type="button"
          >
            {STEP_CHANGE_LABEL}
          </Button>
        )}
      </div>
      {/*
        ⚠ `hidden` ONLY when answered — see the file header. A locked step's
        body stays in the tree, disabled and described by the hint above.
      */}
      <div className="upload-step__body" hidden={done}>
        {children}
      </div>
    </section>
  );
}
